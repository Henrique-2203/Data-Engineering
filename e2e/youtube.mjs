// YouTube e Spotify no chat + "Assistir juntos" na call.
// O ambiente de teste não acessa o YouTube/Spotify: um servidor falso responde o título/miniatura e um
// player falso (no mesmo endereço do YouTube, falando o mesmo protocolo de mensagens) faz o papel do player.
// Uso: npm run build && node e2e/youtube.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = createRequire(path.resolve('server/package.json'))('sharp');
const PORT = 3195;
const FAKE = 3196;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

// ---------- "YouTube/Spotify" falsos (título e miniatura) ----------
const jpeg = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#c4302b' } }).jpeg().toBuffer();
const upstream = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/yt-oembed') {
    const id = /v=([\w-]{11})/.exec(u.searchParams.get('url') ?? '')?.[1];
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ title: id === 'bbbbbbbbbbb' ? 'Segundo Vídeo' : 'Vídeo de Teste', author_name: 'Canal Teste' }));
  }
  if (u.pathname === '/sp-oembed') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ title: 'Música Teste', thumbnail_url: 'https://i.scdn.co/image/abc' }));
  }
  if (/^\/vi\/[\w-]{11}\/hqdefault\.jpg$/.test(u.pathname)) {
    res.setHeader('content-type', 'image/jpeg');
    return res.end(jpeg);
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => upstream.listen(FAKE, r));

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: tempDir('resenha-yt-'),
    EMBED_YOUTUBE_OEMBED: `http://localhost:${FAKE}/yt-oembed`,
    EMBED_YOUTUBE_THUMB: `http://localhost:${FAKE}/vi`,
    EMBED_SPOTIFY_OEMBED: `http://localhost:${FAKE}/sp-oembed`,
  },
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

