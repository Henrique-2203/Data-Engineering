/** Recursos que existem só dentro do app de desktop (ver desktop/src/preload.js). */

export type DesktopUpdate =
  | { state: 'checking' | 'none' | 'dev' }
  | { state: 'downloading'; version?: string; percent?: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message?: string };

export interface DesktopSettings {
  closeToTray: boolean;
  openAtLogin: boolean;
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
  setSettings(patch: Partial<Pick<DesktopSettings, 'closeToTray' | 'openAtLogin'>>): Promise<DesktopSettings>;
  checkForUpdates(): Promise<DesktopUpdate>;
  installUpdate(): void;
  onUpdate(cb: (u: DesktopUpdate) => void): () => void;
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { resenhaDesktop?: DesktopBridge }).resenhaDesktop ?? null) : null;

export const isDesktop = !!desktop;

/** Onde baixar o app (página de versões públicas). */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/Henrique-2203/Data-Engineering/releases/latest';
