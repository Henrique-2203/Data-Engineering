// Card de apoio "depois de gostar" e barra da meta do mês.
//  - quem acabou de chegar (sem calls nem mensagens) não vê pedido nenhum
//  - quem já usa (3 calls neste aparelho) vê o card uma vez; fechar some de vez no mês (também em outro aparelho)
//  - a barra mostra só o total do mês (soma dos apoios confirmados), sem nomes; quem já apoiou não vê o card
//  - a equipe pode esconder a barra
// Uso: npm run build && node e2e/apoio-card.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3214;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-apoiocard-'), PLATFORM_ADMINS: 'equipe', APOIO_CARD_MIN_DAYS: '0' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const equipe = await reg('equipe', 'Equipe');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const base = (await api('/admin/apoio', null, equipe.token)).settings;
  const settings = { ...base, enabled: true, pixKey: '7d3c2a1b-4e5f-4a6b-8c9d-0e1f2a3b4c5d', name: 'Equipe Resenha', city: 'Sao Paulo', deadline: '2099-12-31', monthlyGoalCents: 10000, showMonthly: true };
  assert((await api('/admin/apoio', settings, equipe.token, 'PUT')).open, 'apoio aberto');

  // a Bia apoiou com R$ 35 (confirmado pela equipe neste mês)
  await api('/apoio', null, bia.token);
  await api('/apoio/claim', {}, bia.token);
  await api(`/admin/apoio/${bia.user.id}/confirm`, { amountCents: 3500 }, equipe.token);

  // pela API: quem acabou de chegar não vê; com 3 calls vê; a barra só tem o total
  assert((await api('/apoio', null, ana.token)).card === false, 'sem calls e sem mensagens: nada de card');
  let a = await api('/apoio?calls=3', null, ana.token);
  assert(a.card === true, 'com 3 calls: card liberado');
  assert(a.monthly?.cents === 3500 && a.monthly.goalCents === 10000, `total do mês R$ 35 de R$ 100 (${JSON.stringify(a.monthly)})`);
  assert(!JSON.stringify(a.monthly).includes('bia'), 'a barra não diz quem apoiou');
  assert((await api('/apoio?calls=3', null, bia.token)).card === false, 'quem já apoiou não vê o card');
  step('o card só vem para quem já usa (3 calls ou mensagens); quem acabou de chegar ou já apoiou não vê; a barra tem só o total');

  browser = await chromium.launch();
  const open = async (token, device) => {
    const ctx = await browser.newContext(device ?? { viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.callsJoined', '3');
      localStorage.setItem('resenha.androidBanner', '1');
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.clock.install();
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };

  // computador: o card aparece depois de um tempo usando, com a barra
  const pa = await open(ana.token);
  const card = pa.getByRole('dialog', { name: 'Apoie o Resenha' });
  await sleep(500);
  assert((await card.count()) === 0, 'não aparece assim que abre');
  await pa.clock.fastForward(46_000);
  await card.waitFor({ timeout: 8000 });
  await card.getByText(/R\$\s?35 de R\$\s?100/).waitFor();
  assert((await card.getByRole('progressbar').getAttribute('aria-valuenow')) === '35', 'barra em 35%');
  await sleep(400);
  await pa.screenshot({ path: path.join(shots, 'apoio-card.png') });
  // "Quero apoiar" abre a janela do Pix, com a mesma barra
  await card.getByRole('button', { name: 'Quero apoiar' }).click();
  const modal = pa.getByRole('dialog', { name: /Apoie o Resenha 💚/ });
  await modal.getByRole('group', { name: 'Meta do mês' }).waitFor();
  await modal.getByText('para todo mundo aparece só o total do mês').waitFor();
  step('no computador: o card aparece depois de um tempo usando, com "R$ 35 de R$ 100"; "Quero apoiar" abre o Pix com a barra');

  // depois de abrir/fechar, não volta no mês, nem em outro aparelho
  assert((await api('/apoio?calls=3', null, ana.token)).card === false, 'depois de visto, não volta este mês');
  const caioPhone = await open(caio.token, devices['Pixel 7']);
  const c2 = caioPhone.getByRole('dialog', { name: 'Apoie o Resenha' });
  await caioPhone.clock.fastForward(46_000);
  await c2.waitFor({ timeout: 8000 });
  await sleep(400);
  await caioPhone.screenshot({ path: path.join(shots, 'apoio-card-celular.png') });
  await c2.getByRole('button', { name: 'Agora não' }).click();
  await c2.waitFor({ state: 'detached' });
  assert((await api('/apoio?calls=3', null, caio.token)).card === false, '"Agora não" vale para o mês todo');
  step('no celular: "Agora não" fecha e o card não volta no mês (em nenhum aparelho)');

  // a equipe esconde a barra
  await api('/admin/apoio', { ...settings, showMonthly: false }, equipe.token, 'PUT');
  assert((await api('/apoio', null, ana.token)).monthly === null, 'barra escondida');
  assert((await api('/admin/apoio', null, equipe.token)).totals.monthCents === 3500, 'a equipe continua vendo o total do mês');
  step('a equipe pode esconder a barra (e continua vendo o total no painel)');
  console.log('\nTUDO CERTO (card de apoio e meta do mês)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
