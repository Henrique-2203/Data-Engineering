// Renderiza o trailer do app (16:9) e gera as versões para o site.
// Uso: npm run build && node promo/capture.mjs && node promo/render-trailer.mjs [--preview 1,9,14] [--audio-only]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeActionMusic } from './action-music.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FPS = 30;
const DURATION = 24;
const root = path.resolve('.');
const OUT = path.resolve('promo/out/trailer');
const SITE = path.resolve('client/public/landing');
await mkdir(OUT, { recursive: true });
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
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

const arg = (name) => {
  const i = process.argv.indexOf(name);
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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${server.address().port}/promo/trailer.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.ready);
  if (preview) {
    for (const t of preview) {
      await page.evaluate((t) => window.seek(t), t);
      await page.screenshot({ path: path.join(OUT, `preview-${String(t).replace('.', '_')}.png`) });
    }
    console.log('prévias em promo/out/trailer');
  } else {
    await rm(frames, { recursive: true, force: true });
    await mkdir(frames, { recursive: true });
    const total = DURATION * FPS;
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.seek(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (i % 180 === 0) console.log(`quadro ${i}/${total}`);
    }
    // imagem de capa (antes do vídeo carregar) e imagem da transmissão para a página
    await page.evaluate(() => window.seek(10.6));
    await page.screenshot({ path: path.join(OUT, 'poster.png') });
  }
  await browser.close();
}
if (!preview) {
  await writeFile(path.join(OUT, 'trilha-acao.wav'), makeActionMusic(DURATION));
  const audio = ['-i', path.join(OUT, 'trilha-acao.wav'), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9'];
  const input = ['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg')];
  // 1080p para redes sociais
  run([...input, ...audio, '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', path.join(OUT, 'resenha-app-trailer-1080p.mp4')]);
  // 720p leve para o site
  run([...input, ...audio, '-vf', 'scale=1280:720', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', path.join(SITE, 'trailer.mp4')]);
  run(['-i', path.join(OUT, 'poster.png'), '-vf', 'scale=1280:720', '-q:v', '4', path.join(SITE, 'trailer-poster.jpg')]);
  console.log('trailer em promo/out/trailer e client/public/landing/trailer.mp4');
}
server.close();
