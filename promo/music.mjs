// Trilha original, suave e envolvente (chill/lo-fi eletrônico), sintetizada aqui e sincronizada
// com a narração. Tom de Fá maior (F – C – Dm – Bb), 100 BPM:
//  - "O Discord quer te cobrar...": só um pad em Ré menor (o "problema")
//  - "Então... eu criei o meu": o som cresce devagar
//  - "Esse é o Resenha": entra o groove (arpejo dedilhado com eco, baixo e bateria leve)
//  - "Soundboard?": fica só o pad, e volta em "De graça"
//  - "Feito no Brasil": arpejo vira levada de bossa nova
//  - "Link na bio": volta completo e termina num acorde que ressoa em "Chama a resenha!"
// Sem direitos autorais: pode usar em qualquer conta, inclusive em anúncio.
import { DURATION, LINES } from './timeline.mjs';

const RATE = 44100;
const BPM = 100;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;

/** notas (Hz) a partir do nome: 'F3', 'Bb4'... */
const NOTE = (n) => {
  const m = /^([A-G])(b|#)?(\d)$/.exec(n);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  return 440 * Math.pow(2, (base + (Number(m[3]) + 1) * 12 - 69) / 12);
};
/** acordes do arpejo/pad e nota do baixo */
const CHORDS = {
  F: { pad: ['F3', 'A3', 'C4', 'E4'], arp: ['F4', 'A4', 'C5', 'E5', 'C5', 'A4'], bass: 'F2' },
  C: { pad: ['E3', 'G3', 'C4', 'D4'], arp: ['C4', 'E4', 'G4', 'D5', 'G4', 'E4'], bass: 'C2' },
  Dm: { pad: ['D3', 'F3', 'A3', 'C4'], arp: ['D4', 'F4', 'A4', 'C5', 'A4', 'F4'], bass: 'D2' },
  Bb: { pad: ['D3', 'F3', 'Bb3', 'C4'], arp: ['Bb3', 'D4', 'F4', 'C5', 'F4', 'D4'], bass: 'Bb1' },
};
const PROGRESSION = ['F', 'C', 'Dm', 'Bb'];

export function makeMusic() {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const echo = new Float32Array(N); // envio para o eco (arpejo)
  const verb = new Float32Array(N); // envio para o reverb
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  // ---------- momentos da narração ----------
  const GROOVE = LINES[2].start; // "Esse é o Resenha."
  const SWELL = [LINES[1].start, GROOVE];
  const SB_BREAK = [LINES[5].start - 0.05, LINES[5].segs[1][0]]; // "Soundboard?"
  const BOSSA = [LINES[9].start, LINES[10].start - 0.2]; // "Feito no Brasil..."
  const LAST_BREAK = [LINES[10].start - 0.2, LINES[10].segs[1][0] - 0.05]; // "Quer testar?"
  const FINAL = LINES[10].segs[1][0] - 0.05; // "Link na bio."
  const END = LINES[10].segs[2][1]; // fim de "Chama a resenha!"
  const inRange = (t, [a, b]) => t >= a && t < b;

  // ---------- instrumentos ----------
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

  // pad: ondas triangulares levemente desafinadas, ataque e saída lentos, filtrado
  const pad = (t, len, notes, gain = 1, cutoff = 0.06) => {
    for (const [k, n] of notes.entries()) {
      const f = NOTE(n);
      for (const [det, pan] of [[0.997, -0.5], [1.003, 0.5]]) {
        let lp = 0, lp2 = 0;
        put(t, len + 1.2, (x) => {
          const ph = (f * det * x) % 1;
          const tri = 4 * Math.abs(ph - 0.5) - 1;
          lp += cutoff * (tri - lp);
          lp2 += cutoff * (lp - lp2);
          const a = Math.min(1, x / 0.6) * (x > len ? Math.exp(-(x - len) / 0.35) : 1);
          return lp2 * a * 0.075;
        }, { pan: pan * (k % 2 ? 1 : 0.7), gain, rev: 0.2 });
      }
    }
  };
  // dedilhado (tipo kalimba/pluck): seno + harmônico com decaimento rápido
  const pluck = (t, n, gain = 1, pan = 0, dec = 0.22) => {
    const f = NOTE(n);
    put(t, dec * 5, (x) => (Math.sin(2 * Math.PI * f * x) * 0.7 + Math.sin(4 * Math.PI * f * x) * 0.18 * Math.exp(-x * 25) + Math.sin(6 * Math.PI * f * x) * 0.06 * Math.exp(-x * 40)) * env(x, 0.003, dec) * 0.2, { pan, gain, ech: 0.45, rev: 0.15 });
  };
  // violão de nylon (bossa): pluck mais grave e quente
  const nylon = (t, n, gain = 1, pan = 0) => {
    const f = NOTE(n);
    let lp = 0;
    put(t, 1.2, (x) => {
      const raw = Math.sin(2 * Math.PI * f * x) + 0.5 * Math.sin(4 * Math.PI * f * x) * Math.exp(-x * 8) + 0.25 * Math.sin(6 * Math.PI * f * x) * Math.exp(-x * 14);
      lp += 0.3 * (raw - lp);
      return lp * env(x, 0.002, 0.28) * 0.13;
    }, { pan, gain, rev: 0.2 });
  };
  const bell = (t, n, gain = 1, pan = 0) => {
    const f = NOTE(n);
    put(t, 2.5, (x) => (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * x) * Math.exp(-x * 3) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * x) * Math.exp(-x * 6)) * env(x, 0.002, 0.7) * 0.07, { pan, gain, ech: 0.3, rev: 0.4 });
  };
  const bass = (t, n, len, gain = 1) => {
    const f = NOTE(n);
    put(t, len, (x) => (Math.sin(2 * Math.PI * f * x) * 0.8 + Math.sin(4 * Math.PI * f * x) * 0.15) * Math.min(1, x / 0.01) * Math.min(1, (len - x) / 0.04) * Math.exp(-x * 1.2) * 0.24, { gain });
  };
  const softKick = (t, g = 1) => put(t, 0.3, (x) => Math.sin(2 * Math.PI * (50 * x + (70 / 25) * (1 - Math.exp(-x * 25)))) * env(x, 0.003, 0.08) * 0.3 * g);
  const rim = (t, g = 1) => {
    let lp = 0;
    put(t, 0.12, (x) => {
      const n = rnd();
      lp += 0.5 * (n - lp);
      return (Math.sin(2 * Math.PI * 1700 * x) * 0.4 + (n - lp) * 0.6) * env(x, 0.0008, 0.018) * 0.2 * g;
    }, { pan: -0.15, rev: 0.3 });
  };
  const shaker = (t, g = 1) => {
    let hp = 0, prev = 0;
    put(t, 0.09, (x) => {
      const n = rnd();
      hp = 0.5 * (hp + n - prev);
      prev = n;
      return hp * (x < 0.015 ? x / 0.015 : Math.exp(-(x - 0.015) / 0.025)) * 0.07 * g;
    }, { pan: 0.35 });
  };
  const swell = (a, b, g = 1) => {
    let lp = 0;
    put(a, b - a + 0.1, (x) => {
      const k = Math.min(1, x / (b - a));
      const n = rnd();
      lp += (0.005 + 0.12 * k * k) * (n - lp);
      return lp * Math.pow(k, 2.5) * 0.35 * g * (x > b - a ? 0 : 1);
    }, { rev: 0.5 });
  };

  // ---------- música ----------
  const bars = (from, to) => {
    const out = [];
    for (let t = from, i = 0; t < to - 0.01; t += BEAT * 4, i++) out.push({ t, i });
    return out;
  };

  // 1) o "problema": pad em Ré menor, com um dedilhado triste e espaçado
  pad(0, LINES[0].end - 0.1, ['D3', 'F3', 'A3', 'C4'], 0.9, 0.035);
  for (const [k, n] of ['A4', 'F4', 'D4', 'C4'].entries()) pluck(0.4 + k * BEAT * 1.5, n, 0.5, k % 2 ? 0.3 : -0.3, 0.3);

  // 2) "Então... eu criei o meu": cresce até o groove
  swell(SWELL[0] + 0.2, GROOVE, 0.8);
  pad(SWELL[1] - 1.6, 1.6, ['C3', 'E3', 'G3', 'D4'], 0.5, 0.05);
  for (let k = 0; k < 8; k++) pluck(GROOVE - (8 - k) * STEP, ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6'][k], 0.25 + k * 0.06, k % 2 ? 0.4 : -0.4, 0.12);

  // 3) groove: do "Esse é o Resenha" até o fim
  bell(GROOVE, 'C6', 1, -0.2);
  bell(GROOVE + 0.02, 'F5', 0.8, 0.2);
  for (const { t: barT, i: bi } of bars(GROOVE, END + 0.01)) {
    const ch = CHORDS[PROGRESSION[bi % 4]];
    const breakNow = (x) => inRange(x, SB_BREAK) || inRange(x, LAST_BREAK);
    pad(barT, BEAT * 4, ch.pad, inRange(barT, BOSSA) ? 0.7 : 0.8);
    for (let s = 0; s < 16; s++) {
      const t = barT + s * STEP;
      if (t >= END) break;
      if (breakNow(t)) continue;
      const bossa = inRange(t, BOSSA);
      // arpejo (o que prende a atenção): semicolcheias suaves com eco
      if (!bossa && s % 2 === 0) pluck(t, ch.arp[(s / 2) % ch.arp.length], s % 4 === 0 ? 0.9 : 0.6, (s / 2) % 2 ? 0.35 : -0.35);
      if (!bossa && bi % 2 === 1 && s === 14) pluck(t + STEP, ch.arp[3], 0.5, 0.5);
      // bossa nova: baixo no 1 e no 3, acordes sincopados no violão
      if (bossa) {
        if (s === 0 || s === 8) nylon(t, ch.bass.replace(/\d/, '3'), 1, -0.1);
        if ([3, 6, 10, 13].includes(s)) for (const [k, n] of ch.pad.slice(1).entries()) nylon(t + k * 0.012, n.replace(/\d/, (d) => String(Number(d) + 1)), 0.55, 0.2);
      }
      // bateria leve
      if (s === 0 || s === 10) softKick(t, bossa ? 0.6 : 0.9);
      if (s === 4 || s === 12) rim(t, bossa ? 1.2 : 1);
      if (s % 2 === 0) shaker(t, s % 4 === 2 ? 1 : 0.6);
      if (bossa && s % 2 === 1) shaker(t, 0.5);
    }
    // baixo
    if (!breakNow(barT)) {
      bass(barT, ch.bass, BEAT * 2.5);
      if (!breakNow(barT + BEAT * 2.5)) bass(barT + BEAT * 2.5, ch.bass, BEAT * 1.5, 0.8);
    }
  }
  // voltas das pausas
  bell(SB_BREAK[1], 'A5', 0.9, 0.2);
  pluck(SB_BREAK[1], 'F5', 0.8, -0.2);
  swell(LAST_BREAK[0], FINAL, 0.6);
  bell(FINAL, 'C6', 1, -0.2);
  bell(FINAL + 0.03, 'A5', 0.8, 0.2);
  // final: acorde de Fá ressoando
  pad(END, 1.4, ['F3', 'A3', 'C4', 'E4', 'A4'], 1, 0.05);
  bell(END, 'F5', 1, 0);
  bell(END + 0.05, 'C6', 0.8, 0.3);
  bass(END, 'F2', 1.2, 0.9);

  // ---------- eco (ping-pong, colcheia pontuada) e reverb ----------
  const dly = Math.floor(BEAT * 0.75 * RATE);
  const eL = new Float32Array(N), eR = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const inp = echo[j];
    eL[j] = inp + (j >= dly ? eR[j - dly] * 0.38 : 0);
    eR[j] = j >= dly ? eL[j - dly] * 0.38 : 0;
  }
  let lpe = 0, lpe2 = 0;
  for (let j = 0; j < N; j++) {
    lpe += 0.25 * (eL[j] - echo[j] - lpe);
    lpe2 += 0.25 * (eR[j] - lpe2);
    L[j] += lpe * 0.6;
    R[j] += lpe2 * 0.6;
    verb[j] += (eL[j] - echo[j] + eR[j]) * 0.1;
  }
  const combs = [1687, 1601, 2053, 2251].map((d) => ({ d, buf: new Float32Array(d), i: 0, lp: 0 }));
  const aps = [347, 113].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    const x = verb[j] * 0.35;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.lp += 0.45 * (o - c.lp); // reverb mais escuro e macio
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
  const norm = peak > 0 ? 0.95 / peak : 1;
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
  const fadeIn = Math.floor(0.3 * RATE);
  const fadeOut = Math.floor((DURATION - 0.7) * RATE);
  for (let j = 0; j < N; j++) {
    const f = Math.min(1, j / fadeIn) * (j > fadeOut ? 1 - (j - fadeOut) / (N - fadeOut) : 1);
    out.writeInt16LE(Math.round(Math.tanh(L[j] * norm * 1.1) * 0.9 * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.tanh(R[j] * norm * 1.1) * 0.9 * f * 32767), 46 + j * 4);
  }
  return out;
}
