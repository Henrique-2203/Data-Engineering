// Teste ponta a ponta: dois navegadores (PC + celular) usando o app de verdade.
// Uso: npm run build && npm run test:e2e
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-')) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('servidor não subiu');
}

const step = (msg) => console.log(`✓ ${msg}`);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const pcCtx = await browser.newContext({ viewport: { width: 1366, height: 820 }, permissions: ['microphone', 'camera'] });
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'], permissions: ['microphone', 'camera'] });
  const pc = await pcCtx.newPage();
  const phone = await phoneCtx.newPage();
  for (const [name, p] of [['pc', pc], ['phone', phone]]) {
    p.on('pageerror', (e) => console.error(`[${name} pageerror]`, e));
    p.on('console', (m) => m.type() === 'error' && console.error(`[${name} console]`, m.text()));
  }

  // --- PC: cria conta e servidor ---
  await pc.goto(BASE);
  await pc.getByRole('tab', { name: 'Criar conta' }).click();
  await pc.getByLabel('Usuário').fill('ana');
  await pc.getByLabel('Nome de exibição').fill('Ana');
  await pc.getByLabel('Senha').fill('segredo123');
  await pc.getByRole('button', { name: 'Criar conta' }).click();
  await pc.getByRole('button', { name: 'Criar servidor' }).first().click();
  await pc.getByLabel('Nome do servidor').fill('Galera');
  await pc.getByRole('button', { name: 'Criar', exact: true }).click();
  const link = await pc.getByLabel('Link de convite').inputValue();
  await pc.screenshot({ path: `${shots}/01-pc-convite.png` });
  await pc.getByRole('button', { name: 'Fechar' }).click();
  step(`servidor criado, convite: ${link}`);

  // --- Celular: abre o convite, cria conta e entra ---
  await phone.goto(link);
  await phone.getByLabel('Usuário').fill('bia');
  await phone.getByLabel('Senha').fill('segredo123');
  await phone.getByRole('button', { name: 'Criar conta' }).click();
  await phone.getByText('Galera').waitFor();
  await phone.screenshot({ path: `${shots}/02-celular-entrar.png` });
  await phone.getByRole('button', { name: 'Entrar', exact: true }).click();
  await phone.getByRole('button', { name: 'geral' }).click();
  step('celular entrou pelo convite');

  // --- Chat em tempo real ---
  await pc.getByPlaceholder('Conversar em #geral').fill('Bora jogar hoje? 🎮');
  await pc.keyboard.press('Enter');
  await phone.getByText('Bora jogar hoje? 🎮').waitFor({ timeout: 5000 });
  await phone.getByPlaceholder('Conversar em #geral').fill('Bora! Liga a transmissão');
  await phone.getByRole('button', { name: 'Enviar' }).click();
  await pc.getByText('Bora! Liga a transmissão').waitFor({ timeout: 5000 });
  await phone.screenshot({ path: `${shots}/03-celular-chat.png` });
  await pc.screenshot({ path: `${shots}/04-pc-chat.png` });
  step('mensagens chegaram nos dois lados em tempo real');

  // --- Voz ---
  await pc.getByRole('button', { name: 'Sala de voz' }).click();
  await pc.getByText('Voz conectada').waitFor({ timeout: 10000 });
  await phone.getByRole('button', { name: 'Abrir menu' }).click();
  await phone.getByRole('button', { name: 'Sala de voz' }).click();
  await phone.locator('.tile.user').nth(1).waitFor({ timeout: 10000 });
  // espera os dois lados conectarem via WebRTC
  await phone.waitForFunction(() => !document.querySelector('.tile-badge'), null, { timeout: 15000 });
  step('os dois entraram na chamada de voz (WebRTC conectado)');

  // --- Transmissão de tela no PC ---
  await pc.getByRole('button', { name: 'Transmitir tela' }).click();
  await pc.locator('.modal select').first().selectOption('1080p60');
  await pc.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await pc.getByText('Sua tela').waitFor({ timeout: 10000 });
  step('PC começou a transmitir');

  await phone.getByRole('button', { name: 'Assistir transmissão' }).click({ timeout: 10000 });
  await phone.waitForFunction(
    () => {
      const v = document.querySelector('.tile.screen video');
      return v && v.videoWidth > 0;
    },
    null,
    { timeout: 20000 },
  );
  await phone.locator('.stream-stats').waitFor({ timeout: 10000 });
  await phone.waitForTimeout(4000);
  const stats = await phone.locator('.stream-stats').textContent();
  const size = await phone.evaluate(() => {
    const v = document.querySelector('.tile.screen video');
    return `${v.videoWidth}x${v.videoHeight}`;
  });
  await phone.screenshot({ path: `${shots}/05-celular-assistindo.png` });
  await pc.screenshot({ path: `${shots}/06-pc-transmitindo.png` });
  step(`celular recebendo a tela: ${size} — ${stats}`);

  // --- Mute reflete para o outro lado ---
  await phone.getByRole('button', { name: 'Silenciar', exact: true }).click();
  await pc.locator('.voice-participant .danger-icon').waitFor({ timeout: 5000 });
  step('silenciar aparece para os outros');

  // --- Câmera do celular aparece no PC ---
  await phone.getByRole('button', { name: 'Ligar câmera' }).click();
  await pc.waitForFunction(
    () => [...document.querySelectorAll('.tile.user video')].some((v) => v.videoWidth > 0),
    null,
    { timeout: 15000 },
  );
  await pc.screenshot({ path: `${shots}/07-pc-camera-do-celular.png` });
  step('câmera do celular chegou no PC');

  await pc.getByRole('button', { name: 'Parar transmissão' }).click();
  await phone.getByText('Assistir transmissão').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await phone.locator('.tile.screen').waitFor({ state: 'detached', timeout: 5000 });
  step('parar a transmissão remove a tela do celular');

  console.log('\nTudo certo! Capturas em e2e/screenshots/');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
