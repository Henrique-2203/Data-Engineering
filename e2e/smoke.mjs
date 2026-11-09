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
  await pc.goto(`${BASE}/entrar`);
  await pc.getByRole('tab', { name: 'Criar conta' }).click();
  await pc.getByLabel('Usuário').fill('ana');
  await pc.getByLabel('Nome de exibição').fill('Ana');
  await pc.getByLabel('Senha', { exact: true }).fill('segredo123');
  await pc.getByLabel(/li e aceito os Termos/).check();
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
  await phone.getByLabel('Senha', { exact: true }).fill('segredo123');
  await phone.getByLabel(/li e aceito os Termos/).check();
  await phone.getByRole('button', { name: 'Criar conta' }).click();
  await phone.getByText('Galera').waitFor();
  await phone.screenshot({ path: `${shots}/02-celular-entrar.png` });
  await phone.getByRole('button', { name: 'Entrar', exact: true }).click();
  // ao aceitar o convite, o celular já cai direto no #geral
  await phone.getByPlaceholder('Conversar em #geral').waitFor();
  step('celular entrou pelo convite');

  // --- Chat em tempo real ---
  await pc.getByPlaceholder('Conversar em #geral').fill('Bora jogar hoje? 🎮');
  await pc.keyboard.press('Enter');
  await phone.getByText('Bora jogar hoje? 🎮').waitFor({ timeout: 5000 });
  await phone.getByPlaceholder('Conversar em #geral').fill('Bora! Liga a transmissão');
  await phone.getByRole('button', { name: 'Enviar', exact: true }).click();
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

  // ---- tamanho da transmissão: só na tela de quem assiste ----
  await phone.setViewportSize({ width: 1280, height: 800 });
  // assistir já põe a transmissão em destaque: a divisória ajusta o tamanho dela
  const resizer = phone.getByRole('separator', { name: 'Tamanho da transmissão em destaque' });
  await resizer.waitFor();
  const h1 = await phone.locator('.stage-main').evaluate((e) => e.getBoundingClientRect().height);
  await resizer.focus();
  for (let i = 0; i < 4; i++) await phone.keyboard.press('ArrowUp');
  const h2 = await phone.locator('.stage-main').evaluate((e) => e.getBoundingClientRect().height);
  if (!(h2 < h1 - 40)) throw new Error(`a divisória não mudou o tamanho do destaque (${h1} → ${h2})`);
  const box = await resizer.boundingBox();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 5 });
  await phone.mouse.up();
  const h3 = await phone.locator('.stage-main').evaluate((e) => e.getBoundingClientRect().height);
  if (!(h3 > h2 + 100)) throw new Error(`arrastar a divisória não aumentou o destaque (${h2} → ${h3})`);
  const pip = await phone.getByRole('button', { name: 'Abrir em janela flutuante' }).count();
  await phone.screenshot({ path: `${shots}/05b-destaque-redimensionado.png` });
  // pessoas ao lado: a divisória passa a mudar a LARGURA (arrasta para os lados)
  await phone.getByRole('button', { name: 'Pessoas ao lado da transmissão' }).click();
  await phone.locator('.stage.side').waitFor();
  const w1 = await phone.locator('.stage-main').evaluate((e) => e.getBoundingClientRect().width);
  await resizer.focus();
  for (let i = 0; i < 4; i++) await phone.keyboard.press('ArrowLeft');
  const w2 = await phone.locator('.stage-main').evaluate((e) => e.getBoundingClientRect().width);
  if (!(w2 < w1 - 80)) throw new Error(`lado a lado: a divisória não diminuiu a largura (${w1} → ${w2})`);
  const vbox = await resizer.boundingBox();
  await phone.mouse.move(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(vbox.x + 220, vbox.y + vbox.height / 2, { steps: 5 });
  await phone.mouse.up();
  const w3 = await phone.locator('.stage-main').evaluate((e) => e.getBoundingClientRect().width);
  if (!(w3 > w2 + 150)) throw new Error(`lado a lado: arrastar não aumentou a largura (${w2} → ${w3})`);
  await phone.screenshot({ path: `${shots}/05d-lado-a-lado.png` });
  await phone.getByRole('button', { name: 'Pessoas embaixo da transmissão' }).click();
  await phone.locator('.stage.side').waitFor({ state: 'detached' });
  // na grade: aumentar/diminuir
  await phone.getByRole('button', { name: 'Tirar do destaque' }).click();
  await phone.getByRole('button', { name: 'Aumentar transmissão' }).click();
  await phone.locator('.tile.screen.enlarged').waitFor();
  if (await pc.locator('.tile.enlarged').count()) throw new Error('ampliar mudou a tela de quem transmite');
  await phone.screenshot({ path: `${shots}/05c-transmissao-ampliada.png` });
  await phone.getByRole('button', { name: 'Diminuir transmissão' }).click();
  await phone.locator('.tile.screen.enlarged').waitFor({ state: 'detached' });
  await phone.setViewportSize({ width: 390, height: 844 });
  step(`tamanho da transmissão só para quem assiste: aumentar/diminuir, divisória do destaque para cima/baixo (${Math.round(h1)}→${Math.round(h2)}→${Math.round(h3)} px) e para os lados (${Math.round(w1)}→${Math.round(w2)}→${Math.round(w3)} px)${pip ? ', janela flutuante' : ''}`);
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
