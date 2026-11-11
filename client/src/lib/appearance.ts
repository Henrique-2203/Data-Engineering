import { create } from 'zustand';

/**
 * Aparência do Resenha: modo (escuro, claro ou seguir o sistema), cor de destaque, fundo e papel de
 * parede do chat. Tudo fica NESTE aparelho (nada vai para o servidor); a foto do papel de parede fica
 * guardada no próprio navegador (IndexedDB) e ninguém mais vê.
 */
export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentId = 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'red' | 'cyan' | 'yellow';
export type DarkBg = 'default' | 'midnight' | 'black';

export interface WallpaperChoice {
  /** 'none' | id da biblioteca | 'color' | 'photo' */
  kind: 'none' | 'library' | 'color' | 'photo';
  id?: string;
  color?: string;
  /** escurecer (no escuro) / clarear (no claro) por cima do papel de parede, 0..0.9 */
  dim: number;
  /** desfoque da foto, em px */
  blur: number;
}

export interface Appearance {
  mode: ThemeMode;
  accent: AccentId;
  bg: DarkBg;
  /** papel de parede de todos os chats */
  wallpaper: WallpaperChoice;
}

export const ACCENTS: { id: AccentId; label: string; dark: [string, string]; light: [string, string] }[] = [
  // [cor, cor do texto em cima dela]
  { id: 'green', label: 'Verde Resenha', dark: ['#3ddc97', '#06281a'], light: ['#0f8a57', '#ffffff'] },
  { id: 'blue', label: 'Azul', dark: ['#5aa5ff', '#04203f'], light: ['#1f66d1', '#ffffff'] },
  { id: 'purple', label: 'Roxo', dark: ['#a78bfa', '#1e1240'], light: ['#6d3fd9', '#ffffff'] },
  { id: 'pink', label: 'Rosa', dark: ['#f472b6', '#3d0a26'], light: ['#c71f6f', '#ffffff'] },
  { id: 'orange', label: 'Laranja', dark: ['#fb923c', '#3a1a04'], light: ['#c2510c', '#ffffff'] },
  { id: 'red', label: 'Vermelho', dark: ['#f87171', '#3d0a0a'], light: ['#c42727', '#ffffff'] },
  { id: 'cyan', label: 'Ciano', dark: ['#22d3ee', '#032a33'], light: ['#0a7c94', '#ffffff'] },
  { id: 'yellow', label: 'Amarelo', dark: ['#facc15', '#3a2e02'], light: ['#8a6a00', '#ffffff'] },
];

export const DARK_BGS: { id: DarkBg; label: string; hint: string; swatch: string }[] = [
  { id: 'default', label: 'Padrão', hint: 'O cinza-escuro do Resenha.', swatch: '#171a21' },
  { id: 'midnight', label: 'Meia-noite', hint: 'Escuro azulado.', swatch: '#111a2e' },
  { id: 'black', label: 'Preto total', hint: 'Preto de verdade: economiza bateria em telas OLED.', swatch: '#000000' },
];

export const NO_WALLPAPER: WallpaperChoice = { kind: 'none', dim: 0.55, blur: 0 };

const DEFAULTS: Appearance = { mode: 'dark', accent: 'green', bg: 'default', wallpaper: NO_WALLPAPER };
const KEY = 'resenha.appearance';
const PER_CHAT_KEY = 'resenha.wallpapers';

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: vale só até fechar */
  }
};

