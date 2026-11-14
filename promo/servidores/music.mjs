// Trilha original do vídeo "O Resenha agora tem comunidade" (sem direitos autorais), DIFERENTE das outras:
// pop eletrônico alegre, 116 BPM, Lá maior (A–E–F#m–D). Abafada no gancho (o print real) e inteira a
// partir do "Agora tem o servidor oficial"; impacto no logo e acorde aberto no "Falta você".
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BEAT, CUTS, DURATION, END, MUSIC, NARRATION, VOICES } from './timeline.mjs';

const RATE = 44100;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const DIR = path.resolve('promo/out/servidores/audio');

export function makeAudio({ withMusic = true, withVoice = true } = {}) {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), verb = new Float32Array(N);
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (j, v, gl, gr, rev) => {
    if (j < 0 || j >= N) return;
    L[j] += v * gl;
    R[j] += v * gr;
    if (rev) verb[j] += v * rev;
  };
  const put = (t, len, fn, { pan = 0, gain = 1, rev = 0 } = {}) => {
    const s0 = Math.floor(t * RATE);
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    for (let i = 0; i < len * RATE; i++) add(s0 + i, fn(i / RATE), gl, gr, rev);
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
  const BAR = 4 * BEAT;
  const CHORDS = [
    { root: 33, notes: [57, 61, 64] }, // A
    { root: 40, notes: [64, 68, 71] }, // E
    { root: 42, notes: [66, 69, 73] }, // F#m
    { root: 38, notes: [62, 66, 69] }, // D
  ];
  const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / BAR + 1e-6) % 4];
  const saw = (f, x) => 2 * ((f * x) % 1) - 1;

  // ---------- instrumentos ----------
  /** pad: 3 serras desafinadas por nota, filtro abrindo com `open` (0 abafado .. 1 aberto) */
  const pad = (t, notes, len, g, open) => {
    for (const m of notes)
      for (const det of [0.994, 1, 1.006]) {
        let lp = 0;
        const cut = 0.02 + 0.1 * open;
        put(t, len, (x) => {
          lp += cut * (saw(hz(m) * det, x) - lp);
          return lp * Math.min(1, x / 0.4) * Math.min(1, (len - x) / 0.35) * 0.03;
        }, { gain: g, rev: 0.45, pan: (det - 1) * 80 });
      }
  };
  /** baixo pulsando em colcheias (serra filtrada com "pluck" no filtro) */
  const bass = (t, m, g, open) => {
    let lp = 0;
    const len = BEAT / 2 - 0.02;
    put(t, len, (x) => {
      const cut = 0.03 + (0.05 + 0.2 * open) * Math.exp(-x * 18);
      lp += cut * (saw(hz(m), x) + 0.5 * saw(hz(m) * 1.003, x) - lp);
      return lp * Math.min(1, x / 0.004) * Math.min(1, (len - x) / 0.01) * 0.22;
    }, { gain: g });
  };
  const kick = (t, g = 1) => put(t, 0.45, (x) => Math.sin(2 * Math.PI * (48 * x + (110 / 16) * (1 - Math.exp(-x * 16)))) * env(x, 0.002, 0.16) * 0.9, { gain: g });
  /** caixa "gated" dos anos 80: ruído + corpo, muito reverb */
  const snare = (t, g = 1) => {
    let hp = 0;
    put(t, 0.22, (x) => {
      const n = rnd();
      hp += 0.5 * (n - hp);
      return ((n - hp) * 0.5 + Math.sin(2 * Math.PI * 190 * x) * 0.4) * env(x, 0.001, 0.07) * 0.55;
    }, { gain: g, rev: 1.1 });
  };
  const hat = (t, g = 1, open = false) => {
    let hp = 0;
    put(t, open ? 0.25 : 0.05, (x) => {
      const n = rnd();
      hp += 0.92 * (n - hp);
      return (n - hp) * env(x, 0.001, open ? 0.08 : 0.015) * 0.18;
    }, { gain: g, pan: 0.25 });
  };
  /** sintetizador do tema (onda quadrada suave + vibrato) */
  const lead = (t, m, len, g = 1) => {
    let lp = 0;
    put(t, len, (x) => {
      const vib = 1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * x) * Math.min(1, x / 0.25);
      const sq = Math.sign(Math.sin(2 * Math.PI * hz(m) * vib * x)) * 0.6 + saw(hz(m) * vib * 1.004, x) * 0.4;
      lp += 0.12 * (sq - lp);
      return lp * Math.min(1, x / 0.02) * Math.min(1, (len - x) / 0.06) * 0.07;
    }, { gain: g, rev: 0.6, pan: -0.1 });
  };
  const impact = (t, g = 1) => {
    kick(t, 1.4 * g);
    put(t, 1.6, (x) => Math.sin(2 * Math.PI * 36 * x) * env(x, 0.005, 0.7) * 0.5, { gain: g });
    let hp = 0;
    put(t, 2.2, (x) => {
      const n = rnd();
      hp += 0.9 * (n - hp);
      return (n - hp) * env(x, 0.004, 0.8) * 0.16;
    }, { gain: g, rev: 0.6 });
  };
  /** subida antes do drop (ruído abrindo) */
  const riser = (at, len, g = 1) => {
    let lp = 0;
    put(at - len, len, (x) => {
      const k = x / len;
      lp += (0.01 + 0.3 * k * k) * (rnd() - lp);
      return lp * k * k * 0.5;
    }, { gain: g, rev: 0.3 });
  };
  const whoosh = (at, g = 1) => {
    let lp = 0, lp2 = 0;
    const len = 0.45;
    put(at - len * 0.7, len, (x) => {
      const k = x / len;
      const cut = 0.008 + 0.12 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      lp2 += cut * (lp - lp2);
      return lp2 * Math.pow(Math.sin(Math.PI * k), 2) * 0.7;
    }, { gain: g, pan: -0.15 });
  };

  // ---------- arranjo ----------
  const drop = MUSIC.drop;
  const inQuiet = (t) => MUSIC.quiet.some(([a, b]) => t >= a - 0.05 && t < b);
  // tema (2 compassos) em Lá maior, saltitante
  const THEME = [[0, 76, 0.5], [0.5, 78, 0.5], [1, 81, 1], [2.5, 80, 0.5], [3, 76, 1], [4, 78, 0.5], [4.5, 80, 0.5], [5, 81, 0.5], [5.5, 83, 1], [7, 81, 1]];
  for (let bar = 0; bar * BAR < END - 1e-6; bar++) {
    const t = bar * BAR;
    if (t + BAR <= 0) continue;
    const c = chordAt(t);
    // intro (abafada) · tensão (depois do eco, sem bateria) · inteira (do "resolveu" em diante)
    const part = t < drop - 1e-6 ? 'intro' : 'full';
    const open = part === 'intro' ? 0.15 : part === 'tensao' ? 0.35 : 1;
    pad(t, c.notes.map((m) => m - 12), BAR + 0.2, part === 'full' ? 1 : 0.8, open);
    for (let i = 0; i < 8; i++) {
      const tt = t + (i * BEAT) / 2;
      if (inQuiet(tt) || tt >= END) continue;
      bass(tt, c.root + (i % 2 ? 12 : 0), part === 'intro' ? 0.7 : 1, open);
    }
    for (let i = 0; i < 4; i++) {
      const tt = t + i * BEAT;
      if (inQuiet(tt) || tt >= END) continue;
      if (part === 'intro') {
        if (i % 2 === 0) kick(tt, 0.55);
      } else if (part === 'full') {
        kick(tt, i % 2 === 0 ? 1 : 0.7);
        if (i % 2 === 1) snare(tt, 0.9);
        hat(tt + BEAT / 2, 0.8, i === 3);
        hat(tt, 0.5);
      }
    }
    if (part === 'full' && bar % 2 === 0) for (const [o, m, d] of THEME) if (!inQuiet(t + o * BEAT) && t + o * BEAT < END) lead(t + o * BEAT, m, d * BEAT, 1);
  }
  riser(drop, 1.6, 0.9);
  impact(drop, 1);
  impact(END, 1.2);
  pad(END, [45, 52, 57, 61, 64, 69], DURATION - END, 1.6, 0.8);
  for (const c of CUTS) if (![drop, END].includes(c) && !inQuiet(c)) whoosh(c, 0.4);

  // ---------- reverb ----------
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [225, 556].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.35 * (o - c.lp);
      c.buf[c.i] = x + c.lp * 0.84;
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
    L[j] += y * 0.9;
    R[j] += y * 0.9;
  }
  let acc = 0, cnt = 0;
  for (let j = Math.floor((drop + 0.5) * RATE); j < Math.min(N, END * RATE); j++, cnt++) acc += L[j] * L[j];
  const musicRms = Math.sqrt(acc / Math.max(1, cnt));
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
  for (let j = 0; j < N; j++) {
    // nos "Escuta" a música some de vez (rampa curta)
    const t = j / RATE;
    let q = 1;
    for (const [a, b] of MUSIC.quiet) {
      const k = t < a ? 1 : t < a + 0.25 ? 1 - (t - a) / 0.25 : t < b - 0.05 ? 0 : t < b ? (t - (b - 0.05)) / 0.05 : 1;
      q = Math.min(q, k);
    }
    L[j] = withMusic ? Math.tanh((L[j] / peak) * 1.4) * 0.9 * q : 0;
    R[j] = withMusic ? Math.tanh((R[j] / peak) * 1.4) * 0.9 * q : 0;
  }
  const musicLevel = Math.tanh((musicRms / peak) * 1.4) * 0.9;

  // ---------- vozes (narração + Matheus) ----------
  const narrFile = path.join(DIR, 'narr.wav');
  if (withVoice && existsSync(narrFile)) {
    const clips = [...NARRATION.map((n) => ({ ...n, file: 'narr' })), ...VOICES];
    for (let j = 0; j < N; j++) {
      const t = j / RATE;
      let g = 1;
      for (const n of clips) {
        const t0 = n.at, t1 = n.at + (n.to - n.from), ramp = 0.15;
        const k = t < t0 - ramp || t > t1 + ramp ? 0 : t < t0 ? (t - (t0 - ramp)) / ramp : t > t1 ? 1 - (t - t1) / ramp : 1;
        g = Math.min(g, 1 - (1 - MUSIC.duck) * Math.max(0, Math.min(1, k)));
      }
      L[j] *= g;
      R[j] *= g;
    }
    const wav = {};
    for (const n of clips) wav[n.file] ??= readWav(path.join(DIR, `${n.file}.wav`));
    const target = withMusic ? musicLevel * 1.15 : 0.18;
    // cada voz no mesmo volume (o eco usa o volume da fala original × gain)
    const level = (f) => target / activeRms(wav[f === 'f1-eco' ? 'f1' : f]);
    for (const n of clips) mixIn(L, R, N, wav[n.file], n.from, n.to, n.at, level(n.file) * (n.gain ?? 1));
  }

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

/** volume (RMS a cada 20 ms) de uma fala, para desenhar a onda no vídeo */
export function envelope(file, from = 0, to = Infinity) {
  const x = readWav(path.join(DIR, `${file}.wav`));
  const step = 960, out = [];
  for (let i = Math.floor(from * 48000); i + step < Math.min(x.length, to * 48000); i += step) {
    let s = 0;
    for (let j = i; j < i + step; j++) s += x[j] * x[j];
    out.push(+Math.sqrt(s / step).toFixed(4));
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
