// Mensagens não lidas por canal (guardadas no servidor: continuam depois de recarregar) e o
// "Instalar no celular" da página inicial (manifesto com ícones PNG e passo a passo).
// Uso: npm run build && node e2e/unread-install.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3264;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log(`✓ ${m}`);
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-unread-') }, stdio: 'ignore' });
const api = async (p, body, token) =>
  (await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  const ana = await api('/auth/register', { username: 'ana', password: 'Cor-Forte-Xis-42', displayName: 'Ana', acceptTerms: true });
  const bia = await api('/auth/register', { username: 'bia', password: 'Cor-Forte-Xis-42', displayName: 'Bia', acceptTerms: true });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const jogos = (await api(`/guilds/${guild.id}/channels`, { name: 'jogos', type: 'text' }, ana.token)).channel.id;
  const geral = guild.channels.find((c) => c.type === 'text');
  for (let i = 1; i <= 3; i++) await api(`/channels/${geral.id}/messages`, { content: `geral ${i}` }, bia.token);
  for (let i = 1; i <= 2; i++) await api(`/channels/${jogos}/messages`, { content: `jogos ${i}` }, bia.token);
  await api(`/channels/${geral.id}/messages`, { content: 'minha' }, ana.token);
  let b = await api('/bootstrap', null, ana.token);
  assert(b.unread[geral.id] === 3 && b.unread[jogos] === 2, `contagem no servidor (${JSON.stringify(b.unread)})`);
  step('o servidor conta as não lidas por canal (sem contar as minhas)');

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 3000 }).catch(() => {});
  const badge = (name) => page.locator('.channel', { has: page.getByRole('button', { name: new RegExp(`^${name}`) }) }).locator('.count-badge.soft');
  await badge('jogos').getByText('2').waitFor();
  await page.screenshot({ path: path.resolve('e2e/screenshots/nao-lidas.png') });
  // abriu o #geral (primeiro canal): lido; o #jogos continua com 2 depois de recarregar
  await sleep(3500);
  b = await api('/bootstrap', null, ana.token);
  assert(!b.unread[geral.id] && b.unread[jogos] === 2, `abrir o canal marca como lido no servidor (${JSON.stringify(b.unread)})`);
  await page.reload();
  await badge('jogos').getByText('2').waitFor();
  step('abrir o canal zera; o número dos outros continua depois de recarregar');
  // chega mensagem nova ao vivo
  await api(`/channels/${jogos}/messages`, { content: 'jogos 3' }, bia.token);
  await badge('jogos').getByText('3').waitFor();
  await page.getByRole('button', { name: /^jogos/ }).click();
  await badge('jogos').waitFor({ state: 'detached' });
  step('mensagem nova ao vivo soma no número; abrir o canal tira o número');

  // ---------- instalar no celular ----------
  const man = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  for (const ic of man.icons) assert((await fetch(`${BASE}${ic.src}`)).ok, `ícone ${ic.src}`);
  assert(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') && man.start_url === '/app', 'manifesto com ícones PNG e maskable');
  assert((await fetch(`${BASE}/icons/apple-touch-icon.png`)).ok, 'ícone do iPhone');
  const lp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await lp.goto(`${BASE}/`);
  await lp.getByRole('button', { name: 'Instalar no celular' }).first().click();
  await lp.getByRole('dialog', { name: 'Instalar o Resenha no celular' }).getByText('resenhabr.com.br').waitFor();
  const ios = await browser.newContext({ ...devices['iPhone 13'] });
  const ip = await ios.newPage();
  await ip.goto(`${BASE}/`);
  await ip.locator('#baixar').scrollIntoViewIfNeeded();
  await ip.getByRole('button', { name: 'Instalar no celular' }).last().click();
  await ip.getByText('Adicionar à Tela de Início').waitFor();
  await ip.screenshot({ path: path.resolve('e2e/screenshots/instalar-iphone.png') });
  step('página inicial: "Instalar no celular" (passo a passo no iPhone; no PC, o endereço para abrir no celular) e manifesto com ícones');
  console.log('\nTUDO CERTO (não lidas e instalar no celular)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