const isAccent = (v: unknown): v is AccentId => ACCENTS.some((a) => a.id === v);
const sane = (a: Appearance): Appearance => ({
  mode: a.mode === 'light' || a.mode === 'system' ? a.mode : 'dark',
  accent: isAccent(a.accent) ? a.accent : 'green',
  bg: a.bg === 'midnight' || a.bg === 'black' ? a.bg : 'default',
  wallpaper: saneWallpaper(a.wallpaper),
});
function saneWallpaper(w: Partial<WallpaperChoice> | undefined): WallpaperChoice {
  if (!w || !['none', 'library', 'color', 'photo'].includes(w.kind as string)) return NO_WALLPAPER;
  return {
    kind: w.kind as WallpaperChoice['kind'],
    id: typeof w.id === 'string' ? w.id.slice(0, 40) : undefined,
    color: typeof w.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : undefined,
    dim: Math.min(0.9, Math.max(0, Number(w.dim ?? 0.55) || 0)),
    blur: Math.min(30, Math.max(0, Number(w.blur ?? 0) || 0)),
  };
}

interface Store extends Appearance {
  /** modo de fato em uso (o "sistema" resolvido) */
  resolved: 'dark' | 'light';
  /** papel de parede escolhido só para uma conversa: channelId -> escolha */
  perChat: Record<string, WallpaperChoice>;
  /** a foto mudou (para recarregar as imagens) */
  photoVersion: number;
}

const systemDark = () => typeof matchMedia === 'undefined' || matchMedia('(prefers-color-scheme: dark)').matches;
const resolve = (mode: ThemeMode) => (mode === 'system' ? (systemDark() ? 'dark' : 'light') : mode);

const initial = sane(read(KEY, DEFAULTS));
export const useAppearance = create<Store>(() => ({
  ...initial,
  resolved: resolve(initial.mode),
  perChat: (() => {
    const raw = read<Record<string, WallpaperChoice>>(PER_CHAT_KEY, {});
    const out: Record<string, WallpaperChoice> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 500)) out[k] = saneWallpaper(v);
    return out;
  })(),
  photoVersion: 0,
}));

export function setAppearance(patch: Partial<Appearance>) {
  const s = useAppearance.getState();
  const next = sane({ mode: s.mode, accent: s.accent, bg: s.bg, wallpaper: s.wallpaper, ...patch });
  useAppearance.setState({ ...next, resolved: resolve(next.mode) });
  write(KEY, next);
  applyAppearance();
}

/** Papel de parede só desta conversa (null = usar o de todos os chats). */
export function setChatWallpaper(channelId: string, w: WallpaperChoice | null) {
  const perChat = { ...useAppearance.getState().perChat };
  if (w) perChat[channelId] = saneWallpaper(w);
  else delete perChat[channelId];
  useAppearance.setState({ perChat });
  write(PER_CHAT_KEY, perChat);
  if (!w) void deletePhoto(channelId);
}

/** Aplica no documento: modo, fundo e cor de destaque (chamar antes de desenhar a tela). */
export function applyAppearance() {
  const s = useAppearance.getState();
  const root = document.documentElement;
  const mode = resolve(s.mode);
  if (s.resolved !== mode) useAppearance.setState({ resolved: mode });
  root.dataset.theme = mode;
  root.dataset.bg = mode === 'dark' ? s.bg : 'default';
  const accent = ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0];
  const [color, ink] = mode === 'light' ? accent.light : accent.dark;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-ink', ink);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${color} ${mode === 'light' ? 12 : 14}%, transparent)`);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg-1').trim() || '#111318');
}

let watching = false;
/** Começa a acompanhar o sistema (quando o modo é "seguir o sistema"). */
export function initAppearance() {
  applyAppearance();
  if (watching || typeof matchMedia === 'undefined') return;
  watching = true;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useAppearance.getState().mode === 'system') applyAppearance();
  });
}

// ======================================================================
// Biblioteca de papéis de parede (desenhos nossos, leves: SVG e gradientes)
// ======================================================================

const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

interface WallpaperDef {
  id: string;
  label: string;
  /** fundo CSS para o modo (escuro/claro) e a cor de destaque atual */
  css(mode: 'dark' | 'light', accent: string): string;
}

const ink = (mode: 'dark' | 'light', a = 0.12) => (mode === 'dark' ? `rgba(255,255,255,${a})` : `rgba(20,23,29,${a})`);

