// Resenha × Discord NARRADO (9:16, 26 s, 140 BPM em meio-tempo): quanto de memória cada um usa, medido pelo Henrique no
// Gerenciador de Tarefas do Windows, no mesmo PC e no mesmo momento.
//   Discord: só aberto (sem call, 0 Mbps de rede) -> 761,5 MB
//   Resenha: em call com 4 pessoas, assistindo uma transmissão de jogo (~45 FPS) -> 421,1 MB
// Só a memória: na CPU o Resenha estava usando mais (9,5% × 5,5%), porque estava recebendo a transmissão.
import NARRACAO from './narracao.json' with { type: 'json' };

export const BPM = 140; // trap em meio-tempo (diferente dos outros vídeos, que são 120)
export const BEAT = 60 / BPM;
const b = (n) => +(n * BEAT).toFixed(4); // tempo na batida n
/** a narração (ElevenLabs, alinhada palavra por palavra) começa aqui: "Agora o Resenha" cai na batida 21 */
const OFF = +(b(21) - NARRACAO[2].words[0][1]).toFixed(3);
/** tempo no vídeo da palavra k da fala li */
const w = (li, k) => +(OFF + NARRACAO[li].words[k][1]).toFixed(3);
export const DURATION = 26;
export const END = b(50.5); // "Resenha é grátis": entra o logo

export const MEM = { discord: 761.5, resenha: 421.1 };
export const LESS = Math.round((1 - MEM.resenha / MEM.discord) * 100); // 45

/** linhas do print (frações de 669×264) */
export const ROWS = { discord: [0.006, 0.548, 0.99, 0.09], resenha: [0.006, 0.752, 0.99, 0.09], mem: [0.636, 0, 0.11, 1] };

const WIDE = [0, 0, 1, 1], MID = [0.16, 0.04, 0.66, 0.78], TIGHT = [0.165, 0.065, 0.56, 0.66];
export const SCENES = [
  // "Todo mundo fala que o Discord pesa no PC. Então eu fui medir. O Discord só aberto, sem call nenhuma: setecentos e sessenta megas"
  { t0: 0, t1: b(21), kind: 'print', row: 'discord', hl: w(1, 1), count: [w(1, 7), w(1, 10)] },
  // "Agora o Resenha, em call com quatro amigos, assistindo a transmissão do jogo:" (a batida entra)
  { t0: b(21), t1: b(30), kind: 'clip', first: 0, from: WIDE, to: MID, hud: ['🎧 4 na call', '📺 assistindo transmissão'] },
  // "quatrocentos e vinte e um megas."
  { t0: b(30), t1: b(35.5), kind: 'print', row: 'resenha', hl: b(30), count: [w(3, 0), w(3, 5)] },
  // "E olha a transmissão: rodando lisinha."
  { t0: b(35.5), t1: b(42), kind: 'clip', first: 330, from: MID, to: TIGHT, hud: ['🧠 421 MB', '🎮 ~45 FPS'] },
  // "Quarenta e cinco por cento menos memória, fazendo muito mais." (DROP)
  { t0: b(42), t1: END, kind: 'chart' },
];

export const NARRATION = [{ at: OFF, from: 0, to: 24.32 }];

/**
 * Legendas: [n palavras faladas, texto, (opcional) qual palavra acende cada termo]. Números falados por
 * extenso aparecem em algarismos. *destaque*.
 */
const CHUNKS = [
  [[3, 'Todo mundo fala'], [4, 'que o *Discord* pesa'], [2, 'no PC 🤔'], [4, 'Então eu fui *medir*']],
  [[4, 'O Discord *só aberto*,'], [3, 'sem call nenhuma'], [4, '*760 megas* 😬', [0, 3, 3]], [2, 'de memória']],
  [[5, 'Agora o *Resenha*, em call'], [3, 'com *4 amigos* 🎧'], [5, 'assistindo a *transmissão* do jogo']],
  [[6, '*421 megas* ✅', [0, 5, 5]]],
  [[4, 'E olha a transmissão'], [2, 'rodando *lisinha* 🎮']],
  [[7, '*45% menos* memória', [0, 5, 6]], [3, 'fazendo *muito mais* 💪']],
  [[3, 'Resenha é *grátis*'], [3, 'chama a *galera* 👊'], [5, 'o link tá na *bio*']],
];
const caps = [];
CHUNKS.forEach((chunks, li) => {
  const words = NARRACAO[li].words;
  let k = 0;
  chunks.forEach(([n, text, map], ci) => {
    const ws = words.slice(k, k + n);
    if (ws.length !== n) throw new Error(`legenda fora do roteiro: ${text}`);
    const tokens = text.split(' ').length;
    const times = Array.from({ length: tokens }, (_, i) => OFF + ws[Math.min(map ? map[i] ?? n - 1 : i, n - 1)][1] - 0.04);
    k += n;
    caps.push({ t: OFF + ws[0][1] - 0.04, end: OFF + ws[n - 1][2] + 0.3, text, times, bad: li < 2 });
  });
  if (k !== words.length) throw new Error(`faltam palavras na legenda da fala ${li + 1}`);
});
caps.forEach((c, i) => {
  if (caps[i + 1]) c.end = Math.min(c.end, caps[i + 1].t);
});
export const CAPTIONS = caps;
export const COVER = w(1, 10) + 0.6; // "760 megas" com o número inteiro na tela

export const CUTS = [b(21), b(30), b(35.5), b(42), END];
export const MUSIC = { beatIn: b(21), build: [b(40), b(42)], drop: [b(42), END], impacts: [[b(21), 0.8], [b(42), 1.1]], duck: 0.3 };
