// Reels 2 NARRADO (9:16, 46 s, 120 BPM): a mesma montagem do Reels 2, agora contada como história.
// "Eu tava jogando com um amigo, ele entrou na call perguntando do CS, mas com o teclado dele não dava
// pra entender nada" -> supressão de ruído Forte (IA) -> antes/depois com a gravação de verdade do
// Henrique (o MESMO filtro do app) -> ouvindo/jogando, configurações e "e tem mais" -> o convite do CS.
// A narração (ElevenLabs) foi alinhada palavra por palavra (promo/align-voice.py -> narracao.json):
// as cenas trocam quando a palavra é falada e a legenda acende no tempo de cada palavra.
import NARRACAO from './narracao.json' with { type: 'json' };

export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 46;
/** o logo final entra aqui (a narração termina por cima dele: "chama a galera, o link tá na bio") */
export const END = 42;

/** trechos da gravação do Henrique (s, nos arquivos de promo/out/reels2/audio, 48 kHz) */
export const SEGS = {
  fala: [1.9, 4.65], // "Mano, queria saber se vocês vão entrar pra jogar um CS hoje" + teclado
  tec: [4.5, 7.0], // calado, só o teclado
  bed: [1.3, 4.55], // teclado por baixo da narração no começo
};

const WIDE = [0.25, 0.05, 0.75, 0.85];
const THEO = [0.752, 0.07, 0.243, 0.41]; // o amigo (quadro do Theo na call, com banner)
const THEO_IN = [0.762, 0.1, 0.22, 0.35];
const CFG = [0.26, 0, 0.62, 0.72];
const tile = (t0, t1, noise, extra = {}) => ({ t0, t1, img: 'call-banners', from: THEO, to: THEO_IN, ph: 900, noise, ...extra });

export const SHOTS = [
  // "Eu tava jogando com um amigo, e ele entrou na call perguntando se a gente ia jogar um CS..."
  { t0: 0, t1: 4, img: 'call-banners', from: WIDE, to: [0.6, 0.06, 0.4, 0.5], ph: 1000 },
  // "...mas com o teclado dele, não dava pra entender nada:" (teclado por baixo)
  tile(4, 7.25, 'bed'),
  tile(7.25, 10, 'antes'),
  // "Então a gente deixou a supressão de ruído do Resenha ainda mais forte. É só escolher o Forte, com IA."
  { t0: 10, t1: 13.75, img: 'cfg-ruido', from: [0.27, 0.02, 0.62, 0.6], to: [0.28, 0.12, 0.5, 0.49], ph: 600 },
  { t0: 13.75, t1: 16, img: 'cfg-ruido', from: [0.27, 0.15, 0.38, 0.26], to: [0.27, 0.2, 0.32, 0.2], ph: 420, cursor: { from: [0.55, 0.4], to: [0.37, 0.33], click: 14.8 } },
  tile(16, 18.75, 'depois'),
  // "E quando ele nem tá falando?"
  tile(18.75, 20.5, null),
  tile(20.5, 23, 'tecAntes'),
  // "Agora:"
  tile(23, 23.75, null, { from: THEO_IN, to: [0.77, 0.12, 0.2, 0.32] }),
  tile(23.75, 26.25, 'tecDepois'),
  // "E o perfil agora mostra o que você tá ouvindo e jogando."
  { t0: 26.25, t1: 28.75, img: 'perfil-ouvindo', from: [0.5, 0.05, 0.5, 0.7], to: [0.53, 0.09, 0.29, 0.5], ph: 1000 },
  { t0: 28.75, t1: 29.5, img: 'perfil-jogando', from: [0.53, 0.13, 0.3, 0.48], to: [0.545, 0.15, 0.27, 0.43], ph: 900 },
  // "As configurações ficaram novas, tudo num lugar só." (uma tela por batida)
  ...['cfg-conta', 'cfg-perfil', 'cfg-aparencia', 'cfg-seguranca', 'cfg-privacidade', 'cfg-voz', 'cfg-notificacoes'].map((img, i) => ({
    t0: 29.5 + i * BEAT,
    t1: 29.5 + (i + 1) * BEAT,
    img,
    from: CFG,
    to: [0.27, 0.02, 0.6, 0.68],
    ph: 720,
    beat: true,
  })),
  // "E tem mais: enquete mostrando quem votou, banner na call, eventos e um botão pra relatar problema."
  { t0: 33, t1: 35, img: 'enquete-votos', from: [0.28, 0.37, 0.38, 0.54], to: [0.29, 0.5, 0.34, 0.42], ph: 860 },
  { t0: 35, t1: 36, img: 'call-banners', from: WIDE, to: [0.25, 0.05, 0.62, 0.7], ph: 700 },
  { t0: 36, t1: 36.75, img: 'eventos', from: [0.27, 0.28, 0.46, 0.4], to: [0.28, 0.3, 0.4, 0.33], ph: 540 },
  { t0: 36.75, t1: 38.5, img: 'relatar-problema', from: [0.26, 0.18, 0.46, 0.6], to: [0.27, 0.2, 0.42, 0.5], ph: 800 },
  // "Ah, e o CS? Agora todo mundo entendeu o convite." (a galera toda na call)
  { t0: 38.5, t1: END, img: 'call-banners', from: [0.25, 0.05, 0.62, 0.7], to: WIDE, ph: 1000 },
];

