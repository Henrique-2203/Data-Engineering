// Efeitos sonoros sintetizados (sem direitos autorais), suaves e afinados no tom da trilha:
// whoosh nos cortes, bolhas nos emojis, "plim" nos "de graça" e a buzina do soundboard.
import { CUES, DURATION, LINES } from './timeline.mjs';

const RATE = 44100;

export function makeSfx() {
  const n = Math.ceil(DURATION * RATE);
  const out = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (at, len, fn) => {
    const s0 = Math.floor(at * RATE);
    for (let i = 0; i < len * RATE && s0 + i < n; i++) out[s0 + i] += fn(i / RATE);
  };
  const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

  // tudo afinado em Fá maior (o tom da trilha) e suave, para casar com a música
  const NOTE = { F4: 349.23, A4: 440, C5: 523.25, D5: 587.33, F5: 698.46, A5: 880, C6: 1046.5, F6: 1396.91, A6: 1760 };

  // whoosh macio: ruído bem filtrado subindo e descendo
  const whoosh = (at, len = 0.45, vol = 0.1) => {
    let lp = 0, lp2 = 0;
    add(at - len * 0.65, len, (t) => {
      const k = t / len;
      const cut = 0.01 + 0.12 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      lp2 += cut * (lp - lp2);
      return lp2 * Math.pow(Math.sin(Math.PI * k), 2) * vol * 6;
    });
  };
  // "plim" afinado (sino curto)
  const chime = (at, f, vol = 0.12) =>
    add(at, 1.2, (t) => (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6)) * env(t, 0.003, 0.35) * vol);
  // bolha afinada (emojis e figurinhas)
  const pop = (at, f, vol = 0.14) => add(at, 0.15, (t) => Math.sin(2 * Math.PI * f * (1 + 0.6 * Math.exp(-t * 60)) * t) * env(t, 0.002, 0.045) * vol);
  // "carimbo" suave: batidinha grave curta + plim
  const stamp = (at, f) => {
    add(at, 0.18, (t) => Math.sin(2 * Math.PI * (90 + 60 * Math.exp(-t * 30)) * t) * env(t, 0.003, 0.05) * 0.22);
    chime(at + 0.01, f, 0.11);
    chime(at + 0.06, f * 1.5, 0.06);
  };
  // buzina do soundboard (é o próprio recurso sendo mostrado), mais baixa e afinada
  const horn = (at) =>
    add(at, 0.8, (t) => {
      const f = t < 0.3 ? NOTE.C5 : NOTE.F4;
      const saw = (x) => 2 * (x - Math.floor(x + 0.5));
      return (saw(f * t) * 0.5 + saw(f * 1.5 * t) * 0.2) * env(t, 0.02, 0.45) * (t < 0.75 ? 1 : (0.8 - t) / 0.05) * 0.11;
    });
  const click = (at) => add(at, 0.03, (t) => rnd() * env(t, 0.0005, 0.005) * 0.18);

  for (const l of LINES.slice(1)) whoosh(l.start);
  chime(CUES.lock, NOTE.A4, 0.1); // cadeado: duas notas descendo (Ré menor)
  chime(CUES.lock + 0.14, NOTE.F4, 0.1);
  stamp(CUES.stamp5, NOTE.C6);
  click(CUES.tap);
  horn(CUES.horn);
  stamp(CUES.stamp6, NOTE.A5);
  [NOTE.F5, NOTE.A5, NOTE.C6, NOTE.F6, NOTE.A6].forEach((f, i) =>
    pop([...CUES.pops.slice(0, 2), CUES.pops[1] + 0.2, CUES.pops[2], CUES.pops[3]][i], f),
  );
  stamp(CUES.stamp7, NOTE.F6);
  chime(CUES.playing, NOTE.A5, 0.1);
  chime(CUES.playing + 0.12, NOTE.C6, 0.09);

  // limita e grava WAV 16 bits
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.tanh(out[i] * 1.2) * 0.85 * 32767), 44 + i * 2);
  return pcm;
}
