// Bots de terceiros na tela: Configurações → Desenvolvedor (criar bot, token só aparece uma vez, endereço),
// Configurações do servidor → Integrações (instalar pelo ID) e usar o comando pelo "/" no chat.
// Uso: npm run build && node e2e/bots-apps-ui.mjs
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3293;
const BOT_PORT = 3294;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-botappsui-'), PLATFORM_ADMINS: 'equipe', BOT_ALLOW_LOCAL_URLS: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.12.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
let secret = '';
const botServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ts = req.headers['x-resenha-timestamp'];
    const good = `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
    if (req.headers['x-resenha-signature'] !== good) return res.writeHead(401).end('{}');
    const j = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: `pong ${j.args} (de ${j.user.displayName})` }));
  });
});
await new Promise((r) => botServer.listen(BOT_PORT, r));

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: PASS, displayName: d ?? u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera UI' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api('/admin/beta', { botdev: ['ana'], bots: ['ana'] }, equipe.token, 'PUT');

  browser = await chromium.launch();
  const open = async (user) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`[${user}]`, e.message));
    await page.goto(`${BASE}/app`);
    await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill(user);
    await page.getByLabel('Senha', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: /^Entrar$/ }).click();
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera UI' }).first().click();
    return page;
  };

  // quem não tem o recurso não vê a seção
  const biaPage = await open('bia');
  await biaPage.getByRole('button', { name: 'Configurações', exact: true }).click();
  await biaPage.getByRole('dialog', { name: 'Configurações' }).waitFor();
  assert((await biaPage.getByRole('button', { name: 'Desenvolvedor' }).count()) === 0, 'sem o recurso: a seção Desenvolvedor não aparece');
  await biaPage.keyboard.press('Escape');

  // ana cria o bot pela tela
  const A = await open('ana');
  await A.getByRole('button', { name: 'Configurações', exact: true }).click();
  await A.getByRole('button', { name: 'Desenvolvedor' }).click();
  await A.getByLabel('Nome do bot').fill('Eco Bot');
  await A.getByRole('button', { name: 'Criar bot' }).click();
  const secretBox = A.locator('.dev-secret');
  await secretBox.waitFor({ timeout: 8000 });
  const token = await secretBox.locator('code').nth(0).innerText();
  secret = await secretBox.locator('code').nth(1).innerText();
  assert(/^bot_[a-f0-9]{16}\.[A-Za-z0-9_-]{40,}$/.test(token) && secret.length === 64, 'token e segredo aparecem uma vez');
  await A.screenshot({ path: `${shots}/botdev-token.png` });
  await secretBox.getByRole('button', { name: 'Já guardei' }).click();
  assert((await A.locator('.dev-secret').count()) === 0, 'depois de guardar o token some da tela');
  const botId = (await A.locator('.dev-bot .dev-copy code').first().innerText()).trim();
  assert(/^bot_[a-f0-9]{16}$/.test(botId), 'o ID do bot aparece no cartão');
  await A.getByLabel(/Endereço do bot/).fill(`http://localhost:${BOT_PORT}/hook`);
  await A.getByRole('button', { name: 'Salvar', exact: true }).click();
  await sleep(600);
  // o bot registra os comandos pela API (como o programa do dono faria)
  const rc = await fetch(`${BASE}/api/bot/commands`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bot ${token}`, 'x-forwarded-for': '10.13.0.1' }, body: JSON.stringify({ commands: [{ name: 'ping', description: 'Responde pong', usage: '/ping texto' }] }) });
  assert(rc.status === 200, 'registrou o comando pela API');
  await A.reload();
  await A.getByRole('button', { name: 'Galera UI' }).first().click();
  await A.getByRole('button', { name: 'Configurações', exact: true }).click();
  await A.getByRole('button', { name: 'Desenvolvedor' }).click();
  await A.getByText('/ping').first().waitFor({ timeout: 8000 });
  await A.screenshot({ path: `${shots}/botdev-painel.png` });
  step('Desenvolvedor: criar bot pela tela, token só aparece uma vez, endereço salvo, comandos listados');
  await A.keyboard.press('Escape');

  // ana instala no servidor pelo ID
  await A.locator('.guild-name').click();
  await A.getByRole('button', { name: 'Configurações do servidor' }).click();
  await A.getByRole('button', { name: 'Integrações', exact: true }).click();
  await A.getByLabel('Adicionar pelo ID do bot').fill(botId);
  await A.getByRole('button', { name: 'Procurar' }).click();
  await A.locator('.external-bots .bot-card', { hasText: 'Eco Bot' }).getByRole('button', { name: 'Adicionar ao servidor' }).click();
  await A.locator('.external-bots .bot-card', { hasText: '/ping' }).waitFor({ timeout: 8000 });
  await A.screenshot({ path: `${shots}/botdev-instalar.png` });
  await A.keyboard.press('Escape');
  step('Integrações: procurar pelo ID, conferir e instalar o bot de outra pessoa');

  // bia usa o comando pelo "/"
  await biaPage.reload();
  await biaPage.getByRole('button', { name: 'Galera UI' }).first().click();
  const box = biaPage.getByPlaceholder(/Conversar em #geral/);
  await box.click();
  await box.pressSequentially('/pi');
  const pop = biaPage.getByRole('listbox', { name: 'Comandos' });
  await pop.waitFor({ timeout: 8000 });
  assert((await pop.getByRole('option').count()) === 1, 'o popup mostra o comando do bot de terceiro');
  await biaPage.keyboard.press('Enter');
  await box.pressSequentially('oi');
  await biaPage.keyboard.press('Enter');
  const msg = biaPage.locator('.message', { hasText: 'pong oi (de Bia)' }).last();
  await msg.waitFor({ timeout: 10000 });
  assert((await msg.locator('.bot-tag').count()) === 1, 'a resposta sai com o selo BOT');
  await biaPage.screenshot({ path: `${shots}/botdev-uso.png` });
  step('chat: "/ping oi" chama o bot assinado e a resposta aparece com o selo BOT');

  console.log('\nTudo certo com as telas dos bots de terceiros.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  botServer.close();
  server.kill();
}
