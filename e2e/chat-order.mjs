// Ordem do chat depois de reconectar: com mensagens antigas já carregadas (rolou para cima), o servidor
// reinicia (atualização do site) e o app reconecta; antes as antigas iam parar DEPOIS das novas ("mensagem de ontem depois da de hoje").
// Uso: npm run build && node e2e/chat-order.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3263;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const DATA_DIR = tempDir('resenha-ordem-');
const start = () => spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore' });
let server = start();
const waitUp = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(400);
  }
};
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
  const geral = guild.channels.find((c) => c.type === 'text');
  for (let i = 1; i <= 70; i++) {
    // respeita o limite anti-spam de mensagens seguidas (tenta de novo se bater nele)
    for (let k = 0; k < 20; k++) {
      const r = await api(`/channels/${geral.id}/messages`, { content: `msg ${String(i).padStart(3, '0')}` }, i % 2 ? ana.token : bia.token);
      if (r.message) break;
      await sleep(1500);
    }
  }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 3000 }).catch(() => {});
  await page.getByRole('button', { name: 'Galera' }).first().click();
  await page.getByText('msg 070').waitFor();
  // rola até o topo: carrega as mais antigas
  for (let i = 0; i < 10 && !(await page.getByText('msg 001').isVisible().catch(() => false)); i++) {
    await page.locator('.messages').first().evaluate((el) => (el.scrollTop = 0));
    await sleep(500);
  }
  await page.getByText('msg 001').waitFor();
  // o site se atualiza (servidor reinicia): o app reconecta; chegam mensagens novas nesse meio tempo
  server.kill();
  await new Promise((r) => server.once('exit', r));
  server = start();
  await waitUp();
  for (let i = 71; i <= 73; i++) await api(`/channels/${geral.id}/messages`, { content: `msg ${String(i).padStart(3, '0')}` }, i % 2 ? ana.token : bia.token);
  await page.getByText('msg 073').waitFor({ state: 'attached', timeout: 20000 });
  await sleep(800);
  const order = await page.$$eval('.message', (els) => els.map((e) => e.textContent.match(/msg (\d+)/)?.[1]).filter(Boolean).map(Number));
  const sorted = [...order].sort((a, b) => a - b);
  assert(order.length >= 73, `todas as mensagens na tela (${order.length})`);
  assert(JSON.stringify(order) === JSON.stringify(sorted), `ordem certa depois de reconectar (${order.slice(0, 5)}… ${order.slice(-5)})`);
  console.log(`✓ depois de reconectar, ${order.length} mensagens em ordem (antigas carregadas + novas que chegaram offline)`);
  console.log('\nTUDO CERTO (ordem do chat)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
