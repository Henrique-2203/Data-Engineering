'use strict';
// Ponte do overlay: ele só RECEBE o estado da chamada (não tem acesso a nada além disso).
const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));
contextBridge.exposeInMainWorld('overlay', {
  onState: (cb) => listen('overlay:state', cb),
  onConfig: (cb) => listen('overlay:config', cb),
  onEvent: (cb) => listen('overlay:event', cb),
});
