// Trilha de ação original (trailer do app), sintetizada aqui e sincronizada com promo/trailer.html.
// 120 BPM, Ré menor: braams de cinema, tambores, ostinato, subida com caixa acelerando, DROP no
// "FULL HD" com impactos a cada corte e impacto final no logo. Sem direitos autorais.
const RATE = 44100;
const BPM = 120;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function makeActionMusic(DURATION = 24) {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N), R = new Float32Array(N), verb = new Float32Array(N);
  let seed = 99;
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
  const saw = (x) => 2 * (x - Math.floor(x + 0.5));
  const sat = (x, k) => Math.tanh(x * k);

  // ---------- instrumentos ----------
  /** braam: serras graves desafinadas com o filtro abrindo (som de trailer) */
  const braam = (t, len, root = 38, g = 1) => {
    const notes = [root - 12, root, root + 7, root + 12];
    for (const [i, m] of notes.entries()) {
      for (const det of [0.996, 1.004]) {
        let lp = 0, lp2 = 0;
        const f = hz(m) * det;
        put(t, len + 0.8, (x) => {
          const k = Math.min(1, x / len);
          const cut = 0.004 + 0.09 * Math.sin(Math.PI * Math.min(1, k * 1.3)) ** 2;
          const v = saw(f * x) + 0.5 * saw(f * 0.5 * x);
          lp += cut * (v - lp);
          lp2 += cut * (lp - lp2);
          const a = Math.min(1, x / 0.08) * (x > len ? Math.exp(-(x - len) / 0.25) : 1);
          return sat(lp2 * 2.2, 1.6) * a * 0.12 * (i === 0 ? 1.4 : 1);
        }, { pan: det < 1 ? -0.4 : 0.4, gain: g, rev: 0.25 });
      }
    }
  };
  const kick = (t, g = 1) =>
    put(t, 0.5, (x) => sat(Math.sin(2 * Math.PI * (45 * x + (150 / 28) * (1 - Math.exp(-x * 28)))) * env(x, 0.002, 0.17) * 1.5, 2) * 0.8 + (x < 0.003 ? rnd() * 0.4 : 0), { gain: g });
  const tom = (t, f = 90, g = 1, pan = 0) =>
    put(t, 0.7, (x) => (Math.sin(2 * Math.PI * (f * x + ((f * 0.8) / 14) * (1 - Math.exp(-x * 14)))) * env(x, 0.002, 0.22) * 0.8 + rnd() * env(x, 0.001, 0.03) * 0.3) * 0.75, { gain: g, pan, rev: 0.3 });
  const snare = (t, g = 1) => {
    let lp = 0;
    put(t, 0.4, (x) => {
      const n = rnd();
      lp += 0.45 * (n - lp);
      return (Math.sin(2 * Math.PI * 185 * x) * env(x, 0.001, 0.06) * 0.6 + (n - lp * 0.3) * env(x, 0.001, 0.11) * 0.55) * g;
    }, { rev: 0.4 });
  };
  const hat = (t, g = 1) => {
    let hp = 0, prev = 0;
    put(t, 0.06, (x) => {
      const n = rnd();
      hp = 0.6 * (hp + n - prev);
      prev = n;
      return hp * env(x, 0.0005, 0.014) * 0.25 * g;
    }, { pan: 0.3 });
  };
  /** ostinato staccato (serra filtrada) */
  const stab = (t, midi, g = 1, bright = 0.2, pan = 0) => {
    const f = hz(midi);
    let lp = 0;
    put(t, 0.16, (x) => {
      lp += bright * (saw(f * x) + 0.6 * saw(f * 1.005 * x) - lp);
      return lp * env(x, 0.002, 0.045) * 0.22;
    }, { gain: g, pan, rev: 0.15 });
  };
  const impact = (t, g = 1) => {
    put(t, 2.5, (x) => Math.sin(2 * Math.PI * (32 + 70 * Math.exp(-x * 7)) * x) * env(x, 0.003, 0.7) * 0.9 * g);
    let hp = 0, prev = 0;
    put(t, 2.5, (x) => {
      const n = rnd();
      hp = 0.75 * (hp + n - prev);
      prev = n;
      return hp * env(x, 0.002, 0.5) * 0.35 * g;
    }, { rev: 0.5, pan: 0.1 });
    put(t, 1.5, (x) => (Math.sin(2 * Math.PI * 1243 * x) + Math.sin(2 * Math.PI * 1873 * x)) * env(x, 0.001, 0.25) * 0.06 * g, { rev: 0.6 });
  };
  const riser = (a, b, g = 1) => {
    let lp = 0;
    put(a, b - a, (x) => {
      const k = x / (b - a);
      const n = rnd();
      lp += (0.01 + 0.6 * k * k) * (n - lp);
      return (lp * 0.7 + saw((150 + 1400 * k * k) * x) * 0.1) * Math.pow(k, 2) * 0.55 * g;
    }, { rev: 0.4 });
  };
  const whoosh = (at, g = 1) => {
    let lp = 0;
    put(at - 0.25, 0.4, (x) => {
      const k = x / 0.4;
      lp += (0.02 + 0.3 * Math.sin(Math.PI * k)) * (rnd() - lp);
      return lp * Math.sin(Math.PI * k) * 0.6 * g;
    }, { rev: 0.2 });
  };
  const horn = (t) =>
    put(t, 0.9, (x) => {
      const f = x < 0.32 ? 466 : 349;
      return (saw(f * x) * 0.5 + saw(f * 1.5 * x) * 0.25) * env(x, 0.02, 0.5) * (x < 0.85 ? 1 : 0) * 0.3;
    }, { rev: 0.2 });
  const pop = (t, f = 700, g = 1) => put(t, 0.15, (x) => Math.sin(2 * Math.PI * f * (1 + 0.7 * Math.exp(-x * 60)) * x) * env(x, 0.002, 0.04) * 0.3 * g);
  const shimmer = (t) => [74, 79, 81, 86, 91].forEach((m, i) => put(t + i * 0.07, 2.2, (x) => Math.sin(2 * Math.PI * hz(m) * x) * env(x, 0.004, 0.6) * 0.07, { rev: 0.7, pan: (i - 2) * 0.25 }));

  // progressão: Dm – Bb – Gm – A (1 compasso cada)
  const ROOTS = [50, 46, 43, 45];
  const PATTERN = [0, 0, 12, 0, 7, 0, 10, 7, 0, 0, 12, 0, 15, 12, 10, 7];

  // ---------- arranjo ----------
  // 0–3.8: abertura com braams e chimbal tic-tac
  braam(0, 1.7, 38, 1);
  braam(2.0, 1.5, 34, 0.9);
  for (let t = 0; t < 3.8; t += BEAT / 2) hat(t, 0.5);
  riser(2.6, 3.8, 0.8);

  // 4–16: tambores + ostinato, crescendo
  impact(4.0, 0.7);
  braam(4.0, 1.6, 38, 0.6);
  braam(8.0, 1.6, 34, 0.7);
  braam(12.0, 1.6, 31, 0.8);
  for (let i = 0; i < 48 * 4; i++) {
    const t = 4 + i * STEP;
    if (t >= 16) break;
    const s = i % 16;
    const bar = Math.floor(i / 16);
    const root = ROOTS[bar % 4];
    const build = (t - 4) / 12; // 0 → 1
    // tambores
    if ([0, 6, 10].includes(s)) tom(t, s === 0 ? 70 : 95, 0.8 + build * 0.3, s === 6 ? -0.3 : 0.3);
    if (t >= 8 && (s === 0 || s === 8)) kick(t, 0.9);
    if (t >= 8 && s === 8) snare(t, 0.6 + build * 0.3);
    if (s % 2 === 0) hat(t, 0.5 + build * 0.5);
    // ostinato: cada vez mais aberto
    stab(t, root + PATTERN[s] - 12, 0.6 + build * 0.6, 0.06 + build * 0.3, s % 2 ? 0.3 : -0.3);
  }
  // caixa acelerando + subida antes do drop
  for (let t = 14, step = BEAT; t < 15.98; ) {
    snare(t, 0.35 + ((t - 14) / 2) * 0.7);
    t += step;
    if (t > 14.95) step = STEP;
    if (t > 15.5) step = STEP / 2;
  }
  riser(13.5, 16, 1);
  // efeitos sincronizados com a imagem
  [8.75, 9.0, 10.5, 11.0].forEach((t) => whoosh(t, 0.6));
  [8.9, 9.6, 10.4, 11.1].forEach((t, i) => pop(t, 650 + i * 90, 0.8));
  [12.0, 12.25, 12.5, 12.75, 13.0, 13.25, 13.5].forEach((t, i) => pop(t, 520 + i * 70, 0.5));
  horn(14.25);

  // 16–20: DROP
  for (const h of [16, 17, 18, 19]) impact(h, h === 16 ? 1.2 : 0.8);
  braam(16, 0.9, 38, 1.1);
  braam(18, 0.9, 34, 1.0);
  for (let i = 0; i < 32; i++) {
    const t = 16 + i * STEP * 2; // colcheias
    if (t >= 20) break;
    const s8 = i % 8;
    const root = ROOTS[Math.floor((t - 16) / 1) % 4];
    if (s8 % 2 === 0) kick(t, 1);
    if (s8 === 2 || s8 === 6) snare(t, 0.9);
    hat(t, 0.9);
    hat(t + STEP, 0.6);
    if (s8 === 1 || s8 === 5) tom(t, 110, 0.7, 0.4);
    stab(t, root + PATTERN[(i * 2) % 16], 1.1, 0.35, i % 2 ? 0.35 : -0.35);
    stab(t + STEP, root + PATTERN[(i * 2 + 1) % 16] + 12, 0.7, 0.35, i % 2 ? -0.35 : 0.35);
  }
  whoosh(17, 0.8);
  whoosh(18, 0.8);
  horn(17.15);
  [18.1, 18.22, 18.34, 18.46].forEach((t, i) => pop(t, 600 + i * 120, 0.9));

  // 20: impacto final no logo e cauda
  impact(20, 1.4);
  braam(20, 2.6, 38, 1.1);
  shimmer(20.3);
  tom(20, 60, 1);
  kick(20, 1.2);

  // ---------- reverb (Schroeder) ----------
  const combs = [1687, 1601, 2053, 2251].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [347, 113].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.5 * (o - c.lp);
      c.buf[c.i] = x + c.lp * 0.85;
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
  const fadeOut = Math.floor((DURATION - 1.2) * RATE);
  for (let j = 0; j < N; j++) {
    const f = j > fadeOut ? 1 - (j - fadeOut) / (N - fadeOut) : 1;
    out.writeInt16LE(Math.round(Math.tanh(L[j] * norm * 1.6) * 0.9 * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.tanh(R[j] * norm * 1.6) * 0.9 * f * 32767), 46 + j * 4);
  }
  return out;
}
