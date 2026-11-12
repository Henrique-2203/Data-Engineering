// Resenha × Discord (9:16, 20 s, 120 BPM): quanto de memória cada um usa, medido pelo Henrique no
// Gerenciador de Tarefas do Windows, no mesmo PC e no mesmo momento.
//   Discord: só aberto (sem call, 0 Mbps de rede) -> 761,5 MB
//   Resenha: em call com 4 pessoas, assistindo uma transmissão de jogo (~45 FPS) -> 421,1 MB
// Só a memória: na CPU o Resenha estava usando mais (9,5% × 5,5%), porque estava recebendo a transmissão.
export const BPM = 120;
export const BEAT = 60 / BPM;
export const DURATION = 20;
export const END = 16.5;

export const MEM = { discord: 761.5, resenha: 421.1 };
export const LESS = Math.round((1 - MEM.resenha / MEM.discord) * 100); // 45

/** linhas do print (frações de 669×264) */
export const ROWS = { discord: [0.006, 0.548, 0.99, 0.09], resenha: [0.006, 0.752, 0.99, 0.09], mem: [0.636, 0, 0.11, 1] };

export const SCENES = [
  { t0: 0, t1: 3, kind: 'print', row: 'discord' },
  { t0: 3, t1: 6, kind: 'print', row: 'resenha' },
  // gravação: quadros 295..504 do clipe (a parte com o jogo andando)
  { t0: 6, t1: 13, kind: 'clip', first: 295 },
  { t0: 13, t1: END, kind: 'chart' },
];

export const CAPTIONS = [
  { t: 0.1, end: 1.5, text: 'Discord *só aberto*' },
  { t: 1.5, end: 3, text: 'sem call: *761 MB* 😬' },
  { t: 3.05, end: 4.5, text: 'Resenha *em call*' },
  { t: 4.5, end: 6, text: 'com transmissão: *421 MB* ✅' },
  { t: 6.05, end: 8.5, text: 'call com *4 pessoas* 🎧' },
  { t: 8.5, end: 10.75, text: 'transmissão do jogo *lisinha* 🎮' },
  { t: 10.75, end: 13, text: 'e o PC *leve* 🪶' },
  { t: 13.05, end: 16.5, text: `*${LESS}% menos* memória` },
  { t: 16.6, end: 20, text: 'seu PC *agradece* 👊' },
];

export const CUTS = [3, 6, 13, END];
export const TICKS = [];
export const CLICKS = [];
export const MUSIC = { build: [12, 13], drop: [13, END], impacts: [[3, 0.6], [6, 0.9], [13, 1.1]] };
// a versão narrada pode preencher estes depois
export const NARRATION = [];
export const VOICE = [];
export const DUCK = [];
export const SEGS = {};
