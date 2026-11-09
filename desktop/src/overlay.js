'use strict';
/**
 * Overlay no jogo: uma janela transparente, sempre por cima, que não rouba o foco nem os cliques.
 * Mostra quem está na chamada, quem está falando (contorno verde) e quem tocou som do soundboard.
 *
 * Funciona por cima de jogos em "tela cheia sem bordas" ou janela (o padrão da maioria dos jogos
 * hoje). Em "tela cheia exclusiva" o Windows não deixa nenhuma janela aparecer por cima, como
 * acontece com qualquer overlay que não se injeta dentro do jogo.
 */
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const WIDTH = 280;
const HEIGHT = 460;
const MARGIN = 14;

/** @type {BrowserWindow | null} */
let overlay = null;
let lastState = null;
let config = { enabled: true, position: 'top-left', onlySpeaking: false, opacity: 0.95, showWhen: 'game' };
let hiddenByHotkey = false;
/** a janela do Resenha está na frente (a call já aparece nela: o overlay sai do caminho) */
let appFocused = false;
/** algum jogo reconhecido está aberto (mesma detecção do "Jogando agora") */
let gameOpen = false;

function place() {
  if (!overlay || overlay.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const left = config.position.endsWith('left');
  const top = config.position.startsWith('top');
  overlay.setBounds({
    x: left ? area.x + MARGIN : area.x + area.width - WIDTH - MARGIN,
    y: top ? area.y + MARGIN : area.y + area.height - HEIGHT - MARGIN,
    width: WIDTH,
    height: HEIGHT,
  });
}

function create() {
  overlay = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Resenha overlay',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // nível mais alto possível (acima de jogos em tela cheia sem bordas) e "atravessável" pelo mouse
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true);
  // não aparece em capturas de tela nem na sua transmissão (Windows 10 2004 ou mais novo)
  overlay.setContentProtection(true);
  overlay.on('closed', () => (overlay = null));
  overlay.webContents.on('did-finish-load', () => {
    overlay?.webContents.send('overlay:config', config);
    if (lastState) overlay?.webContents.send('overlay:state', lastState);
  });
  void overlay.loadFile(path.join(__dirname, 'overlay.html'));
  place();
}

function refresh() {
  const shouldShow =
    config.enabled && !hiddenByHotkey && !!lastState?.inCall && !appFocused && (config.showWhen === 'always' || gameOpen);
  if (!shouldShow) {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.hide();
    return;
  }
  if (!overlay || overlay.isDestroyed()) create();
  if (!overlay.isVisible()) overlay.showInactive();
}

module.exports = {
  /** chamado pelo site: { inCall, channel, people: [{ id, name, color, avatar, speaking, muted, deafened, streaming, me }] } */
  setState(state) {
    lastState = state && typeof state === 'object' ? state : null;
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:state', lastState);
    refresh();
  },
  /** soundboard: { name, sound, emoji } */
  event(e) {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.webContents.send('overlay:event', e);
  },
  configure(next) {
    config = { ...config, ...next };
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('overlay:config', config);
      place();
    }
    refresh();
  },
  setAppFocused(focused) {
    appFocused = !!focused;
    refresh();
  },
  setGameOpen(open) {
    gameOpen = !!open;
    refresh();
  },
  /** Ctrl+Shift+O: esconde/mostra durante a partida */
  toggle() {
    hiddenByHotkey = !hiddenByHotkey;
    refresh();
    return !hiddenByHotkey;
  },
  window: () => overlay,
};
