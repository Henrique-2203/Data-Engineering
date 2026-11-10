// Transmissão turbo x transmissão normal (WebRTC), com 3 amigos assistindo.
// A tela da Ana é um vídeo animado (canvas a 60 FPS); medimos o FPS que chega na tela de cada amigo.
// Uso: npm run build && node e2e/turbo.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3186;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-turbo-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const users = [await reg('ana', 'Ana'), await reg('bia', 'Bia'), await reg('caio', 'Caio'), await reg('duda', 'Duda')];
  const { guild } = await api('/guilds', { name: 'Galera' }, users[0].token);
  for (const u of users.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  async function open(token, turbo, streamer) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, turboOn]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: turboOn, noiseMode: 'browser', screenPreset: '720p60', performanceMode: false, codec: 'vp8' }));
      },
      [token, turbo],
    );
    if (streamer) {
      // "tela" = animação de 60 FPS desenhada num canvas (muda todo quadro, como um jogo)
      await ctx.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const c = document.createElement('canvas');
          c.width = 1280;
          c.height = 720;
          const g = c.getContext('2d');
          let n = 0;
          const draw = () => {
            n++;
            g.fillStyle = `hsl(${(n * 3) % 360} 70% 40%)`;
            g.fillRect(0, 0, 1280, 720);
            g.fillStyle = '#fff';
            g.font = 'bold 120px sans-serif';
            g.fillText(String(n), 100 + ((n * 7) % 900), 380);
            for (let i = 0; i < 40; i++) g.fillRect((n * 13 + i * 31) % 1280, (i * 17 + n * 5) % 720, 24, 24);
          };
          setInterval(draw, 1000 / 60);
          draw();
          return c.captureStream(60);
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return { page, ctx };
  }

  /** FPS que cada amigo vê de verdade (quadros novos no <video>, medidos pelo próprio navegador). */
  const viewerFps = (page) =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const v = document.querySelector('.tile.screen video');
          if (!v || !v.requestVideoFrameCallback) return resolve(0);
          let frames = 0;
          const t0 = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - t0 < 4000) v.requestVideoFrameCallback(tick);
            else resolve(Math.round((frames / (performance.now() - t0)) * 1000));
          };
          v.requestVideoFrameCallback(tick);
          setTimeout(() => resolve(Math.round((frames / 5000) * 1000)), 5000);
        }),
    );

  async function round(turbo) {
    const sessions = [];
    for (const [i, u] of users.entries()) sessions.push(await open(u.token, turbo, i === 0));
    const [ana, ...viewers] = sessions.map((s) => s.page);
    await ana.getByRole('button', { name: 'Transmitir tela' }).click();
    await ana.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
    await ana.getByText('Sua tela').waitFor({ timeout: 15000 });
    for (const v of viewers) await v.getByRole('button', { name: 'Assistir transmissão' }).click();
    for (const v of viewers) await v.locator('.tile.screen video').waitFor({ timeout: 15000 });
    await sleep(6000); // aquece (conexão, controle de banda)
    const stats = await viewers[0].locator('.stream-stats').textContent().catch(() => '');
    const fps = [];
    for (const v of viewers) fps.push(await viewerFps(v));
    const sendStats = await ana.locator('.send-stats').textContent().catch(() => '');
    if (turbo) await viewers[0].screenshot({ path: path.join(shots, 'transmissao-turbo.png') });
    for (const s of sessions) await s.ctx.close();
    return { fps, stats, sendStats };
  }

  const normal = await round(false);
  console.log(`  normal (WebRTC, 1 codificação por amigo): FPS na tela dos 3 amigos = ${normal.fps.join(', ')}`);
  const turbo = await round(true);
  console.log(`  turbo (1 codificação para todos):          FPS na tela dos 3 amigos = ${turbo.fps.join(', ')}`);
  console.log(`  quem assiste vê: ${turbo.stats}`);
  console.log(`  quem transmite vê: ${turbo.sendStats}`);
  assert(/Turbo/.test(turbo.stats) && /Turbo/.test(turbo.sendStats), 'a transmissão foi pelo modo turbo');
  assert(Math.min(...turbo.fps) >= 40, `turbo: todos os amigos com 40+ FPS (${turbo.fps.join(', ')})`);
  step(`turbo: os 3 amigos recebem ${Math.min(...turbo.fps)}+ FPS (normal: ${Math.min(...normal.fps)}+)`);
  console.log('\nTUDO CERTO (transmissão turbo)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
