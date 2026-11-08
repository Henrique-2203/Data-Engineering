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
});
