// TURN: com a Cloudflare configurada, o Resenha entrega só ela (o Metered, de cota pequena, não entra
// e nem é consultado); se a Cloudflare falhar, cai no Metered. As portas 53 da Cloudflare (que o
// navegador bloqueia) são tiradas. A "Cloudflare" aqui é um servidor de mentira local.
// Uso: node e2e/ice.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tempDir } from './_tmp.mjs';

const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

let failCf = false;
let cfCalls = 0;
let lastAuth = '';
const cf = createServer((req, res) => {
  cfCalls++;
  lastAuth = req.headers.authorization ?? '';
  if (failCf) {
    res.statusCode = 500;
    return res.end('erro');
  }
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
      ],
    }),
  );
}).listen(0);
await new Promise((r) => cf.once('listening', r));

async function run(port, failing) {
  failCf = failing;
  const logs = [];
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDir('resenha-ice-'),
      CLOUDFLARE_TURN_KEY_ID: 'chave-teste',
      CLOUDFLARE_TURN_API_TOKEN: 'token-teste',
      CLOUDFLARE_TURN_API_BASE: `http://localhost:${cf.address().port}`,
      METERED_TURN_DOMAIN: 'teste-inexistente.invalid',
      METERED_TURN_API_KEY: 'x',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => logs.push(String(d)));
  server.stderr.on('data', (d) => logs.push(String(d)));
  const BASE = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {}
      await sleep(500);
    }
    const reg = await (await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ana', password: 'Cor-Forte-Xis-42', displayName: 'Ana', acceptTerms: true }) })).json();
    const ice = await (await fetch(`${BASE}/api/ice`, { headers: { authorization: `Bearer ${reg.token}` } })).json();
    await sleep(300);
    return { ice, logs: logs.join('') };
  } finally {
    server.kill();
  }
}

try {
  const ok = await run(3195, false);
  const urls = ok.ice.iceServers.flatMap((s) => [s.urls].flat());
  assert(ok.ice.hasTurn, 'tem TURN');
  assert(urls.includes('turn:turn.cloudflare.com:3478?transport=udp') && urls.includes('turns:turn.cloudflare.com:443?transport=tcp'), `TURN da Cloudflare entregue (${urls.join(', ')})`);
  assert(!urls.some((u) => /:53(\?|$)/.test(u)), 'portas 53 tiradas');
  assert(lastAuth === 'Bearer token-teste', 'credencial da Cloudflare enviada');
  assert(!/Metered/.test(ok.logs), 'com a Cloudflare funcionando, o Metered nem é consultado');
  step('com a Cloudflare configurada, só ela é entregue (sem as portas 53) e o Metered nem é consultado');

  const bad = await run(3196, true);
  const urls2 = bad.ice.iceServers.flatMap((s) => [s.urls].flat());
  assert(!urls2.some((u) => u.includes('cloudflare.com') && u.startsWith('turn')), 'Cloudflare fora do ar: sem TURN dela');
  assert(/falha ao gerar credenciais TURN da Cloudflare/.test(bad.logs) && /Metered/.test(bad.logs), 'Cloudflare falhou: tentou o Metered como reserva');
  step('se a Cloudflare falhar, o Resenha tenta o Metered como reserva');
  console.log('\nTUDO CERTO (TURN)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  cf.close();
}
