// "Sem eco na transmissão" (9:16, ~38 s, synthwave 105 BPM). O Lucas transmite o jogo; o Matheus fala
// na call e ouve a própria voz voltando pela transmissão (ANTES, som recriado); o app do Resenha
// passa a mandar só o som do jogo (AGORA). A narração é cortada em 4 pedaços para caber as falas do
// Matheus: com eco, limpa e a reação dele.
import NARRACAO from './narracao.json' with { type: 'json' };
import FALAS from './falas.json' with { type: 'json' };
import BOX from './boxes.json' with { type: 'json' };

export const BPM = 105;
export const BEAT = 60 / BPM;
/** atraso do eco (a voz volta pela transmissão de quem transmite) */
export const ECHO = 0.4;

// pedaços da narração (tempo no áudio → tempo no vídeo)
export const NARRATION = [
  { from: 0, to: 8.13, at: 0 },
  { from: 8.22, to: 19.8, at: 11.3 },
  { from: 19.84, to: 22.765, at: 25.55 },
  { from: 22.765, to: 27.72, at: 31.75 },
];
/** as falas do Matheus: com eco (a original + a que volta), limpa e a reação */
export const VOICES = [
  { file: 'f1', from: 0, to: 2.25, at: 8.35 },
  { file: 'f1-eco', from: 0, to: 2.25, at: 8.35 + ECHO, gain: 0.8 },
  { file: 'f1', from: 0, to: 2.25, at: 23.05 },
  { file: 'f2', from: 0.45, to: 3.45, at: 28.6 },
];
const nt = (x) => {
  const s = NARRATION.find((n) => x >= n.from - 1e-6 && x <= n.to + 1e-6) ?? NARRATION.findLast((n) => x >= n.from);
  return +(s.at + x - s.from).toFixed(3);
};
const w = (li, k) => nt(NARRACAO[li].words[k][1]);
const L = (li) => nt(NARRACAO[li].start);

export const END = w(9, 0) - 0.05; // "O Resenha é grátis": logo final
export const DURATION = +(nt(27.72) + 1.6).toFixed(2);

/** retângulo na proporção do painel (980 × ph) em volta de r, k vezes a largura dele */
const around = (r, k, ph) => {
  const wf = r[2] * k;
  const h = (wf * 2560 * (ph / 980)) / 1600;
  return [r[0] + r[2] / 2 - wf / 2, r[1] + r[3] / 2 - h / 2, wf, h];
};
const grow = (r, k, ky = k) => [r[0] - (r[2] * (k - 1)) / 2, r[1] - (r[3] * (ky - 1)) / 2, r[2] * k, r[3] * ky];
const M = BOX['matheus-assistindo'];
/** a transmissão + o quadrinho do Matheus embaixo */
const both = [M.screen[0] - 0.01, M.screen[1] - 0.01, M.screen[2] + 0.02, M.matheus[1] + M.matheus[3] - M.screen[1] + 0.03];
const fitR = (r, ph) => {
  // aumenta o lado que falta para caber r inteiro na proporção do painel
  const want = (980 / ph) * (1600 / 2560); // largura/altura em frações
  const [x, y, wf, hf] = r;
  if (wf / hf > want) {
    const h = wf / want;
    return [x, y + hf / 2 - h / 2, wf, h];
  }
  const ww = hf * want;
  return [x + wf / 2 - ww / 2, y, ww, hf];
};

const F1 = 8.35, F1B = 23.05, F2 = 28.6;
export const SCENES = [
  // "Eu tava transmitindo meu jogo pros amigos na call..."
  { t0: 0, t1: L(1), img: 'lucas-transmitindo', from: around(BOX['lucas-transmitindo'].screen, 2.4, 780), to: around(BOX['lucas-transmitindo'].screen, 1.7, 780), ph: 780, tag: '🎮 eu, transmitindo', tagAt: 0.4 },
  // "...e toda vez que alguém falava, ouvia a própria voz voltando, atrasada. Escuta só:"
  { t0: L(1), t1: F1 - 0.05, img: 'matheus-assistindo', from: fitR(both, 900), to: fitR(grow(both, 0.92), 900), ph: 900, tag: '👀 o Matheus assistindo', marks: [{ t: w(1, 4), t1: F1 - 0.05, r: grow(M.matheus, 1.04) }] },
  // o Matheus fala... e a voz dele volta pela transmissão (ANTES)
  { t0: F1 - 0.05, t1: L(3), img: 'matheus-assistindo', from: fitR(grow(both, 0.85), 880), to: fitR(grow(both, 0.8), 880), ph: 880, wave: { at: F1, echo: true }, pill: 'ANTES 😵 eco', bad: true, note: 'som recriado para mostrar o eco', marks: [{ t: F1, t1: L(3), r: grow(M.matheus, 1.04) }], shake: true },
  // "Isso é o eco: o som do PC ia pra transmissão, levando junto a voz de todo mundo da call."
  { t0: L(3), t1: L(4), diagram: 'antes' },
  // "Então a gente resolveu. Agora o app do Resenha manda só o som do jogo, e deixa a call de fora."
  { t0: L(4), t1: L(6), diagram: 'agora', at: w(5, 0) },
  // "Escuta de novo:" + o Matheus fala de novo, limpo (AGORA)
  { t0: L(6), t1: L(7), img: 'matheus-assistindo', from: fitR(grow(both, 0.9), 1000), to: fitR(grow(both, 0.8), 1000), ph: 1000, wave: { at: F1B, echo: false }, pill: 'AGORA ✨ sem eco', marks: [{ t: F1B, t1: F1B + 2.3, r: grow(M.matheus, 1.04) }] },
  // "Sem eco, sem voz repetida, só o jogo."
  { t0: L(7), t1: F2 - 0.05, img: 'matheus-assistindo-quieto', from: fitR(grow(M.screen, 1.02), 820), to: fitR(grow(M.screen, 0.8), 820), ph: 820, tag: '🎮 só o som do jogo', tagAt: w(7, 5) - L(7) },
  // "Agora sim, tô ouvindo só o jogo!"
  { t0: F2 - 0.05, t1: L(8), img: 'matheus-assistindo', from: fitR(grow(M.matheus, 3.2), 760), to: fitR(grow(M.matheus, 2.6), 760), ph: 760, marks: [{ t: F2 + 0.4, t1: L(8), r: grow(M.matheus, 1.04) }] },
  // "Já tá no app de Windows, na versão nova."
  { t0: L(8), t1: END, app: true },
];

