// Linha do tempo do Reels 2 (9:16, 26 s, 120 BPM): supressão de ruído (com a gravação de verdade do
// Henrique, antes e depois do MESMO filtro do app), ouvindo/jogando agora, configurações novas e "e mais".
export const DURATION = 30;
export const BPM = 120;
export const BEAT = 60 / BPM;

const HEN = [0.25, 0.065, 0.25, 0.41]; // quadro do Henrique na call (com banner)
const CFG = [0.26, 0, 0.62, 0.72];

export const SHOTS = [
  { t0: 0, t1: 2, img: 'call-banners', from: HEN, to: [0.27, 0.1, 0.21, 0.34], ph: 900, noise: 'hook' },
  { t0: 2, t1: 4, img: 'cfg-ruido', from: [0.27, 0.15, 0.38, 0.26], to: [0.27, 0.2, 0.32, 0.2], ph: 420, cursor: { from: [0.55, 0.4], to: [0.37, 0.33], click: 3.3 } },
  // falando e digitando: sem e com o filtro
  { t0: 4, t1: 6.5, img: 'call-banners', from: HEN, to: [0.26, 0.08, 0.23, 0.38], ph: 900, noise: 'antes' },
  { t0: 6.5, t1: 9, img: 'call-banners', from: HEN, to: [0.26, 0.08, 0.23, 0.38], ph: 900, noise: 'depois' },
  // calado, só digitando: sem e com o filtro (o que mais incomoda numa call)
  { t0: 9, t1: 11.5, img: 'call-banners', from: HEN, to: [0.26, 0.08, 0.23, 0.38], ph: 900, noise: 'tecAntes' },
  { t0: 11.5, t1: 14, img: 'call-banners', from: HEN, to: [0.26, 0.08, 0.23, 0.38], ph: 900, noise: 'tecDepois' },
  { t0: 14, t1: 16.5, img: 'perfil-ouvindo', from: [0.5, 0.05, 0.5, 0.7], to: [0.53, 0.09, 0.29, 0.5], ph: 1000 },
  { t0: 16.5, t1: 17.75, img: 'perfil-jogando', from: [0.53, 0.13, 0.3, 0.48], to: [0.545, 0.15, 0.27, 0.43], ph: 900 },
  // a lista de membros com as duas atividades (ouvindo e jogando)
  { t0: 17.75, t1: 19, img: 'perfil-jogando', from: [0.8, 0.02, 0.2, 0.3], to: [0.81, 0.04, 0.18, 0.25], ph: 900 },
  ...['cfg-conta', 'cfg-perfil', 'cfg-aparencia', 'cfg-seguranca', 'cfg-privacidade', 'cfg-voz', 'cfg-notificacoes', 'cfg-atalhos'].map((img, i) => ({
    t0: 19 + i * BEAT,
    t1: 19 + (i + 1) * BEAT,
    img,
    from: CFG,
    to: [0.27, 0.02, 0.6, 0.68],
    ph: 720,
    beat: true,
  })),
  { t0: 23, t1: 24.25, img: 'enquete-votos', from: [0.28, 0.37, 0.38, 0.54], to: [0.29, 0.5, 0.34, 0.42], ph: 860 },
  { t0: 24.25, t1: 25.5, img: 'call-banners', from: [0.25, 0.05, 0.75, 0.85], to: [0.25, 0.05, 0.62, 0.7], ph: 700 },
  { t0: 25.5, t1: 26.75, img: 'eventos', from: [0.27, 0.28, 0.46, 0.4], to: [0.28, 0.3, 0.4, 0.33], ph: 540 },
  { t0: 26.75, t1: 28, img: 'relatar-problema', from: [0.26, 0.18, 0.46, 0.6], to: [0.27, 0.2, 0.42, 0.5], ph: 800 },
];

export const CAPTIONS = [
  { t: 0.1, end: 1.0, text: 'seu amigo digita' },
  { t: 1.0, end: 1.98, text: '*ALTO* na call? ⌨️👀' },
  { t: 2.05, end: 4.0, text: 'liga o filtro *Forte (IA)*' },
  { t: 4.05, end: 6.5, text: 'falando, *sem filtro* ⌨️' },
  { t: 6.55, end: 9.0, text: 'com o Resenha: *só a voz* 🎙️' },
  { t: 9.05, end: 11.5, text: 'sem falar, só o *teclado* ⌨️' },
  { t: 11.55, end: 14.0, text: 'com o Resenha: *some* 🤫' },
  { t: 14.05, end: 16.5, text: 'mostra o que tá *ouvindo* 🎵' },
  { t: 16.5, end: 19.0, text: 'e o que tá *jogando* 🎮' },
  { t: 19.05, end: 21.0, text: 'configurações *novas* ⚙️' },
  { t: 21.0, end: 23.0, text: 'tudo num *lugar só*' },
  { t: 23.05, end: 24.25, text: 'veja *quem votou* 🗳️' },
  { t: 24.3, end: 25.5, text: '*banner* da call 🎨' },
  { t: 25.55, end: 26.75, text: '*eventos* da galera 📅' },
  { t: 26.8, end: 28.0, text: '*relatar* problema 🩺' },
  { t: 28.15, end: 30, text: 'chama a *galera* 👊' },
];

export const PARTS = [
  { t0: 2, t1: 14, label: 'Sem barulho' },
  { t0: 14, t1: 19, label: 'Ouvindo e jogando' },
  { t0: 19, t1: 23, label: 'Configurações' },
];

/** trechos da gravação: onde cada um toca no vídeo (s) */
export const VOICE = [
  { at: 0, from: 'tecAntes', seg: 'hook', gain: 0.55 },
  { at: 4, from: 'antes', seg: 'seg', gain: 1 },
  { at: 6.5, from: 'depois', seg: 'seg', gain: 1 },
  { at: 9, from: 'tecAntes', seg: 'tec', gain: 1 },
  { at: 11.5, from: 'tecDepois', seg: 'tec', gain: 1 },
];
/** música mais baixa enquanto a gravação toca */
export const DUCK = [
  { t0: 0, t1: 2, level: 0.4 },
  { t0: 4, t1: 14, level: 0.1 },
];

export const CUTS = [2, 4, 6.5, 9, 11.5, 14, 16.5, 17.75, 19, 23, 24.25, 25.5, 26.75, 28];
export const TICKS = [19.5, 20, 20.5, 21, 21.5, 22, 22.5];
export const CLICKS = SHOTS.filter((s) => s.cursor).map((s) => s.cursor.click);
