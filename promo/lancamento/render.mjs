// Renderiza o vídeo do lançamento oficial (1080x1920, 30 FPS) com narração, teclado, música e transições.
// Os áudios ficam fora do repositório (gerados no ElevenLabs): passe a pasta com --audio.
// Uso: node promo/lancamento/render.mjs --audio <pasta> [--preview 1,5,9] [--music sequence|mode] [--skip-frames (só refaz o áudio)]
import { createServer } from 'node:http';
import { readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FPS = 30;
const DURATION = 30;
const arg = (k, d) => (process.argv.indexOf(k) > 0 ? process.argv[process.argv.indexOf(k) + 1] : d);
const AUDIO = path.resolve(arg('--audio', '.'));
const OUT = path.resolve(arg('--out', 'promo/out/lancamento'));
const preview = arg('--preview') ? arg('--preview').split(',').map(Number) : null;
const files = await readdir(AUDIO);
const find = (re) => {
  const f = files.find((n) => re.test(n));
  if (!f) throw new Error(`não achei o áudio ${re}`);
  return path.join(AUDIO, f);
};
await mkdir(OUT, { recursive: true });

const root = path.resolve('.');
const server = createServer(async (req, res) => {
  try {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) throw new Error('fora');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0);
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg falhou');
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${server.address().port}/promo/lancamento/video.html`);
await page.waitForFunction(() => window.ready);
await page.evaluate(() => document.fonts.ready);
const frames = path.join(OUT, 'frames');
if (preview) {
  for (const t of preview) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(OUT, `preview-${String(t).replace('.', '_')}.png`) });
  }
} else if (!process.argv.includes('--skip-frames')) {
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  for (let f = 0; f < DURATION * FPS; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS);
    await page.screenshot({ path: path.join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  await page.evaluate((t) => window.seek(t), 2.9);
  await page.screenshot({ path: path.join(OUT, 'capa.png') });
}
await browser.close();
server.close();
if (preview) {
  console.log(`prévias em ${path.relative('.', OUT)}`);
  process.exit(0);
}

// ---------- áudio ----------
const NARR = find(/narra__o_2/);
const KEYB = find(/teclado/);
const MUSIC = find(arg('--music', 'sequence') === 'mode' ? /Launch_Mode/ : /Launch_Sequence/);
const W = [1, 2, 3, 4].map((n) => find(new RegExp(`whoosh_transiti_${n}-`)));
const N = [1, 2, 3, 4].map((n) => find(new RegExp(`notification__${n}-`)));
const CUT = 9.5; // depois de "metralhadora?" a narração para e o teclado toca sozinho
const GAP = 1.5;
const CLICK = 12.14; // clique no "Forte": o teclado some

const inputs = [];
const parts = [];
let nIn = 0;
const add = (file, chain, pre = []) => {
  inputs.push(...pre, '-i', file);
  const k = nIn++;
  parts.push(`[${k}:a]${chain}[a${k}]`);
};
const at = (s) => `adelay=${Math.round(s * 1000)}:all=1`;
// narração em duas partes, com a pausa no meio
add(NARR, `atrim=0:${CUT},asetpts=PTS-STARTPTS,afade=t=out:st=${CUT - 0.05}:d=0.05,volume=1.0`);
add(NARR, `atrim=${CUT},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,volume=1.0,${at(CUT + GAP)}`);
// teclado: entra baixinho na pergunta, fica alto sozinho na pausa e corta seco no clique do filtro
const kStart = 6.4;
const kLen = CLICK - kStart;
const rel = (s) => (s - kStart).toFixed(2);
add(
  KEYB,
  `atrim=0:${kLen.toFixed(2)},asetpts=PTS-STARTPTS,` +
    `volume='if(lt(t,${rel(9.45)}),0.9,if(lt(t,${rel(11.05)}),5.5,1.4))':eval=frame,afade=t=in:d=0.3,afade=t=out:st=${(kLen - 0.03).toFixed(2)}:d=0.03,${at(kStart)}`,
  ['-stream_loop', '2'], // o som tem 4 s: repete na entrada (o filtro aloop quebra o adelay nesta versão do ffmpeg)
);
// música por baixo da voz; some quase toda na pausa do teclado e sobe no final
add(
  MUSIC,
  `atrim=0:${DURATION},asetpts=PTS-STARTPTS,volume='if(lt(t,0.6),0.32,if(lt(t,9.45),0.17,if(lt(t,11.05),0.07,if(lt(t,26.9),0.17,0.17+min(1,(t-26.9)/0.6)*0.33))))':eval=frame,afade=t=out:st=${DURATION - 1.2}:d=1.2`,
);
// transições
for (const [i, s, v] of [[0, 2.95, 0.5], [1, 6.25, 0.45], [2, 13.95, 0.5], [3, 20.32, 0.4], [0, 23.4, 0.45]]) add(W[i], `volume=${v},${at(s)}`);
for (const [i, s, v] of [[0, 2.6, 0.5], [1, 6.02, 0.45], [3, CLICK, 0.6], [2, 19.42, 0.35], [0, 25.72, 0.5]]) add(N[i], `volume=${v},${at(s)}`);

const mixed = `${parts.join(';')};${parts.map((_, k) => `[a${k}]`).join('')}amix=inputs=${parts.length}:normalize=0,apad,atrim=0:${DURATION}`;
// volume final em duas passadas: mede e aplica um ganho fixo (o modo dinâmico achatava a pausa do teclado)
const raw = path.join(OUT, 'audio-raw.wav');
run([...inputs, '-filter_complex', `${mixed}[out]`, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_f32le', raw]);
const m = spawnSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const J = JSON.parse(m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1));
const wav = path.join(OUT, 'audio.wav');
// ganho fixo até -14 LUFS e um limitador nos picos (o loudnorm "linear" volta ao modo dinâmico quando o pico estoura)
const gain = -14 - Number(J.input_i);
run(['-i', raw, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.8:attack=2:release=60:level=false`, '-ar', '48000', wav]);
const mp4 = path.join(OUT, 'resenha-lancamento.mp4');
run(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4]);
console.log(`pronto: ${path.relative('.', mp4)}`);
