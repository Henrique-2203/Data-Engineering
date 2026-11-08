// Efeitos sonoros sintetizados (sem direitos autorais): whoosh nos cortes, "pop" nos emojis,
// carimbo nos "de graça", buzina no soundboard e um acorde no final. Volume baixo para a narração
// e a música do TikTok/Reels ficarem por cima.
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

  // whoosh: ruído filtrado subindo e descendo
  const whoosh = (at, len = 0.35, vol = 0.22) => {
    let lp = 0;
    add(at - len * 0.6, len, (t) => {
      const k = t / len;
      const cut = 0.02 + 0.25 * Math.sin(Math.PI * k);
      lp += cut * (rnd() - lp);
      return lp * Math.sin(Math.PI * k) * vol * 3;
    });
  };
  // impacto grave
  const boom = (at, vol = 0.5) => add(at, 0.6, (t) => Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t * 18)) * t) * env(t, 0.004, 0.18) * vol);
  // pop de bolha
  const pop = (at, f = 600, vol = 0.25) => add(at, 0.12, (t) => Math.sin(2 * Math.PI * (f + 900 * Math.exp(-t * 40)) * t) * env(t, 0.002, 0.03) * vol);
  // sininho
  const ding = (at, f = 1320, vol = 0.18) => add(at, 1.2, (t) => (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.01 * t)) * env(t, 0.003, 0.25) * vol);
  // carimbo: impacto + sininho
  const stamp = (at) => {
    boom(at, 0.45);
    add(at, 0.08, (t) => rnd() * env(t, 0.001, 0.015) * 0.35);
    ding(at + 0.03, 1567, 0.14);
  };
  // buzina de soundboard (dois tons com vibrato)
  const horn = (at) =>
    add(at, 0.9, (t) => {
      const f = t < 0.35 ? 466 : 349;
      const v = 1 + 0.01 * Math.sin(2 * Math.PI * 6 * t);
      const saw = (x) => 2 * (x - Math.floor(x + 0.5));
      return (saw(f * v * t) * 0.6 + saw(f * 1.5 * v * t) * 0.25) * env(t, 0.02, 0.5) * (t < 0.85 ? 1 : 0) * 0.22;
    });
  const chord = (at) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => ding(at + i * 0.06, f, 0.12));
  const click = (at) => add(at, 0.03, (t) => rnd() * env(t, 0.0005, 0.006) * 0.4);

  // cortes entre as falas
  for (const l of LINES.slice(1)) whoosh(l.start);
  boom(LINES[1].start, 0.55); // "Então eu criei o meu."
  boom(LINES[2].start, 0.45); // logo
  chord(LINES[2].start + 0.15);
  ding(CUES.lock, 392, 0.2); // cadeado do "HD = pago"
  ding(CUES.lock + 0.12, 311, 0.2);
  stamp(CUES.stamp5);
  click(CUES.tap);
  horn(CUES.horn);
  stamp(CUES.stamp6);
  [...CUES.pops.slice(0, 2), CUES.pops[1] + 0.2, CUES.pops[2], CUES.pops[3]].forEach((t, i) => pop(t, 500 + i * 120));
  stamp(CUES.stamp7);
  ding(CUES.playing, 988, 0.16);
  ding(CUES.playing + 0.12, 1318, 0.14);
  boom(LINES[10].start, 0.4);
  chord(CUES.cta);

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
