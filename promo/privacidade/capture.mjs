// Telas reais do app para o vídeo "Só quem eu quero vê minha tela": as 4 opções de quem pode assistir,
// a transmissão para "todos menos a Júlia" e o cadeado que ela vê. Dados de mentira (Henrique, Lari,
// Theo e Júlia); o "jogo" transmitido é a corrida neon nossa (promo/game.mjs).
// Uso: npm run build && node promo/privacidade/capture.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3231;
const FAKE = 3232;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/privacidade/shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = readFileSync(path.resolve('promo/game.mjs'), 'utf8').replace(/^export /gm, '');

// "YouTube" de mentira: só o título do vídeo
const upstream = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/yt-oembed') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ title: 'Corrida Neon: a volta mais insana 🔥', author_name: 'Henrique Games' }));
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => upstream.listen(FAKE, r));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-priv-'), EMBED_YOUTUBE_OEMBED: `http://localhost:${FAKE}/yt-oembed` },
  stdio: 'ignore',
});
const api = async (p, body, token, method) =>
  (await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => ({}));

// player falso no endereço do YouTube: desenha a corrida neon e fala o protocolo do player
const PLAYER = `<!doctype html><body style="margin:0;background:#000;overflow:hidden"><canvas id=c width=1280 height=720 style="width:100vw;height:100vh;object-fit:cover"></canvas><script>
${GAME}
const c = document.getElementById('c'); let t = Number(new URL(location.href).searchParams.get('start') || 0), playing = true, last = performance.now();
const send = (o) => parent.postMessage(JSON.stringify(o), '*');
(function loop(){ const n = performance.now(); if (playing) t += (n - last) / 1000; last = n; drawGame(c, t, { boost: 0.6 }); requestAnimationFrame(loop); })();
setInterval(() => send({ event: 'infoDelivery', info: { currentTime: t, playerState: playing ? 1 : 2, duration: 754 } }), 250);
addEventListener('message', (e) => { let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d.event === 'listening') send({ event: 'onReady' });
  if (d.event !== 'command') return; const a = d.args || [];
  if (d.func === 'playVideo') playing = true; if (d.func === 'pauseVideo') playing = false; if (d.func === 'seekTo') t = a[0]; });
</script>`;

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Pao-de-Queijo-77', displayName: d, acceptTerms: true });
  const hen = await reg('henrique', 'Henrique');
  const lari = await reg('lari', 'Lari');
  const theo = await reg('theo', 'Theo');
  const ju = await reg('julia', 'Júlia');
  const { guild } = await api('/guilds', { name: 'Resenha dos Crias' }, hen.token);
  for (const u of [lari, theo, ju]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  // amigos do Henrique: Lari e Theo (a Júlia não)
  for (const u of [['lari', lari], ['theo', theo]]) {
    await api('/friends', { username: u[0] }, hen.token);
    await api(`/friends/${hen.user.id}/accept`, {}, u[1].token);
  }
  const geral = guild.channels.find((c) => c.type === 'text').id;
  const say = (t, content, extra = {}) => api(`/channels/${geral}/messages`, { content, ...extra }, t.token);
  await say(lari, 'gente, hoje tem call? 👀');
  await say(theo, 'bora! 21h todo mundo lá');
  await say(hen, 'fechou. vou transmitir a corrida nova 🏎️');
  await say(ju, 'leva a pipoca que hoje tem campeonato 🍿');
  await say(lari, 'kkkkk eu levo o refri');
  // banners da call (temas nossos)
  for (const [u, b] of [[hen, 'cidade-neon'], [lari, 'espaco'], [theo, 'corrida'], [ju, 'fliperama']]) await api('/me', { callBanner: `preset:${b}` }, u.token, 'PATCH');

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token, { streamer = false, appearance } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, ap]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '1080p60', performanceMode: false }));
        if (ap) localStorage.setItem('resenha.appearance', JSON.stringify(ap));
      },
      [token, appearance ?? null],
    );
    await ctx.route('https://www.youtube-nocookie.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: PLAYER }));
    if (streamer) {
      // a "tela" transmitida é a corrida neon (1080p, 60 FPS); o código entra direto (sem eval: o CSP do site bloqueia)
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
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    // a linha técnica (FPS/Mbps) mostra o PC de teste com 4 navegadores abertos: não entra no vídeo
    await ctx.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '.stream-stats,.send-stats{display:none!important}';
        document.head.appendChild(st);
      }),
    );
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
    return page;
  };
  // posição dos elementos em cada tela (frações), para a montagem destacar a opção certa
  const boxes = {};
  const shot = async (page, name, marks = {}) => {
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const vp = page.viewportSize();
    boxes[name] = {};
    for (const [k, loc] of Object.entries(marks)) {
      const b = await loc.boundingBox().catch(() => null);
      if (b) boxes[name][k] = [b.x / vp.width, b.y / vp.height, b.width / vp.width, b.height / vp.height].map((v) => +v.toFixed(4));
    }
    console.log('✓', name);
  };
  const join = async (page) => {
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    const btn = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  };

  // ---------- call com os 4 ----------
  const ph = await open(hen.token, { streamer: true });
  const pl = await open(lari.token);
  const pt = await open(theo.token);
  const pj = await open(ju.token);
  for (const p of [ph, pl, pt, pj]) await join(p);
  await sleep(2500);
  await shot(ph, 'call-4', { tiles: ph.locator('.voice-stage, .stage').first() });

  // janela de transmitir: as 4 opções
  await ph.getByRole('button', { name: 'Transmitir tela' }).click();
  const dlg = ph.getByRole('dialog', { name: 'Transmitir tela' });
  await dlg.getByRole('radio', { name: 'Todos da call' }).click();
  const M = () => ({ dialog: dlg, modes: dlg.getByRole('radiogroup', { name: 'Quem pode assistir' }), todos: dlg.getByRole('radio', { name: 'Todos da call' }), amigos: dlg.getByRole('radio', { name: 'Só amigos' }), escolher: dlg.getByRole('radio', { name: /Só quem eu/ }), menos: dlg.getByRole('radio', { name: /Todos menos/ }), people: dlg.locator('.audience-people') });
  await shot(ph, 'modal-todos', M());
  await dlg.getByRole('radio', { name: 'Só amigos' }).click();
  await shot(ph, 'modal-amigos', M());
  await dlg.getByRole('radio', { name: /Só quem eu/ }).click();
  await dlg.getByRole('checkbox', { name: 'Lari' }).check();
  await dlg.getByRole('checkbox', { name: 'Theo' }).check();
  await shot(ph, 'modal-escolher', M());
  await dlg.getByRole('radio', { name: /Todos menos/ }).click();
  for (const n of ['Lari', 'Theo']) await dlg.getByRole('checkbox', { name: n }).uncheck().catch(() => {});
  await dlg.getByRole('checkbox', { name: 'Júlia' }).check();
  await shot(ph, 'modal-menos', M());
  await dlg.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await ph.getByText('Sua tela').waitFor({ timeout: 15000 });
  await sleep(1500);

  // a Lari assiste; a Júlia vê o cadeado
  await pl.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pl.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await sleep(4000);
  await shot(pl, 'lari-assistindo', { screen: pl.locator('.tile.screen').first() });
  await pj.getByText('Henrique está transmitindo para outras pessoas').waitFor({ timeout: 10000 });
  await sleep(800);
  await shot(pj, 'julia-cadeado', { lock: pj.getByText('Henrique está transmitindo para outras pessoas'), tile: pj.locator('.tile').filter({ hasText: 'Henrique está transmitindo' }).first() });
  await ph.locator('.tile.screen').first().hover().catch(() => {});
  await shot(ph, 'henrique-transmitindo', { screen: ph.locator('.tile.screen').first(), chip: ph.getByText('Todos menos alguns').first() });
  writeFileSync(path.join(OUT, 'boxes.json'), JSON.stringify(boxes, null, 1));
  console.log('\nTelas em promo/out/privacidade/shots');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  upstream.close();
}
