// Teste de amigos e mensagens diretas com três navegadores.
// Uso: npm run build && node e2e/social.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 3128;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-social-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  // Ana e Bia estão no mesmo servidor; Caio não conhece ninguém
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana' });
  const bia = await api('/auth/register', { username: 'bia', password: 'segredo123', displayName: 'Bia' });
  const caio = await api('/auth/register', { username: 'caio', password: 'segredo123', displayName: 'Caio' });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  browser = await chromium.launch();
  const open = async (token, mobile = false) => {
    const ctx = await browser.newContext(mobile ? devices['Pixel 7'] : { viewport: { width: 1366, height: 820 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  const pc = await open(caio.token, true);

  // --- DM a partir da lista de membros ---
  await pa.locator('.members').getByRole('button', { name: /Bia/ }).click();
  await pa.locator('.member-card').getByRole('button', { name: 'Enviar mensagem' }).click();
  await pa.getByText('Este é o começo da sua conversa com').waitFor();
  await pa.getByPlaceholder('Conversar com Bia').fill('Oi Bia, mensagem secreta 🤫');
  await pa.keyboard.press('Enter');
  step('Ana abriu DM com Bia pela lista de membros e mandou mensagem');

  await pb.locator('.rail-count').waitFor({ timeout: 5000 });
  step(`Bia vê aviso no Início: ${await pb.locator('.rail-count').textContent()}`);
  await pb.getByRole('button', { name: 'Início' }).click();
  await pb.locator('.dm-item.unread', { hasText: 'Ana' }).click();
  await pb.getByText('Oi Bia, mensagem secreta 🤫').waitFor();
  await pb.getByPlaceholder('Conversar com Ana').fill('Recebi!');
  await pa.getByText('Bia está digitando').waitFor({ timeout: 5000 });
  step('"digitando" funciona na DM');
  await pb.keyboard.press('Enter');
  await pa.getByText('Recebi!').waitFor({ timeout: 5000 });
  await pa.screenshot({ path: `${shots}/09-dm.png` });
  step('conversa em tempo real nos dois lados');

  // --- Pedido de amizade ---
  const dmDenied = await api('/dms', { userId: caio.user.id }, ana.token);
  if (!dmDenied.error) throw new Error('DM com desconhecido deveria ser bloqueada');
  await pa.getByRole('button', { name: 'Início' }).click();
  await pa.locator('.home-item').click();
  await pa.getByRole('tab', { name: 'Adicionar amigo' }).click();
  await pa.getByLabel('Nome de usuário').fill('@Caio');
  await pa.getByRole('button', { name: 'Enviar pedido' }).click();
  await pa.getByText('Pedido enviado', { exact: false }).first().waitFor();
  step('Ana mandou pedido de amizade para Caio (que não está em nenhum servidor dela)');

  await pc.locator('.rail-count').waitFor({ timeout: 5000 });
  // no celular sem servidores, o app já abre na tela de Amigos
  await pc.getByRole('tab', { name: /Pendentes/ }).click();
  await pc.screenshot({ path: `${shots}/10-celular-pedido.png` });
  await pc.getByRole('button', { name: 'Aceitar Ana' }).click();
  await pc.getByRole('tab', { name: 'Todos' }).click();
  await pc.locator('.friend-row', { hasText: 'Ana' }).waitFor();
  step('Caio (no celular) aceitou o pedido');

  await pa.getByRole('tab', { name: 'Online' }).click();
  await pa.locator('.friend-row', { hasText: 'Caio' }).waitFor({ timeout: 5000 });
  step('Ana vê Caio na aba Online');
  await pa.getByRole('button', { name: 'Enviar mensagem para Caio' }).click();
  await pa.getByPlaceholder('Conversar com Caio').fill('Bem-vindo, Caio!');
  await pa.keyboard.press('Enter');
  await pc.getByRole('button', { name: 'Abrir menu' }).click().catch(() => {});
  await pc.locator('.dm-item', { hasText: 'Ana' }).click();
  await pc.getByText('Bem-vindo, Caio!').waitFor({ timeout: 5000 });
  await pc.waitForTimeout(400); // espera a animação do menu lateral fechar
  await pc.screenshot({ path: `${shots}/11-celular-dm.png` });
  step('agora como amigos, a DM funciona (inclusive no celular)');

  // a conversa mais recente fica no topo
  const order = await pa.locator('.dm-item').allTextContents();
  if (!order[0].includes('Caio')) throw new Error(`ordem das DMs errada: ${order}`);
  step(`lista de DMs ordenada pela última mensagem: ${order.join(', ')}`);

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
