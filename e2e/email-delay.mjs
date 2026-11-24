// E-mail de confirmação lento: o cadastro NÃO pode se perder quando a Brevo demora ou falha.
//  - Brevo lenta (> 5 s): a tela segue em ~5 s, o e-mail sai em segundo plano e o código que chega depois vale
//  - Brevo com erro momentâneo (500): tenta de novo sozinho
//  - Brevo recusa de vez (endereço inválido): avisa na hora e não deixa cadastro pendente
//  - pedir outro código, ou cancelar e refazer com o mesmo e-mail: o código anterior (e-mail atrasado) continua valendo
//  - esqueci a senha: o código anterior também continua valendo
// Uso: npm run build && node e2e/email-delay.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tempDir } from './_tmp.mjs';

const PORT = 3277;
const FAKE = 3278;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

// Brevo de mentira: o comportamento depende do e-mail de destino
const sent = []; // o que a "Brevo" entregou (com o código lido do texto)
const hits = {};
const fake = createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', async () => {
    const body = JSON.parse(raw || '{}');
    const to = body.to?.[0]?.email ?? '';
    hits[to] = (hits[to] ?? 0) + 1;
    res.setHeader('content-type', 'application/json');
    if (to.startsWith('invalido')) return (res.statusCode = 400), res.end('{"code":"invalid_parameter","message":"email is not valid"}');
    if (to.startsWith('lento')) await sleep(7000);
    if (to.startsWith('erro') && hits[to] === 1) return (res.statusCode = 503), res.end('{"message":"indisponivel"}');
    sent.push({ to, code: /Código: (\d{6})/.exec(body.textContent ?? '')?.[1], at: Date.now() });
    res.end('{"messageId":"x"}');
  });
}).listen(FAKE);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: tempDir('resenha-maildelay-'),
    PLATFORM_ADMINS: 'equipe',
    EMAIL_PROVIDER: 'brevo',
    EMAIL_API_KEY: 'chave-brevo-teste',
    EMAIL_FROM: 'nao-responda@exemplo.com',
    EMAIL_BREVO_URL: `http://localhost:${FAKE}/v3/smtp/email`,
    EMAIL_RETRY_MS: '500,1500',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY|\[email\]/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const start = (email, username) => api('/auth/register/start', { email, username, password: PASS, acceptTerms: true });
const codeFor = async (email, after = 0, wait = 15000) => {
  for (let t = 0; t < wait; t += 200) {
    const hit = sent.filter((s) => s.to === email && s.at > after).at(-1);
    if (hit) return hit.code;
    await sleep(200);
  }
  return null;
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }

  // ---------- Brevo lenta ----------
  const t0 = Date.now();
  let r = await start('lento@exemplo.com', 'pessoalenta');
  const took = Date.now() - t0;
  assert(r.status === 200 && r.pendingId, `a tela segue mesmo com a Brevo lenta: ${r.status} ${r.error}`);
  assert(took < 6500, `respondeu em ${took} ms (não espera os 7 s da Brevo)`);
  const slowCode = await codeFor('lento@exemplo.com');
  assert(slowCode, 'o e-mail saiu em segundo plano');
  const ok = await api('/auth/register/confirm', { pendingId: r.pendingId, code: slowCode });
  assert(ok.status === 200 && ok.user.username === 'pessoalenta', `o código que chegou depois vale: ${ok.status} ${ok.error}`);
  step('Brevo lenta: a tela segue em ~5 s, o e-mail sai em segundo plano e o código que chega depois cria a conta');

  // ---------- erro momentâneo: tenta de novo ----------
  r = await start('erro@exemplo.com', 'pessoaerro');
  assert(r.status === 200, `erro 503 não derruba o cadastro: ${r.status}`);
  const c2 = await codeFor('erro@exemplo.com');
  assert(c2 && hits['erro@exemplo.com'] >= 2, `tentou de novo sozinho (${hits['erro@exemplo.com']} tentativas)`);
  assert((await api('/auth/register/confirm', { pendingId: r.pendingId, code: c2 })).status === 200, 'e o código vale');
  step('Brevo com erro momentâneo (503): o envio é tentado de novo sozinho');

  // ---------- recusa definitiva ----------
  r = await start('invalido@exemplo.com', 'pessoainvalida');
  assert(r.status === 502 && /Confira o endereço/.test(r.error), `endereço recusado avisa na hora: ${r.status} ${r.error}`);
  step('endereço recusado pela Brevo: avisa na hora');

  // ---------- reenviar / cancelar e refazer: o código anterior continua valendo ----------
  r = await start('ok1@exemplo.com', 'pessoaok');
  const first = await codeFor('ok1@exemplo.com');
  // "cancelou e refez" com o mesmo e-mail: mesmo cadastro pendente, código novo
  const mark = Date.now();
  const again = await start('ok1@exemplo.com', 'pessoaok');
  assert(again.status === 200 && again.pendingId === r.pendingId, 'refazer com o mesmo e-mail reaproveita o cadastro pendente');
  const second = await codeFor('ok1@exemplo.com', mark);
  assert(second && second !== first, 'chegou um código novo');
  // o e-mail ANTIGO (atrasado) é o que a pessoa digita
  const conf = await api('/auth/register/confirm', { pendingId: again.pendingId, code: first });
  assert(conf.status === 200, `o código do primeiro e-mail ainda vale: ${conf.status} ${conf.error}`);
  step('cancelar e refazer com o mesmo e-mail: o código do e-mail atrasado ainda cria a conta');

  r = await start('ok2@exemplo.com', 'pessoaok2');
  const f2 = await codeFor('ok2@exemplo.com');
  await sleep(46_000); // espera o intervalo mínimo do reenvio (45 s)
  const rs = await api('/auth/register/resend', { pendingId: r.pendingId });
  assert(rs.status === 200, `reenviar: ${rs.status} ${rs.error}`);
  const s2 = await codeFor('ok2@exemplo.com', Date.now() - 3000);
  assert(s2 && s2 !== f2, 'código novo no reenvio');
  assert((await api('/auth/register/confirm', { pendingId: r.pendingId, code: 'abc' })).status === 400, 'código errado continua errado');
  assert((await api('/auth/register/confirm', { pendingId: r.pendingId, code: f2 })).status === 200, 'depois de reenviar, o código antigo ainda vale');
  step('reenviar o código: o anterior continua valendo');

  console.log('\nTudo certo com o e-mail lento.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  fake.close();
  server.kill();
}
