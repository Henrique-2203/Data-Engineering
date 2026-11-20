// Celular: arrastar a tela para o lado (como no Discord) e o Início com amigos online e "Acontecendo agora".
//  - no chat, arrastar para a direita abre servidores/canais; para a esquerda, quem está no canal
//  - arrastar de volta fecha; arrastar pouco não muda nada; rolar para cima/baixo não conta
//  - o Início mostra os amigos online e um resumo (call com gente, menção, mensagens novas, pedido de amizade)
// Uso: npm run build && node e2e/mobile-swipe.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3207;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-swipe-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

/** arrasta o dedo de (x0,y) até (x1,y) com toques de verdade (CDP) */
async function swipe(page, x0, x1, y = 400, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * i) / steps) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(350);
}
const panel = (page) => page.evaluate(() => /panel-(\w+)/.exec(document.querySelector('.layout').className)?.[1]);

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api('/friends', { username: 'bia' }, ana.token);
  await api('/friends', { username: 'ana' }, bia.token);
  await api('/friends', { username: 'ana' }, caio.token); // pedido de amizade pendente para a Ana
  for (let i = 0; i < 3; i++) await api(`/channels/${geral.id}/messages`, { content: `msg ${i}` }, bia.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // a Bia fica online e entra na call (no computador)
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await bctx.addInitScript((t) => localStorage.setItem('resenha.token', t), bia.token);
  const pb = await bctx.newPage();
  await pb.goto(`${BASE}/app`);
  await pb.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
  await pb.getByRole('button', { name: 'Galera' }).first().click();
  await pb.getByRole('button', { name: 'Sala de voz' }).first().click();
  await pb.getByText('Voz conectada').waitFor({ timeout: 15000 });

  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript((t) => {
    localStorage.setItem('resenha.token', t);
    localStorage.setItem('resenha.androidBanner', '1');
  }, ana.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});

  // ---------- Início ----------
  await page.getByRole('button', { name: 'Início', exact: true }).click();
  await page.getByRole('button', { name: /menu/i }).first().click().catch(() => {});
  // chegam enquanto a Ana está no Início
  await api(`/channels/${geral.id}/messages`, { content: 'oi @ana, bora?' }, bia.token);
  const online = page.getByRole('region', { name: 'Amigos online' });
  await online.getByRole('button', { name: 'Conversar com Bia' }).waitFor({ timeout: 8000 });
  const happ = page.getByRole('region', { name: 'Acontecendo agora' });
  await happ.getByText('Sala de voz').waitFor();
  await happ.getByText(/Te mencionaram em/).waitFor();
  await happ.getByText(/quer ser seu amigo/).waitFor();
  await sleep(300);
  await page.screenshot({ path: path.join(shots, 'mobile-inicio.png') });
  step('Início: amigos online (com ícone de quem está em call) e "Acontecendo agora" com a call, a menção e o pedido de amizade');
  // tocar na call abre o canal de voz
  await happ.getByRole('button', { name: /Sala de voz/ }).click();
  await page.getByRole('button', { name: 'Entrar na chamada' }).waitFor({ timeout: 5000 });
  step('tocar na call do resumo abre a call');

  // ---------- arrastar ----------
  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.getByText('geral', { exact: true }).first().click();
  await page.locator('.message', { hasText: 'msg 0' }).waitFor();
  assert((await panel(page)) === 'main', 'começa no chat');
  await swipe(page, 60, 140); // pouco: não muda
  assert((await panel(page)) === 'main', 'arrastar pouco não abre nada');
  await swipe(page, 40, 320);
  assert((await panel(page)) === 'nav', `arrastar para a direita abre os canais (${await panel(page)})`);
  await swipe(page, 330, 40);
  assert((await panel(page)) === 'main', 'arrastar para a esquerda volta para o chat');
  await swipe(page, 360, 60);
  assert((await panel(page)) === 'members', `arrastar para a esquerda no chat mostra os membros (${await panel(page)})`);
  await page.locator('.members').getByText('Bia').first().waitFor();
  await sleep(250);
  await page.screenshot({ path: path.join(shots, 'mobile-arrastar-membros.png') });
  await swipe(page, 120, 380);
  assert((await panel(page)) === 'main', 'arrastar para a direita nos membros volta para o chat');
  // rolar para cima e para baixo não conta como gesto
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 600, id: 1 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + i * 4, y: 600 - i * 30, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  assert((await panel(page)) === 'main', 'rolar a tela não abre painel');
  step('arrastar: direita abre servidores e canais, esquerda mostra membros, de volta fecha; arrastar pouco ou rolar não muda nada');
  console.log('\nTUDO CERTO (arrastar e Início no celular)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
