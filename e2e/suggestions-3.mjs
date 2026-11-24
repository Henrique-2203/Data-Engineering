// Sugestões da comunidade (3ª leva):
//  - tocar no @ de alguém na mensagem abre o perfil da pessoa
//  - ligação na conversa privada: "Ampliar" deixa a call na conversa toda (no celular ficava metade)
//  - amigos online: espaço para o anel de Fundador brilhar sem aparecer a "caixa" cortando
//  (ajustar a posição da foto/banner está em e2e/profile.mjs e e2e/server-settings.mjs)
// Uso: npm run build && node e2e/suggestions-3.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3220;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-sug3-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api('/friends', { username: 'bia' }, ana.token);
  await api(`/friends/${ana.user.id}/accept`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api(`/channels/${geral.id}/messages`, { content: 'bora @ana, entra aí' }, bia.token);
  await api('/dms', { userId: bia.user.id }, ana.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token, mobile) => {
    const ctx = await browser.newContext({ ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1366, height: 860 } }), permissions: ['microphone', 'camera'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.androidBanner', '1');
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };

  // ---------- @ abre o perfil ----------
  const pb = await open(bia.token);
  await pb.getByRole('button', { name: 'Galera' }).first().click();
  await pb.locator('.sidebar').getByText('geral', { exact: true }).first().click();
  await pb.locator('.message', { hasText: 'entra aí' }).getByRole('button', { name: '@Ana' }).click();
  await pb.getByRole('dialog', { name: 'Perfil' }).getByText('@ana').first().waitFor();
  await pb.keyboard.press('Escape');
  step('tocar no @ana da mensagem abre o perfil da Ana');

  // ---------- amigos online: espaço para o anel ----------
  const pa = await open(ana.token, true);
  await pa.getByRole('button', { name: 'Início', exact: true }).click().catch(() => {});
  const row = pa.locator('.home-online-row');
  await row.waitFor({ timeout: 8000 });
  const pad = await row.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  assert(pad >= 12, `a fileira tem espaço em cima para o brilho do anel (${pad}px)`);
  step(`amigos online: ${pad}px de espaço em volta, o brilho do anel não é mais cortado`);

  // ---------- ligação: ampliar ----------
  await pa.locator('.dm-item', { hasText: 'Bia' }).first().click();
  await pa.getByRole('button', { name: 'Ligar para Bia' }).click();
  await pb.getByRole('alertdialog', { name: 'Chamada de Ana' }).waitFor({ timeout: 8000 });
  await pb.getByRole('button', { name: 'Atender' }).click();
  await pa.locator('.voice-stage.embedded .tile.user').nth(1).waitFor({ timeout: 20000 });
  const expand = pa.getByRole('button', { name: 'Ampliar a ligação' });
  await expand.click();
  await pa.locator('.chat > .messages-wrap').waitFor({ state: 'hidden' });
  const stage = await pa.locator('.voice-stage.embedded').boundingBox();
  const vh = pa.viewportSize().height;
  assert(stage.height > vh * 0.7, `a call ocupa a conversa toda (${Math.round(stage.height)} de ${vh}px)`);
  await sleep(300);
  await pa.screenshot({ path: path.join(shots, 'ligacao-ampliada-celular.png') });
  await pa.getByRole('button', { name: 'Ver a conversa' }).click();
  await pa.locator('.chat > .messages-wrap').waitFor();
  step('ligação na conversa privada: "Ampliar" deixa a call na tela toda e "Ver a conversa" volta');
  console.log('\nTUDO CERTO (sugestões, 3ª leva)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
