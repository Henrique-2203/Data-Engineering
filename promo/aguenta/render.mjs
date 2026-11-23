// Renderiza um episódio de "O Resenha aguenta?" (1080x1920, 30 FPS) com o áudio de verdade:
// o mesmo trecho da gravação SEM filtro e COM o filtro Forte (IA) do app, um depois do outro.
// Uso: node promo/aguenta/prep.mjs promo/aguenta/ep1.json && node promo/aguenta/render.mjs ep1 [--preview 1,5,9]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, readFile as rf } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FPS = 30;
const name = process.argv[2] ?? 'ep1';
const root = path.resolve('.');
const OUT = path.resolve('promo/out/aguenta', name);
const D = JSON.parse(await rf(path.join(OUT, 'data.json'), 'utf8'));
const types = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) throw new Error('fora');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0);
const i = process.argv.indexOf('--preview');
const preview = i > 0 ? process.argv[i + 1].split(',').map(Number) : null;
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg falhou');
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${server.address().port}/promo/aguenta/video.html?d=${name}`);
await page.waitForFunction(() => window.ready);
const frames = path.join(OUT, 'frames');
if (preview) {
  for (const t of preview) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(OUT, `preview-${String(t).replace('.', '_')}.png`) });
  }
} else {
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const total = Math.ceil(D.duration * FPS);
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS);
    await page.screenshot({ path: path.join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.evaluate((t) => window.seek(t), D.rounds[0].sem[0] + 1.2);
  await page.screenshot({ path: path.join(OUT, 'capa.png') });
}
await browser.close();
server.close();
if (preview) {
  console.log(`prévias em ${path.relative('.', OUT)}`);
  process.exit(0);
}

// áudio: cada pedaço entra no instante certo (adelay), com fades curtos para não estalar
const inputs = [];
const parts = [];
const add = (file, from, secs, at, vol = 1) => {
  inputs.push('-i', file);
  const k = inputs.length / 2 - 1;
  parts.push(`[${k}:a]atrim=${from}:${from + secs},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, secs - 0.04)}:d=0.04,volume=${vol},adelay=${Math.round(at * 1000)}:all=1[a${k}]`);
};
const r0 = D.rounds[0];
add(r0.antes, r0.at, D.hook[1], 0); // gancho: o barulho logo de cara
for (const r of D.rounds) {
  add(r.antes, Math.max(0, r.at - 0.9), r.title[1] - r.title[0], r.title[0], 0.35); // barulho chegando, baixinho, no título
  add(r.antes, r.at, r.sem[1] - r.sem[0], r.sem[0]);
  add(r.depois, r.at, r.stamp[1] - r.com[0], r.com[0]);
}
const mix = `${parts.join(';')};${parts.map((_, k) => `[a${k}]`).join('')}amix=inputs=${parts.length}:normalize=0,apad,atrim=0:${D.duration},loudnorm=I=-14:TP=-1.5:LRA=11[out]`;
const wav = path.join(OUT, 'audio.wav');
run([...inputs, '-filter_complex', mix, '-map', '[out]', '-ar', '48000', wav]);
const mp4 = path.join(OUT, `resenha-aguenta-${name}.mp4`);
run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4]);
run(['-i', path.join(OUT, 'capa.png'), '-q:v', '3', path.join(OUT, `resenha-aguenta-${name}-capa.jpg`)]);
await rm(frames, { recursive: true, force: true });
console.log(`pronto: ${path.relative('.', mp4)}`);
