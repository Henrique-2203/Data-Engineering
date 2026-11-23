// Medidor de internet do servidor (Painel da equipe → Sistema): conta o que sai do servidor no mês,
// continua depois de uma atualização (o Render reinicia o servidor) e mostra o custo estimado.
// Uso: npm run build && node e2e/bandwidth.mjs
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tempDir } from './_tmp.mjs';

const PORT = 3215;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = tempDir('resenha-bw-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log(`✓ ${m}`);
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const start = () => {
  const p = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, PLATFORM_ADMINS: 'equipe', BANDWIDTH_FREE_GB: '0.005', BANDWIDTH_ALERT_GB: '1', BANDWIDTH_PRICE_USD: '100' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  p.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
  return p;
};
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('servidor não subiu');
};
const api = async (p, body, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};

let server = start();
try {
  await up();
  const equipe = await api('/auth/register', { username: 'equipe', password: 'Cor-Forte-Xis-42', displayName: 'Equipe', acceptTerms: true });
  const js = readdirSync('client/dist/assets').find((f) => /^index-.*\.js$/.test(f));
  // 10 downloads do app sem compactar (~0,9 MB cada)
  for (let i = 0; i < 10; i++) await (await fetch(`${BASE}/assets/${js}`, { headers: { 'accept-encoding': 'identity' } })).arrayBuffer();
  let bw = (await api('/admin/capacity', null, equipe.token)).bandwidth;
  assert(bw.monthMb >= 9 && bw.monthMb < 20, `contou ~9 MB (${bw.monthMb} MB)`);
  assert(bw.costUsd > 0, `passou da parte grátis do teste (5 MB): custo estimado ${bw.costUsd}`);
  step(`10 downloads do app: ${bw.monthMb} MB este mês, custo estimado US$ ${bw.costUsd}`);

  // o Render reinicia o servidor a cada atualização: o número continua
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  server = start();
  await up();
  const login = await api('/auth/login', { login: 'equipe', username: 'equipe', password: 'Cor-Forte-Xis-42' });
  bw = (await api('/admin/capacity', null, login.token)).bandwidth;
  assert(bw.monthMb >= 9, `depois de reiniciar continua contando (${bw.monthMb} MB)`);
  step(`depois de reiniciar o servidor, continua: ${bw.monthMb} MB`);
  console.log('\nTUDO CERTO (medidor de internet)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server.kill();
}