export const WALLPAPERS: WallpaperDef[] = [
  {
    id: 'dots',
    label: 'Pontinhos',
    css: (m, a) => `${svg(`<circle cx='12' cy='12' r='1.6' fill='${a}' fill-opacity='0.35'/>`, 24, 24)}`,
  },
  {
    id: 'grid',
    label: 'Grade',
    css: (m) => `${svg(`<path d='M32 0H0V32' fill='none' stroke='${ink(m, 0.09)}' stroke-width='1'/>`, 32, 32)}`,
  },
  {
    id: 'waves',
    label: 'Ondas',
    css: (m, a) =>
      `${svg(`<path d='M0 20 Q 15 8 30 20 T 60 20' fill='none' stroke='${a}' stroke-opacity='0.25' stroke-width='2'/><path d='M0 44 Q 15 32 30 44 T 60 44' fill='none' stroke='${ink(m, 0.1)}' stroke-width='2'/>`, 60, 48)}`,
  },
  {
    id: 'hex',
    label: 'Hexágonos',
    css: (m) =>
      `${svg(`<path d='M14 1 L27 8.5 V23.5 L14 31 L1 23.5 V8.5 Z' fill='none' stroke='${ink(m, 0.1)}' stroke-width='1.2'/>`, 28, 32)}`,
  },
  {
    id: 'confetti',
    label: 'Confete',
    css: (m, a) =>
      `${svg(
        `<rect x='8' y='10' width='6' height='3' rx='1.5' fill='${a}' fill-opacity='0.45' transform='rotate(30 11 11)'/>` +
          `<circle cx='46' cy='18' r='2.5' fill='#f472b6' fill-opacity='0.4'/>` +
          `<rect x='30' y='44' width='7' height='3' rx='1.5' fill='#5aa5ff' fill-opacity='0.4' transform='rotate(-25 33 45)'/>` +
          `<circle cx='12' cy='52' r='2' fill='#facc15' fill-opacity='0.45'/>` +
          `<path d='M52 50 l3 -6 l3 6 z' fill='${ink(m, 0.18)}'/>`,
        64,
        64,
      )}`,
  },
  {
    id: 'gamer',
    label: 'Doodles gamer',
    // desenhos simples nossos: controle, estrela, cruz direcional, botões e coração
    css: (m, a) => {
      const c = ink(m, 0.13);
      return `${svg(
        `<g fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>` +
          `<path d='M14 30 h22 a8 8 0 0 1 8 8 v2 a5 5 0 0 1 -9 3 l-3 -4 h-14 l-3 4 a5 5 0 0 1 -9 -3 v-2 a8 8 0 0 1 8 -8 z'/>` +
          `<path d='M19 35 v6 M16 38 h6'/>` +
          `<path d='M78 14 l3 6 6 1 -4.5 4 1 6 -5.5 -3 -5.5 3 1 -6 -4.5 -4 6 -1 z'/>` +
          `<path d='M72 64 h6 v-6 h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 z'/>` +
          `<path d='M30 78 c-4 -6 -12 -2 -8 5 l8 7 8 -7 c4 -7 -4 -11 -8 -5 z'/>` +
          `</g>` +
          `<circle cx='34' cy='37' r='1.8' fill='${a}' fill-opacity='0.5'/><circle cx='38' cy='34' r='1.8' fill='${a}' fill-opacity='0.5'/>`,
        100,
        100,
      )}`;
    },
  },
  {
    id: 'stars',
    label: 'Estrelas',
    css: (m) =>
      `${svg(
        `<circle cx='10' cy='14' r='1' fill='${ink(m, 0.5)}'/><circle cx='60' cy='8' r='1.4' fill='${ink(m, 0.35)}'/>` +
          `<circle cx='34' cy='40' r='0.8' fill='${ink(m, 0.5)}'/><circle cx='80' cy='52' r='1.2' fill='${ink(m, 0.4)}'/>` +
          `<circle cx='18' cy='72' r='1.4' fill='${ink(m, 0.3)}'/><circle cx='54' cy='84' r='0.9' fill='${ink(m, 0.5)}'/>` +
          `<path d='M70 26 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1 z' fill='${ink(m, 0.45)}'/>`,
        96,
        96,
      )}, ${m === 'dark' ? 'radial-gradient(1200px 800px at 80% 0%, rgba(90,120,255,0.18), transparent)' : 'radial-gradient(1200px 800px at 80% 0%, rgba(90,120,255,0.12), transparent)'}`,
  },
  {
    id: 'neon',
    label: 'Neon',
    css: (m, a) =>
      `repeating-linear-gradient(135deg, transparent 0 22px, color-mix(in srgb, ${a} ${m === 'dark' ? 16 : 12}%, transparent) 22px 24px), ` +
      `radial-gradient(900px 600px at 0% 100%, color-mix(in srgb, #a78bfa 22%, transparent), transparent)`,
  },
  {
    id: 'aurora',
    label: 'Aurora',
    css: (m, a) =>
      `radial-gradient(900px 500px at 15% 10%, color-mix(in srgb, ${a} ${m === 'dark' ? 30 : 22}%, transparent), transparent), ` +
      `radial-gradient(800px 600px at 90% 30%, color-mix(in srgb, #a78bfa ${m === 'dark' ? 28 : 20}%, transparent), transparent), ` +
      `radial-gradient(900px 600px at 50% 110%, color-mix(in srgb, #22d3ee ${m === 'dark' ? 24 : 18}%, transparent), transparent)`,
  },
  {
    id: 'sunset',
    label: 'Pôr do sol',
    css: (m) =>
      m === 'dark'
        ? 'linear-gradient(160deg, #2b1640 0%, #5a1f3d 45%, #8a3a1f 100%)'
        : 'linear-gradient(160deg, #ffe1c7 0%, #ffc6d6 50%, #e7d2ff 100%)',
  },
  {
    id: 'ocean',
    label: 'Oceano',
    css: (m) =>
      m === 'dark'
        ? 'linear-gradient(180deg, #06223a 0%, #0b3a5c 55%, #0f5a6e 100%)'
        : 'linear-gradient(180deg, #d9f0ff 0%, #c4e6f5 55%, #c9f2ea 100%)',
  },
  {
    id: 'forest',
    label: 'Floresta',
    css: (m) =>
      m === 'dark'
        ? 'linear-gradient(170deg, #0d2418 0%, #12301f 50%, #1d3b22 100%)'
        : 'linear-gradient(170deg, #e3f5e6 0%, #d2edd9 50%, #e9f3d4 100%)',
  },
];

// ======================================================================
// Foto própria (só neste aparelho)
// ======================================================================

const DB = 'resenha-local';
const STORE = 'wallpapers';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** chave da foto: 'global' (todos os chats) ou o id da conversa */
export async function loadPhoto(key: string): Promise<Blob | null> {
  try {
    return ((await tx('readonly', (s) => s.get(key))) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}
export async function deletePhoto(key: string) {
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    /* nada guardado */
  }
}

/**
 * Guarda a foto escolhida: diminuída para no máximo 1920 px e regravada em JPEG (isso também tira
 * os dados escondidos da foto, como o local onde ela foi tirada).
 */
export async function savePhoto(key: string, file: File): Promise<void> {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) throw new Error('Escolha uma imagem (JPG, PNG ou WebP).');
  if (file.size > 25 * 1024 * 1024) throw new Error('Imagem grande demais (máximo 25 MB).');
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('Não deu para abrir essa imagem.');
  });
  const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Não deu para preparar a imagem.');
  await tx('readwrite', (s) => s.put(blob, key));
  useAppearance.setState((st) => ({ photoVersion: st.photoVersion + 1 }));
}
