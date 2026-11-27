// Trilha original do vídeo "Só quem eu quero vê minha tela" (sem direitos autorais), DIFERENTE das
// outras: lo-fi hip-hop, 86 BPM com swing, Fá maior (Fmaj7–Em7–Dm7–Cmaj7). Piano elétrico, baixo
// redondo, bateria "empoeirada" e chiado de vinil. Abre abafado (como atrás de uma porta) e "abre"
// quando a batida entra. Abaixa quando a narração fala.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BEAT, CUTS, DURATION, END, MUSIC, NARRATION } from './timeline.mjs';

const RATE = 44100;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const NARR_WAV = path.resolve('promo/out/privacidade/audio/narracao.wav');

export function makeAudio({ withMusic = true, withVoice = true } = {}) {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), verb = new Float32Array(N);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const put = (t, len, fn, { pan = 0, gain = 1, rev = 0 } = {}) => {
    const s0 = Math.floor(t * RATE);
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    for (let i = 0; i < len * RATE; i++) {
      const j = s0 + i;
      if (j < 0) continue;
      if (j >= N) break;
      const v = fn(i / RATE);
      L[j] += v * gl;
      R[j] += v * gr;
      if (rev) verb[j] += v * rev;
    }
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
  const BAR = 4 * BEAT;
  const SWING = 0.16 * BEAT; // a segunda colcheia atrasa um pouco (balanço)

  const CHORDS = [
    { root: 41, notes: [57, 60, 64, 65] }, // Fmaj7
    { root: 40, notes: [55, 59, 62, 64] }, // Em7
    { root: 38, notes: [53, 57, 60, 62] }, // Dm7
    { root: 36, notes: [52, 55, 59, 60] }, // Cmaj7
  ];
  const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / BAR + 1e-6) % 4];

  // ---------- instrumentos ----------
  /** piano elétrico (seno + harmônico de "sino", tremolo lento) */
  const keys = (t, m, len, g = 1, pan = 0) =>
    put(t, len + 0.6, (x) => {
      const f = hz(m);
      const body = Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * f * 2 * x) * Math.exp(-x * 3) + 0.15 * Math.sin(2 * Math.PI * f * 7.02 * x) * Math.exp(-x * 14);
      const amp = Math.min(1, x / 0.012) * Math.exp(-x * 0.9) * (x > len ? Math.exp(-(x - len) / 0.18) : 1);
      return body * amp * (1 + 0.18 * Math.sin(2 * Math.PI * 4.6 * x)) * 0.07;
    }, { gain: g, pan, rev: 0.35 });
  const chord = (t, c, len, g = 1) => c.notes.forEach((m, i) => keys(t + i * 0.018, m, len, g, (i - 1.5) * 0.18));
  const bass = (t, m, len, g = 1) =>
    put(t, len, (x) => Math.sin(2 * Math.PI * hz(m) * x + 0.4 * Math.sin(2 * Math.PI * hz(m) * 2 * x)) * Math.min(1, x / 0.01) * Math.min(1, (len - x) / 0.04) * Math.exp(-x * 0.6) * 0.32, { gain: g });
  const kick = (t, g = 1) => put(t, 0.35, (x) => Math.sin(2 * Math.PI * (50 * x + (60 / 22) * (1 - Math.exp(-x * 22)))) * env(x, 0.003, 0.12) * 0.7, { gain: g });
  const snare = (t, g = 1) => {
    let lp = 0;
    put(t, 0.25, (x) => {
      lp += 0.25 * (rnd() - lp); // ruído abafado (bateria "empoeirada")
      return (lp * env(x, 0.001, 0.06) * 1.6 + Math.sin(2 * Math.PI * 210 * x) * env(x, 0.001, 0.025) * 0.25) * 0.45;
    }, { gain: g, rev: 0.25, pan: -0.05 });
  };
  const hat = (t, g = 1) => {
    let hp = 0;
    put(t, 0.05, (x) => {
      const n = rnd();
      hp += 0.7 * (n - hp);
      return (n - hp) * env(x, 0.0008, 0.014) * 0.13;
    }, { gain: g, pan: 0.35 });
  };
  const bell = (t, m, g = 1, pan = 0) => put(t, 1.4, (x) => Math.sin(2 * Math.PI * hz(m) * x) * env(x, 0.002, 0.4) * 0.07, { gain: g, pan, rev: 0.6 });
  const impact = (t, g = 1) => {
    let lp = 0;
    put(t, 1.2, (x) => {
      lp += 0.05 * (rnd() - lp);
      return lp * env(x, 0.003, 0.35) * 0.6 + Math.sin(2 * Math.PI * 45 * x) * env(x, 0.003, 0.4) * 0.5;
    }, { gain: g, rev: 0.5 });
  };
  const whoosh = (at, g = 1) => {
    let lp = 0, lp2 = 0;
    const len = 0.45;
    put(at - len * 0.7, len, (x) => {
      const k = x / len;
      const cut = 0.008 + 0.1 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      lp2 += cut * (lp - lp2);
      return lp2 * Math.pow(Math.sin(Math.PI * k), 2) * 0.7;
    }, { gain: g, pan: 0.15 });
  };

  // ---------- arranjo ----------
  const beatIn = MUSIC.beatIn;
  for (let t = 0; t < END - 1e-6; t += BAR) {
    const c = chordAt(t);
    chord(t, c, BAR * 0.55, 1);
    chord(t + BEAT * 2.5 + SWING, c, BAR * 0.3, 0.55); // repique no "e" do 3
  }
  const MEL = [72, 69, 67, 64, 67, 69, 72, 74];
  for (let b = 0; b * BEAT < END - 1e-6; b++) {
    const t = b * BEAT;
    const pos = b % 4;
    const c = chordAt(t);
    if (t >= beatIn - 1e-6) {
      if (pos === 0) kick(t, 1);
      if (pos === 2) kick(t + BEAT / 2 + SWING, 0.75);
      if (pos === 1 || pos === 3) snare(t, 0.7);
      hat(t, 0.9);
      hat(t + BEAT / 2 + SWING, 0.6);
      if (pos === 0) bass(t, c.root, BEAT * 1.4, 1);
      if (pos === 1) bass(t + BEAT / 2 + SWING, c.root + 7, BEAT * 0.9, 0.8);
      if (pos === 3) bass(t + BEAT / 2 + SWING, c.root + 12, BEAT * 0.45, 0.6);
      // sininho da melodia a cada 2 tempos
      if (b % 2 === 0 && Math.floor(t / BAR) % 2 === 1) bell(t + (pos === 2 ? SWING : 0), MEL[(b / 2) % MEL.length], 1, 0.3);
    }
  }
  for (const [t, g] of MUSIC.impacts) impact(t, g);
  // final no logo
  impact(END, 1);
  chord(END, CHORDS[0], DURATION - END, 1.3);
  bass(END, 41, DURATION - END - 0.3, 1);
  [72, 76, 79, 84].forEach((m, i) => bell(END + 0.05 + i * 0.12, m, 1.2, (i - 1.5) * 0.3));
  const hits = [...MUSIC.impacts.map((i) => i[0]), END];
  for (const c of CUTS) if (!hits.includes(c)) whoosh(c, 0.5);

  // ---------- reverb ----------
  const combs = [1601, 1733, 1877, 2003].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [389, 131].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.35 * (o - c.lp);
      c.buf[c.i] = x + c.lp * 0.83;
      c.i = (c.i + 1) % c.d;
      y += o;
    }
    y *= 0.25;
    for (const a of aps) {
      const o = a.buf[a.i];
      const v = y + o * 0.5;
      a.buf[a.i] = v;
      a.i = (a.i + 1) % a.d;
      y = o - v * 0.5;
    }
    L[j] += y * 0.8;
    R[j] += y * 0.8;
  }
  // abafado até a batida entrar (filtro que vai abrindo), e chiado de vinil por cima de tudo
  let fl = 0, fr = 0;
  for (let j = 0; j < N; j++) {
    const t = j / RATE;
    const open = t < beatIn - 0.4 ? 0.16 : t < beatIn ? 0.16 + 0.84 * ((t - (beatIn - 0.4)) / 0.4) ** 2 : 1;
    fl += open * (L[j] - fl);
    fr += open * (R[j] - fr);
    // o filtro tira volume: compensa enquanto está abafado
    const comp = 1 + 1.2 * (1 - open);
    L[j] = fl * comp;
    R[j] = fr * comp;
    const crackle = (rnd() > 0.9993 ? rnd() * 0.25 : 0) + rnd() * 0.004;
    L[j] += crackle;
    R[j] += crackle * 0.9;
  }
  // volume médio com a batida (para pôr a narração acima)
  let acc = 0, cnt = 0;
  for (let j = Math.floor((beatIn + 0.5) * RATE); j < Math.min(N, END * RATE); j++, cnt++) acc += L[j] * L[j];
  const musicRms = Math.sqrt(acc / Math.max(1, cnt));
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
  for (let j = 0; j < N; j++) {
    L[j] = withMusic ? Math.tanh((L[j] / peak) * 1.4) * 0.9 : 0;
    R[j] = withMusic ? Math.tanh((R[j] / peak) * 1.4) * 0.9 : 0;
  }
  const musicLevel = Math.tanh((musicRms / peak) * 1.4) * 0.9;

  // ---------- narração ----------
  if (withVoice && NARRATION.length && existsSync(NARR_WAV)) {
    const narr = readWav(NARR_WAV);
    for (let j = 0; j < N; j++) {
      const t = j / RATE;
      let g = 1;
      for (const n of NARRATION) {
        const t0 = n.at, t1 = n.at + (n.to - n.from), ramp = 0.15;
        const k = t < t0 - ramp || t > t1 + ramp ? 0 : t < t0 ? (t - (t0 - ramp)) / ramp : t > t1 ? 1 - (t - t1) / ramp : 1;
        g = Math.min(g, 1 - (1 - MUSIC.duck) * Math.max(0, Math.min(1, k)));
      }
      L[j] *= g;
      R[j] *= g;
    }
    const kn = withMusic ? (musicLevel * 1.15) / activeRms(narr) : 0.18 / activeRms(narr);
    for (const n of NARRATION) mixIn(L, R, N, narr, n.from, n.to, n.at, kn);
  }

  // ---------- master ----------
  let pk = 0;
  for (let j = 0; j < N; j++) pk = Math.max(pk, Math.abs(L[j]), Math.abs(R[j]));
  const norm = pk > 0.98 ? 0.98 / pk : 1;
  const out = Buffer.alloc(44 + N * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + N * 4, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(N * 4, 40);
  const fadeOut = Math.floor((DURATION - 1.2) * RATE);
  for (let j = 0; j < N; j++) {
    const f = j > fadeOut ? 1 - (j - fadeOut) / (N - fadeOut) : 1;
    out.writeInt16LE(Math.round(L[j] * norm * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(R[j] * norm * f * 32767), 46 + j * 4);
  }
  return out;
}

function readWav(file) {
  const b = readFileSync(file);
  const n = (b.length - 44) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(44 + i * 2) / 32768;
  return out;
}
function mixIn(L, R, N, x, a, b, at, gain) {
  const len = b - a;
  for (let i = 0; i < len * RATE; i++) {
    const j = Math.floor(at * RATE) + i;
    if (j >= N || j < 0) continue;
    const pos = (a + i / RATE) * 48000;
    const p0 = Math.floor(pos);
    const val = x[p0] + (x[p0 + 1] - x[p0]) * (pos - p0) || 0;
    const fade = Math.min(1, i / (0.02 * RATE), (len * RATE - i) / (0.02 * RATE));
    L[j] += val * gain * fade;
    R[j] += val * gain * fade;
  }
}
function activeRms(x) {
  const W = 960, fr = [];
  for (let i = 0; i + W < x.length; i += W) {
    let s = 0;
    for (let j = i; j < i + W; j++) s += x[j] * x[j];
    fr.push(s / W);
  }
  const top = Math.max(...fr);
  const on = fr.filter((v) => v > top / 1000);
  return Math.sqrt(on.reduce((p, q) => p + q, 0) / on.length);
}
