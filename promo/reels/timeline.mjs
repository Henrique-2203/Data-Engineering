// Linha do tempo do Reels das novidades (9:16, 26 s, 120 BPM: 1 batida = 0,5 s).
// Usada pela composição (reels.html) e pela trilha/efeitos (music.mjs): tudo cai na batida.
export const DURATION = 26;
export const BPM = 120;
export const BEAT = 60 / BPM;

/** retângulos em frações da tela capturada: [x, y, largura, altura] */
const TOGETHER = [0.257, 0.074, 0.736, 0.64];
const TILE = [0.256, 0.075, 0.457, 0.64];
const CHAT = [0.25, 0, 0.57, 1];

/**
 * Cenas. img = promo/out/reels/shots/<img>.png. A câmera vai de `from` para `to` durante a cena.
 * ph = altura do "monitor" (largura fixa 980).
 */
export const SHOTS = [
  { t0: 0, t1: 2, img: 'call-assistir-juntos', from: [0.34, 0.14, 0.5, 0.48], to: TOGETHER, ph: 1000 },
  // print de verdade do Henrique (vídeo do canal dele; a imagem do vídeo vai desfocada: personagem de terceiros)
  { t0: 2, t1: 4, img: 'user-assistir-juntos', from: [0, 0, 1, 1], to: [0.17, 0.07, 0.645, 0.79], ph: 700, cursor: { from: [0.66, 0.62], to: [0.49, 0.485], click: 3.55 } },
  { t0: 4, t1: 6, img: 'call-pausado-para-todos', from: TILE, to: [0.27, 0.2, 0.42, 0.5], ph: 900, burst: { t: 4.05, icon: '⏸' } },
  { t0: 6, t1: 8, img: 'call-chat-so-da-call', from: [0.715, 0, 0.285, 0.56], to: [0.715, 0.03, 0.285, 0.47], ph: 1060 },
  // transmissão de verdade (clipe do Henrique: o jogo vai pixelizado, é de terceiros)
  { t0: 8, t1: 9, img: 'clip-transmissao', clip: { n: 48, fps: 30 }, from: [0.0, 0.0, 1, 1], to: [0.16, 0.03, 0.84, 0.87], ph: 700 },
  {
    t0: 9,
    t1: 10.5,
    img: 'qualidade-menu',
    from: TILE,
    to: [0.495, 0.235, 0.225, 0.4],
    ph: 1000,
    // destaque passeando pelas opções, na batida
    marks: [
      { t: 9.0, r: [0.512, 0.296, 0.193, 0.083] },
      { t: 9.5, r: [0.512, 0.39, 0.193, 0.065] },
      { t: 10.0, r: [0.512, 0.462, 0.193, 0.065] },
    ],
  },
  { t0: 10.5, t1: 12, img: 'qualidade-720p', from: TILE, to: [0.43, 0.27, 0.28, 0.41], ph: 900 },
  { t0: 12, t1: 13, img: 'transmitir-nova', from: [0.282, 0.068, 0.436, 0.37], to: [0.29, 0.09, 0.42, 0.33], ph: 540, cursor: { from: [0.36, 0.33], to: [0.449, 0.24], click: 12.55 } },
  { t0: 13, t1: 14, img: 'transmissao-so-amigos-cadeado', from: [0.257, 0.075, 0.24, 0.405], to: [0.262, 0.1, 0.23, 0.36], ph: 900 },
  // montagem: um visual por batida
  ...['chat-escuro', 'chat-claro', 'chat-meia-noite-doodles', 'chat-claro-por-do-sol', 'chat-preto-aurora', 'chat-claro-oceano', 'chat-escuro-neon', 'chat-meia-noite-doodles'].map(
    (img, i) => ({ t0: 14 + i * BEAT, t1: 14 + (i + 1) * BEAT, img, from: CHAT, to: [0.27, 0.06, 0.53, 0.9], ph: 1060, beat: true }),
  ),
  { t0: 18, t1: 21, img: 'config-icones', from: [0.282, 0.64, 0.593, 0.36], to: [0.29, 0.66, 0.575, 0.34], ph: 420, icons: true },
  { t0: 21, t1: 24, img: 'compare', ph: 1060 },
];

/** legendas: *palavra* = destaque na cor do Resenha */
export const CAPTIONS = [
  { t: 0.1, end: 0.95, text: '3 *novidades*' },
  { t: 0.95, end: 1.98, text: 'que a galera vai *PEDIR* 👀' },
  { t: 2.05, end: 3.45, text: 'assistam *JUNTOS*' },
  { t: 3.45, end: 4.0, text: 'na call 📺' },
  { t: 4.05, end: 5.0, text: 'pausou pra um…' },
  { t: 5.0, end: 6.0, text: '*pausou pra todos*' },
  { t: 6.05, end: 7.0, text: 'chat *só da call* 🔒' },
  { t: 7.0, end: 8.0, text: 'some quando *acaba*' },
  { t: 8.05, end: 9.0, text: '*transmite* o jogo 🎮' },
  { t: 9.0, end: 10.5, text: 'cada um na *SUA qualidade*' },
  { t: 10.5, end: 12.0, text: 'muda *só pra você*' },
  { t: 12.05, end: 13.0, text: 'você escolhe' },
  { t: 13.0, end: 14.0, text: '*QUEM ASSISTE* 🔒' },
  { t: 14.05, end: 16.0, text: 'deixa com a' },
  { t: 16.0, end: 18.0, text: '*SUA CARA* 🎨' },
  { t: 18.05, end: 19.5, text: 'até o *ícone*' },
  { t: 19.5, end: 21.0, text: 'do *app* 🤯' },
  { t: 22.1, end: 24.0, text: 'bem mais *simples* ✨' },
  { t: 24.15, end: 26, text: 'chama a *galera* 👊' },
];

/** barra de progresso no topo: "fique até o 3" */
export const PARTS = [
  { t0: 2, t1: 8, label: 'Assistir juntos' },
  { t0: 8, t1: 14, label: 'Transmissão' },
  { t0: 14, t1: 21, label: 'Do seu jeito' },
];

/** cortes que ganham "whoosh" (os da montagem ganham só um "tic") */
export const CUTS = [2, 4, 6, 8, 9, 10.5, 12, 13, 14, 18, 21, 22, 24];
export const TICKS = [14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18.5, 19, 19.5, 20, 20.5];
export const CLICKS = SHOTS.filter((s) => s.cursor).map((s) => s.cursor.click);
