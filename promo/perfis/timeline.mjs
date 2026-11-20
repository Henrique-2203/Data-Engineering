// "Um perfil em cada servidor" (9:16, ~34 s, trilha de aventura 100 BPM). A história do Henrique:
// no outro app, foto por servidor era paga; no Resenha ele é o Sir Kael na mesa de RPG, o Zéfiro na
// outra mesa e só o Henrique na faculdade. Cenas e legendas seguem as palavras da narração.
import NARRACAO from './narracao.json' with { type: 'json' };
import BOX from './boxes.json' with { type: 'json' };

export const BPM = 100;
export const BEAT = 60 / BPM;
const b = (n) => +(n * BEAT).toFixed(4);
/** "o Resenha" cai na batida 16 (o logo aparece e a música entra) */
const OFF = +(b(16) - NARRACAO[2].words[5][1]).toFixed(3);
const w = (li, k) => +(OFF + NARRACAO[li].words[k][1]).toFixed(3);
export const END = b(47.5); // "O Resenha é grátis": logo final
export const DURATION = 34.4;

/** retângulo na proporção do painel (980 × ph), para nada ser cortado dos lados */
const fit = (x, y, wf, ph, W = 2560, H = 1600) => [x, y, wf, (wf * W * (ph / 980)) / H];
const around = (r, k, ph) => {
  const wf = r[2] * k;
  const h = (wf * 2560 * (ph / 980)) / 1600;
  return [r[0] + r[2] / 2 - wf / 2, r[1] + r[3] / 2 - h / 2, wf, h];
};
const grow = (r, k, ky = k) => [r[0] - (r[2] * (k - 1)) / 2, r[1] - (r[3] * (ky - 1)) / 2, r[2] * k, r[3] * ky];
/** câmera perto da mensagem do Henrique (foto + nome + texto), que é o que muda em cada servidor */
const focusMsg = (name, wf = 0.3, ph = 600) => {
  const m = BOX[name].msg;
  const h = (wf * 2560 * (ph / 980)) / 1600;
  return [0.262, m[1] + m[3] / 2 - h / 2, wf, h];
};
/** destaque da mensagem do Henrique, incluindo a foto */
const msgMark = (name) => {
  const m = BOX[name].msg;
  return [0.262, m[1] - m[3] * 0.12, m[0] + m[2] - 0.262, m[3] * 1.24];
};
const CHAT = (name, tag) => ({ from: focusMsg(name, 0.36), to: focusMsg(name, 0.3), ph: 600, img: name, tag });
/** a linha "eu" na lista de membros (largura fixa: o nome muda de tamanho) */
const memberRow = (name) => [0.83, BOX[name].member[1] - 0.008, 0.16, 0.036];

export const SCENES = [
  // "Eu usava outro app de call com os meus amigos, mas lá, ter uma foto diferente em cada servidor era pago. E eu queria deixar tudo mais com a minha cara."
  { t0: 0, t1: b(14), img: 'antes', from: [0.02, 0.02, 0.96, 0.96], to: [0.05, 0.05, 0.9, 0.9], ph: 620, tag: '💸 foto por servidor: só pagando', tagAt: w(0, 19), noBeat: true },
  // "Até que eu conheci o Resenha." (o logo aparece no "Resenha")
  { t0: b(14), t1: b(17.5), logo: b(16) },
  // "Aqui, em cada servidor, eu posso ter uma foto e um nome diferentes." (troca de servidor na batida)
  { t0: b(17.5), t1: b(19.5), ...CHAT('fac-chat', '🎓 Faculdade'), marks: [{ t: b(17.5) + 0.1, t1: b(19.5), r: msgMark('fac-chat') }] },
  { t0: b(19.5), t1: b(21.5), ...CHAT('rpg-chat', '🐉 Mesa de RPG'), marks: [{ t: b(19.5) + 0.1, t1: b(21.5), r: msgMark('rpg-chat') }] },
  { t0: b(21.5), t1: b(24), ...CHAT('mas-chat', '🕯️ Masmorra das Quintas'), marks: [{ t: b(21.5) + 0.1, t1: b(24), r: msgMark('mas-chat') }] },
  // "Na mesa de RPG das sextas, eu sou o Sir Kael, o paladino."
  { t0: b(24), t1: b(27), img: 'rpg-chat', from: focusMsg('rpg-chat', 0.5, 700), to: focusMsg('rpg-chat', 0.34, 700), ph: 700, tag: '🐉 Mesa de RPG', marks: [{ t: w(4, 6), t1: b(27), r: msgMark('rpg-chat') }] },
  { t0: b(27), t1: b(30), img: 'rpg-perfil', from: around(BOX['rpg-perfil'].card, 1.6, 900), to: around(BOX['rpg-perfil'].card, 1.25, 900), ph: 900 },
  // "Na outra mesa, eu viro o Zéfiro, o mago."
  { t0: b(30), t1: b(34), img: 'mas-chat', from: focusMsg('mas-chat', 0.5, 700), to: focusMsg('mas-chat', 0.34, 700), ph: 700, tag: '🕯️ Masmorra das Quintas', marks: [{ t: w(5, 6), t1: b(34), r: msgMark('mas-chat') }] },
  // "E no grupo da faculdade, sou só o Henrique, do jeito que todo mundo me conhece."
  { t0: b(34), t1: b(37.25), img: 'fac-chat', from: focusMsg('fac-chat', 0.5, 700), to: focusMsg('fac-chat', 0.34, 700), ph: 700, tag: '🎓 Faculdade', marks: [{ t: w(6, 8), t1: b(37.25), r: msgMark('fac-chat') }] },
  { t0: b(37.25), t1: b(40.5), img: 'fac-perfil', from: around(BOX['fac-perfil'].card, 1.6, 900), to: around(BOX['fac-perfil'].card, 1.25, 900), ph: 900 },
  // "É só abrir 'Meu perfil neste servidor' e trocar, sem mexer no resto."
  {
    t0: b(40.5),
    t1: END,
    img: 'rpg-meu-perfil',
    from: around(BOX['rpg-meu-perfil'].dialog, 1.25, 760),
    to: around(BOX['rpg-meu-perfil'].dialog, 1.05, 760),
    ph: 760,
    marks: [
      { t: w(7, 4), t1: w(7, 7), r: grow(BOX['rpg-meu-perfil'].dialog, 1.01, 1.01) },
      { t: w(7, 8), t1: END, r: grow(BOX['rpg-meu-perfil'].nick, 1.03, 1.3) },
      { t: w(7, 8) + 0.3, t1: END, r: grow(BOX['rpg-meu-perfil'].photo, 1.05, 1.3) },
    ],
  },
];

