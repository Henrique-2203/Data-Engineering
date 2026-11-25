// Vídeo de apanhado de funções (1080x1920, 30 FPS). Uso:
//  node promo/qrcam3/render.mjs --preview 1,10,20   (quadros soltos)
//  node promo/qrcam3/render.mjs --audio <pasta com os mp3> [--narr arquivo.mp3]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (k, d) => (process.argv.indexOf(k) > 0 ? process.argv[process.argv.indexOf(k) + 1] : d);
const root = path.resolve('promo/qrcam3');
const OUT = path.resolve('promo/out/qrcam3');
await mkdir(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = createServer(async (req, res) => {
  try {
    const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(root)) throw new Error('fora');
    res.setHeader('Content-Type', types[path.extname(f)] ?? 'application/octet-stream');
    res.end(await readFile(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${srv.address().port}/video.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 1500)); // texturas
const preview = arg('--preview');
if (preview) {
  for (const t of preview.split(',').map(Number)) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(OUT, `p-${String(t).replace('.', '_')}.png`) });
  }
  await b.close(); srv.close(); console.log('prévias em', OUT); process.exit(0);
}
const DUR = await page.evaluate(() => window.DURATION), FPS = 30;
const frames = path.join(OUT, 'frames');
if (!process.argv.includes('--skip-frames')) {
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  for (let f = 0; f < DUR * FPS; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS);
    await page.screenshot({ path: path.join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
}
const TLs = await page.evaluate(() => window.TL);
const META = await page.evaluate(() => ({ CUTS: window.CUTS, POPS: window.POPS }));
await b.close(); srv.close();
// áudio: narração (se houver) + música em loop + whooshes nas trocas de cena
const A = path.resolve(arg('--audio', '.'));
const files = await readdir(A);
const find = (re) => { const f = files.find((n) => re.test(n)); if (!f) throw new Error(`falta o áudio ${re}`); return path.join(A, f); };
const run = (args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg falhou'); };
const inputs = [], parts = []; let n = 0;
const add = (file, chain, pre = []) => { inputs.push(...pre, '-i', file); parts.push(`[${n}:a]${chain}[a${n}]`); n++; };
const narr = arg('--narr');
const music = arg('--music');
const hasNarr = !!narr;
if (narr && music) {
  // a música abaixa sozinha quando a voz fala (sidechain) e volta nas pausas
  inputs.push('-i', path.resolve(narr), '-i', path.resolve(music));
  parts.push(`[${n}:a]asplit=2[nv][nk]`, `[${n + 1}:a]atrim=0:${DUR},asetpts=PTS-STARTPTS,volume=0.55,afade=t=out:st=${DUR - 2}:d=2[mu]`, `[mu][nk]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350:makeup=1[duck]`, `[nv]volume=1.0[a${n}]`, `[duck]anull[a${n + 1}]`);
  n += 2;
} else {
  if (narr) add(path.resolve(narr), 'volume=1.0');
  add(find(/Launch_Mode/), `atrim=0:${DUR},asetpts=PTS-STARTPTS,volume=${hasNarr ? 0.14 : 0.35},afade=t=out:st=${DUR - 2}:d=2`, ['-stream_loop', '5']);
}
const W = [1, 2, 3, 4].map((i) => find(new RegExp(`whoosh_transiti_${i}-`)));
const { CUTS, POPS } = await (async () => ({ CUTS: META.CUTS, POPS: META.POPS }))();
CUTS.forEach((c, i) => add(W[i % 4], `volume=0.45,adelay=${Math.round(Math.max(0, c - 0.15) * 1000)}:all=1`));
const N = [1, 2, 3, 4].map((i) => find(new RegExp(`notification__${i}-`)));
POPS.forEach((h, i) => add(N[i % 4], `volume=0.16,adelay=${Math.round(h * 1000)}:all=1`));
const mixed = `${parts.join(';')};${Array.from({ length: n }, (_, k) => `[a${k}]`).join('')}amix=inputs=${n}:normalize=0,apad,atrim=0:${DUR}`;
const raw = path.join(OUT, 'audio-raw.wav');
run([...inputs, '-filter_complex', `${mixed}[out]`, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_f32le', raw]);
const m = spawnSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const J = JSON.parse(m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1));
const wav = path.join(OUT, 'audio.wav');
run(['-i', raw, '-af', `volume=${(-14 - Number(J.input_i)).toFixed(2)}dB,alimiter=limit=0.8:attack=2:release=60:level=false`, '-ar', '48000', wav]);
const mp4 = path.join(OUT, hasNarr ? 'resenha-camera-celular.mp4' : 'resenha-camera-celular-previa.mp4');
run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', wav, '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4]);
console.log('pronto:', mp4);
