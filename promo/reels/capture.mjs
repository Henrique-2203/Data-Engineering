// Telas reais do app para o Reels das novidades (call + Assistir juntos, chat "Só da call",
// qualidade por pessoa, quem pode assistir, aparência e ícones). Dados de mentira (Henrique, Lari,
// Theo e Júlia); o "vídeo" do Assistir juntos e o "jogo" transmitido são a corrida neon nossa
// (promo/game.mjs), nada de conteúdo de terceiros.
// Uso: npm run build && node promo/reels/capture.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3211;
const FAKE = 3212;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/reels/shots');
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-reels-'), EMBED_YOUTUBE_OEMBED: `http://localhost:${FAKE}/yt-oembed` },
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
  const shot = async (page, name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  };
  const join = async (page) => {
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    const btn = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  };

  // ---------- aparência (só o Henrique, no chat) ----------
  const looks = [
    ['chat-escuro', { mode: 'dark', accent: 'green' }],
    ['chat-claro', { mode: 'light', accent: 'green' }],
    ['chat-meia-noite-doodles', { mode: 'dark', accent: 'purple', bg: 'midnight', wallpaper: { kind: 'library', id: 'gamer', dim: 0, blur: 0 } }],
    ['chat-preto-aurora', { mode: 'dark', accent: 'cyan', bg: 'black', wallpaper: { kind: 'library', id: 'aurora', dim: 0.35, blur: 0 } }],
    ['chat-claro-por-do-sol', { mode: 'light', accent: 'pink', wallpaper: { kind: 'library', id: 'sunset', dim: 0.35, blur: 0 } }],
    ['chat-escuro-neon', { mode: 'dark', accent: 'orange', wallpaper: { kind: 'library', id: 'neon', dim: 0.35, blur: 0 } }],
    ['chat-claro-oceano', { mode: 'light', accent: 'blue', wallpaper: { kind: 'library', id: 'ocean', dim: 0.35, blur: 0 } }],
  ];
  for (const [name, ap] of looks) {
    const p = await open(hen.token, { appearance: ap });
    await p.getByRole('button', { name: 'geral' }).first().click();
    await p.getByText('kkkkk eu levo o refri').waitFor();
    await shot(p, name);
    if (name === 'chat-meia-noite-doodles') {
      await p.getByRole('button', { name: 'Configurações', exact: true }).click();
      await p.getByRole('button', { name: 'Aparência' }).click();
      await shot(p, 'config-aparencia');
      await p.getByRole('radio', { name: 'Ícone Neon', exact: true }).scrollIntoViewIfNeeded();
      await p.getByRole('radio', { name: 'Ícone Neon', exact: true }).click();
      await shot(p, 'config-icones');
    }
    await p.context().close();
  }

  // ---------- call: Henrique, Lari e Theo ----------
  const ph = await open(hen.token, { streamer: true });
  const pl = await open(lari.token);
  const pt = await open(theo.token);
  for (const p of [ph, pl, pt]) await join(p);

  // Assistir juntos
  await pl.getByRole('button', { name: 'Assistir juntos (YouTube)' }).click();
  await pl.getByLabel('Link do YouTube').fill('https://youtu.be/aaaaaaaaaaa');
  await pl.getByRole('dialog', { name: 'Assistir juntos' }).getByRole('button', { name: 'Assistir juntos' }).click();
  await ph.locator('.tile.together').waitFor();
  await sleep(3000);
  await ph.locator('.tile.together').hover({ position: { x: 300, y: 200 } });
  await shot(ph, 'call-assistir-juntos');
  // chat só da call
  await ph.getByRole('button', { name: /Abrir o chat da call/ }).click();
  const box = (p) => p.getByLabel('Mensagem só para quem está na call');
  await pl.getByRole('button', { name: /Abrir o chat da call/ }).click();
  await box(pl).fill('PARA TUDO que essa volta foi insana 😂');
  await box(pl).press('Enter');
  await pt.getByRole('button', { name: /Abrir o chat da call/ }).click();
  await box(pt).fill('volta 10s, volta! quero ver de novo');
  await box(pt).press('Enter');
  await box(ph).fill('pausei pra todo mundo, olha o replay 👀');
  await box(ph).press('Enter');
  await ph.locator('.tile.together').hover({ position: { x: 300, y: 200 } });
  await ph.getByRole('button', { name: 'Pausar para todos' }).click();
  await sleep(1200);
  await shot(ph, 'call-chat-so-da-call');
  await pl.locator('.tile.together').hover({ position: { x: 300, y: 200 } });
  await shot(pl, 'call-pausado-para-todos');
  await ph.locator('.tile.together').hover({ position: { x: 300, y: 200 } });
  await ph.getByRole('button', { name: 'Parar para todos' }).click();
  for (const p of [ph, pl, pt]) await p.getByRole('button', { name: 'Fechar o chat da call' }).click().catch(() => {});

  // nova janela de transmitir, com "Só amigos" e o "i" aberto
  await ph.getByRole('button', { name: 'Transmitir tela' }).click();
  const dlg = ph.getByRole('dialog', { name: 'Transmitir tela' });
  await dlg.getByRole('radio', { name: 'Só amigos' }).click();
  await sleep(300);
  await shot(ph, 'transmitir-nova');
  await dlg.getByRole('button', { name: 'O que é: Transmissão turbo' }).click();
  await shot(ph, 'transmitir-nova-info');
  await ph.keyboard.press('Escape');
  await dlg.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await ph.getByText('Sua tela').waitFor({ timeout: 15000 });

  // Júlia entra (não é amiga): vê o cadeado
  const pj = await open(ju.token);
  await join(pj);
  await pj.getByText('Henrique está transmitindo para outras pessoas').waitFor({ timeout: 10000 });
  await shot(pj, 'transmissao-so-amigos-cadeado');

  // Theo assiste e abre a qualidade
  await pt.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pt.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await sleep(4000);
  await pt.locator('.tile.screen').hover();
  await pt.locator('.quality-chip').click();
  await shot(pt, 'qualidade-menu');
  await pt.getByRole('menuitemradio', { name: /^720p/ }).click();
  await sleep(3000);
  await pt.locator('.tile.screen').hover();
  await shot(pt, 'qualidade-720p');
  await ph.locator('.tile.screen').first().hover().catch(() => {});
  await shot(ph, 'transmitindo-henrique');
  console.log('\nTelas em promo/out/reels/shots');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  upstream.close();
}
