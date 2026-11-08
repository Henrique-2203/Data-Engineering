// Teste de ligação em conversa direta: tocar, atender, recusar, desistir, não atender e offline.
// Uso: npm run build && node e2e/dm-call.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 3130;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-call-')),
    RING_TIMEOUT_MS: '4000',
  },
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
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana' });
  const bia = await api('/auth/register', { username: 'bia', password: 'segredo123', displayName: 'Bia' });
  const caio = await api('/auth/register', { username: 'caio', password: 'segredo123', displayName: 'Caio' });
  for (const [from, to, toUser] of [
    [ana, bia, 'bia'],
    [ana, caio, 'caio'],
  ]) {
    await api('/friends', { username: toUser }, from.token);
    await api(`/friends/${from.user.id}/accept`, {}, to.token);
  }
  await api('/dms', { userId: bia.user.id }, ana.token);
  await api('/dms', { userId: caio.user.id }, ana.token);

  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const open = async (token, mobile = false) => {
    const ctx = await browser.newContext({
      ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1366, height: 860 } }),
      permissions: ['microphone', 'camera'],
    });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(BASE);
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token, true); // Bia atende no celular
  const voiceOn = (p) => p.locator('.voice-panel');

  await pa.locator('.dm-item', { hasText: 'Bia' }).click();
  const call = () => pa.getByRole('button', { name: 'Ligar para Bia' }).click();

  // ---- 1) ligar e atender ----
  await call();
  await pa.getByText('Chamando Bia…').waitFor({ timeout: 10000 });
  await pb.getByRole('alertdialog', { name: 'Chamada de Ana' }).waitFor({ timeout: 5000 });
  await pb.screenshot({ path: `${shots}/15-celular-recebendo-ligacao.png` });
  step('Ana ligou: ela vê "Chamando Bia…" e o celular da Bia mostra a chamada');
  await pb.getByRole('button', { name: 'Atender' }).click();
  await pb.getByPlaceholder('Conversar com Ana').waitFor();
  for (const p of [pa, pb]) {
    await p.waitForFunction(() => document.querySelectorAll('.voice-stage.embedded .tile.user').length === 2 && !document.querySelector('.tile-badge'), null, {
      timeout: 20000,
    });
  }
  await pa.getByText('Chamando Bia…').waitFor({ state: 'detached' });
  if (await pb.getByRole('alertdialog').isVisible()) throw new Error('janela de chamada não fechou');
  await pa.locator('.dm-item', { hasText: 'Bia' }).locator('.dm-call').waitFor();
  await pa.getByPlaceholder('Conversar com Bia').fill('to te ouvindo!');
  await pa.keyboard.press('Enter');
  await pb.getByText('to te ouvindo!').waitFor();
  await pa.screenshot({ path: `${shots}/16-ligacao-na-dm.png` });
  step('Bia atendeu no celular: os dois conectados (WebRTC) com o chat funcionando embaixo');
  await pb.getByRole('button', { name: 'Sair da chamada' }).click();
  await pa.getByRole('button', { name: 'Sair da chamada' }).click();
  await voiceOn(pa).waitFor({ state: 'detached' });

  // ---- 2) recusar ----
  await call();
  await pb.getByRole('button', { name: 'Recusar' }).click({ timeout: 5000 });
  await pa.getByText('Bia recusou a chamada.').waitFor({ timeout: 5000 });
  await voiceOn(pa).waitFor({ state: 'detached', timeout: 5000 });
  step('Bia recusou: Ana é avisada e a chamada encerra sozinha');

  // ---- 3) quem ligou desiste antes de atender ----
  await call();
  await pb.getByRole('alertdialog').waitFor({ timeout: 5000 });
  await pa.getByRole('button', { name: 'Sair da chamada' }).click();
  await pb.getByRole('alertdialog').waitFor({ state: 'detached', timeout: 5000 });
  await pb.getByText('Chamada perdida de Ana').waitFor({ timeout: 5000 });
  step('Ana desistiu antes: a chamada some do celular da Bia como "Chamada perdida"');

  // ---- 4) ninguém atende ----
  await call();
  await pb.getByRole('alertdialog').waitFor({ timeout: 5000 });
  await pa.getByText('Bia não atendeu.').waitFor({ timeout: 10000 });
  await voiceOn(pa).waitFor({ state: 'detached', timeout: 5000 });
  await pb.getByRole('alertdialog').waitFor({ state: 'detached' });
  step('ninguém atendeu: depois do tempo limite os dois lados encerram');

  // ---- 5) amigo offline ----
  await pa.getByRole('button', { name: 'Início' }).click();
  await pa.locator('.dm-item', { hasText: 'Caio' }).click();
  await pa.getByRole('button', { name: 'Ligar para Caio' }).click();
  await pa.getByText('Caio está offline agora.').waitFor({ timeout: 10000 });
  await voiceOn(pa).waitFor({ state: 'detached', timeout: 5000 });
  step('ligar para alguém offline avisa na hora');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
