// Trilha da conversa (lo-fi de bate-papo, Fá maior, 90 BPM), sincronizada com promo/out/conversa/conversa.json:
// leve nas perguntas, tensa nos perrengues (com "erro" e "plim" de solução), séria na segurança e
// crescendo no final até o "Chama a resenha!". Sem direitos autorais.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const BPM = 90;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function makeConversationMusic() {
  const conv = JSON.parse(readFileSync(path.resolve('promo/out/conversa/conversa.json'), 'utf8'));
  const L = conv.lines;
  const DURATION = conv.duration;
  const word = (li, frag) => conv.words.find((w) => w.start >= L[li].start - 0.05 && w.end <= L[li].end + 0.05 && w.word.toLowerCase().includes(frag))?.start ?? L[li].start;
  const N = Math.ceil(DURATION * RATE);
  const Lc = new Float32Array(N), Rc = new Float32Array(N), echo = new Float32Array(N), verb = new Float32Array(N);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const put = (t, len, fn, { pan = 0, gain = 1, ech = 0, rev = 0 } = {}) => {
    const s0 = Math.floor(t * RATE);
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    for (let i = 0; i < len * RATE; i++) {
      const j = s0 + i;
      if (j < 0) continue;
      if (j >= N) break;
      const v = fn(i / RATE);
      Lc[j] += v * gl;
      Rc[j] += v * gr;
      if (ech) echo[j] += v * ech;
      if (rev) verb[j] += v * rev;
    }
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
  // teclado elétrico (rhodes simples)
  const keys = (t, notes, len, g = 1) => notes.forEach((m, k) => put(t + k * 0.012, len + 0.6, (x) => (Math.sin(2 * Math.PI * hz(m) * x) + 0.25 * Math.sin(2 * Math.PI * hz(m) * 2 * x) * Math.exp(-x * 5)) * env(x, 0.006, 0.9) * (x > len ? Math.exp(-(x - len) / 0.2) : 1) * 0.055, { pan: (k % 2 ? 0.3 : -0.3), gain: g, rev: 0.3 }));
  const pluck = (t, m, g = 1, pan = 0) => put(t, 0.8, (x) => (Math.sin(2 * Math.PI * hz(m) * x) * 0.7 + Math.sin(4 * Math.PI * hz(m) * x) * 0.15 * Math.exp(-x * 25)) * env(x, 0.003, 0.16) * 0.16, { pan, gain: g, ech: 0.35, rev: 0.1 });
  const bass = (t, m, len, g = 1) => put(t, len, (x) => (Math.sin(2 * Math.PI * hz(m) * x) * 0.8 + Math.sin(4 * Math.PI * hz(m) * x) * 0.12) * Math.min(1, x / 0.01) * Math.min(1, (len - x) / 0.04) * Math.exp(-x * 1.2) * 0.22, { gain: g });
  const kick = (t, g = 1) => put(t, 0.3, (x) => Math.sin(2 * Math.PI * (50 * x + (70 / 25) * (1 - Math.exp(-x * 25)))) * env(x, 0.003, 0.08) * 0.32 * g);
  const snap = (t, g = 1) => {
    let lp = 0;
    put(t, 0.15, (x) => {
      const n = rnd();
      lp += 0.5 * (n - lp);
      return (n - lp) * env(x, 0.001, 0.03) * 0.22 * g;
    }, { pan: -0.1, rev: 0.35 });
  };
  const hat = (t, g = 1) => {
    let hp = 0, prev = 0;
    put(t, 0.06, (x) => {
      const n = rnd();
      hp = 0.5 * (hp + n - prev);
      prev = n;
      return hp * env(x, 0.002, 0.018) * 0.07 * g;
    }, { pan: 0.35 });
  };
  const vinyl = (a, b) => put(a, b - a, () => (rnd() > 0.9993 ? rnd() * 0.12 : rnd() * 0.004));
  const bell = (t, m, g = 1) => put(t, 1.8, (x) => (Math.sin(2 * Math.PI * hz(m) * x) + 0.3 * Math.sin(2 * Math.PI * hz(m) * 2.76 * x) * Math.exp(-x * 3)) * env(x, 0.002, 0.5) * 0.08, { gain: g, ech: 0.3, rev: 0.4 });
  const fix = (t) => [76, 79, 84].forEach((m, i) => bell(t + i * 0.08, m, 0.9));
  const err = (t) => put(t, 0.4, (x) => (Math.sign(Math.sin(2 * Math.PI * 110 * x)) * 0.5 + Math.sin(2 * Math.PI * 104 * x) * 0.5) * env(x, 0.005, 0.12) * 0.06);
  const whoosh = (at, g = 1) => {
    let lp = 0;
    put(at - 0.3, 0.45, (x) => {
      const k = x / 0.45;
      lp += (0.01 + 0.12 * Math.sin(Math.PI * k)) * (rnd() - lp);
      return lp * Math.pow(Math.sin(Math.PI * k), 2) * 0.5 * g;
    });
  };
  const pop = (t, m, g = 1) => put(t, 0.15, (x) => Math.sin(2 * Math.PI * hz(m) * (1 + 0.6 * Math.exp(-x * 60)) * x) * env(x, 0.002, 0.04) * 0.14 * g);
  const scramble = (a, b) => { for (let t = a; t < b; t += 0.045) pop(t, 84 + Math.floor(((t * 977) % 1) * 12), 0.5); };
  const sub = (t, g = 1) => put(t, 1.2, (x) => Math.sin(2 * Math.PI * (36 + 40 * Math.exp(-x * 8)) * x) * env(x, 0.003, 0.35) * 0.4 * g);

  // acordes: maior (leve) e menor (tensão / sério)
  const MAJOR = [[53, 57, 60, 64], [50, 53, 57, 60], [46, 50, 53, 57], [48, 52, 55, 58]]; // Fmaj7 Dm7 Bbmaj7 C7
  const MINOR = [[50, 53, 57, 60], [46, 50, 53, 57], [45, 48, 52, 55], [43, 46, 50, 53]]; // Dm Bb Am Gm
  const tense = (t) => (t >= L[5].start && t < L[7].end) || (t >= L[10].start && t < L[14].start);
  const serious = (t) => t >= L[10].start && t < L[14].start;
  const end = L[16].start;
  vinyl(0, DURATION);
  for (let bi = 0, t = 0.2; t < end; bi++, t += BEAT * 4) {
    const chord = (tense(t) ? MINOR : MAJOR)[bi % 4];
    const g = serious(t) ? 0.7 : 1;
    keys(t, chord, BEAT * 3.6, g);
    bass(t, chord[0] - 12, BEAT * 2.5, g);
    bass(t + BEAT * 2.5, chord[0] - 12 + 7, BEAT * 1.5, 0.7 * g);
    for (let s = 0; s < 16; s++) {
      const x = t + s * STEP + (s % 2 ? STEP * 0.12 : 0); // um pouco de swing
      if (x >= end) break;
      if (s === 0 || s === 10) kick(x, serious(x) ? 0.6 : 1);
      if ((s === 4 || s === 12) && !serious(x)) snap(x);
      if (s % 2 === 0 && !serious(x)) hat(x, s % 4 === 2 ? 1 : 0.6);
      if (t > L[13].end && s % 2 === 0) pluck(x, chord[[0, 1, 2, 3, 2, 1, 2, 3][(s / 2) % 8]] + 12, 0.6, (s / 2) % 2 ? 0.3 : -0.3);
    }
  }
  // efeitos sincronizados com a fala
  [L[3].start, L[5].start, L[7].start, L[9].start, L[11].start, L[12].start, L[13].start, L[15].start].forEach((t) => whoosh(t, 0.6));
  err(word(5, 'passava'));
  fix(word(5, 'graça'));
  err(word(7, 'travava'));
  fix(word(7, 'liso'));
  for (let i = 0; i < 16; i++) pop(word(9, 'testes') + (i / 16) * (L[9].end - word(9, 'testes')), 72 + (i % 5) * 3, 0.7);
  sub(L[11].start, 0.5);
  scramble(word(11, 'embaralhada') - 0.3, word(11, 'embaralhada') + 0.9);
  bell(word(13, 'lgpd'), 84, 0.9);
  // final
  keys(end, [53, 57, 60, 64, 69], 2.6, 1.2);
  bass(end, 41, 2.2);
  sub(end, 0.6);
  [72, 76, 79, 84, 88].forEach((m, i) => bell(end + 0.05 + i * 0.07, m, 1));

  // eco + reverb
  const dly = Math.floor(BEAT * 0.75 * RATE);
  const eL = new Float32Array(N), eR = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    eL[j] = echo[j] + (j >= dly ? eR[j - dly] * 0.35 : 0);
    eR[j] = j >= dly ? eL[j - dly] * 0.35 : 0;
    Lc[j] += (eL[j] - echo[j]) * 0.45;
    Rc[j] += eR[j] * 0.45;
  }
  const combs = [1687, 1601, 2053, 2251].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.45 * (o - c.lp);
      c.buf[c.i] = x + c.lp * 0.85;
      c.i = (c.i + 1) % c.d;
      y += o;
    }
    Lc[j] += y * 0.18;
    Rc[j] += y * 0.18;
  }
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(Lc[j]), Math.abs(Rc[j]));
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
  const fadeOut = Math.floor((DURATION - 0.8) * RATE);
  for (let j = 0; j < N; j++) {
    const f = Math.min(1, j / (0.4 * RATE)) * (j > fadeOut ? 1 - (j - fadeOut) / (N - fadeOut) : 1);
    out.writeInt16LE(Math.round(Math.tanh(Lc[j] * norm * 1.1) * 0.9 * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.tanh(Rc[j] * norm * 1.1) * 0.9 * f * 32767), 46 + j * 4);
  }
  return out;
}
