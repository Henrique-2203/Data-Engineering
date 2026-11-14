// Renderiza o vídeo "Criei meu próprio Discord" (avatar + narração).
// Uso: npm run build && node promo/capture.mjs && node promo/render-creator.mjs --voice narracao.mp3 [--preview 2,10,25] [--audio-only]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { FPS, DURATION } from './creator-timeline.mjs';
import { makeCreatorMusic } from './creator-music.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('.');
const OUT = path.resolve('promo/out/criador');
await mkdir(OUT, { recursive: true });
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : null;
};
const voice = path.resolve(arg('--voice'));
const preview = arg('--preview')?.split(',').map(Number);
const audioOnly = process.argv.includes('--audio-only');
const run = (args, opts = {}) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr}`);
  return r;
};

// volume da voz a cada quadro (boca do avatar)
const raw = run(['-i', voice, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']).stdout;
const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
const per = 16000 / FPS;
const rms = [];
for (let f = 0; f * per < samples.length; f++) {
  const i0 = Math.floor(f * per), i1 = Math.min(Math.floor((f + 1) * per), samples.length);
  let s = 0;
  for (let j = i0; j < i1; j++) s += (samples[j] / 32768) ** 2;
  rms.push(Math.sqrt(s / Math.max(1, i1 - i0)));
}
const sorted = [...rms].sort((a, b) => a - b);
const ref = sorted[Math.floor(sorted.length * 0.95)] || 1;
// raiz quadrada: falas baixas (começo inseguro) também abrem a boca de forma visível
const envJson = rms.map((v) => Math.round(Math.sqrt(Math.min(1, Math.max(0, (v / ref - 0.04) * 1.05))) * 100) / 100);
await writeFile(path.resolve('promo/out/creator-env.json'), JSON.stringify(envJson));
// quantos quadros tem cada trecho gravado do app (capture-v2.mjs)
const { readdirSync, existsSync } = await import('node:fs');
const clipsDir = path.resolve('promo/out/clips');
const counts = existsSync(clipsDir) ? Object.fromEntries(readdirSync(clipsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => [d.name, readdirSync(path.join(clipsDir, d.name)).length])) : {};
await writeFile(path.join(clipsDir, 'counts.json'), JSON.stringify(counts));

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
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

const frames = path.join(OUT, 'frames');
if (!audioOnly) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${server.address().port}/promo/creator.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.ready);
  if (preview) {
    for (const t of preview) {
      await page.evaluate((t) => window.seek(t), t);
      await page.screenshot({ path: path.join(OUT, `preview-${String(t).replace('.', '_')}.png`) });
    }
  } else {
    await rm(frames, { recursive: true, force: true });
    await mkdir(frames, { recursive: true });
    const total = Math.round(DURATION * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.seek(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (i % 300 === 0) console.log(`quadro ${i}/${total}`);
    }
  }
  await browser.close();
}
if (!preview) {
  await writeFile(path.join(OUT, 'trilha.wav'), makeCreatorMusic());
  const mix =
    `[1:a]highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-14:TP=-1.5:LRA=7,asplit=2[v][vk];` +
    `[2:a]loudnorm=I=-19.5:TP=-2,aformat=channel_layouts=stereo[m0];[m0][vk]sidechaincompress=threshold=0.1:ratio=2.5:attack=20:release=300:makeup=1,volume=-10dB[m];` +
    `[v][m]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89[a]`;
  run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', voice, '-i', path.join(OUT, 'trilha.wav'), '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(DURATION), path.join(OUT, 'resenha-criei-meu-discord.mp4')]);
  console.log('vídeo em promo/out/criador/resenha-criei-meu-discord.mp4');
}
server.close();
