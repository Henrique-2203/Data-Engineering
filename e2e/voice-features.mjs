// Teste dos recursos de voz para jogadores: push-to-talk, ativação por voz (sensibilidade),
// atalho Ctrl+Shift+M e gravação da tecla do push-to-talk.
// Uso: npm run build && node e2e/voice-features.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3125;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-voice-')) },
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

/** Observa por `ms` se o bloco de alguém aparece "falando" (contorno verde) em algum momento. */
async function sawSpeaking(page, name, ms = 3000) {
  return page.evaluate(
    ({ name, ms }) =>
      new Promise((resolve) => {
        const end = Date.now() + ms;
        const t = setInterval(() => {
          const tile = [...document.querySelectorAll('.tile.user')].find((el) =>
            el.querySelector('.tile-label')?.textContent?.trim().startsWith(name),
          );
          if (tile?.classList.contains('speaking')) {
            clearInterval(t);
            resolve(true);
          } else if (Date.now() > end) {
            clearInterval(t);
            resolve(false);
          }
        }, 50);
      }),
    { name, ms },
  );
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const a = await api('/auth/register', { username: 'falante', password: 'segredo123', displayName: 'Falante' });
  const b = await api('/auth/register', { username: 'ouvinte', password: 'segredo123', displayName: 'Ouvinte' });
  const { guild } = await api('/guilds', { name: 'Teste Voz' }, a.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, b.token);

  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const open = async (token, settings) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone', 'camera'] });
    await ctx.addInitScript(
      ({ token, settings }) => {
        localStorage.setItem('resenha.token', token);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify(settings));
      },
      { token, settings },
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(BASE);
    return page;
  };
  // falante em push-to-talk com a tecla T; ouvinte em ativação por voz sensível
  const speaker = await open(a.token, { inputMode: 'ptt', pttKey: 'KeyT' });
  const listener = await open(b.token, { inputMode: 'voice', vadThresholdDb: -80 });

  for (const p of [speaker, listener]) {
    await p.getByRole('button', { name: 'Sala de voz' }).click();
    await p.getByText('Voz conectada').waitFor({ timeout: 10000 });
  }
  await listener.waitForFunction(() => document.querySelectorAll('.tile.user').length === 2 && !document.querySelector('.tile-badge'), null, {
    timeout: 15000,
  });
  await speaker.getByText('Segure T para falar').waitFor();

  // ---- push-to-talk ----
  if (await sawSpeaking(listener, 'Falante', 3000)) throw new Error('falante transmitiu sem apertar a tecla');
  step('push-to-talk: sem a tecla, o outro lado não ouve nada');
  await speaker.locator('body').click({ position: { x: 700, y: 400 } });
  await speaker.keyboard.down('KeyT');
  await speaker.getByText('Transmitindo…').waitFor();
  if (!(await sawSpeaking(listener, 'Falante', 5000))) throw new Error('segurando a tecla, o áudio não chegou');
  step('push-to-talk: segurando T, o áudio chega do outro lado');
  await speaker.keyboard.up('KeyT');
  await listener.waitForTimeout(800);
  if (await sawSpeaking(listener, 'Falante', 3000)) throw new Error('áudio continuou depois de soltar a tecla');
  step('push-to-talk: soltando a tecla, o microfone fecha');

  // ---- ativação por voz ----
  if (!(await sawSpeaking(speaker, 'Ouvinte', 5000))) throw new Error('ativação por voz sensível não transmitiu');
  step('ativação por voz: com sensibilidade alta, transmite');
  await listener.getByRole('button', { name: 'Configurações' }).click();
  await listener.getByLabel('Sensibilidade da ativação por voz').fill('-10');
  await speaker.waitForTimeout(1000);
  if (await sawSpeaking(speaker, 'Ouvinte', 3000)) throw new Error('com sensibilidade baixa o ruído passou');
  step('ativação por voz: com limite em -10 dB, o som do microfone de teste é cortado');

  // ---- gravação de tecla do push-to-talk ----
  await listener.getByText('Aperte para falar').click();
  await listener.getByRole('button', { name: "' (ao lado do 1)" }).click();
  await listener.keyboard.press('KeyG');
  await listener.getByRole('button', { name: 'G', exact: true }).waitFor();
  step('gravar tecla: o push-to-talk passou a usar G');
  await listener.getByRole('button', { name: 'Fechar' }).click();

  // ---- atalho de silenciar ----
  await listener.keyboard.press('Control+Shift+M');
  await speaker.locator('.voice-participant', { hasText: 'Ouvinte' }).locator('.danger-icon').waitFor({ timeout: 5000 });
  step('Ctrl+Shift+M silencia e os outros veem o ícone');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
