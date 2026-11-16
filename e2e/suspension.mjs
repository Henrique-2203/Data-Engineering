// Suspensão no Resenha inteiro com prazo: a equipe suspende pelo perfil (1, 3, 7, 30 dias ou até reativar);
// a pessoa cai na hora, não entra (vê o motivo e até quando) e, quando o prazo acaba, volta sozinha.
// Uso: npm run build && node e2e/suspension.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3265;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log(`✓ ${m}`);
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const DATA_DIR = tempDir('resenha-susp-');
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR, PLATFORM_ADMINS: 'equipe' }, stdio: 'ignore' });
const api = async (p, body, token) => {
  const r = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const login = (u) => api('/auth/login', { username: u, password: 'Cor-Forte-Xis-42' });
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const equipe = await reg('equipe', 'Equipe');
  const troll = await reg('troll', 'Troll');
  const ana = await reg('ana', 'Ana');
  const { guild } = await api('/guilds', { name: 'Galera' }, equipe.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, troll.token);

  // só a equipe suspende
  assert((await api(`/admin/users/${troll.user.id}/suspend`, { reason: 'teste', days: 1 }, ana.token)).status === 404, 'quem não é da equipe não suspende');
  // o troll está conectado
  const s = io(BASE, { auth: { token: troll.token }, transports: ['websocket'] });
  await new Promise((r) => s.once('connect', r));
  let dropped = false;
  s.on('disconnect', () => (dropped = true));

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), equipe.token);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 3000 }).catch(() => {});
  await page.locator('.member-list, aside').last().getByText('Troll').first().click();
  await page.getByRole('button', { name: 'Suspender no Resenha' }).click();
  const dlg = page.getByRole('dialog', { name: 'Suspender conta' });
  await dlg.getByLabel('Motivo da suspensão').fill('Vazou dados pessoais de outras pessoas');
  await dlg.getByLabel('Duração da suspensão').selectOption({ label: '1 dia' });
  await page.screenshot({ path: path.resolve('e2e/screenshots/suspender.png') });
  await dlg.getByRole('button', { name: 'Suspender' }).click();
  await page.getByText('@troll suspenso(a) por 1 dia(s).').waitFor();
  const reopen = async () => {
    await page.keyboard.press('Escape');
    await page.locator('.member-list, aside').last().getByText('Troll').first().click();
  };
  await reopen();
  await page.getByText(/Suspensa até/).waitFor();
  for (let i = 0; i < 20 && !dropped; i++) await sleep(200);
  assert(dropped, 'o troll cai na hora');
  assert((await api('/bootstrap', null, troll.token)).status === 401, 'a sessão dele não vale mais');
  const l = await login('troll');
  assert(l.status === 403 && /suspensa até \d\d\/\d\d\/\d{4}/.test(l.error) && /Vazou dados/.test(l.error), `ao entrar, vê o motivo e até quando (${l.error})`);
  step(`equipe suspende pelo perfil por 1 dia: cai na hora e ao entrar vê "${l.error.slice(0, 70)}…"`);

  // reativar
  await page.getByRole('button', { name: 'Reativar conta' }).click();
  await page.getByText('Conta reativada.').waitFor();
  assert((await login('troll')).status === 200, 'reativada: entra de novo');
  step('reativar pelo perfil: entra de novo');

  // suspensão vencida volta sozinha (simula o fim do prazo direto no banco)
  await api(`/admin/users/${troll.user.id}/suspend`, { reason: 'teste', days: 1 }, equipe.token);
  assert((await login('troll')).status === 403, 'suspenso de novo');
  server.kill();
  await new Promise((r) => server.once('exit', r));
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(DATA_DIR);
  await db.query(`update users set suspended_until = now() - interval '1 minute' where username = 'troll'`);
  await db.close();
  const server2 = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR, PLATFORM_ADMINS: 'equipe' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {}
      await sleep(400);
    }
    assert((await login('troll')).status === 200, 'prazo acabou: entra sozinho');
  } finally {
    server2.kill();
  }
  step('quando o prazo acaba, a conta volta ao normal sozinha');
  console.log('\nTUDO CERTO (suspensão com prazo)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