// player falso: mesmo protocolo de mensagens do player do YouTube (listening/command -> infoDelivery)
const FAKE_PLAYER = `<!doctype html><body style="margin:0;background:#300;color:#fff;font:20px sans-serif"><div id=v></div><script>
const q = new URL(location.href).searchParams;
let vid = location.pathname.split('/').pop(), t = Number(q.get('start') || 0), playing = q.get('autoplay') === '1', state = playing ? 1 : 5, last = performance.now();
const tick = () => { const n = performance.now(); if (playing) t += (n - last) / 1000; last = n; };
const send = (o) => parent.postMessage(JSON.stringify(o), '*');
setInterval(() => { tick(); document.getElementById('v').textContent = vid + ' ' + t.toFixed(1); send({ event: 'infoDelivery', info: { currentTime: t, playerState: state, duration: 600 } }); }, 250);
addEventListener('message', (e) => {
  let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d.event === 'listening') send({ event: 'onReady' });
  if (d.event !== 'command') return;
  tick(); const a = d.args || [];
  if (d.func === 'playVideo') { playing = true; state = 1; }
  if (d.func === 'pauseVideo') { playing = false; state = 2; }
  if (d.func === 'seekTo') t = a[0];
  if (d.func === 'loadVideoById') { vid = a[0].videoId; t = a[0].startSeconds || 0; playing = true; state = 1; }
  if (d.func === 'setVolume') window.__volume = a[0];
  if (d.func === 'loadModule' && a[0] === 'captions') window.__cc = true;
  if (d.func === 'unloadModule' && a[0] === 'captions') window.__cc = false;
});
window.__pauseLocal = () => { tick(); playing = false; state = 2; };
window.__fake = () => ({ vid, t, playing, state, volume: window.__volume, cc: window.__cc });
window.__end = () => { playing = false; state = 0; };
</script>`;

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text').id;

  // ---------- API ----------
  const e1 = await api(`/embed?url=${encodeURIComponent('https://youtu.be/aaaaaaaaaaa?t=30')}`, null, ana.token);
  assert(e1.embed?.title === 'Vídeo de Teste' && e1.embed.author === 'Canal Teste' && e1.embed.start === 30 && e1.embed.thumb === '/api/embed/thumb?yt=aaaaaaaaaaa', `prévia do YouTube (${JSON.stringify(e1)})`);
  const e2 = await api(`/embed?url=${encodeURIComponent('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')}`, null, ana.token);
  assert(e2.embed?.title === 'Música Teste' && /^\/api\/embed\/thumb\?sp=i\.scdn\.co/.test(e2.embed.thumb ?? ''), `prévia do Spotify (${JSON.stringify(e2)})`);
  assert((await api(`/embed?url=${encodeURIComponent('https://evil.example/watch?v=aaaaaaaaaaa')}`, null, ana.token)).status === 404, 'site que não é YouTube/Spotify é recusado');
  const thumbBad = await fetch(`${BASE}/api/embed/thumb?sp=${encodeURIComponent('evil.example/x.jpg')}`, { headers: { authorization: `Bearer ${ana.token}` } });
  assert(thumbBad.status === 404, 'miniatura só de endereços conhecidos');
  step('API: título e miniatura pelo nosso servidor; só YouTube/Spotify; miniatura só de endereços conhecidos');

  await api(`/channels/${geral}/messages`, { content: 'olha esse: https://youtu.be/aaaaaaaaaaa e essa música https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' }, ana.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const csp = [];
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    await ctx.route('https://www.youtube-nocookie.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_PLAYER }));
    await ctx.route('https://open.spotify.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="background:#1db954">Spotify</body>' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('console', (m) => /Content Security Policy/i.test(m.text()) && csp.push(m.text()));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);

  // ---------- chat ----------
  await pb.getByRole('button', { name: 'geral' }).first().click();
  const yt = pb.locator('.link-embed.youtube');
  await yt.getByText('Vídeo de Teste').waitFor();
  await yt.getByText('Canal Teste').waitFor();
  assert(await yt.locator('img').evaluate((i) => i.complete && i.naturalWidth > 0), 'miniatura carregou pelo nosso servidor');
  await pb.locator('.link-embed.spotify').getByText('Música Teste').waitFor();
  assert(!(await pb.locator('iframe').count()), 'nada do YouTube/Spotify carrega antes de clicar');
  await pb.screenshot({ path: path.join(shots, 'youtube-spotify-no-chat.png') });
  await yt.getByRole('button', { name: /Assistir Vídeo de Teste aqui/ }).click();
  const ytSrc = await yt.locator('iframe').getAttribute('src');
  assert(ytSrc.startsWith('https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?autoplay=1'), `player sem cookies (${ytSrc})`);
  await pb.locator('.link-embed.spotify').getByRole('button', { name: /Ouvir Música Teste aqui/ }).click();
  assert((await pb.locator('.link-embed.spotify iframe').getAttribute('src')).startsWith('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT'), 'player do Spotify');
  step('chat: card com título, canal e miniatura; player do YouTube (sem cookies) e do Spotify só ao clicar');

  // ---------- assistir juntos ----------
  await pa.getByRole('button', { name: 'Sala de voz' }).first().click();
  await pa.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await pa.getByRole('button', { name: 'Assistir juntos (YouTube)' }).click();
  await pa.getByLabel('Link do YouTube').fill('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  await pa.getByRole('dialog', { name: 'Assistir juntos' }).getByRole('button', { name: 'Assistir juntos' }).click();
  await pa.locator('.tile.together').getByText('Vídeo de Teste').waitFor();
  await sleep(4000);
  // a Bia entra depois: pega o vídeo já na posição certa
  await pb.getByRole('button', { name: 'Sala de voz' }).first().click();
  await pb.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await pb.locator('.tile.together').getByText('Vídeo de Teste').waitFor();
  const fake = async (page) => {
    for (let i = 0; i < 20; i++) {
      const f = page.frames().find((fr) => fr.url().startsWith('https://www.youtube-nocookie.com/embed/'));
      if (f) {
        try {
          return await f.evaluate(() => window.__fake());
        } catch {
          /* ainda carregando */
        }
      }
      await sleep(250);
    }
    return null;
  };
  await sleep(2500);
  let a = await fake(pa);
  let b = await fake(pb);
  assert(a && b && a.vid === 'aaaaaaaaaaa' && b.vid === 'aaaaaaaaaaa' && a.playing && b.playing, `os dois tocando o mesmo vídeo (${JSON.stringify({ a, b })})`);
  assert(b.t > 3 && Math.abs(a.t - b.t) < 2.5, `quem entrou depois está na mesma posição (${a.t.toFixed(1)} x ${b.t.toFixed(1)})`);
  step(`assistir juntos: começou para a Ana e quem entrou depois pegou na mesma posição (${a.t.toFixed(1)} s x ${b.t.toFixed(1)} s)`);

  // pausar e pular para um ponto: vale para todos
  await pa.locator('.tile.together').hover();
  await pa.getByRole('button', { name: 'Pausar para todos' }).click();
  await sleep(2000);
  b = await fake(pb);
  assert(!b.playing, 'pausou para a Bia também');
  await pb.getByRole('button', { name: 'Tocar para todos' }).click();
  await pb.locator('.together-seek').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '120');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2500);
  a = await fake(pa);
  b = await fake(pb);
  assert(a.playing && b.playing && a.t >= 119 && b.t >= 119 && Math.abs(a.t - b.t) < 2.5, `pular para 2:00 vale para os dois (${a.t.toFixed(1)} x ${b.t.toFixed(1)})`);
  step('pausar, tocar e pular para um ponto valem para todo mundo');

  // volume é só de cada um
  const wake = (page) => page.locator('.tile.together').hover({ position: { x: 200, y: 200 } });
  await wake(pb);
  await pb.locator('.together-volume').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '20');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(800);
  assert((await fake(pb)).volume === 20 && (await fake(pa)).volume !== 20, 'volume só muda para quem mexeu');

  // barras somem depois de 3 s sem mexer o mouse e voltam ao mexer
  await pb.locator('.tile.together.bars-hidden').waitFor({ timeout: 6000 });
  await wake(pb);
  await pb.locator('.tile.together:not(.bars-hidden)').waitFor({ timeout: 2000 });
  step('título e barra de tempo somem sozinhos depois de 3 s (e voltam ao mexer o mouse)');

  // legendas: cada um liga as suas
  await pb.getByRole('button', { name: 'Ligar legendas (só para você)' }).click();
  await sleep(600);
  assert((await fake(pb)).cc === true && (await fake(pa)).cc === undefined, 'legenda só para quem ligou');
  await wake(pb);
  await pb.getByRole('button', { name: 'Desligar legendas (só para você)' }).click();
  await sleep(600);
  assert((await fake(pb)).cc === false, 'desligou a legenda');
  step('legendas: cada um liga ou desliga as suas');

  // controles do YouTube (qualidade, legendas, idioma pelo menu dele): pausar por eles vale para todos
  await wake(pb);
  await pb.getByRole('button', { name: 'Qualidade e legendas (controles do YouTube)' }).click();
  await pb.waitForFunction(() => document.querySelector('.tile.together iframe')?.src.includes('controls=1'));
  await sleep(2500);
  b = await fake(pb);
  assert(b && b.vid === 'aaaaaaaaaaa' && b.playing && b.t >= 119, `player do YouTube recarregou no mesmo ponto (${JSON.stringify(b)})`);
  const fb = () => pb.frames().find((fr) => fr.url().startsWith('https://www.youtube-nocookie.com/embed/'));
  await sleep(1500);
  await fb().evaluate(() => window.__pauseLocal());
  await pa.getByRole('button', { name: 'Tocar para todos' }).waitFor({ timeout: 6000 });
  await sleep(1500);
  assert(!(await fake(pa)).playing, 'pausar pelos controles do YouTube pausou para a Ana também');
  await wake(pa);
  await pa.getByRole('button', { name: 'Tocar para todos' }).click();
  await wake(pb);
  await pb.getByRole('button', { name: 'Usar os controles do Resenha' }).click();
  await pb.waitForFunction(() => document.querySelector('.tile.together iframe')?.src.includes('controls=0'));
  step('controles do YouTube (qualidade, legendas, idioma) só para quem ligou; pausar por eles vale para todos');

  // fechar só para mim: o vídeo continua para os outros
  await sleep(1500);
  await wake(pb);
  await pb.getByRole('button', { name: 'Fechar só para mim' }).click();
  await pb.locator('.tile.together').waitFor({ state: 'detached' });
  await pb.getByText('Voltar a assistir').waitFor();
  await sleep(1500);
  assert((await fake(pa))?.playing, 'continua tocando para a Ana');
  await pb.getByRole('button', { name: 'Voltar a assistir' }).click();
  await pb.locator('.tile.together').waitFor();
  await sleep(2500);
  a = await fake(pa);
  b = await fake(pb);
  assert(b?.playing && Math.abs(a.t - b.t) < 2.5, `voltou no mesmo ponto (${a.t.toFixed(1)} x ${b?.t.toFixed(1)})`);
  step('"Fechar só para mim": some só para quem fechou e dá para voltar no mesmo ponto');

  // quem colocou o vídeo sai da call: continua para os outros
  await pa.getByRole('button', { name: 'Sair da chamada' }).click();
  await sleep(3000);
  b = await fake(pb);
  assert(b?.playing && b.vid === 'aaaaaaaaaaa', `continua para a Bia quando a Ana sai (${JSON.stringify(b)})`);
  await pa.getByRole('button', { name: 'Sala de voz' }).first().click();
  const again = pa.getByRole('button', { name: 'Entrar na chamada' });
  if (await again.isVisible().catch(() => false)) await again.click();
  await pa.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await pa.locator('.tile.together').getByText('Vídeo de Teste').waitFor();
  step('quem colocou o vídeo saiu da call: continua para os outros (e ao voltar, pega no mesmo ponto)');

  // fila: o próximo vídeo começa sozinho quando o atual acaba
  await wake(pa);
  await pa.getByRole('button', { name: 'Fila', exact: true }).click();
  await pa.locator('.together-queue').getByLabel('Link do YouTube').fill('https://youtu.be/bbbbbbbbbbb');
  await pa.locator('.together-queue').getByRole('button', { name: 'Adicionar à fila' }).click();
  await pb.locator('.together-count', { hasText: '1' }).waitFor();
  // um player que diz "acabou" no meio do vídeo (com defeito, PC que dormiu) não encerra o vídeo de todos
  await sleep(2000);
  const fa = () => pa.frames().find((fr) => fr.url().startsWith('https://www.youtube-nocookie.com/embed/'));
  await fa().evaluate(() => window.__end());
  await sleep(3500);
  b = await fake(pb);
  assert(b.vid === 'aaaaaaaaaaa' && b.playing, `"acabou" falso no meio não pula o vídeo (${JSON.stringify(b)})`);
  // perto do fim de verdade: o próximo da fila começa para todos
  await wake(pb);
  await pb.locator('.together-seek').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '597');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2500);
  await fa().evaluate(() => window.__end());
  await pb.locator('.tile.together').getByText('Segundo Vídeo').waitFor({ timeout: 8000 });
  await sleep(2000);
  b = await fake(pb);
  assert(b.vid === 'bbbbbbbbbbb' && b.playing, `o próximo da fila começou para todos (${JSON.stringify(b)})`);
  await wake(pb);
  await pb.screenshot({ path: path.join(shots, 'assistir-juntos.png') });
  step('fila: quando o vídeo acaba de verdade, o próximo começa para todo mundo; "acabou" falso no meio é ignorado');

  // assistir juntos direto do chat
  await wake(pa);
  await pa.getByRole('button', { name: 'Parar para todos' }).click();
  await pb.locator('.tile.together').waitFor({ state: 'detached' });
  await pb.getByRole('button', { name: 'geral' }).first().click();
  await pb.locator('.link-embed.youtube').getByRole('button', { name: 'Assistir juntos na call' }).click();
  await pa.locator('.tile.together').getByText('Vídeo de Teste').waitFor();
  step('do link no chat: "Assistir juntos na call" começa para todo mundo da call');
  assert(!csp.length, `sem bloqueio de segurança no navegador (${csp.join(' | ')})`);
  console.log('\nTUDO CERTO (YouTube e Spotify)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  upstream.close();
}
