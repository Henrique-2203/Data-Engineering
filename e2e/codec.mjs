// Teste do codec da transmissão: o codec escolhido por quem transmite precisa ser o usado,
// não importa quem iniciou a negociação (ex.: o espectador ligou a câmera antes).
// Também confere as estatísticas de envio mostradas para quem transmite.
// Uso: npm run build && node e2e/codec.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3127;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-codec-') },
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
  const a = await api('/auth/register', { username: 'streamer', password: 'segredo123' });
  const b = await api('/auth/register', { username: 'viewer', password: 'segredo123' });
  const { guild } = await api('/guilds', { name: 'Teste Codec' }, a.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, b.token);

  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone', 'camera'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    return page;
  };
  const streamer = await open(a.token);
  const viewer = await open(b.token);
  for (const p of [streamer, viewer]) {
    await p.getByRole('button', { name: 'Sala de voz' }).click();
    await p.getByText('Voz conectada').waitFor({ timeout: 10000 });
  }
  await viewer.waitForFunction(() => document.querySelectorAll('.tile.user').length === 2 && !document.querySelector('.tile-badge'), null, {
    timeout: 15000,
  });

  // o espectador liga a câmera primeiro: ele passa a ser quem oferece a linha de vídeo
  await viewer.getByRole('button', { name: 'Ligar câmera' }).click();
  await streamer.waitForFunction(() => [...document.querySelectorAll('.tile.user video')].some((v) => v.videoWidth > 0), null, {
    timeout: 15000,
  });

  async function shareWith(codecLabel, expected) {
    await streamer.getByRole('button', { name: 'Transmitir tela' }).click();
    await streamer.locator('.modal').getByText('Avançado').click();
    await streamer.locator('#share-codec').selectOption({ label: codecLabel });
    await streamer.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
    const watch = viewer.getByRole('button', { name: 'Assistir transmissão' });
    if (await watch.isVisible().catch(() => false)) await watch.click();
    else await watch.click({ timeout: 10000 }).catch(() => {});
    await viewer.waitForFunction(
      (exp) => document.querySelector('.stream-stats')?.textContent?.includes(exp),
      expected,
      { timeout: 20000 },
    ).catch(async () => {
      throw new Error(`esperava ${expected}, chegou: ${await viewer.locator('.stream-stats').textContent()}`);
    });
    step(`escolhendo ${expected}, o espectador recebe ${expected}: ${await viewer.locator('.stream-stats').textContent()}`);
    // quem transmite vê as estatísticas de envio
    await streamer.locator('.send-stats').waitFor({ timeout: 10000 });
    await streamer.waitForFunction(
      (exp) => /Envio \d+×\d+/.test(document.querySelector('.send-stats')?.textContent ?? '') &&
        document.querySelector('.send-stats').textContent.includes(exp),
      expected,
      { timeout: 10000 },
    );
    step(`quem transmite vê: ${await streamer.locator('.send-stats').textContent()}`);
    await streamer.getByRole('button', { name: 'Parar transmissão' }).click();
    await viewer.locator('.tile.screen').waitFor({ state: 'detached', timeout: 10000 });
  }

  await shareWith('H.264 (recomendado: usa a placa de vídeo)', 'H264');
  await shareWith('VP9 (mais qualidade, usa mais CPU)', 'VP9');
  await shareWith('H.264 (recomendado: usa a placa de vídeo)', 'H264');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
