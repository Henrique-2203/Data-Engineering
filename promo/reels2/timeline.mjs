// Linha do tempo do Reels 2 (9:16, 26 s, 120 BPM): supressão de ruído (com a gravação de verdade do
// Henrique, antes e depois do MESMO filtro do app), ouvindo/jogando agora, configurações novas e "e mais".
export const DURATION = 26;
export const BPM = 120;
export const BEAT = 60 / BPM;

const HEN = [0.25, 0.065, 0.25, 0.41]; // quadro do Henrique na call (com banner)
const CFG = [0.26, 0, 0.62, 0.72];

export const SHOTS = [
  { t0: 0, t1: 2, img: 'call-banners', from: HEN, to: [0.27, 0.1, 0.21, 0.34], ph: 900, noise: 'hook' },
  { t0: 2, t1: 4, img: 'cfg-ruido', from: [0.27, 0.15, 0.38, 0.26], to: [0.27, 0.2, 0.32, 0.2], ph: 420, cursor: { from: [0.55, 0.4], to: [0.37, 0.33], click: 3.3 } },
  { t0: 4, t1: 7, img: 'call-banners', from: HEN, to: [0.26, 0.08, 0.23, 0.38], ph: 900, noise: 'antes' },
  { t0: 7, t1: 10, img: 'call-banners', from: HEN, to: [0.26, 0.08, 0.23, 0.38], ph: 900, noise: 'depois' },
  { t0: 10, t1: 12.5, img: 'perfil-ouvindo', from: [0.5, 0.05, 0.5, 0.7], to: [0.53, 0.09, 0.29, 0.5], ph: 1000 },
  { t0: 12.5, t1: 13.75, img: 'perfil-jogando', from: [0.53, 0.13, 0.3, 0.48], to: [0.545, 0.15, 0.27, 0.43], ph: 900 },
  // a lista de membros com as duas atividades (ouvindo e jogando)
  { t0: 13.75, t1: 15, img: 'perfil-jogando', from: [0.8, 0.02, 0.2, 0.3], to: [0.81, 0.04, 0.18, 0.25], ph: 900 },
  ...['cfg-conta', 'cfg-perfil', 'cfg-aparencia', 'cfg-seguranca', 'cfg-privacidade', 'cfg-voz', 'cfg-notificacoes', 'cfg-atalhos'].map((img, i) => ({
    t0: 15 + i * BEAT,
    t1: 15 + (i + 1) * BEAT,
    img,
    from: CFG,
    to: [0.27, 0.02, 0.6, 0.68],
    ph: 720,
    beat: true,
  })),
  { t0: 19, t1: 20.25, img: 'enquete-votos', from: [0.28, 0.37, 0.38, 0.54], to: [0.29, 0.5, 0.34, 0.42], ph: 860 },
  { t0: 20.25, t1: 21.5, img: 'call-banners', from: [0.25, 0.05, 0.75, 0.85], to: [0.25, 0.05, 0.62, 0.7], ph: 700 },
  { t0: 21.5, t1: 22.75, img: 'eventos', from: [0.27, 0.28, 0.46, 0.4], to: [0.28, 0.3, 0.4, 0.33], ph: 540 },
  { t0: 22.75, t1: 24, img: 'relatar-problema', from: [0.26, 0.18, 0.46, 0.6], to: [0.27, 0.2, 0.42, 0.5], ph: 800 },
];

export const CAPTIONS = [
  { t: 0.1, end: 1.0, text: 'seu amigo digita' },
  { t: 1.0, end: 1.98, text: '*ALTO* na call? ⌨️👀' },
  { t: 2.05, end: 4.0, text: 'liga o filtro *Forte (IA)*' },
  { t: 4.05, end: 7.0, text: '*sem* filtro… ⌨️⌨️' },
  { t: 7.05, end: 10.0, text: 'com o Resenha: *só a voz* 🎙️' },
  { t: 10.05, end: 12.5, text: 'mostra o que tá *ouvindo* 🎵' },
  { t: 12.5, end: 15.0, text: 'e o que tá *jogando* 🎮' },
  { t: 15.05, end: 17.0, text: 'configurações *novas* ⚙️' },
  { t: 17.0, end: 19.0, text: 'tudo num *lugar só*' },
  { t: 19.05, end: 20.25, text: 'veja *quem votou* 🗳️' },
  { t: 20.3, end: 21.5, text: '*banner* da call 🎨' },
  { t: 21.55, end: 22.75, text: '*eventos* da galera 📅' },
  { t: 22.8, end: 24.0, text: '*relatar* problema 🩺' },
  { t: 24.15, end: 26, text: 'chama a *galera* 👊' },
];

export const PARTS = [
  { t0: 2, t1: 10, label: 'Sem barulho' },
  { t0: 10, t1: 15, label: 'Ouvindo e jogando' },
  { t0: 15, t1: 19, label: 'Configurações' },
];

/** trechos da gravação: onde cada um toca no vídeo (s) */
export const VOICE = [
  { at: 0, from: 'antes', seg: 'hook', gain: 0.55 },
  { at: 4, from: 'antes', seg: 'seg', gain: 1 },
  { at: 7, from: 'depois', seg: 'seg', gain: 1 },
];
/** música mais baixa enquanto a gravação toca */
export const DUCK = [
  { t0: 0, t1: 2, level: 0.4 },
  { t0: 4, t1: 10, level: 0.1 },
];

export const CUTS = [2, 4, 7, 10, 12.5, 13.75, 15, 19, 20.25, 21.5, 22.75, 24];
export const TICKS = [15.5, 16, 16.5, 17, 17.5, 18, 18.5];
export const CLICKS = SHOTS.filter((s) => s.cursor).map((s) => s.cursor.click);
