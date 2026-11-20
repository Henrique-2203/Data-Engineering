// Trilha do vídeo "Criei meu próprio Discord": começa insegura (Lá menor, pad escuro e pulso lento),
// a ideia acende (💡), o beat entra com a IA, abre para Dó maior na lista de recursos e termina num
// acorde que ressoa no "Chama a resenha!". Os efeitos estão no mesmo tom. Sem direitos autorais.
import { CUES as C, DURATION } from './creator-timeline.mjs';

const RATE = 44100;
const BPM = 100;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function makeCreatorMusic() {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), echo = new Float32Array(N), verb = new Float32Array(N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const put = (t, len, fn, { pan = 0, gain = 1, ech = 0, rev = 0 } = {}) => {
    const s0 = Math.floor(t * RATE);
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    for (let i = 0; i < len * RATE; i++) {
      const j = s0 + i;
      if (j < 0) continue;
      if (j >= N) break;
      const v = fn(i / RATE);
      L[j] += v * gl;
      R[j] += v * gr;
      if (ech) echo[j] += v * ech;
      if (rev) verb[j] += v * rev;
    }
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

  // ---------- instrumentos ----------
  const pad = (t, len, notes, g = 1, cutoff = 0.05) => {
    for (const [k, m] of notes.entries()) {
      for (const [det, pan] of [[0.997, -0.5], [1.003, 0.5]]) {
        let lp = 0, lp2 = 0;
        const f = hz(m) * det;
        put(t, len + 1.2, (x) => {
          const ph = (f * x) % 1;
          const tri = 4 * Math.abs(ph - 0.5) - 1;
          lp += cutoff * (tri - lp);
          lp2 += cutoff * (lp - lp2);
          return lp2 * Math.min(1, x / 0.8) * (x > len ? Math.exp(-(x - len) / 0.4) : 1) * 0.07;
        }, { pan: pan * (k % 2 ? 1 : 0.7), gain: g, rev: 0.25 });
      }
    }
  };
  const piano = (t, m, g = 1, pan = 0) => {
    const f = hz(m);
    put(t, 2.5, (x) => (Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(4 * Math.PI * f * x) * Math.exp(-x * 4) + 0.12 * Math.sin(6 * Math.PI * f * x) * Math.exp(-x * 7)) * env(x, 0.004, 0.7) * 0.13, { pan, gain: g, rev: 0.35 });
  };
  const pluck = (t, m, g = 1, pan = 0) => {
    const f = hz(m);
    put(t, 0.9, (x) => (Math.sin(2 * Math.PI * f * x) * 0.7 + Math.sin(4 * Math.PI * f * x) * 0.18 * Math.exp(-x * 25)) * env(x, 0.003, 0.18) * 0.2, { pan, gain: g, ech: 0.4, rev: 0.12 });
  };
  const bell = (t, m, g = 1, pan = 0) => {
    const f = hz(m);
    put(t, 2.2, (x) => (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * x) * Math.exp(-x * 3)) * env(x, 0.002, 0.6) * 0.07, { pan, gain: g, ech: 0.3, rev: 0.4 });
  };
  const bass = (t, m, len, g = 1) => {
    const f = hz(m);
    put(t, len, (x) => (Math.sin(2 * Math.PI * f * x) * 0.8 + Math.sin(4 * Math.PI * f * x) * 0.15) * Math.min(1, x / 0.01) * Math.min(1, (len - x) / 0.04) * Math.exp(-x * 1.1) * 0.24, { gain: g });
  };
  const heartbeat = (t, g = 1) => {
    for (const [o, a] of [[0, 1], [0.22, 0.7]]) put(t + o, 0.3, (x) => Math.sin(2 * Math.PI * (48 + 30 * Math.exp(-x * 30)) * x) * env(x, 0.004, 0.07) * 0.5 * a, { gain: g });
  };
  const kick = (t, g = 1) => put(t, 0.3, (x) => Math.sin(2 * Math.PI * (50 * x + (70 / 25) * (1 - Math.exp(-x * 25)))) * env(x, 0.003, 0.08) * 0.35 * g);
  const rim = (t, g = 1) => {
    let lp = 0;
    put(t, 0.12, (x) => {
      const n = rnd();
      lp += 0.5 * (n - lp);
      return (Math.sin(2 * Math.PI * 1700 * x) * 0.4 + (n - lp) * 0.6) * env(x, 0.0008, 0.018) * 0.18 * g;
    }, { pan: -0.15, rev: 0.3 });
  };
  const hat = (t, g = 1) => {
    let hp = 0, prev = 0;
    put(t, 0.08, (x) => {
      const n = rnd();
      hp = 0.5 * (hp + n - prev);
      prev = n;
      return hp * env(x, 0.002, 0.02) * 0.08 * g;
    }, { pan: 0.35 });
  };
  const swell = (a, b, g = 1) => {
    let lp = 0;
    put(a, b - a, (x) => {
      const k = x / (b - a);
      lp += (0.005 + 0.12 * k * k) * (rnd() - lp);
      return lp * Math.pow(k, 2.5) * 0.4 * g;
    }, { rev: 0.5 });
  };
  const whoosh = (at, g = 1) => {
    let lp = 0, lp2 = 0;
    put(at - 0.3, 0.45, (x) => {
      const k = x / 0.45;
      const cut = 0.01 + 0.12 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      lp2 += cut * (lp - lp2);
      return lp2 * Math.pow(Math.sin(Math.PI * k), 2) * 0.6 * g;
    });
  };
  const pop = (t, m, g = 1) => put(t, 0.15, (x) => Math.sin(2 * Math.PI * hz(m) * (1 + 0.6 * Math.exp(-x * 60)) * x) * env(x, 0.002, 0.045) * 0.16 * g);
  const key = (t, g = 1) => {
    let hp = 0, prev = 0;
    put(t, 0.05, (x) => {
      const n = rnd();
      hp = 0.6 * (hp + n - prev);
      prev = n;
      return (hp * 0.7 + Math.sin(2 * Math.PI * 900 * x) * 0.2) * env(x, 0.0005, 0.01) * 0.1 * g;
    }, { pan: rnd() * 0.3 });
  };
  const horn = (t) => {
    const saw = (x) => 2 * (x - Math.floor(x + 0.5));
    put(t, 0.8, (x) => {
      const f = x < 0.3 ? hz(72) : hz(67);
      return (saw(f * x) * 0.5 + saw(f * 1.5 * x) * 0.2) * env(x, 0.02, 0.45) * (x < 0.75 ? 1 : (0.8 - x) / 0.05) * 0.1;
    });
  };
  const sub = (t, g = 1) => put(t, 1.4, (x) => Math.sin(2 * Math.PI * (36 + 40 * Math.exp(-x * 8)) * x) * env(x, 0.003, 0.4) * 0.45 * g);
  const shimmer = (t, notes = [76, 79, 84, 88, 91]) => notes.forEach((m, i) => bell(t + i * 0.07, m, 0.9, (i - 2) * 0.25));

  // ---------- 1) inseguro: Lá menor, pulso lento ----------
  pad(0, C.tudo - 0.2, [45, 52, 57, 60], 0.9, 0.03);
  for (let t = 0.4; t < C.criei - 0.2; t += 1.25) heartbeat(t, 0.8);
  [[0.6, 76], [2.0, 72], [3.3, 71]].forEach(([t, m], i) => piano(t, m, 0.6, i % 2 ? 0.3 : -0.3));
  // "eu criei o meu próprio Discord": acende
  sub(C.criei, 0.6);
  shimmer(C.criei + 0.05, [69, 72, 76, 81]);

  // ---------- 2) o problema: Am – F, plucks discretos; "pagar" pesa ----------
  const sad = [[45, 52, 57, 60], [41, 48, 53, 57]];
  for (let i = 0, t = C.tudo; t < C.pensei - 0.1; i++, t += BEAT * 4) {
    pad(t, BEAT * 4, sad[i % 2], 0.9, 0.04);
    bass(t, sad[i % 2][0] - 12 + 12, BEAT * 3.5, 0.7);
    for (let s = 0; s < 8; s++) if (t + s * BEAT / 2 < C.pagar - 0.2) pluck(t + s * BEAT / 2, sad[i % 2][[3, 2, 1, 2][s % 4]] + 12, 0.35, s % 2 ? 0.3 : -0.3);
  }
  piano(C.pagar - 0.4, 57, 1);
  piano(C.pagar - 0.4, 60, 0.8);
  piano(C.pagar - 0.4, 64, 0.7);
  sub(C.pagar - 0.4, 0.4);

  // ---------- 3) a ideia ----------
  swell(C.pensei + 0.2, C.usei, 0.6);
  shimmer(C.fizesse, [72, 76, 79, 84]);

  // ---------- 4) groove: entra com a IA e abre para Dó maior nos recursos ----------
  const minorProg = [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]]; // Am F C G
  const majorProg = [[48, 55, 60, 64], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]]; // C G Am F
  const arp = [0, 2, 3, 2, 1, 2, 3, 2];
  for (let bi = 0, t = C.usei; t < C.link; bi++, t += BEAT * 4) {
    const major = t >= C.chat - 0.3;
    const chord = (major ? majorProg : minorProg)[bi % 4];
    const ctaDip = t >= C.quer && t < C.link ? 0.6 : 1;
    pad(t, BEAT * 4, chord, 0.75 * ctaDip, major ? 0.06 : 0.045);
    bass(t, chord[0] - 12 + 12, BEAT * 2.5, 0.9 * ctaDip);
    bass(t + BEAT * 2.5, chord[0] - 12 + 12, BEAT * 1.5, 0.7 * ctaDip);
    for (let s = 0; s < 16; s++) {
      const x = t + s * STEP;
      if (x >= C.link) break;
      const build = Math.min(1, (x - C.usei) / (C.chat - C.usei));
      if (s % 2 === 0) pluck(x, chord[arp[(s / 2) % 8]] + 12 + (major && s % 4 === 0 ? 12 : 0), (0.4 + build * 0.4) * ctaDip, (s / 2) % 2 ? 0.35 : -0.35);
      if (s === 0 || s === 10) kick(x, (major ? 1 : 0.6 + build * 0.3) * ctaDip);
      if (s === 4 || s === 12) rim(x, (major ? 1 : 0.6) * ctaDip);
      if (major && s % 2 === 0) hat(x, (s % 4 === 2 ? 1 : 0.6) * ctaDip);
    }
  }

  // ---------- efeitos no tom ----------
  [C.tudo, C.usei, C.chat, C.call, C.tela, C.soundboard, C.emojis, C.testei, C.noAr, C.nome, C.quer, C.link].forEach((t) => whoosh(t, 0.7));
  // digitando de madrugada
  for (let t = C.usei + 0.2; t < C.chat - 0.3; t += 0.09 + ((t * 977) % 1) * 0.12) key(t, 0.8);
  // um "plim" para cada recurso
  [[C.chat, 72], [C.call, 74], [C.tela, 76], [C.soundboard, 79]].forEach(([t, m]) => bell(t, m + 12, 0.8));
  horn(C.soundboard + 0.9);
  [C.emojis + 0.1, C.emojis + 0.3, C.emojis + 0.45, C.figurinhas + 0.05, C.figurinhas + 0.35].forEach((t, i) => pop(t, [72, 76, 79, 84, 88][i]));
  sub(C.graca, 0.35);
  shimmer(C.graca + 0.02, [79, 84, 88]);
  [0, 1, 2, 3].forEach((i) => pop(C.bugs + 0.25 + i * 0.15, [67, 72, 76, 79][i], 0.9));
  bell(C.noAr + 0.6, 84, 1);
  sub(C.nome - 0.1, 0.5);
  shimmer(C.nome, [72, 76, 79, 84, 88]);
  for (let i = 0; i < 4; i++) key(C.como + 0.15 + i * 0.15, 1.4);
  pop(C.como + 1.3, 84, 1.2);

  // ---------- final ----------
  pad(C.link, DURATION - C.link - 0.6, [48, 55, 60, 64, 67], 1, 0.06);
  bass(C.link, 36, 2.4, 1);
  sub(C.link, 0.6);
  shimmer(C.link + 0.05);
  shimmer(C.chama + 0.4, [84, 88, 91]);

  // ---------- eco e reverb ----------
  const dly = Math.floor(BEAT * 0.75 * RATE);
  const eL = new Float32Array(N), eR = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    eL[j] = echo[j] + (j >= dly ? eR[j - dly] * 0.35 : 0);
    eR[j] = j >= dly ? eL[j - dly] * 0.35 : 0;
    L[j] += (eL[j] - echo[j]) * 0.45;
    R[j] += eR[j] * 0.45;
    verb[j] += (eL[j] + eR[j]) * 0.05;
  }
  const combs = [1687, 1601, 2053, 2251].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [347, 113].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.35;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.45 * (o - c.lp);
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
    L[j] += y * 0.7;
    R[j] += y * 0.7;
  }

  // ---------- master ----------
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
  const norm = 0.95 / peak;
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
  const fadeIn = Math.floor(0.4 * RATE), fadeOut = Math.floor((DURATION - 1) * RATE);
  for (let j = 0; j < N; j++) {
    const f = Math.min(1, j / fadeIn) * (j > fadeOut ? 1 - (j - fadeOut) / (N - fadeOut) : 1);
    out.writeInt16LE(Math.round(Math.tanh(L[j] * norm * 1.1) * 0.9 * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.tanh(R[j] * norm * 1.1) * 0.9 * f * 32767), 46 + j * 4);
  }
  return out;
}
