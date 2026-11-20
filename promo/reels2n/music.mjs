// Trilha do Reels 2 NARRADO (original, sem direitos autorais): a mesma do Reels 2, em Mi menor
// (Em–C–G–D), mas de fundo: abaixa na narração e quase some na gravação do Henrique (antes e depois
// do filtro do app, com o MESMO volume). DROP nas configurações e impacto final no logo.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BEAT, CLICKS, CUTS, DUCK, DURATION, END, MUSIC, NARRATION, SEGS, TICKS, VOICE } from './timeline.mjs';

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
    { root: 40, notes: [55, 59, 64] }, // Em
    { root: 36, notes: [55, 60, 64] }, // C
    { root: 43, notes: [55, 59, 62] }, // G
    { root: 38, notes: [54, 57, 62] }, // D
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
    const groove = t >= 2 && t < END;
    const build = t >= MUSIC.build[0] && t < MUSIC.build[1];
    const drop = t >= MUSIC.drop[0] && t < MUSIC.drop[1];
    const breath = t >= MUSIC.build[1] - 0.5 && t < MUSIC.build[1];
    if (!groove) continue;
    if (!breath) kick(t, drop ? 1.1 : 1);
    if (b % 2 === 1 && !build) clap(t, drop ? 1.1 : 0.9);
    hat(t + BEAT / 2, drop ? 1 : 0.8, b % 4 === 3);
    if (drop) {
      hat(t + BEAT / 4, 0.5);
      hat(t + (3 * BEAT) / 4, 0.5);
    }
    // baixo em colcheias
    if (!breath) {
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
      const melody = [76, 74, 71, 74, 76, 79, 78, 74];
      if (b % 2 === 0) pluck(t, melody[(b / 2) % 8], 0.9, 0.35, 0);
    }
    // segunda metade mais "cheia"
    if (t >= 10 && t < MUSIC.build[0] && b % 4 === 0) pad(t, c.notes, 4 * BEAT, 0.5);
  }
  // virada para a montagem: caixa acelerando + subida, respiro e DROP
  const [b0, b1] = MUSIC.build;
  for (let i = 0; i < 16; i++) snare(b0 + (i / 16) * (b1 - b0 - 0.05), 0.3 + (i / 16) * 0.7);
  riser(b0 - 0.4, b1, 1);
  for (const [t, g] of MUSIC.impacts) impact(t, g);
  // final no logo (a narração termina por cima)
  riser(END - 0.8, END, 0.8);
  impact(END, 1.2);
  stab(END, CHORDS[0].notes, 1.2, 1.1);
  pad(END, CHORDS[0].notes.map((m) => m + 12), DURATION - END, 1);
  pad(END, CHORDS[0].notes, DURATION - END, 0.6);
  shimmer(END + 0.05);

  // efeitos sincronizados
  const hits = [...MUSIC.impacts.map((i) => i[0]), END];
  for (const c of CUTS) if (!hits.includes(c)) whoosh(c, 0.55);
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

  // volume da narração/gravação pelo volume MÉDIO da música no groove, medido antes de abaixar
  let acc = 0, cnt = 0;
  for (let j = Math.floor(10.5 * RATE); j < 18 * RATE; j++) {
    acc += L[j] * L[j];
    cnt++;
  }
  const grooveRms = Math.sqrt(acc / cnt);

  // ---------- música mais baixa na narração e na gravação ----------
  for (let j = 0; j < N; j++) {
    const t = j / RATE;
    let g = 1;
    for (const d of DUCK) {
      const ramp = 0.12;
      const k = t < d.t0 - ramp || t > d.t1 + ramp ? 0 : t < d.t0 ? (t - (d.t0 - ramp)) / ramp : t > d.t1 ? 1 - (t - d.t1) / ramp : 1;
      g = Math.min(g, 1 - (1 - d.level) * Math.max(0, Math.min(1, k)));
    }
    L[j] *= g;
    R[j] *= g;
  }
  addVoice(L, R, N, grooveRms * 0.85, true);

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

// ---------- a gravação do Henrique + a narração ----------
const AUDIO = path.resolve('promo/out/reels2/audio');
function readWav(file) {
  const b = readFileSync(file);
  const n = (b.length - 44) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(44 + i * 2) / 32768;
  return out; // 48 kHz mono
}
const demo = JSON.parse(readFileSync(path.resolve('promo/out/reels2n/audio/demo.json'), 'utf8'));
/** copia x[a..b] (s, 48 kHz) para o vídeo em `at` (44,1 kHz), com fade de 20 ms nas pontas */
function mixIn(L, R, N, x, a, b, at, gain) {
  const len = b - a;
  for (let i = 0; i < len * RATE; i++) {
    const j = Math.floor(at * RATE) + i;
    if (j >= N) break;
    const pos = (a + i / RATE) * 48000;
    const p0 = Math.floor(pos);
    const val = x[p0] + (x[p0 + 1] - x[p0]) * (pos - p0) || 0;
    const fade = Math.min(1, i / (0.02 * RATE), (len * RATE - i) / (0.02 * RATE));
    const y = val * gain * fade;
    L[j] += y;
    R[j] += y;
  }
}
/** volume médio só onde tem fala (ignora as pausas) */
function activeRms(x, a, b) {
  const W = 960, fr = [];
  for (let i = Math.floor(a * 48000); i + W < b * 48000; i += W) {
    let s = 0;
    for (let j = i; j < i + W; j++) s += x[j] * x[j];
    fr.push(s / W);
  }
  const top = Math.max(...fr);
  const on = fr.filter((v) => v > top / 1000);
  return Math.sqrt(on.reduce((p, q) => p + q, 0) / on.length);
}
/** põe os trechos da gravação e da narração na hora certa; o "depois" no mesmo volume do "antes" */
function addVoice(L, R, N, target, byRms = false) {
  const src = {
    antes: readWav(path.join(AUDIO, 'antes.wav')),
    depois: readWav(path.join(AUDIO, 'depois.wav')),
    tecAntes: readWav(path.join(AUDIO, 'tec-antes.wav')),
    tecDepois: readWav(path.join(AUDIO, 'tec-depois.wav')),
  };
  const lv = demo.rmsAntes / demo.rmsDepois;
  const level = { antes: 1, depois: lv, tecAntes: 1, tecDepois: lv };
  const [s0, s1] = SEGS.fala;
  let vp = 0, va = 0, vn = 0;
  for (let i = Math.floor(s0 * 48000); i < s1 * 48000; i++) {
    vp = Math.max(vp, Math.abs(src.antes[i]));
    va += src.antes[i] * src.antes[i];
    vn++;
  }
  const k = byRms ? target / Math.sqrt(va / vn) : target / vp;
  for (const v of VOICE) mixIn(L, R, N, src[v.from], ...SEGS[v.seg], v.at, k * level[v.from] * v.gain);
  // narração (voz do ElevenLabs, sem efeito): um pouco acima da fala da gravação
  const narr = readWav(path.resolve('promo/out/reels2n/audio/narracao.wav'));
  const kn = (k * activeRms(src.antes, s0, s1) * 1.12) / activeRms(narr, 0, narr.length / 48000);
  for (const n of NARRATION) mixIn(L, R, N, narr, n.from, n.to, n.at, kn);
}

/** narração + gravação, sem música: para quem quiser colocar um áudio do Instagram por baixo */
export function makeVoiceOnly() {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N);
  addVoice(L, R, N, 0.45);
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
  for (let j = 0; j < N; j++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[j])) * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[j])) * 32767), 46 + j * 4);
  }
  return out;
}
