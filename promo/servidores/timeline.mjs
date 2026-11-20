// "O Resenha agora tem comunidade" (9:16, ~30 s): servidor oficial, Explorar, servidor público com
// boas-vindas e o "Dar oi". Abre e fecha com o print REAL do #boas-vindas (nomes e fotos borrados).
// Todos os tempos saem da narração (narracao.json), palavra por palavra.
import NARRACAO from './narracao.json' with { type: 'json' };
import BOX from './boxes.json' with { type: 'json' };

export const BPM = 116;
export const BEAT = 60 / BPM;
export const NARRATION = [{ from: 0, to: 28.68, at: 0 }];
export const VOICES = [];
const w = (li, k) => NARRACAO[li].words[k][1];
const L = (li) => NARRACAO[li].start;

/** "Resenha." (logo) */
export const END = L(10) - 0.04;
/** o print real da lista de membros ("gente de verdade") e o fecho "Falta você" */
export const REAL = w(11, 3) - 0.1;
export const FINAL = L(12) - 0.05;
export const DURATION = +(28.68 + 1.5).toFixed(2);

const SHOT = 2560 / 1600;
const PRINT = 1919 / 1028;
/** aumenta o lado que falta para o retângulo r caber inteiro no painel (980 × ph) */
const fit = (r, ph, aspect = SHOT) => {
  const want = 980 / ph / aspect;
  const [x, y, wf, hf] = r;
  if (wf / hf > want) {
    const h = wf / want;
    return [x, y + hf / 2 - h / 2, wf, h];
  }
  const ww = hf * want;
  return [x + wf / 2 - ww / 2, y, ww, hf];
};
const grow = (r, k, ky = k) => [r[0] - (r[2] * (k - 1)) / 2, r[1] - (r[3] * (ky - 1)) / 2, r[2] * k, r[3] * ky];
const B = (shot, k) => BOX[shot]?.[k];

const CHAT = [0.255, 0.24, 0.56, 0.6];
export const SCENES = [
  // "Ontem, quinze pessoas chegaram no Resenha num dia só."  (print real)
  { t0: 0, t1: L(1), img: 'print', print: true, ph: 1080, from: fit([0.17, 0.2, 0.36, 0.7], 1080, PRINT), to: fit([0.18, 0.24, 0.32, 0.6], 1080, PRINT), tag: '📸 print real · #boas-vindas do servidor oficial', tagAt: 0.3, big: { at: w(0, 1), text: '15', sub: 'chegadas em 1 dia' } },
  // "Agora tem o servidor oficial."
  { t0: L(1), t1: L(2), img: 'oficial', ph: 1000, from: fit([0.0, 0.0, 1.0, 1.0], 1000), to: fit([0.0, 0.0, 0.62, 0.62], 1000), tag: '🏆 Resenha Brasil OFC' },
  // "Você entra sozinho,"
  { t0: L(2), t1: w(2, 3), img: 'oficial-boasvindas', ph: 1100, from: fit(grow(B('oficial-boasvindas', 'modal'), 1.15), 1100), to: fit(grow(B('oficial-boasvindas', 'modal'), 1.0), 1100), tag: '✨ entra sozinho, sem convite' },
  // "acha a galera pra jogar"
  { t0: w(2, 3), t1: w(2, 8), img: 'oficial', ph: 1000, from: fit(CHAT, 1000), to: fit([0.26, 0.33, 0.45, 0.45], 1000), tag: '🎮 #procurando-grupo' },
  // "e fica sabendo das novidades primeiro."
  { t0: w(2, 8), t1: L(3), img: 'novidades', ph: 1000, from: fit(CHAT, 1000), to: fit([0.26, 0.3, 0.5, 0.45], 1000), tag: '📣 #novidades' },
  // "E tem o Explorar. Servidores públicos da comunidade."
  { t0: L(3), t1: L(5), img: 'explorar', ph: 1150, from: fit([0.05, 0.0, 0.9, 1.0], 1150), to: fit([0.2, 0.25, 0.75, 0.75], 1150), tag: '🧭 Explorar' },
  // "Por categoria."
  { t0: L(5), t1: L(6), img: 'explorar', ph: 1150, from: fit([0.05, 0.02, 0.3, 0.55], 1150), to: fit([0.06, 0.03, 0.26, 0.5], 1150), marks: [{ t: L(5) + 0.1, t1: L(6), r: grow(B('explorar', 'nav'), 1.03) }] },
  // "FPS,"  "RPG,"  "Roblox."
  { t0: L(6), t1: w(6, 1), img: 'explorar-fps', ph: 1100, from: fit([0.05, 0.02, 0.85, 0.75], 1100), to: fit([0.06, 0.04, 0.78, 0.7], 1100), marks: [{ t: L(6), t1: w(6, 1), r: grow(B('explorar-fps', 'tab'), 1.06, 1.2) }] },
  { t0: w(6, 1), t1: w(6, 2), img: 'explorar-rpg', ph: 1100, from: fit([0.05, 0.02, 0.85, 0.75], 1100), to: fit([0.06, 0.04, 0.78, 0.7], 1100), marks: [{ t: w(6, 1), t1: w(6, 2), r: grow(B('explorar-rpg', 'tab'), 1.06, 1.2) }] },
  { t0: w(6, 2), t1: L(7), img: 'explorar-roblox', ph: 1100, from: fit([0.2, 0.05, 0.6, 0.45], 1100), to: fit([0.2, 0.1, 0.4, 0.42], 1100), marks: [{ t: w(6, 2), t1: L(7), r: grow(B('explorar-roblox', 'search'), 1.02, 1.1) }] },
  // "É só clicar em Entrar."  (o cursor clica no Entrar)
  { t0: L(7), t1: w(7, 4) + 0.25, img: 'explorar-roblox', ph: 1000, from: fit(grow(B('explorar-roblox', 'card'), 1.4), 1000), to: fit(grow(B('explorar-roblox', 'card'), 1.15), 1000), click: { at: w(7, 4), r: B('explorar-roblox', 'entrar') } },
  { t0: w(7, 4) + 0.25, t1: L(8), img: 'entrou', ph: 1000, from: fit(grow(B('entrou', 'modal'), 1.3), 1000), to: fit(grow(B('entrou', 'modal'), 1.15), 1000), tag: '🎉 entrou!' },
  // "Tem um servidor? Deixe ele público,"
  { t0: L(8), t1: w(8, 6), img: 'config-comunidade', ph: 1000, from: fit([0.06, 0.02, 0.72, 0.45], 1000), to: fit(grow(B('config-comunidade', 'vis'), 1.1, 1.6), 1000), marks: [{ t: w(8, 3), t1: w(8, 6), r: grow(B('config-comunidade', 'vis'), 1.01, 1.05) }] },
  // "escreve as regras"
  { t0: w(8, 6), t1: w(8, 9), img: 'config-regras', ph: 1000, from: fit([0.2, 0.02, 0.7, 0.5], 1000), to: fit([0.26, 0.04, 0.6, 0.42], 1000), tag: '📜 regras com "Aceito"' },
  // "e uma mensagem de boas-vindas pra quem chegar."
  { t0: w(8, 9), t1: L(9), img: 'config-boasvindas', ph: 1000, from: fit(grow(B('config-boasvindas', 'text'), 1.1), 1000), to: fit(grow(B('config-boasvindas', 'preview'), 1.1), 1000), tag: '👋 boas-vindas' },
  // "E quando alguém entra,"
  { t0: L(9), t1: w(9, 4), img: 'oi-antes', ph: 900, from: fit([0.255, 0.3, 0.56, 0.3], 900), to: fit([0.26, 0.33, 0.5, 0.2], 900), marks: [{ t: w(9, 2), t1: w(9, 4), r: grow(B('oi-antes', 'line'), 1.0, 1.15) }] },
  // "a galera dá oi."
  { t0: w(9, 4), t1: END, img: 'oi-depois', ph: 1100, from: fit([0.255, 0.3, 0.56, 0.52], 1100), to: fit([0.26, 0.36, 0.5, 0.45], 1100), tag: '👋 Dar oi' },
  // "Resenha." (logo) · "Gratuito, brasileiro e com gente de verdade." → o print real da lista de membros
  { t0: END, t1: REAL, end: 'logo' },
  { t0: REAL, t1: FINAL, img: 'print', print: true, ph: 1150, from: fit([0.86, 0.02, 0.14, 0.62], 1150, PRINT), to: fit([0.87, 0.03, 0.13, 0.5], 1150, PRINT), tag: '📸 print real · servidor oficial', tagAt: 0.1, big: { at: REAL + 0.2, text: '33', sub: 'membros · 10 online' } },
  // "Falta você."
  { t0: FINAL, t1: DURATION + 1, end: 'final' },
];

