// Prepara os trechos da gravação do Henrique para a versão narrada: volume a cada 20 ms (onda) e os
// cliques do teclado (para as teclas pulando na tela). Lê promo/out/reels2/audio/*.wav (48 kHz mono).
// Uso: node promo/reels2n/prep.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { SEGS } from './timeline.mjs';

const SRC = path.resolve('promo/out/reels2/audio');
const OUT = path.resolve('promo/out/reels2n/audio');
mkdirSync(OUT, { recursive: true });
const SR = 48000, STEP = 0.02;
const wav = (f) => {
  const b = readFileSync(path.join(SRC, f));
  const n = (b.length - 44) / 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  return x;
};
const env = (x, [a, b]) => {
  const out = [];
  for (let t = a; t < b - 1e-6; t += STEP) {
    let s = 0, n = 0;
    for (let i = Math.floor(t * SR); i < (t + STEP) * SR; i++, n++) s += x[i] * x[i];
    out.push(+Math.sqrt(s / n).toFixed(5));
  }
  return out;
};
/** cliques: energia dos agudos (diferença entre amostras) em janelas de 5 ms subindo de repente */
const clicks = (x, [a, b]) => {
  const W = 0.005 * SR, e = [];
  for (let i = Math.floor((a - 0.1) * SR); i < b * SR; i += W) {
    let s = 0;
    for (let j = i; j < i + W; j++) s += (x[j] - x[j - 1]) ** 2;
    e.push(s);
  }
  const sorted = [...e].sort((p, q) => p - q), floor = sorted[Math.floor(e.length * 0.5)];
  const out = [];
  let last = -1;
  for (let f = 20; f < e.length; f++) {
    const t = a - 0.1 + f * 0.005 - a;
    const prev = Math.max(...e.slice(f - 6, f - 1));
    if (e[f] > floor * 12 && e[f] > prev * 3 && t - last > 0.1 && t >= 0) {
      out.push(+t.toFixed(2));
      last = t;
    }
  }
  return out;
};
const antes = wav('antes.wav'), depois = wav('depois.wav'), ta = wav('tec-antes.wav'), td = wav('tec-depois.wav');
const rms = (x, [a, b]) => {
  let s = 0, n = 0;
  for (let i = Math.floor(a * SR); i < b * SR; i++, n++) s += x[i] * x[i];
  return Math.sqrt(s / n);
};
const demo = {
  step: STEP,
  segs: SEGS,
  antes: env(antes, SEGS.fala),
  depois: env(depois, SEGS.fala),
  tecAntes: env(ta, SEGS.tec),
  tecDepois: env(td, SEGS.tec),
  bed: env(ta, SEGS.bed),
  clicks: clicks(antes, SEGS.fala),
  tecClicks: clicks(ta, SEGS.tec),
  bedClicks: clicks(ta, SEGS.bed),
  // o filtrado sai mais alto (reforço do app): toca no MESMO volume do original
  rmsAntes: rms(antes, SEGS.fala),
  rmsDepois: rms(depois, SEGS.fala),
};
writeFileSync(path.join(OUT, 'demo.json'), JSON.stringify(demo));
console.log({ clicks: demo.clicks, tecClicks: demo.tecClicks, bedClicks: demo.bedClicks, level: demo.rmsAntes / demo.rmsDepois });
// conferência com o detector antigo (trecho antigo)
console.log('antigo 0.85–3.35:', clicks(antes, [0.85, 3.35]), 'tec antigo:', clicks(ta, [4.5, 7.0]));
