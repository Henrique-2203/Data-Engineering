// Sugestões da comunidade (2ª leva):
//  - marcar canais no chat: "#" mostra os canais, vira "#nome" clicável na mensagem (e "#nome" ao editar)
//  - tamanho ideal das imagens ao lado dos botões de enviar banner
//  - expandir a call: só os quadros, na tela toda (Esc volta)
// Uso: npm run build && node e2e/suggestions-2.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-sug2-') },
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
  const ana = await api('/auth/register', { username: 'ana', password: 'Cor-Forte-Xis-42', displayName: 'Ana', acceptTerms: true });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/guilds/${guild.id}/channels`, { name: 'regras', type: 'text' }, ana.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
  await page.getByRole('button', { name: 'Galera' }).first().click();
  await page.getByText('geral', { exact: true }).first().click();

  // ---------- marcar canais ----------
  const input = page.locator('.composer textarea');
  await input.click();
  await input.type('leiam o #reg');
  const pop = page.getByRole('listbox', { name: 'Canais' });
  await pop.getByRole('option', { name: /regras/ }).waitFor();
  await page.keyboard.press('Enter');
  assert((await input.inputValue()) === 'leiam o #regras ', `canal escolhido no texto (${await input.inputValue()})`);
  await input.type('e entrem na #Sala de voz');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  const msg = page.locator('.message', { hasText: 'leiam o' });
  await msg.locator('.channel-mention', { hasText: 'regras' }).waitFor();
  await msg.locator('.channel-mention', { hasText: 'Sala de voz' }).waitFor();
  const stored = (await api(`/channels/${guild.channels.find((c) => c.type === 'text').id}/messages`, null, ana.token));
  const list = Array.isArray(stored) ? stored : stored.messages ?? Object.values(stored).find(Array.isArray);
  assert(/<#[0-9a-f-]+>/.test(list.at(-1).content), `vai salvo como <#id> (${list.at(-1).content})`);
  await page.screenshot({ path: path.join(shots, 'marcar-canal.png') });
  await msg.locator('.channel-mention', { hasText: 'regras' }).click();
  await page.locator('.main-header, .mobile-header').getByText('regras').first().waitFor();
  step('"#" mostra os canais; a mensagem guarda o canal (<#id>) e mostra "#regras" clicável, que abre o canal');
  // editar mostra "#regras"
  await page.getByText('geral', { exact: true }).first().click();
  await msg.hover();
  await msg.locator('.message-actions').getByRole('button', { name: 'Editar' }).click();
  const edit = msg.getByRole('textbox', { name: 'Editar mensagem' });
  assert((await edit.inputValue()).includes('#regras'), `ao editar aparece #regras (${await edit.inputValue()})`);
  await page.keyboard.press('Escape');
  step('ao editar, o canal aparece como #regras');

  // ---------- tamanho ideal do banner ----------
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Perfil', exact: true }).click();
  await page.getByText(/ajusta a parte que aparece/).first().waitFor();
  await page.getByText(/1920 × 680/).first().waitFor();
  await page.getByText(/1280 × 720/).waitFor();
  await page.keyboard.press('Escape');
  step('o tamanho ideal aparece ao lado de enviar foto, banner do perfil e banner da call');

  // ---------- expandir a call ----------
  await page.getByRole('button', { name: 'Sala de voz' }).first().click();
  await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Expandir a call' }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.layout > .nav-drawer')).display === 'none');
  await sleep(300);
  await page.screenshot({ path: path.join(shots, 'call-expandida.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.layout > .nav-drawer')).display !== 'none');
  step('expandir a call esconde servidores e canais (só os quadros); Esc volta');
  console.log('\nTUDO CERTO (sugestões, 2ª leva)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
