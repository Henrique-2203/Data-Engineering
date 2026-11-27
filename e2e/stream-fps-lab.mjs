// Laboratório do FPS fixo (nada disso está ligado para os usuários).
// A Ana transmite uma "tela" animada a 60 FPS (720p60) para 3 amigos. O Caio tem internet fraca (simulada
// em 2,5 Mb/s, menos do que a transmissão precisa). Comparamos, para cada amigo, o FPS que aparece na tela
// e as travadas (intervalos sem quadro novo), com o laboratório DESLIGADO (o Resenha de hoje) e LIGADO
// (camadas temporais + bitrate constante na transmissão turbo).
// Uso: npm run build && node e2e/stream-fps-lab.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3213;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOW_KBPS = Number(process.env.SLOW_KBPS || 2500);
const SECS = Number(process.env.SECS || 10);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-fpslab-') },
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
  const users = [await reg('ana', 'Ana'), await reg('bia', 'Bia'), await reg('caio', 'Caio'), await reg('duda', 'Duda')];
  const { guild } = await api('/guilds', { name: 'Galera' }, users[0].token);
  for (const u of users.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  async function open(token, streamer, lab) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, isStreamer, labOn, slow]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '720p60', performanceMode: false, codec: 'vp8' }));
        if (isStreamer) {
          localStorage.setItem('resenha.lab', JSON.stringify(labOn ? ['fps'] : []));
          // o 2º a entrar para assistir (Caio) tem internet fraca
          localStorage.setItem('resenha.lab.netKbps', JSON.stringify({ 2: slow }));
        }
      },
      [token, streamer, lab, SLOW_KBPS],
    );
    if (streamer) {
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
            for (let i = 0; i < 60; i++) g.fillRect((n * 13 + i * 31) % 1280, (i * 17 + n * 5) % 720, 28, 28);
          };
          setInterval(draw, 1000 / 60);
          draw();
          return c.captureStream(60);
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera' }).first().click();
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return { page, ctx };
  }

  /** quadros novos no <video> de quem assiste: FPS médio, travadas (>150 ms sem quadro) e a maior travada */
  const measure = (page, secs) =>
    page.evaluate(
      (s) =>
        new Promise((resolve) => {
          const v = document.querySelector('.tile.screen video');
          if (!v?.requestVideoFrameCallback) return resolve({ fps: 0, freezes: 0, worstMs: 0 });
          const times = [];
          const t0 = performance.now();
          const tick = (now) => {
            times.push(now);
            if (now - t0 < s * 1000) v.requestVideoFrameCallback(tick);
            else done();
          };
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            let freezes = 0;
            let worst = 0;
            for (let i = 1; i < times.length; i++) {
              const gap = times[i] - times[i - 1];
              if (gap > 150) freezes++;
              worst = Math.max(worst, gap);
            }
            resolve({ fps: Math.round((times.length / s) * 10) / 10, freezes, worstMs: Math.round(worst) });
          };
          v.requestVideoFrameCallback(tick);
          setTimeout(done, s * 1000 + 1500);
        }),
      secs,
    );

  async function round(lab) {
    const sessions = [];
    for (const [i, u] of users.entries()) sessions.push(await open(u.token, i === 0, lab));
    const [ana, ...viewers] = sessions.map((s) => s.page);
    await ana.getByRole('button', { name: 'Transmitir tela' }).click();
    await ana.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
    await ana.getByText('Sua tela').waitFor({ timeout: 15000 });
    for (const v of viewers) {
      await v.getByRole('button', { name: 'Assistir transmissão' }).click();
      await v.locator('.tile.screen video').waitFor({ timeout: 15000 });
      await sleep(400);
    }
    await sleep(6000); // aquece
    const results = await Promise.all(viewers.map((v) => measure(v, SECS)));
    const send = await ana.evaluate(() => {
      const e = window.__resenhaVoice;
      const s = e.turboSendStats;
      return s ? { capture: s.captureFps, encode: s.encodeFps, temporal: !!s.temporal, codec: s.codec, viewers: s.viewers.map((v) => ({ fps: v.fps, skipped: v.skipped, tlDrops: v.tlDrops ?? 0, mbps: Math.round(v.mbps * 10) / 10 })) } : null;
    });
    const log = await ana.evaluate(() => (window.__resenhaVoice.debugLog ?? []).filter((l) => /turbo\/lab/.test(String(l))).slice(-3));
    for (const s of sessions) await s.ctx.close();
    return { results, send, log };
  }

  const before = await round(false);
  const after = await round(true);
  const names = ['Bia', `Caio (internet de ${SLOW_KBPS / 1000} Mb/s)`, 'Duda'];
  const row = (r) => `${String(r.fps).padStart(5)} FPS · ${String(r.freezes).padStart(3)} travadas · pior ${String(r.worstMs).padStart(5)} ms`;
  console.log(`\nTransmissão 720p60, ${SECS} s medindo cada amigo\n`);
  console.log(`${''.padEnd(32)}HOJE (lab desligado)                       LAB (FPS fixo)`);
  names.forEach((n, i) => console.log(`${n.padEnd(32)}${row(before.results[i])}     ${row(after.results[i])}`));
  console.log(`\nquem transmite (hoje):  ${JSON.stringify(before.send)}`);
  console.log(`quem transmite (lab):   ${JSON.stringify(after.send)}`);
  if (after.log.length) console.log(`lab: ${after.log.join(' | ')}`);
  writeFileSync(path.join(shots, 'stream-fps-lab.json'), JSON.stringify({ slowKbps: SLOW_KBPS, secs: SECS, before, after }, null, 2));
  console.log('\nLABORATÓRIO CONCLUÍDO (resultado em e2e/screenshots/stream-fps-lab.json)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
