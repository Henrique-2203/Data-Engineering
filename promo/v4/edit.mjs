// Vídeo v4 (estilo "criador"): monta as gravações reais (promo/v4/capture.mjs) em 9:16 com cortes secos,
// legenda grande palavra por palavra e o som REAL do filtro de ruído (o mesmo do vídeo que viralizou).
// Uso: node promo/v4/capture.mjs && node promo/v4/edit.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve('promo/out/v4');
const CLIPS = path.join(OUT, 'clips');
const CAP = path.join(OUT, 'legendas');
rmSync(CAP, { recursive: true, force: true });
mkdirSync(CAP, { recursive: true });
const marks = JSON.parse(readFileSync(path.join(CLIPS, 'marcas.json'), 'utf8'));
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });
  if (r.status !== 0) console.error(String(r.stderr).slice(-1500));
  if (r.status !== 0) throw new Error('ffmpeg falhou');
};

// ---------------- roteiro ----------------
// cada parte: de onde vem a imagem, quanto dura e as legendas (tempo relativo à parte)
// tempos conferidos nos quadros da gravação (a gravação começa uns segundos antes das marcas do capture)
const PARTS = [
  { id: 'gancho', src: 'cel', from: 7.5, dur: 2.8, crop: 'full' },
  { id: 'tela', src: 'cel', from: 10.4, dur: 4.0, crop: 'stream' },
  { id: 'ruidoA', src: 'cel', from: 3.3, dur: 2.6, crop: 'full', audio: 'antes' },
  { id: 'ruidoB', src: 'cel', from: 3.5, dur: 2.6, crop: 'full', audio: 'depois' },
  { id: 'lado', src: 'pc', from: 24.6, dur: 7.0, crop: 'side' },
  { id: 'fim', src: 'cel', from: 15, dur: 3.6, crop: 'blur' },
];
// legendas: [início, fim, linhas, tipo] — *palavra* = destaque verde; cada palavra aparece no seu tempo
const CAPS = {
  gancho: [[0.05, 2.8, ['achei um app *BRASILEIRO*', 'que faz de graça o que', 'os outros cobram 👀']]],
  tela: [[0.0, 4.0, ['1. transmite a tela', 'em *Full HD* pros amigos 🎮']]],
  ruidoA: [[0.0, 2.6, ['2. o barulho do teclado', '*SOME* da call ⌨️']]],
  ruidoB: [[0.0, 2.6, ['2. o barulho do teclado', '*SOME* da call ⌨️'], 'still']],
  lado: [[0.0, 7.0, ['3. call e conversa', '*lado a lado* (é só arrastar)']]],
  fim: [[0.0, 3.6, ['é de *graça* 💚', 'link na bio']], [1.3, 3.6, ['qual app vocês usam hoje? 👇'], 'small']],
};
// etiquetas do antes/depois do som
const LABELS = { ruidoA: ['sem filtro 🔊', '#ff5d6c'], ruidoB: ['com o Resenha 🤫', '#3ddc97'] };

