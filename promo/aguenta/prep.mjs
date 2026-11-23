// Prepara um episódio de "O Resenha aguenta?": passa cada gravação pelo MESMO filtro do app (Forte (IA)),
// recorta o mesmo trecho antes e depois (comparação justa), calcula o volume para a animação e monta
// a linha do tempo. Uso: node promo/aguenta/prep.mjs promo/aguenta/ep1.json
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cfgFile = path.resolve(process.argv[2] ?? 'promo/aguenta/ep1.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
const dir = path.dirname(cfgFile);
const name = path.basename(cfgFile, '.json');
const OUT = path.resolve('promo/out/aguenta', name);
mkdirSync(OUT, { recursive: true });
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} falhou`);
};
const SR = 48000;
/** qualquer áudio → wav 48 kHz mono 16 bits */
const norm = (src, dst) => run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', dst]);
const readPcm = (file) => {
  const b = readFileSync(file);
  let o = 12;
  while (o < b.length && b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const data = b.subarray(o + 8, o + 8 + b.readUInt32LE(o + 4));
  const out = new Float32Array(data.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return out;
};
const STEP = 0.02; // volume a cada 20 ms
const env = (pcm, from, secs) => {
  const out = [];
  const n = STEP * SR;
  for (let t = 0; t < secs; t += STEP) {
    const a = Math.floor((from + t) * SR);
    let s = 0;
    for (let i = a; i < a + n && i < pcm.length; i++) s += pcm[i] * pcm[i];
    out.push(Math.round(Math.sqrt(s / n) * 10000) / 10000);
  }
  return out;
};

// linha do tempo (segundos)
const HOOK = 2.6, TITLE = 1.1, SEM = 3.0, COM = 3.0, STAMP = 0.9, END = 3.6;
const rounds = [];
let t = HOOK;
for (const [i, r] of cfg.rounds.entries()) {
  let antes, depois;
  if (r.file) {
    const raw = path.resolve(dir, r.file);
    if (!existsSync(raw)) throw new Error(`Falta a gravação: ${raw} (veja promo/aguenta/LEIA.txt)`);
    const n = path.join(OUT, `r${i + 1}-in.wav`);
    norm(raw, n);
    run(process.execPath, ['promo/reels2/denoise-offline.mjs', n, path.join(OUT, `r${i + 1}.wav`)]);
    antes = path.join(OUT, `r${i + 1}-original.wav`);
    depois = path.join(OUT, `r${i + 1}.wav`);
  } else {
    antes = path.resolve(dir, r.antes);
    depois = path.resolve(dir, r.depois);
  }
  const a = path.join(OUT, `r${i + 1}-antes.wav`);
  const d = path.join(OUT, `r${i + 1}-depois.wav`);
  norm(antes, a);
  norm(depois, d);
  const pa = readPcm(a), pd = readPcm(d);
  const len = SEM + STAMP;
  if ((r.at + len) * SR > Math.min(pa.length, pd.length)) throw new Error(`Rodada ${i + 1}: a gravação precisa ter pelo menos ${r.at + len} s`);
  rounds.push({
    ...r,
    antes: a,
    depois: d,
    title: [t, (t += TITLE)],
    sem: [t, (t += SEM)],
    com: [t, (t += COM)],
    stamp: [t, (t += STAMP)],
    envSem: env(pa, r.at, SEM),
    envCom: env(pd, r.at, COM + STAMP),
    text: r.sem,
  });
}
const data = { ep: cfg.ep, speaker: cfg.speaker, step: STEP, hook: [0, HOOK], end: [t, t + END], duration: t + END, rounds, envHook: env(readPcm(rounds[0].antes), rounds[0].at, HOOK) };
writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(data));
console.log(`pronto: ${path.relative('.', OUT)}/data.json (${data.duration.toFixed(1)} s, ${rounds.length} rodadas)`);
