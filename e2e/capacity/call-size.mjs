// Tamanho da call: na call do Resenha cada pessoa se conecta DIRETO com todas as outras (sem servidor
// de mídia no meio). Mede, com 2 a 8 pessoas, se todo mundo conecta, em quanto tempo, quanta internet
// (upload) cada pessoa gasta com a voz e quanto gasta quem transmite a tela para todos.
// Uso: npm run build && node e2e/capacity/call-size.mjs [2,4,6,8]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from '../_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3193;
const BASE = `http://localhost:${PORT}`;
const SIZES = (process.argv[2] ?? '2,4,6,8').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-callsize-'), PWNED_CHECK: 'off' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 0;
async function api(p, body, token) {
  ip++;
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${ip >> 8}.${ip & 255}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

/** upload da página (kbps de áudio e Mbps de vídeo/canal turbo), medido por 5 s no getStats */
const uploadOf = (page) =>
  page.evaluate(async () => {
    const v = globalThis.__resenhaVoice;
    const read = async () => {
      let audio = 0;
      let other = 0;
      for (const p of v.diagnosticPeers()) {
        (await p.pc.getStats()).forEach((r) => {
          if (r.type === 'outbound-rtp' && r.kind === 'audio') audio += r.bytesSent ?? 0;
          if (r.type === 'outbound-rtp' && r.kind === 'video') other += r.bytesSent ?? 0;
          if (r.type === 'data-channel') other += r.bytesSent ?? 0;
        });
      }
      return { audio, other, t: performance.now() };
    };
    const a = await read();
    await new Promise((r) => setTimeout(r, 5000));
    const b = await read();
    const secs = (b.t - a.t) / 1000;
    return { audioKbps: Math.round(((b.audio - a.audio) * 8) / secs / 1000), otherMbps: Math.round((((b.other - a.other) * 8) / secs / 1e6) * 10) / 10 };
  });

let browser;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(250);
  }
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (const n of SIZES) {
    const users = [];
    for (let i = 0; i < n; i++) users.push(await api('/auth/register', { username: `c${n}_${i}`, password: 'Cor-Forte-Xis-42', displayName: `P${i}`, acceptTerms: true }));
    const { guild } = await api('/guilds', { name: `Call ${n}` }, users[0].token);
    for (const u of users.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
    const pages = [];
    const ctxs = [];
    for (const [i, u] of users.entries()) {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
      await ctx.addInitScript(
        ([t, streamer]) => {
          localStorage.setItem('resenha.token', t);
          localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'browser', screenPreset: '720p60' }));
          if (!streamer) return;
          navigator.mediaDevices.getDisplayMedia = async () => {
            const c = document.createElement('canvas');
            c.width = 1280;
            c.height = 720;
            const g = c.getContext('2d');
            let k = 0;
            setInterval(() => {
              k++;
              g.fillStyle = `hsl(${(k * 3) % 360} 60% 40%)`;
              g.fillRect(0, 0, 1280, 720);
              g.fillStyle = '#fff';
              for (let j = 0; j < 30; j++) g.fillRect((k * 11 + j * 41) % 1280, (j * 23) % 720, 30, 30);
            }, 1000 / 60);
            return c.captureStream(60);
          };
        },
        [u.token, i === 0],
      );
      const page = await ctx.newPage();
      await page.goto(`${BASE}/app`);
      await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2000 }).catch(() => {});
      pages.push(page);
      ctxs.push(ctx);
    }
    const t0 = Date.now();
    for (const [i, p] of pages.entries()) {
      await p
        .getByRole('button', { name: 'Sala de voz' })
        .first()
        .click({ timeout: 15000 })
        .catch(async (e) => {
          console.error(`pessoa ${i} não achou o canal de voz`);
          throw e;
        });
    }
    // todo mundo conectado com todo mundo
    let full = false;
    for (let i = 0; i < 120 && !full; i++) {
      const counts = await Promise.all(
        pages.map((p) => p.evaluate(() => globalThis.__resenhaVoice.diagnosticPeers().filter((x) => x.pc.connectionState === 'connected').length).catch(() => 0)),
      );
      full = counts.every((c) => c === n - 1);
      if (!full) await sleep(250);
    }
    const connectSecs = Math.round((Date.now() - t0) / 100) / 10;
    await sleep(3000);
    const voiceUp = await uploadOf(pages[0]);

    // a pessoa 0 transmite para todas as outras
    await pages[0].getByRole('button', { name: 'Transmitir tela' }).click();
    await pages[0].getByRole('button', { name: 'Escolher tela e transmitir' }).click();
    for (const p of pages.slice(1)) await p.getByRole('button', { name: 'Assistir transmissão' }).click();
    await sleep(8000);
    const streamUp = await uploadOf(pages[0]);
    const viewerFps = await Promise.all(
      pages.slice(1).map((p) =>
        p.evaluate(() => {
          const v = globalThis.__resenhaVoice;
          const t = v.diagnosticPeers().map((x) => v.turboRecvStats(x.socketId)).find(Boolean);
          return t?.fps ?? 0;
        }),
      ),
    );
    const r = { people: n, allConnected: full, connectSecs, voiceUploadKbps: voiceUp.audioKbps, streamUploadMbps: streamUp.otherMbps, minViewerFps: Math.min(...viewerFps) };
    results.push(r);
    console.log(
      `${n} pessoas: ${full ? 'todos conectados' : 'NEM TODOS CONECTARAM'} em ${connectSecs} s · upload de voz de cada um ${r.voiceUploadKbps} kbps · ` +
        `quem transmite para ${n - 1}: ${r.streamUploadMbps} Mbps de upload · FPS mais baixo entre quem assiste: ${r.minViewerFps}`,
    );
    for (const c of ctxs) await c.close();
  }
  console.log(`\nRESULTADO ${JSON.stringify(results)}`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