const CHUNKS = [
  [[4, 'Ontem, *15* pessoas chegaram'], [5, 'no Resenha num *dia só* 🔥']],
  [[5, 'Agora tem o *servidor oficial* 🏆']],
  [[3, 'Você entra *sozinho*'], [5, 'acha a *galera* pra jogar 🎮'], [6, 'e fica sabendo das *novidades* primeiro 📣']],
  [[4, 'E tem o *Explorar* 🧭']],
  [[4, 'servidores *públicos* da comunidade']],
  [[2, 'por *categoria*']],
  [[1, '*FPS* 🎯'], [1, '*RPG* 🐉'], [1, '*Roblox* 🧱']],
  [[5, 'é só clicar em *Entrar* 👆']],
  [[3, 'Tem um *servidor?*'], [3, 'deixe ele *público*'], [3, 'escreve as *regras* 📜'], [5, 'e uma mensagem de *boas-vindas*'], [3, 'pra quem chegar 👋']],
  [[4, 'E quando alguém *entra*'], [4, 'a galera *dá oi* 👋']],
  [[1, '*Resenha* 💚']],
  [[2, '*Gratuito*, brasileiro'], [5, 'e com *gente de verdade*']],
  [[2, 'Falta *você* 💚']],
];
const caps = [];
CHUNKS.forEach((chunks, li) => {
  const words = NARRACAO[li].words;
  let k = 0;
  chunks.forEach(([n, text]) => {
    const ws = words.slice(k, k + n);
    if (ws.length !== n) throw new Error(`legenda fora do roteiro: ${text}`);
    k += n;
    const tokens = text.split(' ').length;
    const times = Array.from({ length: tokens }, (_, i) => ws[Math.min(i, n - 1)][1] - 0.04);
    caps.push({ t: ws[0][1] - 0.04, end: ws[n - 1][2] + 0.3, text, times });
  });
  if (k !== words.length) throw new Error(`faltam palavras na legenda da fala ${li + 1} (${k} de ${words.length})`);
});
caps.forEach((c, i) => {
  c.t = Math.max(0.05, c.t);
  c.times = c.times.map((x) => Math.max(c.t, x));
  if (caps[i + 1]) c.end = Math.min(c.end, caps[i + 1].t);
});
export const CAPTIONS = caps;
/** capa: o print real com o "15" */
export const COVER = w(0, 3);
export const CUTS = SCENES.map((s) => s.t0).filter((t) => t > 0);
/** música: abafada no gancho, entra inteira no "Agora tem o servidor oficial" */
export const MUSIC = { drop: L(1) - 0.04, quiet: [], duck: 0.3 };
