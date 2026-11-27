// Trilha original do vídeo "Um perfil em cada servidor" (sem direitos autorais), diferente das outras:
// aventura/fantasia, 100 BPM, Ré menor (Dm–C–B♭–C). Harpa sozinha e triste enquanto ele conta do
// "outro app"; no "Resenha" entram tambores, cordas, alaúde e a flauta com o tema. Abaixa na narração.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BEAT, CUTS, DURATION, END, MUSIC, NARRATION } from './timeline.mjs';

const RATE = 44100;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const NARR_WAV = path.resolve('promo/out/perfis/audio/narracao.wav');

export function makeAudio({ withMusic = true, withVoice = true } = {}) {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), verb = new Float32Array(N);
  let seed = 23;
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
    { root: 38, notes: [62, 65, 69] }, // Dm
    { root: 36, notes: [60, 64, 67] }, // C
    { root: 34, notes: [58, 62, 65] }, // B♭
    { root: 36, notes: [60, 64, 67] }, // C
  ];
  const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / BAR + 1e-6) % 4];

  // ---------- instrumentos ----------
  /** corda dedilhada (Karplus-Strong): harpa (brilho alto) e alaúde (mais seco) */
  const pluck = (t, m, { gain = 1, pan = 0, decay = 0.996, bright = 0.5, len = 1.6 } = {}) => {
    const f = hz(m);
    const P = Math.max(2, Math.round(RATE / f));
    const buf = new Float32Array(P);
    for (let i = 0; i < P; i++) buf[i] = rnd() * (1 - bright) + rnd() * bright;
    let idx = 0;
    const s0 = Math.floor(t * RATE);
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    for (let i = 0; i < len * RATE; i++) {
      const a = buf[idx], c = buf[(idx + 1) % P];
      const v = (a + c) * 0.5 * decay;
      buf[idx] = v;
      idx = (idx + 1) % P;
      add(s0 + i, a * 0.22 * Math.min(1, (len * RATE - i) / (0.05 * RATE)), gl, gr, 0.4);
    }
  };
  /** cordas (serras desafinadas, filtradas, entrada lenta) */
  const strings = (t, notes, len, g = 1) => {
    for (const m of notes)
      for (const det of [0.996, 1.004]) {
        let lp = 0;
        put(t, len, (x) => {
          const v = 2 * ((hz(m) * det * x) % 1) - 1;
          lp += 0.04 * (v - lp);
          return lp * Math.min(1, x / 0.35) * Math.min(1, (len - x) / 0.3) * 0.045;
        }, { gain: g, rev: 0.5, pan: (det - 1) * 120 });
      }
  };
  /** flauta: seno com vibrato e um pouco de sopro */
  const flute = (t, m, len, g = 1) => {
    let lp = 0;
    put(t, len, (x) => {
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * x) * Math.min(1, x / 0.3);
      lp += 0.1 * (rnd() - lp);
      const a = Math.min(1, x / 0.06) * Math.min(1, (len - x) / 0.08);
      return (Math.sin(2 * Math.PI * hz(m) * vib * x) * 0.9 + lp * 0.12) * a * 0.09;
    }, { gain: g, rev: 0.45, pan: 0.1 });
  };
  /** tambor grave (taiko) e tambor de mão */
  const taiko = (t, g = 1) => {
    put(t, 0.6, (x) => Math.sin(2 * Math.PI * (60 * x + (50 / 12) * (1 - Math.exp(-x * 12)))) * env(x, 0.002, 0.22) * 0.8, { gain: g, rev: 0.2 });
    let lp = 0;
    put(t, 0.08, (x) => {
      lp += 0.3 * (rnd() - lp);
      return lp * env(x, 0.001, 0.02) * 0.6;
    }, { gain: g });
  };
  const handDrum = (t, g = 1, pan = 0.25) => {
    let bp = 0;
    put(t, 0.15, (x) => {
      const n = rnd();
      bp += 0.35 * (n - bp);
      return (Math.sin(2 * Math.PI * 220 * x) * env(x, 0.001, 0.04) * 0.4 + (n - bp) * env(x, 0.001, 0.03) * 0.3) * 0.7;
    }, { gain: g, pan, rev: 0.25 });
  };
  const bassNote = (t, m, len, g = 1) => put(t, len, (x) => Math.sin(2 * Math.PI * hz(m) * x) * Math.min(1, x / 0.01) * Math.min(1, (len - x) / 0.05) * 0.3, { gain: g });
  const cymbal = (t, g = 1) => {
    let hp = 0;
    put(t, 2.2, (x) => {
      const n = rnd();
      hp += 0.9 * (n - hp);
      return (n - hp) * env(x, 0.004, 0.7) * 0.18;
    }, { gain: g, rev: 0.4 });
  };
  const impact = (t, g = 1) => {
    taiko(t, 1.3 * g);
    cymbal(t, g);
    put(t, 1.5, (x) => Math.sin(2 * Math.PI * 41 * x) * env(x, 0.005, 0.6) * 0.5, { gain: g });
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
  const beatIn = MUSIC.beatIn;
  // tema da flauta (2 compassos), pentatônica menor de Ré
  const THEME = [[0, 74, 1], [1, 72, 0.5], [1.5, 69, 0.5], [2, 72, 1], [3, 74, 1], [4, 77, 1.5], [5.5, 76, 0.5], [6, 74, 2]];
  for (let bar = 0; bar * BAR < END - 1e-6; bar++) {
    const t = bar * BAR;
    const c = chordAt(t);
    const full = t >= beatIn - 1e-6;
    // harpa: arpejo subindo (sozinha e devagar antes do Resenha; depois em colcheias)
    const arp = [c.notes[0] - 12, c.notes[1] - 12, c.notes[2] - 12, c.notes[0], c.notes[1], c.notes[2], c.notes[1], c.notes[0]];
    const step = full ? BEAT / 2 : BEAT;
    for (let i = 0; i < (full ? 8 : 4); i++) pluck(t + i * step, arp[full ? i : i * 2], { gain: full ? 0.8 : 3, pan: (i % 2 ? 0.3 : -0.3), bright: 0.6, len: full ? 1.6 : 2.4 });
    if (!full) {
      strings(t, c.notes.map((m) => m - 12), BAR + 0.2, 0.8); // fundo baixinho, melancólico
      continue;
    }
    strings(t, c.notes.map((m) => m - 12), BAR + 0.2, 1);
    bassNote(t, c.root, BEAT * 1.5, 1);
    bassNote(t + BEAT * 2, c.root, BEAT * 1.5, 0.8);
    // tambores: BUM . pa BUM | BUM pa pa .
    for (const [o, k] of [[0, 'T'], [1.5, 'h'], [2, 'T'], [2.5, 'T'], [3, 'h'], [3.5, 'h']]) (k === 'T' ? taiko(t + o * BEAT, 0.9) : handDrum(t + o * BEAT, 0.9, o % 1 ? -0.25 : 0.25));
    // alaúde nos contratempos
    for (let i = 0; i < 4; i++) pluck(t + (i + 0.5) * BEAT, c.notes[(i + 1) % 3], { gain: 0.5, pan: 0.4, decay: 0.99, bright: 0.3, len: 0.6 });
    // tema da flauta a cada 2 compassos (a partir do 2º compasso cheio)
    if (bar % 2 === 1) for (const [o, m, d] of THEME) flute(t + o * BEAT, m, d * BEAT, 1);
  }
  for (const [t, g] of MUSIC.impacts) impact(t, g);
  // final no logo: acorde grande e um último arpejo de harpa
  impact(END, 1.2);
  strings(END, [50, 57, 62, 65, 69], DURATION - END, 1.6);
  bassNote(END, 38, DURATION - END - 0.4, 1.2);
  [62, 65, 69, 74, 77, 81].forEach((m, i) => pluck(END + 0.08 + i * 0.09, m, { gain: 1, pan: (i - 2.5) * 0.15, bright: 0.7, len: 2.5 }));
  const hits = [...MUSIC.impacts.map((i) => i[0]), END];
  for (const c of CUTS) if (!hits.includes(c)) whoosh(c, 0.45);

  // ---------- reverb (sala grande) ----------
  const combs = [1801, 1949, 2111, 2273].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [421, 149].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.3 * (o - c.lp);
      c.buf[c.i] = x + c.lp * 0.86;
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
