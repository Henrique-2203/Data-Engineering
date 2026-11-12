// "Só quem eu quero vê minha tela" (9:16, ~23 s, lo-fi 86 BPM com swing). As cenas trocam na palavra
// falada (narração do ElevenLabs alinhada palavra por palavra -> narracao.json) e a legenda acende no
// tempo de cada palavra. Telas: as prints reais do Henrique (pixelizadas) + telas capturadas do app
// com dados de mentira (Henrique, Lari, Theo, Júlia).
import NARRACAO from './narracao.json' with { type: 'json' };
import BOX from './boxes.json' with { type: 'json' };

export const BPM = 86;
export const BEAT = 60 / BPM;
const b = (n) => +(n * BEAT).toFixed(4);
/** a batida entra no "No Resenha" (batida 5) */
const OFF = +(b(5) - NARRACAO[1].words[0][1]).toFixed(3);
const w = (li, k) => +(OFF + NARRACAO[li].words[k][1]).toFixed(3);
export const END = b(24.75); // "O Resenha é grátis": entra o logo
export const DURATION = 23.5;

/** amplia um retângulo [x, y, w, h] em volta do centro */
const grow = (r, k, ky = k) => [r[0] - (r[2] * (k - 1)) / 2, r[1] - (r[3] * (ky - 1)) / 2, r[2] * k, r[3] * ky];
const M = (name) => BOX[name];
/** retângulo com a mesma proporção do painel (980 × ph), para nada ser cortado dos lados */
const fit = (x, y, wFrac, ph, W = 2560, H = 1600) => [x, y, wFrac, (wFrac * W * (ph / 980)) / H];
/** zoom em volta de r (k × a largura dele), sempre na proporção do painel: o texto não é cortado dos lados */
const fitAround = (r, k, ph, W = 2560, H = 1600) => {
  const w = r[2] * k;
  const h = (w * W * (ph / 980)) / H;
  return [r[0] + r[2] / 2 - w / 2, r[1] + r[3] / 2 - h / 2, w, h];
};
const modal = (name, opt, t0, t1, extra = {}) => {
  const m = M(name);
  const ph = 560;
  return {
    t0,
    t1,
    img: name,
    // câmera na parte "Quem pode assistir" (e na lista de pessoas, quando tem)
    from: fit(m.dialog[0], m.modes[1] - 0.07, m.dialog[2], ph),
    to: fit(m.modes[0] - 0.012, m.modes[1] - 0.035, m.modes[2] + 0.024, ph),
    ph,
    marks: [{ t: t0 + 0.12, t1, r: grow(m[opt], 1.04, 1.08) }, ...(extra.people ? [{ t: extra.people, t1, r: grow(m.people, 1.02, 1.1) }] : [])],
  };
};

// prints reais do Henrique (1919×1030)
const PJ = { dialog: [0.355, 0.2, 0.291, 0.624], modes: [0.364, 0.272, 0.273, 0.102] };
const PC = { tile: [0.172, 0.08, 0.27, 0.84], lock: [0.215, 0.455, 0.2, 0.09] };

