// Renderiza o vídeo da conversa (criador + amigo). Antes: node promo/build-conversation.mjs <amigo.mp3> <criador.mp3>
// Uso: node promo/render-conversation.mjs [--preview 5,20,40] [--audio-only]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeConversationMusic } from './conversation-music.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const FPS = 30;
const root = path.resolve('.');
const OUT = path.resolve('promo/out/conversa');
const conv = JSON.parse(readFileSync(path.join(OUT, 'conversa.json'), 'utf8'));
const DURATION = conv.duration;
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : null;
};
const preview = arg('--preview')?.split(',').map(Number);
const audioOnly = process.argv.includes('--audio-only');
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr}`);
  return r;
};

// volume de cada voz por quadro (boca de cada personagem)
const env = {};
for (const who of ['amigo', 'criador']) {
  const raw = run(['-i', path.join(OUT, `voz-${who}.wav`), '-ac', '1', '-ar', '16000', '-f', 's16le', '-']).stdout;
  const s = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const per = 16000 / FPS;
  const rms = [];
  for (let f = 0; f * per < s.length; f++) {
    const a = Math.floor(f * per), b = Math.min(Math.floor((f + 1) * per), s.length);
    let acc = 0;
    for (let j = a; j < b; j++) acc += (s[j] / 32768) ** 2;
    rms.push(Math.sqrt(acc / Math.max(1, b - a)));
  }
  const ref = [...rms].sort((x, y) => x - y)[Math.floor(rms.length * 0.97)] || 1;
  env[who] = rms.map((v) => Math.round(Math.sqrt(Math.min(1, Math.max(0, (v / ref - 0.04) * 1.05))) * 100) / 100);
}
await writeFile(path.join(OUT, 'env.json'), JSON.stringify(env));
const clipsDir = path.resolve('promo/out/clips');
if (existsSync(clipsDir)) {
  const counts = Object.fromEntries(readdirSync(clipsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => [d.name, readdirSync(path.join(clipsDir, d.name)).length]));
  await writeFile(path.join(clipsDir, 'counts.json'), JSON.stringify(counts));
}

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
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
  await page.goto(`http://localhost:${server.address().port}/promo/conversation.html`);
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
      await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
      if (i % 450 === 0) console.log(`quadro ${i}/${total}`);
    }
  }
  await browser.close();
}
if (!preview) {
  await writeFile(path.join(OUT, 'trilha.wav'), makeConversationMusic());
  // em passos separados: com loudnorm + asplit no mesmo grafo, os últimos ~3 s da voz se perdiam na mixagem
  const vproc = path.join(OUT, 'voz-final.wav'), mproc = path.join(OUT, 'trilha-final.wav');
  run(['-i', path.join(OUT, 'conversa.wav'), '-af', 'highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-14:TP=-1.5:LRA=7,aresample=48000', '-ac', '2', vproc]);
  run(['-i', path.join(OUT, 'trilha.wav'), '-i', vproc, '-filter_complex', '[0:a]loudnorm=I=-19.5:TP=-2,aresample=48000,aformat=channel_layouts=stereo[m0];[m0][1:a]sidechaincompress=threshold=0.1:ratio=2.5:attack=20:release=300:makeup=1,volume=-10dB[m]', '-map', '[m]', mproc]);
  run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', vproc, '-i', mproc, '-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(DURATION), path.join(OUT, 'resenha-como-eu-fiz.mp4')]);
  console.log('vídeo em promo/out/conversa/resenha-como-eu-fiz.mp4');
}
server.close();
