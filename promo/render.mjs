// Renderiza o vídeo quadro a quadro (Playwright) e junta com o ffmpeg.
// Uso: npm run build && node promo/capture.mjs && node promo/render.mjs [--preview 3,10,16]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { FPS, DURATION, toSrt } from './timeline.mjs';
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
  console.log('vídeo em promo/out/resenha-video.mp4');
}
await browser.close();
server.close();
