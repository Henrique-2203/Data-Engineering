// Renderiza o vídeo quadro a quadro (Playwright) e junta com o ffmpeg.
// Uso: npm run build && node promo/capture.mjs && node promo/render.mjs [--voice narracao.mp3] [--preview 3,10,16]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { FPS, DURATION, VOICE_START, toSrt } from './timeline.mjs';
import { makeSfx } from './sfx.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('.');
const OUT = path.resolve('promo/out');
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const port = server.address().port;

const voiceArg = process.argv.indexOf('--voice');
const voice = voiceArg > 0 ? path.resolve(process.argv[voiceArg + 1]) : null;
const previewArg = process.argv.indexOf('--preview');
const preview = previewArg > 0 ? process.argv[previewArg + 1].split(',').map(Number) : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/promo/video.html`);
await page.waitForFunction(() => window.ready).catch(() => {});
await page.evaluate(() => window.ready);

if (preview) {
  for (const t of preview) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: `${OUT}/preview-${t}.png` });
  }
  console.log('prévias em promo/out/preview-*.png');
} else {
  const frames = path.join(OUT, 'frames');
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const total = Math.round(DURATION * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (i % 150 === 0) console.log(`quadro ${i}/${total}`);
  }
  await writeFile(path.join(OUT, 'efeitos.wav'), makeSfx());
  await writeFile(path.join(OUT, 'resenha-roteiro.srt'), toSrt());
  const enc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const run = (args) => {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg falhou');
  };
  run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', path.join(OUT, 'efeitos.wav'), ...enc, '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(OUT, 'resenha-video.mp4')]);
  run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), ...enc, path.join(OUT, 'resenha-video-sem-som.mp4')]);
  if (voice) {
    // narração na frente (limpa, comprimida e no volume padrão das redes) e efeitos por baixo
    const mix =
      `[1:a]highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-14:TP=-1.5:LRA=7,adelay=${Math.round(VOICE_START * 1000)}:all=1[v];` +
      `[2:a]volume=0.35[s];[v][s]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89[a]`;
    run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', voice, '-i', path.join(OUT, 'efeitos.wav'), '-filter_complex', mix, '-map', '0:v', '-map', '[a]', ...enc, '-c:a', 'aac', '-b:a', '192k', '-t', String(DURATION), path.join(OUT, 'resenha-video-narrado.mp4')]);
    console.log('vídeo narrado em promo/out/resenha-video-narrado.mp4');
  }
  console.log('vídeo em promo/out/resenha-video.mp4');
}
await browser.close();
server.close();
