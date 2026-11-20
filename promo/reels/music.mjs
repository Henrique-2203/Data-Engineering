// Trilha original do Reels das novidades (sem direitos autorais): eletrônica animada, 120 BPM,
// Lá menor (Am–F–C–G). Intro com arpejo e subida, groove a partir do gancho, virada antes da
// montagem de visuais, DROP nela e impacto final no logo. Os efeitos (whoosh nos cortes, "tic" na
// montagem e clique do mouse) vêm na mesma mixagem, na hora certa (promo/reels/timeline.mjs).
import { BEAT, CLICKS, CUTS, DURATION, TICKS } from './timeline.mjs';

const RATE = 44100;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function makeReelsAudio() {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), verb = new Float32Array(N);
  // ducking (sidechain) a partir do bumbo: multiplica baixo e acordes
  const duck = new Float32Array(N).fill(1);
  let seed = 42;
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
  const saw = (x) => 2 * (x - Math.floor(x + 0.5));
  const sat = (x, k) => Math.tanh(x * k);

  // ---------- acordes (1 compasso = 4 batidas = 2 s) ----------
  const CHORDS = [
    { root: 45, notes: [57, 60, 64] }, // Am
    { root: 41, notes: [57, 60, 65] }, // F
    { root: 48, notes: [55, 60, 64] }, // C
    { root: 43, notes: [55, 59, 62] }, // G
  ];
  const chordAt = (t) => CHORDS[Math.floor(t / (4 * BEAT)) % 4];

  // ---------- instrumentos ----------
  const kick = (t, g = 1) => {
    const s0 = Math.floor(t * RATE);
    for (let i = 0; i < 0.3 * RATE && s0 + i < N; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - 0.65 * Math.exp(-i / RATE / 0.11));
    put(t, 0.45, (x) => sat(Math.sin(2 * Math.PI * (48 * x + (140 / 30) * (1 - Math.exp(-x * 30)))) * env(x, 0.002, 0.16) * 1.6, 2) * 0.75 + (x < 0.004 ? rnd() * 0.35 : 0), { gain: g });
  };
  const clap = (t, g = 1) => {
    let bp = 0, bp2 = 0;
    put(t, 0.35, (x) => {
      const n = rnd();
      bp += 0.35 * (n - bp);
      bp2 += 0.35 * (bp - bp2);
      const hits = [0, 0.011, 0.022].reduce((a, d) => a + (x >= d ? Math.exp(-(x - d) / 0.012) : 0), 0) * 0.5 + Math.exp(-x / 0.13);
      return (n - bp2) * hits * 0.32;
    }, { gain: g, rev: 0.25 });
  };
  const hat = (t, g = 1, open = false) => {
    let hp = 0;
    put(t, open ? 0.25 : 0.06, (x) => {
      const n = rnd();
      hp += 0.6 * (n - hp);
      return (n - hp) * env(x, 0.001, open ? 0.08 : 0.018) * 0.22;
    }, { gain: g, pan: 0.25 });
  };
  const bass = (t, m, len, g = 1) => {
    let lp = 0;
    put(t, len, (x) => {
      const f = hz(m);
      const v = saw(f * x) * 0.6 + Math.sin(2 * Math.PI * f * 0.5 * x) * 0.8;
      lp += 0.06 * (v - lp);
      return sat(lp * 1.6, 1.5) * Math.min(1, x / 0.005) * (x > len - 0.02 ? (len - x) / 0.02 : 1) * 0.42;
    }, { gain: g, side: true });
  };
  const pluck = (t, m, g = 1, bright = 0.25, pan = 0) => {
    let lp = 0;
    put(t, 0.5, (x) => {
      const f = hz(m);
      const v = saw(f * x) * 0.6 + saw(f * 1.005 * x) * 0.4;
      lp += (0.02 + bright * Math.exp(-x * 14)) * (v - lp);
      return lp * env(x, 0.002, 0.16) * 0.28;
    }, { gain: g, pan, rev: 0.3 });
  };
  /** acorde "supersaw" (o som do drop) */
  const stab = (t, notes, len, g = 1) => {
    for (const m of notes)
      for (const det of [0.992, 1, 1.008]) {
        let lp = 0;
        put(t, len + 0.15, (x) => {
          const v = saw(hz(m + 12) * det * x);
          lp += 0.18 * (v - lp);
          return lp * Math.min(1, x / 0.004) * (x > len ? Math.exp(-(x - len) / 0.05) : 1) * 0.055;
        }, { gain: g, pan: (det - 1) * 50, rev: 0.25, side: true });
      }
  };
  const pad = (t, notes, len, g = 1) => {
    for (const m of notes) {
      let lp = 0;
      put(t, len, (x) => {
        const v = saw(hz(m) * x) + saw(hz(m) * 1.003 * x);
        lp += 0.012 * (v - lp);
        return lp * Math.min(1, x / 0.4) * Math.min(1, (len - x) / 0.4) * 0.06;
      }, { gain: g, rev: 0.4 });
    }
  };
  const riser = (a, b, g = 1) => {
    let lp = 0;
    put(a, b - a, (x) => {
      const k = x / (b - a);
      lp += (0.02 + 0.3 * k * k) * (rnd() - lp);
      return (lp * 0.9 + Math.sin(2 * Math.PI * (200 * x + 900 * x * k)) * 0.05) * k * k * 0.45;
    }, { gain: g, rev: 0.3 });
  };
  const impact = (t, g = 1) => {
    put(t, 1.4, (x) => Math.sin(2 * Math.PI * (36 * x + 60 * (1 - Math.exp(-x * 9)) / 9)) * env(x, 0.003, 0.5) * 0.9, { gain: g });
    let lp = 0;
    put(t, 1.2, (x) => {
      lp += 0.08 * (rnd() - lp);
      return lp * env(x, 0.002, 0.25) * 0.9;
    }, { gain: g, rev: 0.6 });
  };
  const snare = (t, g = 1) => {
    let bp = 0;
    put(t, 0.2, (x) => {
      const n = rnd();
      bp += 0.5 * (n - bp);
      return ((n - bp) * env(x, 0.001, 0.05) * 0.5 + Math.sin(2 * Math.PI * 190 * x) * env(x, 0.001, 0.03) * 0.4) * 0.6;
    }, { gain: g, rev: 0.2 });
  };
  const shimmer = (t) => [69, 72, 76, 81, 84].forEach((m, i) => put(t + i * 0.06, 2, (x) => Math.sin(2 * Math.PI * hz(m) * x) * env(x, 0.004, 0.55) * 0.08, { rev: 0.7, pan: (i - 2) * 0.25 }));
  // efeitos
  const whoosh = (at, g = 1) => {
    let lp = 0, lp2 = 0;
    const len = 0.42;
    put(at - len * 0.7, len, (x) => {
      const k = x / len;
      const cut = 0.01 + 0.16 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      lp2 += cut * (lp - lp2);
      return lp2 * Math.pow(Math.sin(Math.PI * k), 2) * 0.9;
    }, { gain: g, pan: 0.2 });
  };
  const tick = (at) => put(at, 0.06, (x) => Math.sin(2 * Math.PI * 2400 * x) * env(x, 0.001, 0.012) * 0.18);
  const click = (at) => {
    put(at, 0.05, (x) => rnd() * env(x, 0.0005, 0.006) * 0.5 + Math.sin(2 * Math.PI * 1800 * x) * env(x, 0.0005, 0.01) * 0.25);
    put(at + 0.07, 0.04, (x) => rnd() * env(x, 0.0005, 0.005) * 0.3);
  };

  // ---------- arranjo ----------
  const beats = Math.round(DURATION / BEAT);
  // intro (0–2 s): arpejo abrindo o filtro + subida
  for (let i = 0; i < 16; i++) {
    const t = i * BEAT / 2;
    const c = chordAt(0);
    pluck(t, c.notes[i % 3] + (i % 6 >= 3 ? 12 : 0), 0.7, 0.05 + 0.25 * (i / 16), (i % 2 ? 0.3 : -0.3));
  }
  pad(0, CHORDS[0].notes, 2, 0.8);
  riser(0.9, 2.0, 0.7);

  for (let b = 0; b < beats; b++) {
    const t = b * BEAT;
    const c = chordAt(t);
    const groove = t >= 2 && t < 24;
    const build = t >= 13 && t < 14;
    const drop = t >= 14 && t < 21;
    if (!groove) continue;
    if (!(t >= 13.5 && t < 14)) kick(t, drop ? 1.1 : 1);
    if (b % 2 === 1 && !build) clap(t, drop ? 1.1 : 0.9);
    hat(t + BEAT / 2, drop ? 1 : 0.8, b % 4 === 3);
    if (drop) {
      hat(t + BEAT / 4, 0.5);
      hat(t + (3 * BEAT) / 4, 0.5);
    }
    // baixo em colcheias
    if (!build || t < 13.5) {
      bass(t, c.root, BEAT / 2 - 0.01, drop ? 1.1 : 0.9);
      bass(t + BEAT / 2, c.root + (b % 4 === 3 ? 7 : 0), BEAT / 2 - 0.01, drop ? 1.1 : 0.9);
    }
    // arpejo em semicolcheias (fora do drop) / melodia por cima no drop
    for (let s = 0; s < 4; s++) {
      const ts = t + (s * BEAT) / 4;
      const m = c.notes[(b * 4 + s) % 3] + 12;
      if (!drop) pluck(ts, m, 0.55, 0.22, s % 2 ? 0.35 : -0.35);
    }
    if (drop) {
      stab(t + BEAT / 2, c.notes, BEAT / 2 - 0.04, 1);
      const melody = [76, 74, 72, 74, 76, 79, 76, 72];
      if (b % 2 === 0) pluck(t, melody[(b / 2) % 8], 0.9, 0.35, 0);
    }
    // segunda metade mais "cheia"
    if (t >= 8 && t < 13 && b % 4 === 0) pad(t, c.notes, 4 * BEAT, 0.5);
  }
  // virada para a montagem: caixa acelerando + subida, respiro e DROP
  for (let i = 0; i < 16; i++) snare(13 + (i / 16) * 0.95, 0.3 + (i / 16) * 0.7);
  riser(12.6, 14, 1);
  impact(14, 1.1);
  impact(2, 0.7);
  impact(22, 0.6);
  // final no logo
  riser(23.2, 24, 0.8);
  impact(24, 1.2);
  stab(24, CHORDS[0].notes, 1.2, 1.1);
  pad(24, CHORDS[0].notes.map((m) => m + 12), 2, 1);
  shimmer(24.05);

  // efeitos sincronizados
  for (const c of CUTS) if (![2, 14, 24].includes(c)) whoosh(c, 0.55);
  for (const t of TICKS) tick(t);
  for (const t of CLICKS) click(t);

  // ---------- reverb (Schroeder) ----------
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [225, 556].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.45 * (o - c.lp);
      c.buf[c.i] = x + c.lp * 0.82;
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

  // ---------- master ----------
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
  const norm = 1 / peak;
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
    out.writeInt16LE(Math.round(Math.tanh(L[j] * norm * 1.5) * 0.92 * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.tanh(R[j] * norm * 1.5) * 0.92 * f * 32767), 46 + j * 4);
  }
  return out;
}