// ---------------- legendas em PNG (texto de verdade, com contorno, como nos apps de vídeo) ----------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.setContent(`<!doctype html><html><head><style>
  body{margin:0;background:transparent;font-family:Inter,'Noto Color Emoji',sans-serif}
  #c{display:inline-block;padding:18px 40px;text-align:center}
  .l{font-weight:900;font-size:66px;line-height:1.08;color:#fff;letter-spacing:-1px;
     -webkit-text-stroke:10px #000;paint-order:stroke fill;text-shadow:0 8px 18px rgba(0,0,0,.55)}
  .small .l{font-size:52px;-webkit-text-stroke:8px #000}
  .g{color:#3ddc97}
  .w{opacity:0}.w.on{opacity:1}
  .tag{display:inline-block;padding:14px 34px;border-radius:999px;font-weight:900;font-size:54px;color:#06110c}
</style></head><body><div id="c"></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
let n = 0;
const files = []; // { file, t0, t1, y }
async function shot(html, cls = '') {
  await page.evaluate(([h, c]) => {
    const el = document.getElementById('c');
    el.className = c;
    el.innerHTML = h;
  }, [html, cls]);
  const file = path.join(CAP, `c${String(n++).padStart(3, '0')}.png`);
  await page.locator('#c').screenshot({ path: file, omitBackground: true });
  return file;
}
let tGlobal = 0;
for (const p of PARTS) {
  for (const [a, b, lines, kind] of CAPS[p.id] ?? []) {
    // palavra por palavra: um PNG a cada palavra (a legenda vai "se escrevendo" no ritmo da fala)
    const words = lines.flatMap((l, li) => l.split(' ').map((w) => ({ w, li })));
    const step = Math.min(0.16, (b - a) / (words.length + 2));
    // 'still': a mesma legenda continuando de um corte para o outro (já aparece inteira)
    for (let k = kind === 'still' ? words.length : 1; k <= words.length; k++) {
      const html = lines
        .map((l, li) => {
          let idx = words.findIndex((x) => x.li === li);
          return `<div class="l">${l
            .split(' ')
            .map((w) => {
              const on = idx++ < k;
              const hi = /^\*.*\*$/.test(w);
              return `<span class="w${on ? ' on' : ''}${hi ? ' g' : ''}">${w.replace(/\*/g, '')}</span>`;
            })
            .join(' ')}</div>`;
        })
        .join('');
      const file = await shot(html, kind === 'small' ? 'small' : '');
      const t0 = kind === 'still' ? tGlobal + a : tGlobal + a + (k - 1) * step;
      const t1 = k === words.length ? tGlobal + b : tGlobal + a + k * step;
      files.push({ file, t0, t1, y: kind === 'small' ? 1560 : p.id === 'fim' ? 700 : 150 });
    }
  }
  if (LABELS[p.id]) {
    const [text, color] = LABELS[p.id];
    files.push({ file: await shot(`<span class="tag" style="background:${color}">${text}</span>`), t0: tGlobal + 0.1, t1: tGlobal + p.dur, y: 1640 });
  }
  tGlobal += p.dur;
}
await browser.close();
const DUR = tGlobal;

// ---------------- vídeo ----------------
const inputs = ['-i', path.join(CLIPS, 'celular.webm'), '-i', path.join(CLIPS, 'computador.webm')];
const parts = [];
// cada gravação é usada em mais de uma parte: duplica antes (o ffmpeg não reaproveita a mesma entrada)
const nCel = PARTS.filter((p) => p.src === 'cel').length;
const nPc = PARTS.length - nCel;
parts.push(`[0:v]split=${nCel}${Array.from({ length: nCel }, (_, k) => `[c${k}]`).join('')}`);
parts.push(`[1:v]split=${nPc}${Array.from({ length: nPc }, (_, k) => `[d${k}]`).join('')}`);
let ci = 0;
let di = 0;
PARTS.forEach((p, i) => {
  const src = p.src === 'cel' ? `c${ci++}` : `d${di++}`;
  const trim = `[${src}]trim=start=${p.from.toFixed(2)}:duration=${p.dur},setpts=PTS-STARTPTS,fps=30`;
  let f;
  if (p.crop === 'full') f = `${trim},crop=412:839:0:0,scale=1080:-2,crop=1080:1920:0:(ih-1920)/2`;
  else if (p.crop === 'stream') f = `${trim},crop=412:732:0:40,scale=1080:1920,zoompan=z='min(1.12,1+0.0009*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`;
  else if (p.crop === 'side')
    // a call e a conversa ao lado (sem a coluna de servidores/canais), em cima de um fundo desfocado
    f = `${trim},crop=815:760:465:0,split[a${i}][b${i}];[a${i}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:3,eq=brightness=-0.3[bg${i}];[b${i}]scale=1080:-2[fg${i}];[bg${i}][fg${i}]overlay=0:(H-h)/2+90`;
  else if (p.crop === 'fit')
    f = `${trim},split[a${i}][b${i}];[a${i}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:3,eq=brightness=-0.25[bg${i}];[b${i}]scale=1080:-2[fg${i}];[bg${i}][fg${i}]overlay=0:(H-h)/2`;
  else f = `${trim},crop=412:839:0:0,scale=1080:-2,crop=1080:1920:0:(ih-1920)/2,boxblur=24:2,eq=brightness=-0.35`;
  parts.push(`${f},setsar=1,format=yuv420p[p${i}]`);
});
let graph = parts.join(';') + ';' + PARTS.map((_, i) => `[p${i}]`).join('') + `concat=n=${PARTS.length}:v=1:a=0[base]`;
// legendas por cima, cada uma no seu tempo
const capInputs = files.flatMap((c) => ['-i', c.file]);
let last = 'base';
files.forEach((c, k) => {
  const idx = 2 + k;
  const out = k === files.length - 1 ? 'v' : `o${k}`;
  graph += `;[${last}][${idx}:v]overlay=x=(W-w)/2:y=${c.y}:enable='between(t,${c.t0.toFixed(3)},${c.t1.toFixed(3)})'[${out}]`;
  last = out;
});
// som: só o antes/depois real do filtro (a música entra no app do Instagram, em volume baixo)
const A = path.resolve('promo/out/reels2/audio');
const audioIn = ['-i', path.join(A, 'antes.wav'), '-i', path.join(A, 'depois.wav')];
const ai = 2 + files.length;
let at = 0;
const mixes = [];
for (const p of PARTS) {
  if (p.audio) {
    const k = p.audio === 'antes' ? ai : ai + 1;
    graph += `;[${k}:a]atrim=0.9:${(0.9 + p.dur).toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st=${(p.dur - 0.08).toFixed(2)}:d=0.08,adelay=${Math.round(at * 1000)}:all=1[s${mixes.length}]`;
    mixes.push(`[s${mixes.length}]`);
  }
  at += p.dur;
}
graph += `;${mixes.join('')}amix=inputs=${mixes.length}:normalize=0,apad,atrim=0:${DUR.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
writeFileSync(path.join(OUT, 'graph.txt'), graph);
const mp4 = path.join(OUT, 'resenha-v4-criador.mp4');
run([...inputs, ...capInputs, ...audioIn, '-filter_complex_script', path.join(OUT, 'graph.txt'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-t', DUR.toFixed(2), '-movflags', '+faststart', mp4]);
run(['-ss', '1.5', '-i', mp4, '-frames:v', '1', '-q:v', '3', path.join(OUT, 'resenha-v4-capa.jpg')]);
console.log(`pronto: ${path.relative('.', mp4)} (${DUR.toFixed(1)} s, ${files.length} legendas)`);