export const SCENES = [
  // "Sabe quando você quer mostrar a tela, mas não pra call inteira?"
  { t0: 0, t1: b(5), img: 'call-4', from: [0.25, 0.02, 0.75, 0.9], to: [0.27, 0.05, 0.6, 0.72], ph: 1000 },
  // "No Resenha, você escolhe quem pode assistir." (print real)
  { t0: b(5), t1: b(8.75), img: 'print-janela', from: fit(0.33, 0.16, 0.34, 520, 1919, 1030), to: fit(0.355, 0.235, 0.29, 520, 1919, 1030), ph: 520, tag: '📸 print real' },
  // "Todo mundo da call, só os seus amigos, só quem você escolher, ou todo mundo menos aquela pessoa."
  modal('modal-todos', 'todos', b(8.75), b(10.25)),
  modal('modal-amigos', 'amigos', b(10.25), b(11.75)),
  modal('modal-escolher', 'escolher', b(11.75), b(13.5), { people: w(2, 11) }),
  modal('modal-menos', 'menos', b(13.5), b(16.5), { people: w(2, 16) }),
  // "Quem pode, assiste normal."
  { t0: b(16.5), t1: b(18.75), img: 'lari-assistindo', from: grow(M('lari-assistindo').screen, 1.05), to: grow(M('lari-assistindo').screen, 0.8), ph: 620, tag: '👀 a Lari assiste' },
  // "E quem ficou de fora vê só um cadeado." (a print real; no "cadeado", a Júlia de perto)
  { t0: b(18.75), t1: b(20.5), img: 'print-cadeado', from: grow(PC.tile, 1.05), to: fitAround(PC.lock, 1.25, 620, 1919, 1030), ph: 620, tag: '📸 print real' },
  { t0: b(20.5), t1: b(22.25), img: 'julia-cadeado', from: grow(M('julia-cadeado').tile, 1.1), to: fitAround(M('julia-cadeado').lock, 1.3, 620), ph: 620, tag: '🔒 a Júlia ficou de fora', marks: [{ t: w(4, 8), t1: b(22.25), r: grow(M('julia-cadeado').lock, 1.1, 1.4) }] },
  // "Sua tela, suas regras."
  { t0: b(22.25), t1: END, img: 'henrique-transmitindo', from: grow(M('henrique-transmitindo').screen, 1.1), to: fitAround(M('henrique-transmitindo').chip, 2.4, 620), ph: 620, marks: [{ t: w(5, 2), t1: END, r: grow(M('henrique-transmitindo').chip, 1.15, 1.3) }] },
];

export const NARRATION = [{ at: OFF, from: 0, to: 21.84 }];

/** legendas: [palavras faladas, texto (*destaque*), (opcional) palavra que acende cada termo] */
const CHUNKS = [
  [[4, 'Sabe quando você quer'], [3, 'mostrar a *tela*'], [5, 'mas não pra *call inteira*? 🤔']],
  [[2, 'No *Resenha*,'], [5, 'você escolhe *quem pode assistir*']],
  [[4, '*todo mundo* da call'], [4, 'só os seus *amigos*'], [4, 'só *quem você escolher*'], [6, 'ou todo mundo *menos* aquela pessoa 👀']],
  [[4, 'quem pode, *assiste normal* ✅']],
  [[5, 'e quem ficou *de fora*'], [4, 'vê só um *cadeado* 🔒']],
  [[4, 'sua tela, *suas regras* 😎']],
  [[4, 'O Resenha é *grátis*'], [4, 'e tá liberando *convites* 🎟️'], [5, 'entra na *lista de espera*'], [5, 'o link tá na *bio*']],
];
const caps = [];
CHUNKS.forEach((chunks, li) => {
  const words = NARRACAO[li].words;
  let k = 0;
  chunks.forEach(([n, text, map]) => {
    const ws = words.slice(k, k + n);
    if (ws.length !== n) throw new Error(`legenda fora do roteiro: ${text}`);
    const tokens = text.split(' ').length;
    const times = Array.from({ length: tokens }, (_, i) => OFF + ws[Math.min(map ? map[i] ?? n - 1 : i, n - 1)][1] - 0.04);
    k += n;
    caps.push({ t: OFF + ws[0][1] - 0.04, end: OFF + ws[n - 1][2] + 0.3, text, times });
  });
  if (k !== words.length) throw new Error(`faltam palavras na legenda da fala ${li + 1}`);
});
caps.forEach((c, i) => {
  c.t = Math.max(0.05, c.t);
  c.times = c.times.map((x) => Math.max(c.t, x));
  if (caps[i + 1]) c.end = Math.min(c.end, caps[i + 1].t);
});
export const CAPTIONS = caps;
export const COVER = w(4, 8) + 0.5; // o cadeado com "vê só um cadeado"

export const CUTS = SCENES.map((s) => s.t0).filter((t) => t > 0).concat(END);
export const MUSIC = { beatIn: b(5), impacts: [[b(5), 0.7], [b(18.75), 0.5]], duck: 0.3 };
