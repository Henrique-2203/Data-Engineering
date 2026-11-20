'use strict';
/**
 * Ponte segura entre o site do Resenha e o app (contextIsolation). O site detecta o app por
 * `window.resenhaDesktop` e usa estes recursos extras; no navegador comum ela não existe.
 */
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, cb) => {
  const handler = (_event, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('resenhaDesktop', {
  platform: process.platform,
  /** quais teclas o hook global deve repassar (só estas, por privacidade) */
  setGlobalKeys: (keys) => ipcRenderer.send('resenha:set-keys', keys),
  /** eventos: { type: 'ptt-down' | 'ptt-up' | 'toggle-mute' | 'toggle-deafen' } */
  onGlobalKey: (cb) => listen('resenha:global-key', cb),
  /** estado mostrado no menu do ícone da bandeja */
  setTrayState: (state) => ipcRenderer.send('resenha:tray-state', state),
  /** ações escolhidas no menu da bandeja: 'toggle-mute' | 'toggle-deafen' | 'leave-call' */
  onTrayAction: (cb) => listen('resenha:tray-action', cb),
  getSettings: () => ipcRenderer.invoke('resenha:get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('resenha:set-settings', patch),
  checkForUpdates: () => ipcRenderer.invoke('resenha:check-updates'),
  installUpdate: () => ipcRenderer.send('resenha:install-update'),
  /** { state: 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'dev', version?, percent?, message? } */
  onUpdate: (cb) => listen('resenha:update', cb),
  /** jogo aberto agora ({ name } ou { name: null }) */
  onActivity: (cb) => listen('resenha:activity', cb),
  getActivity: () => ipcRenderer.invoke('resenha:get-activity'),
  /** música tocando no Spotify do PC ({ track, artist } ou null) (a partir do app 0.3.6) */
  onMusic: (cb) => listen('resenha:music', cb),
  getMusic: () => ipcRenderer.invoke('resenha:get-music'),
  /** troca o ícone do app (a partir do 0.3.7): { id, png: data URL } -> { ok, shortcuts?, error? } */
  setAppIcon: (id, png) => ipcRenderer.invoke('resenha:set-app-icon', { id, png }),
  /** overlay no jogo (a partir do app 0.3.0) */
  setOverlayState: (state) => ipcRenderer.send('resenha:overlay-state', state),
  overlayEvent: (event) => ipcRenderer.send('resenha:overlay-event', event),
  /** estou transmitindo a tela (a partir do app 0.3.5: prioridade de processador e placa de vídeo) */
  setStreaming: (on) => ipcRenderer.send('resenha:streaming', !!on),
  /**
   * som do PC na transmissão SEM o Resenha (a partir do 0.3.9): PCM 16 bits, 48 kHz, estéreo.
   * status() -> { active, lastError }; onData(cb) recebe os pedaços (Uint8Array); stop() para.
   */
  sysAudio: {
    status: () => ipcRenderer.invoke('resenha:sysaudio-status'),
    onData: (cb) => listen('resenha:sysaudio', cb),
    stop: () => ipcRenderer.send('resenha:sysaudio-stop'),
  },
});
