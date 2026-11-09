// Trilha original (phonk + funk carioca) sintetizada aqui mesmo, sincronizada com a narração:
// intro abafada que "trava" no fim da 1ª frase, subida em "Então... eu criei o meu", DROP no
// "Esse é o Resenha", pausa no "Soundboard?", tamborzão no "Feito no Brasil" e final no
// "Link na bio" / "Chama a resenha!". Sem direitos autorais: pode usar em qualquer conta.
import { DURATION, LINES } from './timeline.mjs';

const RATE = 44100;
const BPM = 128;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // semicolcheia

export function makeMusic() {
  const N = Math.ceil(DURATION * RATE);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const send = new Float32Array(N); // reverb
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  // ---------- momentos da narração ----------
  const DROP = LINES[2].start; // "Esse é o Resenha."
  const RISER_FROM = LINES[1].start; // "Então..."
  const LAG_END = LINES[0].end; // fim de "live em HD."
  const SB_BREAK = [LINES[5].start - 0.05, LINES[5].segs[1][0]]; // "Soundboard?" ... "De graça."
  const FUNK = [LINES[9].start, LINES[10].start - 0.2]; // "Feito no Brasil..."
  const LAST_BREAK = [LINES[10].start - 0.2, LINES[10].segs[1][0] - 0.06]; // "Quer testar?"
  const FINAL_DROP = LINES[10].segs[1][0] - 0.06; // "Link na bio."
  const END_HIT = LINES[10].segs[2][1] - 0.02; // fim de "Chama a resenha!"
  const stepAt = (i) => DROP + i * STEP; // grade presa ao drop

  // ---------- instrumentos ----------
  const put = (t, len, fn, { pan = 0, rev = 0, gain = 1 } = {}) => {
    const s0 = Math.floor(t * RATE);
    const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
    for (let i = 0; i < len * RATE; i++) {
      const j = s0 + i;
      if (j < 0) continue;
      if (j >= N) break;
      const v = fn(i / RATE);
      L[j] += v * gl;
      R[j] += v * gr;
      if (rev) send[j] += v * rev;
    }
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
  const sat = (x, k) => Math.tanh(x * k) / Math.tanh(k);

  const kick = (t, g = 1) =>
    put(t, 0.45, (x) => {
      const ph = 2 * Math.PI * (48 * x + (140 / 30) * (1 - Math.exp(-x * 30)));
      return sat(Math.sin(ph) * env(x, 0.002, 0.16) * 1.6, 2) * 0.9 + (x < 0.004 ? rnd() * 0.3 : 0);
    }, { gain: g });
  const clap = (t, g = 1) => {
    let lp = 0;
    put(t, 0.35, (x) => {
      const bursts = [0, 0.011, 0.022].reduce((a, o) => a + (x >= o ? env(x - o, 0.001, x - o < 0.03 ? 0.008 : 0.09) : 0), 0);
      const n = rnd();
      lp += 0.35 * (n - lp);
      return (n - lp) * bursts * 0.5;
    }, { rev: 0.35, gain: g });
  };
  const snare = (t, g = 1) =>
    put(t, 0.22, (x) => (Math.sin(2 * Math.PI * 190 * x) * env(x, 0.001, 0.05) * 0.5 + rnd() * env(x, 0.001, 0.07) * 0.45) * g, { rev: 0.25 });
  const hat = (t, g = 1, open = false) => {
    let hp = 0, prev = 0;
    put(t, open ? 0.25 : 0.06, (x) => {
      const n = rnd();
      hp = 0.6 * (hp + n - prev);
      prev = n;
      return hp * env(x, 0.0005, open ? 0.08 : 0.018) * 0.28 * g;
    }, { pan: 0.25 });
  };
  // cowbell de phonk (dois quadrados desafinados, filtrado), afinado em notas
  const cowbell = (t, freq, g = 1, pan = -0.2) => {
    let bp = 0, lp2 = 0;
    put(t, 0.35, (x) => {
      const sq = Math.sign(Math.sin(2 * Math.PI * freq * x)) * 0.6 + Math.sign(Math.sin(2 * Math.PI * freq * 1.48 * x)) * 0.4;
      bp += 0.3 * (sq - bp);
      lp2 += 0.5 * (bp - lp2);
      return (bp - lp2 * 0.6) * env(x, 0.001, 0.07 + 0.05 * (freq < 450 ? 1 : 0)) * 0.32 * g;
    }, { pan, rev: 0.3 });
  };
  // 808: seno longo saturado + oitava acima (para aparecer em alto-falante de celular)
  const bass808 = (t, freq, len, g = 1, glideTo = null) =>
    put(t, len, (x) => {
      const k = Math.min(1, x / len);
      const f = glideTo ? freq * Math.pow(glideTo / freq, Math.max(0, (k - 0.6) / 0.4)) : freq;
      const ph = 2 * Math.PI * f * x;
      const a = env(x, 0.004, len * 0.9) * (x > len - 0.03 ? (len - x) / 0.03 : 1);
      return (sat(Math.sin(ph) * 1.8, 2.5) * 0.55 + Math.sin(2 * ph) * 0.18) * a * g;
    });
  const crash = (t, g = 1) => {
    let hp = 0, prev = 0;
    put(t, 2.2, (x) => {
      const n = rnd();
      hp = 0.7 * (hp + n - prev);
      prev = n;
      return hp * env(x, 0.002, 0.6) * 0.32 * g;
    }, { rev: 0.4, pan: 0.15 });
  };
  const subBoom = (t, g = 1) => put(t, 1.6, (x) => Math.sin(2 * Math.PI * (38 + 60 * Math.exp(-x * 9)) * x) * env(x, 0.003, 0.55) * 0.9 * g);
  const riser = (a, b, g = 1) => {
    let lp = 0;
    put(a, b - a, (x) => {
      const k = x / (b - a);
      const n = rnd();
      lp += (0.01 + 0.5 * k * k) * (n - lp);
      return (lp * 0.8 + Math.sin(2 * Math.PI * (200 + 900 * k * k) * x) * 0.15) * k * k * 0.5 * g;
    }, { rev: 0.3 });
  };
  const reverseCymbal = (a, b) => {
    let hp = 0, prev = 0;
    put(a, b - a, (x) => {
      const n = rnd();
      hp = 0.7 * (hp + n - prev);
      prev = n;
      return hp * Math.pow(x / (b - a), 3) * 0.4;
    }, { rev: 0.2 });
  };

  // ---------- música ----------
  // fá menor: progressão de 2 compassos por acorde (Fm, Fm, Db, Eb)
  const ROOTS = [43.65, 43.65, 34.65, 38.89];
  const SCALE = [349.23, 415.3, 466.16, 523.25, 622.25, 698.46]; // F Ab Bb C Eb F
  // melodia do cowbell (índice da escala por semicolcheia; -1 = pausa), 2 compassos
  const MELODY = [5, -1, 3, -1, 4, -1, 3, 2, -1, 3, -1, 0, 2, -1, 3, -1, 5, -1, 3, -1, 4, -1, 3, 2, -1, 3, -1, 4, 5, -1, 3, -1];
  const PHONK_KICK = [0, 7, 10];
  const TAMBOR = [0, 3, 6, 8, 10, 12, 14]; // "tamborzão" do funk (3-3-2)

  const inRange = (t, [a, b]) => t >= a && t < b;
  const firstStep = Math.floor((0 - DROP) / STEP);
  const lastStep = Math.floor((END_HIT - DROP) / STEP);

  // a intro abafada vai para um buffer separado e depois é filtrada e "travada"
  const swapOut = () => [L.slice(), R.slice()];

  const playStep = (i, intro) => {
    const t = stepAt(i);
    const s = ((i % 16) + 16) % 16;
    const bar = Math.floor(i / 16);
    const chord = ROOTS[(((Math.floor(bar / 2)) % 4) + 4) % 4];
    const funk = inRange(t, FUNK);
    // bateria
    if (funk) {
      if (TAMBOR.includes(s)) kick(t, s === 0 ? 1 : 0.75);
      if ([4, 12].includes(s)) clap(t, 0.8);
      if (s % 2 === 1) hat(t, 0.8);
      if (s === 0 || s === 6) bass808(t, chord * 2, STEP * 3, 0.55);
    } else {
      if (PHONK_KICK.includes(s)) kick(t);
      if (s === 8) clap(t);
      if (s === 8 && !intro) snare(t, 0.4);
      if (s % 2 === 0) hat(t, s % 4 === 2 ? 1 : 0.6);
      if (!intro && bar % 2 === 1 && s >= 12) hat(t + STEP / 2, 0.7); // rolinho de chimbal
      if (!intro && s === 14 && bar % 4 === 3) hat(t, 1, true);
      // 808 no ritmo do bumbo
      if (PHONK_KICK.includes(s)) {
        const next = PHONK_KICK.find((k) => k > s) ?? 16;
        const glide = s === 10 && bar % 2 === 1 ? chord * 1.5 : null;
        bass808(t, chord, (next - s) * STEP, intro ? 0.6 : 1, glide);
      }
    }
    // cowbell (melodia), mais alto depois do drop
    const note = MELODY[(((i % 32) + 32) % 32)];
    if (note >= 0 && !funk) cowbell(t, SCALE[note] * (bar % 8 >= 4 && !intro ? 2 : 1), intro ? 0.6 : 1, s % 4 === 0 ? -0.25 : 0.25);
    if (funk && note >= 0 && s % 4 === 0) cowbell(t, SCALE[note], 0.6, 0.3);
  };

  // 1) intro (até o fim de "live em HD."), em buffer separado
  for (let i = firstStep; ; i++) {
    const t = stepAt(i);
    if (t >= LAG_END) break;
    if (t < 0) continue;
    playStep(i, true);
  }
  const [iL, iR] = swapOut();
  L.fill(0);
  R.fill(0);
  send.fill(0); // o reverb da intro também fica abafado (não vaza)
  // filtro abafado + "travadas" (como live com lag) + desacelera no fim (tape stop)
  const lagEnd = Math.floor(LAG_END * RATE);
  const stopStart = Math.floor((LAG_END - 0.5) * RATE);
  let lpL = 0, lpL2 = 0, lpR = 0, lpR2 = 0;
  let pos = 0, rate = 1;
  for (let j = 0; j < lagEnd; j++) {
    // engasgos: repete pedacinhos curtos em 2 momentos
    let src = j;
    const tt = j / RATE;
    if ((tt > 1.2 && tt < 1.42) || (tt > 2.05 && tt < 2.2)) src = Math.floor(RATE * (tt > 2 ? 2.05 : 1.2)) + (j % Math.floor(RATE * 0.06));
    if (j >= stopStart) {
      rate = Math.max(0, 1 - (j - stopStart) / (lagEnd - stopStart));
      pos += rate;
      src = stopStart + Math.floor(pos);
    } else pos = 0;
    const cut = 0.09;
    lpL += cut * (iL[src] - lpL);
    lpL2 += cut * (lpL - lpL2);
    lpR += cut * (iR[src] - lpR);
    lpR2 += cut * (lpR - lpR2);
    const crackle = rnd() > 0.9986 ? rnd() * 0.25 : 0;
    const fadeIn = Math.min(1, j / (RATE * 0.15));
    L[j] = (lpL2 * 1.6 + crackle) * fadeIn;
    R[j] = (lpR2 * 1.6 + crackle) * fadeIn;
  }

  // 2) "Então... eu criei o meu": silêncio tenso, depois subida com caixa acelerando
  riser(RISER_FROM + 0.4, DROP, 1);
  {
    const a = LINES[1].segs[1][0];
    let t = a;
    while (t < DROP - 0.02) {
      const p = (t - a) / (DROP - a);
      snare(t, 0.25 + 0.6 * p);
      t += p < 0.5 ? BEAT / 2 : p < 0.8 ? STEP : STEP / 2;
    }
  }

  // 3) DROP e música até o fim (com as pausas)
  crash(DROP);
  subBoom(DROP);
  for (let i = 0; i <= lastStep; i++) {
    const t = stepAt(i);
    if (inRange(t, SB_BREAK) || inRange(t, LAST_BREAK)) continue;
    playStep(i, false);
  }
  reverseCymbal(SB_BREAK[1] - 0.6, SB_BREAK[1]);
  crash(SB_BREAK[1]);
  kick(SB_BREAK[1]);
  bass808(SB_BREAK[1], ROOTS[0], 0.5);
  crash(FUNK[0], 0.8);
  riser(LAST_BREAK[0], FINAL_DROP, 0.9);
  crash(FINAL_DROP);
  subBoom(FINAL_DROP, 0.8);
  // impacto final
  kick(END_HIT, 1.2);
  subBoom(END_HIT, 1.1);
  crash(END_HIT, 1.2);
  bass808(END_HIT, ROOTS[0], 0.9, 1);


  // ---------- reverb simples (Schroeder) ----------
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  const aps = [225, 556].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (let j = 0; j < N; j++) {
    let x = send[j] * 0.5;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.buf[c.i] = x + o * 0.82;
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
    L[j] += y * 0.6;
    R[j] += y * 0.55;
  }

  // ---------- master: limita e grava WAV estéreo 16 bits ----------
  let peak = 0;
  for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j]));
  const norm = peak > 0 ? 1 / peak : 1;
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
  const fadeOut = Math.floor((DURATION - 0.3) * RATE);
  for (let j = 0; j < N; j++) {
    const f = j > fadeOut ? 1 - (j - fadeOut) / (N - fadeOut) : 1;
    out.writeInt16LE(Math.round(Math.tanh(L[j] * norm * 1.4) * 0.89 * f * 32767), 44 + j * 4);
    out.writeInt16LE(Math.round(Math.tanh(R[j] * norm * 1.4) * 0.89 * f * 32767), 46 + j * 4);
  }
  return out;
}