/** onde cada trecho da narração toca: falas [primeira, última] do roteiro */
const PLACE = [
  { at: 0, lines: [0, 1] },
  { at: 10.25, lines: [2, 2] },
  { at: 19, lines: [3, 3] },
  { at: 23.1, lines: [4, 4] },
  { at: 26.5, lines: [5, 7] },
  { at: 38.5, lines: [8, 8] },
];
export const NARRATION = PLACE.map(({ at, lines: [a, b] }) => {
  const first = NARRACAO[a], last = NARRACAO[b];
  const next = NARRACAO[b + 1];
  const from = Math.max(0, first.start - 0.03);
  const to = Math.min(last.end + 0.15, next ? next.start - 0.03 : Infinity);
  return { at: at - (first.start - from), from, to, offset: at - first.start };
});

/**
 * Legendas da narração: n = quantas palavras faladas o bloco cobre (emoji no fim acende junto da
 * última), *destaque* na cor do Resenha. Cada palavra acende quando é falada.
 */
const CHUNKS = [
  [[3, 'Eu tava *jogando*'], [3, 'com um amigo'], [5, 'e ele entrou na *call*'], [4, 'perguntando se a gente'], [4, 'ia jogar um *CS*… 🎯']],
  [[5, 'mas com o *teclado* dele ⌨️'], [5, 'não dava pra entender *nada* 😵']],
  [[4, 'Então a gente deixou'], [4, 'a *supressão de ruído*'], [5, 'do Resenha ainda mais *forte*'], [4, 'É só escolher o'], [3, '*Forte, com IA* 🤖']],
  [[3, 'E quando ele'], [3, 'nem tá *falando*? 🤐']],
  [[1, '*Agora:*']],
  [[4, 'E o perfil agora'], [3, 'mostra o que'], [3, 'você tá *ouvindo* 🎵'], [2, 'e *jogando* 🎮']],
  [[2, 'As *configurações*'], [2, 'ficaram *novas* ⚙️'], [4, 'tudo num *lugar só*']],
  [[3, 'E tem *mais:*'], [3, '*enquete* mostrando quem'], [1, '*votou* 🗳️'], [3, '*banner* na call 🎨'], [2, '*eventos* e 📅'], [2, 'um botão'], [3, 'pra *relatar problema* 🩺']],
  [[4, 'Ah, e o *CS*? 🎯'], [3, 'Agora todo mundo'], [3, '*entendeu* o convite ✅'], [3, 'Resenha é *grátis*'], [3, 'chama a *galera* 👊'], [5, 'o link tá na *bio*']],
];
const lineOffset = (li) => PLACE.find((p) => li >= p.lines[0] && li <= p.lines[1]).at - NARRACAO[PLACE.find((p) => li >= p.lines[0] && li <= p.lines[1]).lines[0]].start;
const narrCaps = [];
CHUNKS.forEach((chunks, li) => {
  const words = NARRACAO[li].words;
  const off = lineOffset(li);
  let k = 0;
  chunks.forEach(([n, text], ci) => {
    const ws = words.slice(k, k + n);
    if (ws.length !== n) throw new Error(`legenda fora do roteiro: ${text}`);
    k += n;
    const nextStart = ci + 1 < chunks.length ? words[k][1] + off : null;
    narrCaps.push({
      t: ws[0][1] + off - 0.04,
      end: nextStart ?? ws[n - 1][2] + off + 0.35,
      text,
      times: ws.map((w) => w[1] + off - 0.04),
    });
  });
  if (k !== words.length) throw new Error(`faltam palavras na legenda da fala ${li + 1}`);
});

