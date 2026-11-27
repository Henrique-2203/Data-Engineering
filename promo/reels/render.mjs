// Renderiza o Reels das novidades (1080x1920, 30 FPS) em duas versões: com trilha + efeitos e
// sem áudio (para colocar um áudio do próprio Instagram). Também gera a capa.
// Uso: npm run build && node promo/reels/capture.mjs && node promo/reels/render.mjs [--preview 0.5,3,9]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DURATION } from './timeline.mjs';
import { makeReelsAudio } from './music.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FPS = 30;
const root = path.resolve('.');
const OUT = path.resolve('promo/out/reels');
await mkdir(OUT, { recursive: true });
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : null;
};
const preview = arg('--preview')?.split(',').map(Number);
const audioOnly = process.argv.includes('--audio-only');
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg falhou');
};
const frames = path.join(OUT, 'frames');
if (!audioOnly) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  await page.goto(`http://localhost:${server.address().port}/promo/reels/reels.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.ready);
  if (preview) {
    for (const t of preview) {
      await page.evaluate((t) => window.seek(t), t);
      await page.screenshot({ path: path.join(OUT, `preview-${String(t).replace('.', '_')}.png`) });
    }
    console.log('prévias em promo/out/reels');
  } else {
    await rm(frames, { recursive: true, force: true });
    await mkdir(frames, { recursive: true });
    const total = DURATION * FPS;
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.seek(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
      if (i % 150 === 0) console.log(`quadro ${i}/${total}`);
    }
    // capa (o Instagram mostra no perfil)
    await page.evaluate(() => window.seek(1.5));
    await page.screenshot({ path: path.join(OUT, 'capa.png') });
  }
  await browser.close();
}
server.close();
if (!preview) {
  await writeFile(path.join(OUT, 'trilha-reels.wav'), makeReelsAudio());
  const input = ['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg')];
  const video = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart'];
  run([...input, '-i', path.join(OUT, 'trilha-reels.wav'), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9', ...video, '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(OUT, 'resenha-novidades-reels.mp4')]);
  run([...input, ...video, '-an', path.join(OUT, 'resenha-novidades-reels-sem-audio.mp4')]);
  run(['-i', path.join(OUT, 'capa.png'), '-q:v', '3', path.join(OUT, 'resenha-novidades-capa.jpg')]);
  console.log('pronto: promo/out/reels/resenha-novidades-reels.mp4 (+ sem áudio e capa)');
}
