// Site de teste x site oficial: o mesmo código, com APP_ENV=staging, avisa que é teste em todo lugar.
// Uso: npm run build && node e2e/envs.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

function start(port, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'resenha-env-'));
  const outbox = path.join(dir, 'outbox.jsonl');
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'db'), EMAIL_PROVIDER: 'file', EMAIL_FROM: 'teste@resenha.app', EMAIL_OUTBOX: outbox, PWNED_CHECK: 'off', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server ${port}] ${d}`));
  return { proc, outbox, base: `http://localhost:${port}` };
}
async function ready(base) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('servidor não subiu');
}

let browser;
const staging = start(3189, { APP_ENV: 'staging', OFFICIAL_URL: 'https://oficial.exemplo' });
const official = start(3190, {});
try {
  await Promise.all([ready(staging.base), ready(official.base)]);
  browser = await chromium.launch();

  // ---------- teste ----------
  const head = await fetch(`${staging.base}/`);
  assert(/noindex/.test(head.headers.get('x-robots-tag') ?? ''), 'site de teste fora dos buscadores');
  assert((await (await fetch(`${staging.base}/api/version`)).json()).env === 'staging', '/api/version diz que é teste');
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto(staging.base);
  await p.getByText('SITE DE TESTE').waitFor();
  assert((await p.getByRole('link', { name: 'Ir para o oficial' }).getAttribute('href')) === 'https://oficial.exemplo', 'link para o oficial');
  await p.waitForFunction(() => document.title.startsWith('[TESTE] '));
  await p.screenshot({ path: path.join(shots, 'site-de-teste.png') });
  await p.goto(`${staging.base}/app`);
  await p.getByText('SITE DE TESTE').waitFor();
  // e-mail do site de teste
  const start1 = await fetch(`${staging.base}/api/auth/register/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ana@exemplo.com', username: 'ana', displayName: 'Ana', password: 'Cor-Forte-Xis-42', acceptTerms: true }),
  });
  assert(start1.ok, `cadastro no teste (${start1.status})`);
  const mails = readFileSync(staging.outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert(mails.length && mails.every((m) => m.subject.startsWith('[TESTE] ')), `e-mails do teste com [TESTE] (${mails.map((m) => m.subject)})`);
  step('site de teste: faixa "SITE DE TESTE" (site e app), [TESTE] na aba e nos e-mails, fora dos buscadores');

  // ---------- oficial ----------
  const headO = await fetch(`${official.base}/`);
  assert(!headO.headers.get('x-robots-tag'), 'oficial aparece nos buscadores');
  const o = await (await browser.newContext()).newPage();
  await o.goto(official.base);
  await o.getByRole('heading', { name: /Sua call/ }).waitFor();
  await sleep(800);
  assert(!(await o.getByText('SITE DE TESTE').count()), 'oficial sem a faixa');
  assert(!(await o.title()).startsWith('[TESTE]'), 'oficial sem [TESTE] na aba');
  await fetch(`${official.base}/api/auth/register/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bia@exemplo.com', username: 'bia', displayName: 'Bia', password: 'Cor-Forte-Xis-42', acceptTerms: true }),
  });
  const omails = existsSync(official.outbox) ? readFileSync(official.outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  assert(omails.length && omails.every((m) => !m.subject.startsWith('[TESTE]')), 'e-mails do oficial sem [TESTE]');
  step('site oficial: igual a antes (sem faixa, sem [TESTE])');
  console.log('\nTUDO CERTO (site de teste x oficial)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  staging.proc.kill();
  official.proc.kill();
}