/** nos trechos da gravação (sem narração): sem filtro não dá pra entender; com o Resenha, o que ele falou */
const FRIEND = [['Mano,', 1.9], ['queria', 2.22], ['saber', 2.46], ['se', 2.62], ['vocês', 2.78], ['vão', 3.02], ['entrar', 3.18], ['pra', 3.42], ['jogar', 3.5], ['um', 3.66], ['*CS*', 3.9], ['hoje?', 4.3]];
const friendCaps = (at) => {
  const rel = (w) => at + w[1] - SEGS.fala[0];
  const a = FRIEND.slice(0, 6), b = FRIEND.slice(6);
  return [
    { t: rel(a[0]), end: rel(b[0]), text: `“${a.map((w) => w[0]).join(' ')}`, times: a.map(rel), quote: true },
    { t: rel(b[0]), end: at + SEGS.fala[1] - SEGS.fala[0], text: `${b.map((w) => w[0]).join(' ')}”`, times: b.map(rel), quote: true },
  ];
};
export const CAPTIONS = [
  ...narrCaps,
  { t: 7.35, end: 10, text: '*???* 😵‍💫', times: [7.35, 7.35] },
  ...friendCaps(16),
  { t: 20.6, end: 23, text: 'só o *teclado* ⌨️⌨️', times: [20.6, 20.9, 21.2, 21.4] },
  { t: 23.85, end: 26.25, text: '*sumiu* 🤫', times: [23.85, 24.1] },
].sort((a, b) => a.t - b.t);
// o fim de cada bloco não passa do começo do próximo
CAPTIONS.forEach((c, i) => {
  c.t = Math.max(0.05, c.t);
  c.times = c.times.map((x) => Math.max(c.t, x));
  if (CAPTIONS[i + 1]) c.end = Math.min(c.end, CAPTIONS[i + 1].t);
});
/** quadro usado de capa: "não dava pra entender nada" com o teclado batendo */
export const COVER = 7.0;

export const PARTS = [
  { t0: 7.25, t1: 26.25, label: 'Sem barulho' },
  { t0: 26.25, t1: 29.5, label: 'Ouvindo e jogando' },
  { t0: 29.5, t1: 33, label: 'Configurações' },
];
export const PARTS_SHOW = [7, 33];
/** selo "🔊 com som" enquanto a gravação importa */
export const SOUND = [4, 26.25];
/** montagem das configurações (cor do destaque troca na batida) */
export const MONTAGE = [29.5, 33];

/** trechos da gravação: onde cada um toca no vídeo (s) */
export const VOICE = [
  { at: 4, from: 'tecAntes', seg: 'bed', gain: 0.5 },
  { at: 7.25, from: 'antes', seg: 'fala', gain: 1 },
  { at: 16, from: 'depois', seg: 'fala', gain: 1 },
  { at: 20.5, from: 'tecAntes', seg: 'tec', gain: 1 },
  { at: 23.75, from: 'tecDepois', seg: 'tec', gain: 1 },
];
/** música mais baixa: quase some na gravação, fica de fundo na narração */
export const DUCK = [
  ...NARRATION.map((n) => ({ t0: n.at, t1: n.at + (n.to - n.from), level: 0.3 })),
  ...VOICE.filter((v) => v.seg !== 'bed').map((v) => ({ t0: v.at, t1: v.at + (SEGS[v.seg][1] - SEGS[v.seg][0]), level: 0.08 })),
];
/** arranjo da trilha */
export const MUSIC = { build: [28.5, 29.5], drop: [29.5, 33], impacts: [[7.25, 0.5], [26.25, 0.6], [29.5, 1.1]] };

export const CUTS = [...new Set(SHOTS.map((s) => s.t0).filter((t) => t > 0 && !(t > MONTAGE[0] && t < MONTAGE[1]))), END];
export const TICKS = SHOTS.filter((s) => s.beat && s.t0 > MONTAGE[0]).map((s) => s.t0);
export const CLICKS = SHOTS.filter((s) => s.cursor).map((s) => s.cursor.click);
