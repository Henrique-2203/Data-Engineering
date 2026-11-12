// Resenha × Discord (9:16, 20 s, 140 BPM em meio-tempo): quanto de memória cada um usa, medido pelo Henrique no
// Gerenciador de Tarefas do Windows, no mesmo PC e no mesmo momento.
//   Discord: só aberto (sem call, 0 Mbps de rede) -> 761,5 MB
//   Resenha: em call com 4 pessoas, assistindo uma transmissão de jogo (~45 FPS) -> 421,1 MB
// Só a memória: na CPU o Resenha estava usando mais (9,5% × 5,5%), porque estava recebendo a transmissão.
export const BPM = 140; // trap em meio-tempo (diferente dos outros vídeos, que são 120)
export const BEAT = 60 / BPM;
const b = (n) => +(n * BEAT).toFixed(4); // tempo na batida n
export const DURATION = 20;
export const END = b(38);

export const MEM = { discord: 761.5, resenha: 421.1 };
export const LESS = Math.round((1 - MEM.resenha / MEM.discord) * 100); // 45

/** linhas do print (frações de 669×264) */
export const ROWS = { discord: [0.006, 0.548, 0.99, 0.09], resenha: [0.006, 0.752, 0.99, 0.09], mem: [0.636, 0, 0.11, 1] };

export const SCENES = [
  { t0: 0, t1: b(7), kind: 'print', row: 'discord' },
  { t0: b(7), t1: b(14), kind: 'print', row: 'resenha' },
  // gravação: a partir do quadro 295 do clipe (a parte com o jogo andando)
  { t0: b(14), t1: b(30), kind: 'clip', first: 295 },
  { t0: b(30), t1: END, kind: 'chart' },
];

export const CAPTIONS = [
  { t: 0.1, end: b(3.5), text: 'Discord *só aberto*' },
  { t: b(3.5), end: b(7), text: 'sem call: *761 MB* 😬' },
  { t: b(7) + 0.05, end: b(10.5), text: 'Resenha *em call*' },
  { t: b(10.5), end: b(14), text: 'com transmissão: *421 MB* ✅' },
  { t: b(14) + 0.05, end: b(19.5), text: 'call com *4 pessoas* 🎧' },
  { t: b(19.5), end: b(25), text: 'transmissão do jogo *lisinha* 🎮' },
  { t: b(25), end: b(30), text: 'e o PC *leve* 🪶' },
  { t: b(30) + 0.05, end: END, text: `*${LESS}% menos* memória` },
  { t: END + 0.1, end: DURATION, text: 'seu PC *agradece* 👊' },
];

export const CUTS = [b(7), b(14), b(30), END];
export const MUSIC = { beatIn: b(7), build: [b(28), b(30)], drop: [b(30), END], impacts: [[b(7), 0.8], [b(30), 1.1]], duck: 0.3 };
/** narração: [{ at, from, to }] em promo/out/vs-discord/audio/narracao.wav (preenchida quando chegar o áudio) */
export const NARRATION = [];
