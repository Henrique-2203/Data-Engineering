/**
 * Ícones do app: variações do logo do Resenha (o balão de conversa com dois "olhinhos").
 * Todos desenhados por nós em SVG (sem marcas de ninguém). O site troca o ícone da aba; o app de
 * Windows troca também o da janela, da bandeja e dos atalhos.
 */
export interface AppIcon {
  id: string;
  label: string;
  /** SVG 512x512 */
  svg: string;
}

const BUBBLE = 'M136 168a48 48 0 0 1 48-48h144a48 48 0 0 1 48 48v112a48 48 0 0 1-48 48h-72l-72 64v-64h0a48 48 0 0 1-48-48z';

const wrap = (defs: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;

/** fundo + balão + olhos (o desenho clássico, com cores trocadas) */
const classic = (bg: string, bubble: string, eyes: string, defs = '') =>
  wrap(
    defs,
    `<rect width="512" height="512" rx="112" fill="${bg}"/><path d="${BUBBLE}" fill="${bubble}"/><circle cx="208" cy="224" r="20" fill="${eyes}"/><circle cx="304" cy="224" r="20" fill="${eyes}"/>`,
  );

const grad = (id: string, a: string, b: string, angle = 135) =>
  `<linearGradient id="${id}" gradientTransform="rotate(${angle - 90} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

export const APP_ICONS: AppIcon[] = [
  { id: 'classic', label: 'Clássico', svg: classic('#3ddc97', '#111318', '#3ddc97') },
  { id: 'night', label: 'Noite', svg: classic('#111318', '#3ddc97', '#111318') },
  { id: 'purple', label: 'Roxo', svg: classic('#a78bfa', '#1e1240', '#a78bfa') },
  { id: 'blue', label: 'Azul', svg: classic('#5aa5ff', '#04203f', '#5aa5ff') },
  { id: 'pink', label: 'Rosa', svg: classic('#f472b6', '#3d0a26', '#f472b6') },
  { id: 'minimal', label: 'Minimalista', svg: classic('#ffffff', '#15181e', '#ffffff') },
  { id: 'fire', label: 'Fogo', svg: classic('url(#g)', '#2a0a04', '#ffb547', grad('g', '#ffb547', '#e5384b')) },
  { id: 'gold', label: 'Dourado', svg: classic('url(#g)', '#2b1d00', '#ffe08a', grad('g', '#ffe08a', '#c58b12')) },
  { id: 'ocean', label: 'Oceano', svg: classic('url(#g)', '#03212b', '#7df9ff', grad('g', '#22d3ee', '#1f4fd1')) },
  { id: 'sunset', label: 'Pôr do sol', svg: classic('url(#g)', '#2b1640', '#ffd27a', grad('g', '#fb923c', '#a855f7')) },
  {
    id: 'rainbow',
    label: 'Arco-íris',
    svg: wrap(
      `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f87171"/><stop offset=".25" stop-color="#fbbf24"/><stop offset=".5" stop-color="#34d399"/><stop offset=".75" stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>`,
      `<rect width="512" height="512" rx="112" fill="url(#g)"/><path d="${BUBBLE}" fill="#ffffff"/><circle cx="208" cy="224" r="20" fill="#15181e"/><circle cx="304" cy="224" r="20" fill="#15181e"/>`,
    ),
  },
  {
    id: 'brasil',
    label: 'Verde e amarelo',
    svg: classic('#16a34a', '#facc15', '#1e3a8a'),
  },
  {
    id: 'neon',
    label: 'Neon',
    svg: wrap(
      `<filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
      `<rect width="512" height="512" rx="112" fill="#0b0716"/><g filter="url(#f)"><path d="${BUBBLE}" fill="none" stroke="#ff4fd8" stroke-width="18" stroke-linejoin="round"/><circle cx="208" cy="224" r="20" fill="#4ff3ff"/><circle cx="304" cy="224" r="20" fill="#4ff3ff"/></g>`,
    ),
  },
  {
    id: 'retro',
    label: 'Retrô (pixel)',
    // o balão em "pixels" de 32 px
    svg: wrap(
      '',
      `<rect width="512" height="512" rx="112" fill="#facc15"/>` +
        `<g fill="#1f1300">` +
        `<rect x="160" y="128" width="192" height="32"/><rect x="128" y="160" width="256" height="128"/><rect x="160" y="288" width="192" height="32"/>` +
        `<rect x="192" y="320" width="64" height="32"/><rect x="192" y="352" width="32" height="32"/>` +
        `</g><g fill="#facc15"><rect x="192" y="208" width="32" height="32"/><rect x="288" y="208" width="32" height="32"/></g>`,
    ),
  },
  {
    id: 'christmas',
    label: 'Natal',
    svg: wrap(
      '',
      `<rect width="512" height="512" rx="112" fill="#c42727"/><path d="${BUBBLE}" fill="#ffffff"/>` +
        `<circle cx="208" cy="224" r="20" fill="#c42727"/><circle cx="304" cy="224" r="20" fill="#c42727"/>` +
        // gorrinho (desenho nosso): triângulo verde com pompom branco
        `<path d="M262 136 L404 120 L368 36 Z" fill="#16a34a"/><rect x="250" y="116" width="168" height="30" rx="15" fill="#e8f5ec" transform="rotate(-6 334 131)"/><circle cx="368" cy="36" r="20" fill="#ffffff"/>`,
    ),
  },
  {
    id: 'halloween',
    label: 'Halloween',
    svg: wrap(
      '',
      `<rect width="512" height="512" rx="112" fill="#f97316"/><path d="${BUBBLE}" fill="#1a0b2e"/>` +
        // olhos de "abóbora" (triângulos) e sorriso
        `<path d="M188 238 L208 204 L228 238 Z" fill="#f97316"/><path d="M284 238 L304 204 L324 238 Z" fill="#f97316"/>` +
        `<path d="M196 268 h120 l-12 16 h-16 l-8 -10 l-8 10 h-16 l-8 -10 l-8 10 h-16 l-8 -10 l-8 10 h-12 z" fill="#f97316"/>`,
    ),
  },
];

export const appIconById = (id: string | null | undefined) => APP_ICONS.find((i) => i.id === id) ?? APP_ICONS[0];