const CHUNKS = [
  [[5, 'Eu tava transmitindo meu jogo'], [4, 'pros amigos na *call* 🎮']],
  [[6, 'e toda vez que alguém falava'], [4, 'ouvia a *própria voz*'], [2, 'voltando, *atrasada* 😵']],
  [[2, 'Escuta só 👂']],
  [[4, 'Isso é o *eco*'], [7, 'o som do PC ia pra *transmissão*'], [4, 'levando junto a *voz*'], [5, 'de todo mundo da call']],
  [[4, 'Então a gente *resolveu* 💪']],
  [[5, 'Agora o app do *Resenha*'], [6, 'manda *só o som do jogo* 🎮'], [6, 'e deixa a *call de fora* 🚫']],
  [[3, 'Escuta de novo 👂']],
  [[2, '*Sem eco*'], [3, 'sem voz repetida'], [3, '*só o jogo* ✅']],
  [[6, 'Já tá no app de *Windows*'], [3, 'na *versão nova* ⬆️']],
  [[4, 'O Resenha é *grátis*'], [3, 'chama a *galera*'], [5, 'o link tá na *bio*']],
];
const caps = [];
const pushCap = (ws, text, map, extra = {}) => {
  const n = ws.length;
  const tokens = text.split(' ').length;
  const times = Array.from({ length: tokens }, (_, i) => map(ws[Math.min(i, n - 1)][1]) - 0.04);
  caps.push({ t: map(ws[0][1]) - 0.04, end: map(ws[n - 1][2]) + 0.3, text, times, ...extra });
};
CHUNKS.forEach((chunks, li) => {
  const words = NARRACAO[li].words;
  let k = 0;
  chunks.forEach(([n, text]) => {
    const ws = words.slice(k, k + n);
    if (ws.length !== n) throw new Error(`legenda fora do roteiro: ${text}`);
    k += n;
    pushCap(ws, text, nt);
  });
  if (k !== words.length) throw new Error(`faltam palavras na legenda da fala ${li + 1} (${k} de ${words.length})`);
});
// o que o Matheus fala (em itálico); na primeira vez, a mesma frase volta em vermelho (o eco)
const f1 = (at) => (x) => at + x;
pushCap(FALAS.f1, '“Ô, cuidado! Tem um atrás de você!”', f1(F1), { quote: true, echo: ECHO, end: F1 + 2.25 + ECHO + 0.25 });
pushCap(FALAS.f1, '“Ô, cuidado! Tem um atrás de você!”', f1(F1B), { quote: true });
pushCap(FALAS.f2, '“Agora sim, tô ouvindo *só o jogo*!”', (x) => F2 - 0.45 + x, { quote: true });
caps.sort((a, b) => a.t - b.t);
caps.forEach((c, i) => {
  c.t = Math.max(0.05, c.t);
  c.times = c.times.map((x) => Math.max(c.t, x));
  if (caps[i + 1]) c.end = Math.min(c.end, caps[i + 1].t);
});
export const CAPTIONS = caps;
/** capa: o eco (a voz voltando em vermelho) */
export const COVER = F1 + 1.9;

export const CUTS = SCENES.map((s) => s.t0).filter((t) => t > 0).concat(END);
/** a música: some nos "Escuta", entra inteira no "resolveu" */
export const MUSIC = { drop: w(4, 3), quiet: [[L(2) - 0.1, L(3)], [L(6) - 0.1, L(7)]], duck: 0.3 };
export const WORD = { nt, w, L };