export const NARRATION = [{ at: OFF, from: 0, to: 33.2 }];

const CHUNKS = [
  [[4, 'Eu usava outro app'], [6, 'de call com os meus amigos'], [5, 'mas lá, ter uma foto'], [4, '*diferente* em cada servidor'], [2, 'era *pago* 💸']],
  [[4, 'E eu queria deixar'], [6, 'tudo mais com a *minha cara*']],
  [[4, 'Até que eu conheci'], [2, 'o *Resenha* 💚']],
  [[4, 'Aqui, em *cada servidor*'], [5, 'eu posso ter uma *foto*'], [4, 'e um *nome* diferentes']],
  [[6, 'Na mesa de *RPG* das sextas 🎲'], [7, 'eu sou o *Sir Kael, o paladino* 🛡️']],
  [[3, 'Na outra mesa'], [6, 'eu viro o *Zéfiro, o mago* 🧙']],
  [[5, 'E no grupo da *faculdade* 🎓'], [4, 'sou só o *Henrique*'], [7, 'do jeito que todo mundo me conhece']],
  [[3, 'É só abrir'], [4, '*Meu perfil neste servidor*'], [2, 'e *trocar*'], [4, 'sem mexer no resto ✌️']],
  [[4, 'O Resenha é *grátis*'], [4, 'e tá liberando *convites* 🎟️'], [5, 'entra na *lista de espera*'], [5, 'o link tá na *bio*']],
];
const caps = [];
CHUNKS.forEach((chunks, li) => {
  const words = NARRACAO[li].words;
  let k = 0;
  chunks.forEach(([n, text]) => {
    const ws = words.slice(k, k + n);
    if (ws.length !== n) throw new Error(`legenda fora do roteiro: ${text}`);
    const tokens = text.split(' ').length;
    const times = Array.from({ length: tokens }, (_, i) => OFF + ws[Math.min(i, n - 1)][1] - 0.04);
    k += n;
    caps.push({ t: OFF + ws[0][1] - 0.04, end: OFF + ws[n - 1][2] + 0.3, text, times });
  });
  if (k !== words.length) throw new Error(`faltam palavras na legenda da fala ${li + 1} (${k} de ${words.length})`);
});
caps.forEach((c, i) => {
  c.t = Math.max(0.05, c.t);
  c.times = c.times.map((x) => Math.max(c.t, x));
  if (caps[i + 1]) c.end = Math.min(c.end, caps[i + 1].t);
});
export const CAPTIONS = caps;
export const COVER = w(4, 9) + 0.3; // o Sir Kael na mesa de RPG

export const CUTS = SCENES.map((s) => s.t0).filter((t) => t > 0).concat(END);
export const MUSIC = { beatIn: b(16), impacts: [[b(16), 1], [b(24), 0.5]], duck: 0.3 };
