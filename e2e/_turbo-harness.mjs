// Peças em comum dos testes da transmissão turbo (servidor temporário, contas, tela sintética, leituras do motor).
// ATENÇÃO: a "tela" é uma animação num canvas. Serve para testar o encanamento (negociação, queda, recuperação);
// NÃO prova FPS de jogo real (isso só se mede em hardware real).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const step = (m) => console.log(`✓ ${m}`);
export const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

export async function startHarness({ port, names = ['ana', 'bia', 'caio', 'duda'], tag = 'turbo-life-' }) {
  const BASE = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: tempDir(`resenha-${tag}`) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
  const api = async (p, body, token) => {
    const res = await fetch(`${BASE}/api${p}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const users = [];
  for (const n of names) users.push(await api('/auth/register', { username: n, password: 'Cor-Forte-Xis-42', displayName: n[0].toUpperCase() + n.slice(1), acceptTerms: true }));
  const { guild } = await api('/guilds', { name: 'Galera' }, users[0].token);
  for (const u of users.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  /** abre um navegador logado e já dentro da sala de voz. `settings`: ajustes de voz; `streamer`: tela sintética. */
  async function open(token, { settings = {}, streamer = false, noTurboApis = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, s]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '720p60', performanceMode: false, codec: 'vp8', ...s }));
      },
      [token, settings],
    );
    if (noTurboApis) {
      // aparelho incompatível: sem WebCodecs (simula navegador antigo)
      await ctx.addInitScript(() => {
        delete window.VideoDecoder;
        delete window.VideoEncoder;
        delete window.EncodedVideoChunk;
      });
    }
    if (streamer) {
      await ctx.addInitScript(() => {
        // cada chamada de "escolher tela" cria uma nova animação; `displaySurface` imita monitor/janela
        window.__shareCount = 0;
        navigator.mediaDevices.getDisplayMedia = async () => {
          window.__shareCount++;
          const surface = window.__nextSurface || 'monitor';
          const c = document.createElement('canvas');
          c.width = surface === 'window' ? 960 : 1280;
          c.height = surface === 'window' ? 540 : 720;
          const g = c.getContext('2d');
          let n = 0;
          const draw = () => {
            n++;
            g.fillStyle = `hsl(${(n * 3) % 360} 70% 40%)`;
            g.fillRect(0, 0, c.width, c.height);
            g.fillStyle = '#fff';
            g.font = 'bold 100px sans-serif';
            g.fillText(String(n), 100 + ((n * 7) % 700), 300);
            for (let i = 0; i < 30; i++) g.fillRect((n * 13 + i * 31) % c.width, (i * 17 + n * 5) % c.height, 24, 24);
          };
          const timer = setInterval(draw, 1000 / 60);
          draw();
          const stream = c.captureStream(60);
          if (window.__withAudio) {
            // som de verdade na transmissão (para conferir que o áudio não é duplicado)
            const ac = new AudioContext();
            const osc = ac.createOscillator();
            const dest = ac.createMediaStreamDestination();
            osc.connect(dest);
            osc.start();
            dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
          }
          const track = stream.getVideoTracks()[0];
          const realGet = track.getSettings.bind(track);
          track.getSettings = () => ({ ...realGet(), displaySurface: surface });
          track.addEventListener('ended', () => clearInterval(timer));
          const origStop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            origStop();
          };
          return stream;
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

  const startShare = async (page) => {
    await page.getByRole('button', { name: 'Transmitir tela' }).click();
    await page.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
    await page.getByText('Sua tela').waitFor({ timeout: 15000 });
  };
  const stopShare = async (page) => {
    await page.getByRole('button', { name: 'Parar transmissão' }).click();
    await page.getByText('Sua tela').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  };
  const watch = async (page) => {
    await page.getByRole('button', { name: 'Assistir transmissão' }).click();
    await page.locator('.tile.screen video').waitFor({ timeout: 15000 });
  };
  /** FPS que o espectador mostra de verdade no <video> (medido pelo navegador). */
  const shownFps = (page, ms = 3000) =>
    page.evaluate(
      (dur) =>
        new Promise((resolve) => {
          const v = document.querySelector('.tile.screen video');
          if (!v || !v.requestVideoFrameCallback) return resolve(0);
          let frames = 0;
          const t0 = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - t0 < dur) v.requestVideoFrameCallback(tick);
            else resolve(Math.round((frames / (performance.now() - t0)) * 1000));
          };
          v.requestVideoFrameCallback(tick);
          setTimeout(() => resolve(Math.round((frames / (dur + 1500)) * 1000)), dur + 1500);
        }),
    [ms],
  );
  /** O que o motor de voz do espectador está usando agora para ver a tela de alguém. */
  const viewerState = (page) =>
    page.evaluate(() => {
      const v = window.__resenhaVoice;
      const vid = document.querySelector('.tile.screen video');
      return {
        turboRecv: v.turboRecv.size,
        videoPlaying: !!vid && vid.readyState >= 2 && !vid.paused,
        hasVideoEl: !!vid,
      };
    });
  /** O que o motor de voz do transmissor está fazendo com cada espectador. */
  const senderState = (page) =>
    page.evaluate(() => {
      const v = window.__resenhaVoice;
      const out = { turbo: !!v.turbo, watchers: [] };
      for (const id of v.screenWatchers) {
        const peer = v.peers.get(id);
        out.watchers.push({ id: id.slice(0, 6), inTurbo: !!v.turbo?.has(id), rtcVideo: !!peer?.isSending('screenVideo'), rtcAudio: !!peer?.isSending('screenAudio') });
      }
      return out;
    });
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < ms) {
      last = await fn().catch(() => undefined);
      if (last) return last;
      await sleep(250);
    }
    throw new Error(`FALHOU (tempo esgotado): ${what}`);
  };
  const close = async () => {
    await browser.close().catch(() => {});
    server.kill();
  };
  return { BASE, api, users, open, startShare, stopShare, watch, shownFps, viewerState, senderState, waitFor, close };
}
