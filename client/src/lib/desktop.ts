/** Recursos que existem só dentro do app de desktop (ver desktop/src/preload.js). */

export type DesktopUpdate =
  | { state: 'checking' | 'none' | 'dev' }
  | { state: 'downloading'; version?: string; percent?: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message?: string };

export interface OverlaySettings {
  enabled: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  onlySpeaking: boolean;
  opacity: number;
  /** 'game' = só com um jogo aberto; 'always' = sempre em call (fora da janela do Resenha) */
  showWhen?: 'game' | 'always';
}

export interface OverlayState {
  inCall: boolean;
  channel: string;
  people: { id: string; name: string; color: string; avatar: string | null; speaking: boolean; muted: boolean; deafened: boolean; streaming: boolean; me: boolean }[];
}

export interface DesktopSettings {
  closeToTray: boolean;
  openAtLogin: boolean;
  /** só existe a partir do app 0.3.0 */
  overlay?: OverlaySettings;
  version: string;
  platform: string;
  update: DesktopUpdate;
}

export type GlobalKeyEvent = { type: 'ptt-down' | 'ptt-up' | 'toggle-mute' | 'toggle-deafen' };

interface DesktopBridge {
  platform: string;
  setGlobalKeys(keys: { ptt: string | null }): void;
  onGlobalKey(cb: (e: GlobalKeyEvent) => void): () => void;
  setTrayState(state: { muted: boolean; deafened: boolean; inCall: boolean }): void;
  onTrayAction(cb: (action: 'toggle-mute' | 'toggle-deafen' | 'leave-call') => void): () => void;
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: Partial<Pick<DesktopSettings, 'closeToTray' | 'openAtLogin'>> & { overlay?: Partial<OverlaySettings> }): Promise<DesktopSettings>;
  checkForUpdates(): Promise<DesktopUpdate>;
  installUpdate(): void;
  onUpdate(cb: (u: DesktopUpdate) => void): () => void;
  /** existem a partir do app 0.2.0 */
  onActivity?(cb: (a: { name: string | null }) => void): () => void;
  getActivity?(): Promise<{ name: string | null }>;
  /** existem a partir do app 0.3.0 (overlay no jogo) */
  setOverlayState?(state: OverlayState): void;
  overlayEvent?(event: { type: 'sound'; id: string; name: string; sound: string; emoji: string | null }): void;
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { resenhaDesktop?: DesktopBridge }).resenhaDesktop ?? null) : null;

export const isDesktop = !!desktop;

/** Onde baixar o app (página de versões públicas). */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/Henrique-2203/Data-Engineering/releases/latest';
