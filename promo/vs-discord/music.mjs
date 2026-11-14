// Trilha original do vídeo Resenha × Discord (sem direitos autorais), DIFERENTE da dos outros vídeos:
// trap em meio-tempo, 140 BPM, Ré menor (Dm–B♭–Gm–A). 808 com deslize, palmas no 3, chimbal com
// viradas em tercina e sinos escuros. Abre só com sinos, a batida entra no Resenha, quebra antes do
// gráfico e volta cheia no "45% menos". Abaixa quando a narração fala.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BEAT, CUTS, DURATION, END, MUSIC, NARRATION } from './timeline.mjs';

const RATE = 44100;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const NARR_WAV = path.resolve('promo/out/vs-discord/audio/narracao.wav');

export function makeReelsAudio({ withMusic = true, withVoice = true } = {}) {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), verb = new Float32Array(N);
  const duck = new Float32Array(N).fill(1); // sidechain pelo 808
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const put = (t, len, fn, { pan = 0, gain = 1, rev = 0, side = false } = {}) => {
    const s0 = Math.floor(t * RATE);
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    const n = Math.floor(len * RATE);
    for (let i = 0; i < n; i++) {
      const j = s0 + i;
      if (j < 0) continue;
      if (j >= N) break;
      let v = fn(i / RATE);
      if (side) v *= duck[j];
      L[j] += v * gl;
      R[j] += v * gr;
      if (rev) verb[j] += v * rev;
    }
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
  const sat = (x, k) => Math.tanh(x * k);
  const BAR = 4 * BEAT;

  // ---------- harmonia: Dm – B♭ – Gm – A (1 acorde por compasso) ----------
  const CHORDS = [
    { root: 38, notes: [62, 65, 69] }, // Dm
    { root: 34, notes: [62, 65, 70] }, // B♭
    { root: 31, notes: [62, 67, 70] }, // Gm
    { root: 33, notes: [61, 64, 69] }, // A
  ];
  const chordAt = (t) => CHORDS[Math.floor(t / BAR + 1e-6) % 4];

  // ---------- instrumentos ----------
  /** 808: seno grave com ataque, deslize opcional e saturação */
  const b808 = (t, m, len, g = 1, glideTo = null) => {
    const s0 = Math.floor(t * RATE);
    for (let i = 0; i < 0.25 * RATE && s0 + i < N; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - 0.5 * Math.exp(-i / RATE / 0.09));
    let ph = 0;
    put(t, len, (x) => {
      const f0 = hz(m), f1 = glideTo == null ? f0 : hz(glideTo);
      const k = glideTo == null ? 0 : Math.min(1, Math.max(0, (x - len * 0.55) / (len * 0.3)));
      const f = (f0 + (f1 - f0) * k) * (1 + 1.6 * Math.exp(-x * 38));
      ph += (2 * Math.PI * f) / RATE;
      const a = Math.min(1, x / 0.003) * (x > len - 0.04 ? (len - x) / 0.04 : 1) * Math.exp(-x * 0.9);
      return sat(Math.sin(ph) * 1.8, 1.4) * a * 0.55 + (x < 0.006 ? rnd() * 0.25 * (1 - x / 0.006) : 0);
    }, { gain: g });
  };
  const clap = (t, g = 1) => {
    let bp = 0, bp2 = 0;
    put(t, 0.4, (x) => {
      const n = rnd();
      bp += 0.4 * (n - bp);
      bp2 += 0.4 * (bp - bp2);
      const hits = [0, 0.009, 0.019, 0.03].reduce((a, d) => a + (x >= d ? Math.exp(-(x - d) / 0.01) : 0), 0) * 0.45 + Math.exp(-x / 0.11);
      return (n - bp2) * hits * 0.26;
    }, { gain: g, rev: 0.35 });
  };
  const rim = (t, g = 1) => put(t, 0.08, (x) => (Math.sin(2 * Math.PI * 1700 * x) * 0.5 + rnd() * 0.3) * env(x, 0.0005, 0.012) * 0.3, { gain: g, pan: -0.3, rev: 0.2 });
  const hat = (t, g = 1, open = false) => {
    let hp = 0;
    put(t, open ? 0.3 : 0.05, (x) => {
      const n = rnd();
      hp += 0.75 * (n - hp);
      return (n - hp) * env(x, 0.0008, open ? 0.1 : 0.012) * 0.24;
    }, { gain: g, pan: 0.3 });
  };
  /** sino FM escuro */
  const bell = (t, m, g = 1, pan = 0) =>
    put(t, 1.6, (x) => {
      const f = hz(m);
      const I = 2.2 * Math.exp(-x * 4);
      return Math.sin(2 * Math.PI * f * x + I * Math.sin(2 * Math.PI * f * 3.5 * x)) * env(x, 0.002, 0.45) * 0.11;
    }, { gain: g, pan, rev: 0.55 });
  /** pad escuro (seno + triângulo, filtrado) */
  const pad = (t, notes, len, g = 1) => {
    for (const m of notes) {
      let lp = 0;
      put(t, len, (x) => {
        const f = hz(m - 12);
        const v = Math.sin(2 * Math.PI * f * x) + 0.5 * Math.asin(Math.sin(2 * Math.PI * f * 1.004 * x));
        lp += 0.03 * (v - lp);
        return lp * Math.min(1, x / 0.5) * Math.min(1, (len - x) / 0.4) * 0.07;
      }, { gain: g, rev: 0.5, side: true });
    }
  };
  const riser = (a, b, g = 1) => {
    let lp = 0;
    put(a, b - a, (x) => {
      const k = x / (b - a);
      lp += (0.02 + 0.35 * k * k) * (rnd() - lp);
      return lp * k * k * 0.5;
    }, { gain: g, rev: 0.3 });
  };
  const impact = (t, g = 1) => {
    put(t, 1.6, (x) => Math.sin(2 * Math.PI * (32 * x + (50 * (1 - Math.exp(-x * 8))) / 8)) * env(x, 0.003, 0.6) * 0.9, { gain: g });
    let lp = 0;
    put(t, 1.2, (x) => {
      lp += 0.06 * (rnd() - lp);
      return lp * env(x, 0.002, 0.3) * 0.8;
    }, { gain: g, rev: 0.6 });
  };
  /** "rebobinada" (som de fita voltando) antes do drop */
  const rewind = (t, len, g = 1) => {
    let ph = 0;
    put(t, len, (x) => {
      const k = x / len;
      ph += (2 * Math.PI * (900 - 700 * k)) / RATE;
      return (Math.sin(ph) * 0.15 + rnd() * 0.08) * k * (1 - k) * 4;
    }, { gain: g, rev: 0.2 });
  };
  const whoosh = (at, g = 1) => {
    let lp = 0, lp2 = 0;
    const len = 0.4;
    put(at - len * 0.7, len, (x) => {
      const k = x / len;
      const cut = 0.01 + 0.16 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      lp2 += cut * (lp - lp2);
      return lp2 * Math.pow(Math.sin(Math.PI * k), 2) * 0.9;
    }, { gain: g, pan: -0.2 });
  };

  // ---------- arranjo ----------
  const [b0, b1] = MUSIC.build; // quebra antes do gráfico
  const [d0, d1] = MUSIC.drop;
  const beatIn = MUSIC.beatIn; // a batida entra aqui
  // sinos o tempo todo (melodia de 2 compassos, pentatônica de Ré menor)
  const MEL = [74, 77, 81, 79, 77, 74, 72, 74, 69, 72, 74, 77, 76, 74, 72, 69];
  const steps = Math.floor(DURATION / (BEAT / 2));
  for (let s = 0; s < steps; s++) {
    const t = s * (BEAT / 2);
    if (t >= END) break;
    if (s % 2 === 0 || (t >= d0 && t < d1)) {
      const k = Math.floor(s / 2) % MEL.length;
      if (k % 4 !== 3) bell(t, MEL[k], t < beatIn ? 1.4 : t >= d0 && t < d1 ? 1 : 0.75, ((k % 3) - 1) * 0.35);
    }
  }
  // pad por compasso
  for (let t = 0; t < END; t += BAR) pad(t, chordAt(t).notes, Math.min(BAR, END - t) + 0.3, t < beatIn ? 1.6 : 0.8);
  // bateria e 808
  const beats = Math.ceil(END / BEAT);
  for (let b = 0; b < beats; b++) {
    const t = b * BEAT;
    if (t < beatIn - 1e-6 || t >= END) continue;
    const inBreak = t >= b0 && t < b1;
    const drop = t >= d0 && t < d1;
    const pos = b % 4; // posição no compasso
    const c = chordAt(t);
    // chimbal: colcheias; no drop, semicolcheias; virada em tercina no fim de cada 2º compasso
    const rollBar = Math.floor(t / BAR) % 2 === 1 && pos === 3;
    if (!inBreak) {
      if (rollBar) for (let i = 0; i < 6; i++) hat(t + (i * BEAT) / 6, 0.5 + i * 0.08);
      else {
        hat(t, 0.8);
        hat(t + BEAT / 2, 0.6);
        if (drop) {
          hat(t + BEAT / 4, 0.4);
          hat(t + (3 * BEAT) / 4, 0.4);
        }
      }
      if (pos === 2) clap(t, drop ? 0.85 : 0.7);
      if (pos === 3 && b % 8 === 7) hat(t + BEAT / 2, 0.6, true);
      if (pos === 1 && drop) rim(t + BEAT / 2, 0.8);
      // 808: tempo 1 e "e" do 3 (meio-tempo), com deslize para o próximo acorde no fim do compasso
      if (pos === 0) b808(t, c.root, BEAT * 2.4, drop ? 1.1 : 1);
      if (pos === 2) {
        const next = chordAt(t + 2 * BEAT);
        b808(t + BEAT / 2, c.root, BEAT * 1.4, drop ? 1.1 : 0.95, next.root !== c.root ? next.root : null);
      }
    } else {
      // na quebra: só palmas acelerando
      for (let i = 0; i < 4; i++) clap(t + (i * BEAT) / 4, 0.25 + 0.6 * ((t - b0) / (b1 - b0)));
    }
  }
  rewind(b1 - 0.45, 0.45, 0.8);
  riser(b0 - BEAT, b1, 0.9);
  for (const [t, g] of MUSIC.impacts) impact(t, g);
  // final no logo
  impact(END, 1.2);
  b808(END, 38, 2.5, 1.2);
  pad(END, [62, 65, 69, 74], DURATION - END, 1.2);
  [74, 77, 81, 86].forEach((m, i) => bell(END + i * 0.09, m, 1, (i - 1.5) * 0.3));
  const hits = [...MUSIC.impacts.map((i) => i[0]), END];
  for (const c of CUTS) if (!hits.includes(c)) whoosh(c, 0.5);

  // ---------- reverb (Schroeder) ----------
  const combs = [1687, 1601, 2053, 2251].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [347, 113].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.4 * (o - c.lp);
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
    L[j] += y * 0.7;
    R[j] += y * 0.7;
  }
  // volume médio da música com a batida (para pôr a narração acima dela)
  let acc = 0, cnt = 0;
  for (let j = Math.floor((MUSIC.beatIn + 0.5) * RATE); j < Math.min(N, b0 * RATE); j++, cnt++) acc += L[j] * L[j];
  const musicRms = Math.sqrt(acc / Math.max(1, cnt));
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
  // normaliza a música e passa pelo "tanh" (cola os picos)
  for (let j = 0; j < N; j++) {
    L[j] = withMusic ? Math.tanh((L[j] / peak) * 1.5) * 0.92 : 0;
    R[j] = withMusic ? Math.tanh((R[j] / peak) * 1.5) * 0.92 : 0;
  }
  const musicLevel = Math.tanh((musicRms / peak) * 1.5) * 0.92;

  // ---------- narração ----------
  if (withVoice && NARRATION.length && existsSync(NARR_WAV)) {
    const narr = readWav(NARR_WAV);
    // música mais baixa enquanto ela fala
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
    // a voz fica ~1 dB acima do volume cheio da música (e ~11 dB acima dela abaixada)
    const kn = withMusic ? (musicLevel * 1.12) / activeRms(narr) : 0.18 / activeRms(narr);
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
  const fadeOut = Math.floor((DURATION - 0.9) * RATE);
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
  return out; // 48 kHz mono
}
/** copia x[a..b] (s, 48 kHz) para o vídeo em `at` (44,1 kHz), com fade de 20 ms nas pontas */
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
/** volume médio só onde tem fala (ignora as pausas) */
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
