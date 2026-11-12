// "Só quem eu quero vê minha tela" (9:16, 86 BPM com swing). Provisório até chegar a narração:
// depois as cenas passam a seguir as palavras faladas (como nos outros vídeos narrados).
export const BPM = 86;
export const BEAT = 60 / BPM;
const b = (n) => +(n * BEAT).toFixed(4);
export const DURATION = 26;
export const END = b(32);
export const CUTS = [];
export const NARRATION = [];
export const MUSIC = { beatIn: b(4), impacts: [[b(4), 0.7]], duck: 0.3 };
