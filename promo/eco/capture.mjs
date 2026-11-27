// Telas reais do app para o vídeo "sem eco na transmissão": o Lucas transmite a corrida neon (o
// "jogo" é arte nossa, promo/game.mjs) e o Matheus assiste e fala na call. Dados de mentira (Lucas,
// Matheus, Bia, Rafa); avatares desenhados aqui. Grava as telas e as posições (boxes.json).
// Uso: npm run build && node promo/eco/capture.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3247;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/eco/shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = readFileSync(path.resolve('promo/game.mjs'), 'utf8').replace(/^export /gm, '');
const VOZ = process.env.ECO_VOZ; // a fala do Matheus (wav), para o quadrinho dele acender de verdade
const tmp = tempDir('resenha-eco-');
const silence = path.join(tmp, 'silencio.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '10', silence]);
const voice = path.join(tmp, 'voz.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', VOZ, '-ar', '48000', '-ac', '1', '-af', 'volume=2', voice]);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, 'db') },
  stdio: 'ignore',
});
const api = async (p, body, token, method) =>
  (await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => ({}));
const upload = async (p, png, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: 'POST', headers: { 'content-type': 'image/png', authorization: `Bearer ${token}` }, body: png });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
};

// ---------- arte nossa ----------
const face = (bg1, bg2, skin, hair, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/><path d="M96 512c10-96 76-150 160-150s150 54 160 150z" fill="#1f2b44"/>
  <circle cx="256" cy="230" r="104" fill="${skin}"/><path d="M150 214c0-74 50-120 106-120s108 40 108 116c-24-36-66-50-106-48-40 2-80 14-108 52z" fill="${hair}"/>
  <circle cx="218" cy="240" r="11" fill="#2b1d16"/><circle cx="296" cy="240" r="11" fill="#2b1d16"/><path d="M222 286q34 26 68 0" stroke="#2b1d16" stroke-width="10" fill="none" stroke-linecap="round"/>${extra}</svg>`;
const AVATARS = {
  // Lucas: fone de ouvido verde
  lucas: face('#3ddc97', '#1b6fd6', '#e9b48c', '#2b1d16', '<path d="M136 236a120 120 0 0 1 240 0" stroke="#111" stroke-width="22" fill="none"/><rect x="118" y="222" width="40" height="74" rx="18" fill="#3ddc97"/><rect x="354" y="222" width="40" height="74" rx="18" fill="#3ddc97"/>'),
  // Matheus: boné laranja
  matheus: face('#ff9f43', '#c2255c', '#b97a56', '#1a1210', '<path d="M146 190c10-70 60-104 110-104s100 34 110 104z" fill="#ff7a1a"/><path d="M250 186h170c-10 14-40 22-80 22h-90z" fill="#e8590c"/>'),
};

let browser, browserVoz;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${silence}`, '--autoplay-policy=no-user-gesture-required'] });
  browserVoz = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voice}`, '--autoplay-policy=no-user-gesture-required'] });
  const art = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const png = {};
  for (const [k, svg] of Object.entries(AVATARS)) {
    await art.setContent(`<body style="margin:0">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body>`);
    png[k] = await art.locator('svg').screenshot();
  }
  await art.close();

  const reg = (u, d) => api('/auth/register', { username: u, password: 'Pao-de-Queijo-77', displayName: d, acceptTerms: true });
  const lucas = await reg('lucas', 'Lucas');
  const mat = await reg('matheus', 'Matheus');
  const bia = await reg('bia', 'Bia');
  const rafa = await reg('rafa', 'Rafa');
  await upload('/me/avatar', png.lucas, lucas.token);
  await upload('/me/avatar', png.matheus, mat.token);
  for (const [u, b] of [[lucas, 'cidade-neon'], [mat, 'corrida'], [bia, 'espaco'], [rafa, 'fliperama']]) await api('/me', { callBanner: `preset:${b}` }, u.token, 'PATCH');
  const { guild } = await api('/guilds', { name: 'Resenha dos Crias' }, lucas.token);
  for (const u of [mat, bia, rafa]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);

  const open = async (b, token, { streamer = false } = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '1080p60', performanceMode: false, vadThresholdDb: -60 }));
    }, token);
    if (streamer) {
      await ctx.addInitScript({
        content: `${GAME}
          navigator.mediaDevices.getDisplayMedia = async () => {
            const c = document.createElement('canvas');
            c.width = 1920;
            c.height = 1080;
            const t0 = performance.now();
            setInterval(() => drawGame(c, (performance.now() - t0) / 1000, { boost: 0.8 }), 1000 / 60);
            return c.captureStream(60);
          };`,
      });
    }
    // a linha técnica (FPS/Mbps) mostra o PC de teste: não entra no vídeo
    await ctx.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '.stream-stats,.send-stats{display:none!important}';
        document.head.appendChild(st);
      }),
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
    return page;
  };
  const join = async (page) => {
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    const btn = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  };
  const boxes = {};
  /** posição (frações da tela) de cada elemento, para os destaques do vídeo */
  const measure = async (page, name, sel) => {
    const out = {};
    for (const [k, loc] of Object.entries(sel)) {
      const b = await loc.boundingBox().catch(() => null);
      if (b) out[k] = [b.x / 1280, b.y / 800, b.width / 1280, b.height / 800].map((v) => +v.toFixed(4));
    }
    boxes[name] = out;
  };
  const shot = async (page, name, sel = {}) => {
    await page.mouse.move(1270, 790);
    await sleep(400);
    await measure(page, name, sel);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  };

  const pl = await open(browser, lucas.token, { streamer: true });
  const pb = await open(browser, bia.token);
  const pr = await open(browser, rafa.token);
  const pm = await open(browserVoz, mat.token);
  for (const p of [pl, pb, pr, pm]) await join(p);
  for (const p of [pb, pr]) await p.getByRole('button', { name: 'Silenciar microfone' }).first().click().catch(() => {});

  await pl.getByRole('button', { name: 'Transmitir tela' }).click();
  await pl.getByRole('dialog', { name: 'Transmitir tela' }).getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await pl.getByText('Sua tela').waitFor({ timeout: 15000 });
  for (const p of [pm, pb, pr]) await p.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pm.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await sleep(5000);

  const tileOf = (page, name) => page.locator('.tile').filter({ hasText: name }).filter({ hasNot: page.locator('video') }).first();
  // o Lucas transmitindo (o Matheus falando)
  await pl.locator('.tile.speaking').first().waitFor({ timeout: 15000 }).catch(() => console.log('  (Matheus sem falar no print do Lucas)'));
  await shot(pl, 'lucas-transmitindo', { screen: pl.locator('.tile.screen').first(), matheus: tileOf(pl, 'Matheus') });
  // o que o Matheus vê: a transmissão do Lucas, e ele falando
  await pm.locator('.tile.speaking').first().waitFor({ timeout: 15000 }).catch(() => console.log('  (Matheus sem falar no print dele)'));
  await shot(pm, 'matheus-assistindo', { screen: pm.locator('.tile.screen').first(), matheus: tileOf(pm, 'Matheus') });
  // a mesma tela com ninguém falando (cena "só o jogo")
  await pm.getByRole('button', { name: 'Silenciar microfone' }).first().click();
  await sleep(1500);
  await shot(pm, 'matheus-assistindo-quieto', { screen: pm.locator('.tile.screen').first(), matheus: tileOf(pm, 'Matheus') });
  writeFileSync(path.resolve('promo/eco/boxes.json'), JSON.stringify(boxes, null, 1));
  console.log('\nTelas em promo/out/eco/shots');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await browserVoz?.close();
  server.kill();
}
