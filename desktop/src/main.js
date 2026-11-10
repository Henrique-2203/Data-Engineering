'use strict';
/**
 * App de desktop do Resenha.
 *
 * É uma "casca" que abre o Resenha hospedado (o mesmo do navegador), então novidades do site
 * chegam aqui na hora, sem reinstalar. O app acrescenta o que o navegador não consegue:
 *  - atalhos globais (push-to-talk, silenciar) que funcionam com o jogo em primeiro plano;
 *  - transmissão sem os freios de segundo plano do navegador e usando a placa de vídeo dedicada;
 *  - seletor de tela/janela com áudio do computador;
 *  - ícone na bandeja e atualização automática da própria casca.
 */
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, Notification, session, shell } = require('electron');
const settings = require('./settings');
const { buildKeymap, MOUSE } = require('./keymap');
const { watchGames } = require('./games');
const { watchMusic } = require('./music');
const overlay = require('./overlay');
const { setGpuPriority } = require('./gpuPriority');

const DEFAULT_URL = 'https://resenha-m2bt.onrender.com';
const argUrl = process.argv.find((a) => a.startsWith('--url='))?.slice(6);
const APP_URL = (argUrl || process.env.RESENHA_URL || DEFAULT_URL).replace(/\/$/, '');
const APP_ORIGIN = new URL(APP_URL).origin;
const START_HIDDEN = process.argv.includes('--hidden');
// perfil separado (desenvolvimento/testes): --profile=C:\caminho
const argProfile = process.argv.find((a) => a.startsWith('--profile='))?.slice(10);
if (argProfile) app.setPath('userData', path.resolve(argProfile));
const ICON = path.join(__dirname, 'assets', 'icon.png');

// ---------- sem freios: o navegador reduz o ritmo de janelas em segundo plano/escondidas ----------
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// notebooks com duas placas: usa a dedicada (a mesma do jogo) para capturar e codificar
app.commandLine.appendSwitch('force_high_performance_gpu');
// captura moderna do Windows (Windows Graphics Capture) para tela e janelas de jogos e
// H.264 codificado pela placa de vídeo também no perfil que o WebRTC usa (sem isso, o H.264 pode
// cair no processador e roubar FPS do jogo)
app.commandLine.appendSwitch(
  'enable-features',
  'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer,MediaFoundationH264CbpEncoding,MediaFoundationVideoEncodeAccelerator',
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('app.resenha.desktop');

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
let trayState = { muted: false, deafened: false, inCall: false };
let updateState = { state: app.isPackaged ? 'none' : 'dev' };

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- janela principal ----------

async function waitForServer() {
  // o Render grátis "dorme": o primeiro acesso pode levar ~1 min para acordar
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return;
    } catch {
      /* ainda acordando ou sem internet */
    }
    const secs = Math.round((Date.now() - started) / 1000);
    const detail =
      secs < 90
        ? `Acordando o servidor (${secs}s). No plano gratuito ele dorme quando ninguém usa; leva até 1 minuto.`
        : 'O servidor não respondeu. Confira sua internet; continuamos tentando.';
    win?.webContents.executeJavaScript(`setStatus(${JSON.stringify('Conectando…')}, ${JSON.stringify(detail)})`).catch(() => {});
    await new Promise((r) => setTimeout(r, attempt < 3 ? 1000 : 3000));
  }
}

function createWindow() {
  const s = settings.load();
  win = new BrowserWindow({
    width: s.bounds?.width ?? 1280,
    height: s.bounds?.height ?? 800,
    x: s.bounds?.x,
    y: s.bounds?.y,
    minWidth: 380,
    minHeight: 500,
    show: false,
    backgroundColor: '#111318',
    title: 'Resenha',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });
  win.setMenuBarVisibility(false);
  if (s.bounds?.maximized) win.maximize();

  win.once('ready-to-show', () => {
    if (!START_HIDDEN) win.show();
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    settings.save({ bounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  // fechar = esconder na bandeja (a chamada continua); "Sair" no menu da bandeja encerra
  win.on('close', (e) => {
    if (!quitting && settings.load().closeToTray) {
      e.preventDefault();
      win.hide();
      if (!settings.load().trayHintShown && Notification.isSupported()) {
        new Notification({ title: 'Resenha continua aberto', body: 'Ele fica no ícone perto do relógio. Use "Sair" lá para fechar de vez.', icon: ICON }).show();
        settings.save({ trayHintShown: true });
      }
    }
  });

  // links externos abrem no navegador; navegação fica restrita ao Resenha
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  // se a conexão cair no carregamento, volta para a tela de espera e tenta de novo
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    console.log(`[boot] did-fail-load code=${code} ${desc} main=${isMainFrame} ${url}`);
    if (isMainFrame && url.startsWith(APP_ORIGIN) && code !== -3) void boot();
  });

  void boot();
}

async function boot() {
  if (!win) return;
  console.log('[boot] carregando tela de espera');
  await win.loadFile(path.join(__dirname, 'splash.html'));
  await waitForServer();
  await win.loadURL(APP_URL);
}

// ---------- permissões e seletor de tela ----------

function setupSession() {
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture']);
  const trusted = (url) => {
    try {
      return new URL(url).origin === APP_ORIGIN;
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(trusted(wc.getURL()) && allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => !!wc && trusted(wc.getURL()) && allowed.has(permission));

  // getDisplayMedia() do site abre o nosso seletor de tela/janela
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const choice = await openPicker();
      if (!choice) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === choice.id);
      if (!source) return callback({});
      // 'loopback' = áudio do sistema (só no Windows)
      callback({ video: source, ...(choice.audio && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    } catch (err) {
      console.error('[picker]', err);
      callback({});
    }
  });
}

/** @returns {Promise<{id: string, audio: boolean} | null>} */
function openPicker() {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: win ?? undefined,
      modal: !!win,
      width: 820,
      height: 600,
      minWidth: 520,
      minHeight: 400,
      title: 'Escolha o que transmitir',
      backgroundColor: '#111318',
      icon: ICON,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    picker.setMenuBarVisibility(false);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler('picker:sources');
      ipcMain.removeAllListeners('picker:choose');
      ipcMain.removeAllListeners('picker:cancel');
      if (!picker.isDestroyed()) picker.close();
      resolve(value);
    };
    ipcMain.handle('picker:sources', async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 400, height: 225 },
        fetchWindowIcons: true,
      });
      const list = sources
        .filter((s) => s.name !== 'Resenha' && s.name !== 'Escolha o que transmitir' && s.name !== 'Resenha overlay')
        .map((s) => ({
          id: s.id,
          name: s.id.startsWith('screen') ? (s.name === 'Entire screen' || s.name === 'Entire Screen' ? 'Tela inteira' : s.name) : s.name,
          type: s.id.startsWith('screen') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
          icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }));
      // jogo aberto (mesma detecção do "Jogando agora") que NÃO aparece entre as janelas:
      // quase sempre é tela cheia exclusiva, que o Windows minimiza quando você sai do jogo
      const game = gameWatcher?.current() ?? null;
      const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
      const gameMissing = !!game && !list.some((s) => s.type === 'window' && norm(s.name).includes(norm(game)));
      return { sources: list, game, gameMissing };
    });
    ipcMain.once('picker:choose', (_e, choice) => finish(choice));
    ipcMain.once('picker:cancel', () => finish(null));
    picker.on('closed', () => finish(null));
    void picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

// ---------- atalhos globais (funcionam com o jogo em primeiro plano) ----------

let watchedPtt = null;
let pttDown = false;

function setupGlobalHook() {
  let hook;
  try {
    hook = require('uiohook-napi');
  } catch (err) {
    console.warn('[atalhos] hook global indisponível:', err.message);
    return;
  }
  const { uIOhook, UiohookKey } = hook;
  const keymap = buildKeymap(UiohookKey);

  const pressPtt = (down) => {
    if (down === pttDown) return; // ignora a repetição automática da tecla segurada
    pttDown = down;
    send('resenha:global-key', { type: down ? 'ptt-down' : 'ptt-up' });
  };

  uIOhook.on('keydown', (e) => {
    const code = keymap.get(e.keycode);
    if (!code) return;
    // só repassa as teclas configuradas (nada de "keylogger")
    if (code === watchedPtt) return pressPtt(true);
    if (e.ctrlKey && e.shiftKey && !e.altKey && code === 'KeyM') send('resenha:global-key', { type: 'toggle-mute' });
    if (e.ctrlKey && e.shiftKey && !e.altKey && code === 'KeyD') send('resenha:global-key', { type: 'toggle-deafen' });
  });
  uIOhook.on('keyup', (e) => {
    if (keymap.get(e.keycode) === watchedPtt) pressPtt(false);
  });
  uIOhook.on('mousedown', (e) => {
    if (MOUSE[e.button] && MOUSE[e.button] === watchedPtt) pressPtt(true);
  });
  uIOhook.on('mouseup', (e) => {
    if (MOUSE[e.button] && MOUSE[e.button] === watchedPtt) pressPtt(false);
  });

  try {
    uIOhook.start();
    app.on('will-quit', () => uIOhook.stop());
  } catch (err) {
    console.warn('[atalhos] não foi possível iniciar o hook global:', err.message);
  }
}

// ---------- bandeja ----------

function trayIcon() {
  const img = nativeImage.createFromPath(ICON);
  return img.isEmpty() ? img : img.resize({ width: process.platform === 'win32' ? 16 : 22 });
}

function buildTrayMenu() {
  if (!tray) return;
  const s = settings.load();
  const update =
    updateState.state === 'ready'
      ? [{ label: `Reiniciar e atualizar (v${updateState.version})`, click: () => installUpdate() }]
      : [{ label: 'Procurar atualizações', enabled: app.isPackaged, click: () => void checkForUpdates(true) }];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Resenha', click: showWindow },
      { type: 'separator' },
      { label: 'Silenciar microfone', type: 'checkbox', checked: trayState.muted, click: () => send('resenha:tray-action', 'toggle-mute') },
      { label: 'Desativar áudio', type: 'checkbox', checked: trayState.deafened, click: () => send('resenha:tray-action', 'toggle-deafen') },
      { label: 'Sair da chamada', enabled: trayState.inCall, click: () => send('resenha:tray-action', 'leave-call') },
      { type: 'separator' },
      { label: 'Abrir junto com o Windows', type: 'checkbox', checked: s.openAtLogin, click: (i) => applySettings({ openAtLogin: i.checked }) },
      { label: 'Fechar para a bandeja', type: 'checkbox', checked: s.closeToTray, click: (i) => applySettings({ closeToTray: i.checked }) },
      ...update,
      { type: 'separator' },
      { label: `Resenha v${app.getVersion()}`, enabled: false },
      {
        label: 'Sair',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.setToolTip(trayState.inCall ? `Resenha — em chamada${trayState.muted ? ' (silenciado)' : ''}` : 'Resenha');
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  buildTrayMenu();
}

function applySettings(patch) {
  const s = settings.save(patch);
  if ('openAtLogin' in patch && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.openAtLogin, args: ['--hidden'] });
  }
  buildTrayMenu();
  return publicSettings();
}

const publicSettings = () => {
  const s = settings.load();
  return {
    closeToTray: s.closeToTray,
    openAtLogin: s.openAtLogin,
    overlay: { showWhen: 'game', ...settings.load().overlay },
    gamePriority: s.gamePriority !== false,
    version: app.getVersion(),
    platform: process.platform,
    update: updateState,
  };
};

// ---------- atualização automática (da casca; o site se atualiza sozinho) ----------

let autoUpdater = null;

function setUpdate(state) {
  updateState = state;
  send('resenha:update', state);
  buildTrayMenu();
}

function setupUpdater() {
  if (!app.isPackaged) return;
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => setUpdate({ ...updateState, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    setUpdate({ state: 'ready', version: i.version });
    notifyUpdateWhenFree(i.version);
  });
  autoUpdater.on('error', (err) => setUpdate({ state: 'error', message: String(err?.message ?? err).slice(0, 200) }));
  setTimeout(() => void checkForUpdates(false), 10_000);
  setInterval(() => void checkForUpdates(false), 4 * 3600_000);
}

async function checkForUpdates(manual) {
  if (!autoUpdater) return updateState;
  if (updateState.state === 'downloading' || updateState.state === 'ready') return updateState;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setUpdate({ state: 'error', message: String(err?.message ?? err).slice(0, 200) });
  }
  if (manual) showWindow();
  return updateState;
}

/**
 * Aviso de atualização pronta: nunca no meio do jogo ou da call (a notificação do Windows aparece
 * por cima do jogo). Espera os dois acabarem; a atualização entra quando você fechar o app.
 */
function notifyUpdateWhenFree(version) {
  const busy = () => !!gameWatcher?.current() || trayState.inCall;
  const show = () => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: 'Atualização do Resenha pronta', body: `Versão ${version}. Reinicie quando quiser (ou ela entra na próxima vez que abrir).`, icon: ICON });
    n.on('click', showWindow);
    n.show();
  };
  if (!busy()) return show();
  const t = setInterval(() => {
    if (busy()) return;
    clearInterval(t);
    show();
  }, 30_000);
}

function installUpdate() {
  if (updateState.state !== 'ready' || !autoUpdater) return;
  quitting = true;
  autoUpdater.quitAndInstall(true, true);
}

// ---------- comunicação com o site ----------

ipcMain.on('resenha:set-keys', (_e, keys) => {
  const next = typeof keys?.ptt === 'string' ? keys.ptt : null;
  if (next !== watchedPtt && pttDown) {
    pttDown = false;
    send('resenha:global-key', { type: 'ptt-up' });
  }
  watchedPtt = next;
});
ipcMain.on('resenha:tray-state', (_e, state) => {
  trayState = { muted: !!state?.muted, deafened: !!state?.deafened, inCall: !!state?.inCall };
  buildTrayMenu();
});
ipcMain.handle('resenha:get-settings', () => publicSettings());
ipcMain.handle('resenha:set-settings', (_e, patch) => {
  const clean = {};
  if (typeof patch?.closeToTray === 'boolean') clean.closeToTray = patch.closeToTray;
  if (typeof patch?.openAtLogin === 'boolean') clean.openAtLogin = patch.openAtLogin;
  if (typeof patch?.gamePriority === 'boolean') {
    clean.gamePriority = patch.gamePriority;
    setTimeout(applyPriority, 0);
  }
  if (patch?.overlay && typeof patch.overlay === 'object') {
    const o = patch.overlay;
    const next = { ...settings.load().overlay };
    if (typeof o.enabled === 'boolean') next.enabled = o.enabled;
    if (typeof o.onlySpeaking === 'boolean') next.onlySpeaking = o.onlySpeaking;
    if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(o.position)) next.position = o.position;
    if (typeof o.opacity === 'number' && o.opacity >= 0.3 && o.opacity <= 1) next.opacity = o.opacity;
    if (o.showWhen === 'game' || o.showWhen === 'always') next.showWhen = o.showWhen;
    clean.overlay = next;
    overlay.configure(next);
  }
  return applySettings(clean);
});

// ---------- overlay no jogo ----------

const fromMainWindow = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;
const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
ipcMain.on('resenha:overlay-state', (e, s) => {
  if (!fromMainWindow(e)) return;
  // só passa o que o overlay precisa (e fotos só do próprio Resenha)
  const people = Array.isArray(s?.people)
    ? s.people.slice(0, 25).map((p) => ({
        id: str(p?.id),
        name: str(p?.name, 40) || 'Alguém',
        color: /^#[0-9a-f]{3,8}$/i.test(p?.color ?? '') ? p.color : '#555',
        avatar: typeof p?.avatar === 'string' && p.avatar.startsWith(`${APP_ORIGIN}/api/images/`) ? p.avatar.slice(0, 200) : null,
        speaking: !!p?.speaking,
        muted: !!p?.muted,
        deafened: !!p?.deafened,
        streaming: !!p?.streaming,
        me: !!p?.me,
      }))
    : [];
  overlay.setState({ inCall: !!s?.inCall, channel: str(s?.channel, 40), people });
});
ipcMain.on('resenha:overlay-event', (e, ev) => {
  if (!fromMainWindow(e) || ev?.type !== 'sound') return;
  overlay.event({ type: 'sound', id: str(ev.id), name: str(ev.name, 40), sound: str(ev.sound, 40), emoji: str(ev.emoji, 16) });
});
ipcMain.handle('resenha:check-updates', () => checkForUpdates(true));
ipcMain.on('resenha:install-update', () => installUpdate());

// ---------- ciclo de vida ----------

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', showWindow);

// ---------- "Jogando agora" ----------

let gameWatcher = null;
function setupGameWatcher() {
  const intervalMs = Number(process.env.RESENHA_GAME_INTERVAL_MS) || 15_000;
  gameWatcher = watchGames((game) => {
    send('resenha:activity', { name: game });
    overlay.setGameOpen(!!game);
    applyPriority();
  }, intervalMs);
  overlay.setGameOpen(!!gameWatcher.current());
  applyPriority();
  // processos novos (a página recarregou, o da placa de vídeo reiniciou) também ficam atrás do jogo
  win?.webContents.on('did-finish-load', applyPriority);
  setInterval(applyPriority, 10_000).unref();
  // a página recarregou (ou abriu agora): manda o jogo atual de novo
  win?.webContents.on('did-finish-load', () => send('resenha:activity', { name: gameWatcher?.current() ?? null }));
  app.on('will-quit', () => gameWatcher?.stop());
}
ipcMain.handle('resenha:get-activity', () => ({ name: gameWatcher?.current() ?? null }));

// ---------- "Ouvindo agora" (Spotify do PC) ----------

let musicWatcher = null;
function setupMusicWatcher() {
  const intervalMs = Number(process.env.RESENHA_MUSIC_INTERVAL_MS) || 10_000;
  musicWatcher = watchMusic((music) => send('resenha:music', music), intervalMs);
  win?.webContents.on('did-finish-load', () => send('resenha:music', musicWatcher?.current() ?? null));
  app.on('will-quit', () => musicWatcher?.stop());
}
ipcMain.handle('resenha:get-music', () => musicWatcher?.current() ?? null);

// ---------- prioridades (processador e placa de vídeo) ----------
// Jogando SEM transmitir: o Resenha fica "abaixo do normal" no processador (o jogo primeiro).
// Jogando E transmitindo: a captura da tela, a codificação e a página ficam "acima do normal" no
// processador e com prioridade ALTA na placa de vídeo (como o OBS). Elas usam pouco, mas precisam ser
// atendidas na hora; senão o jogo ocupa tudo e o FPS da transmissão despenca.
let streaming = false;
let priorityMode = 'normal';
function applyPriority() {
  const game = !!gameWatcher?.current();
  const mode = streaming ? 'stream' : game && settings.load().gamePriority !== false ? 'game' : 'normal';
  if (mode === 'normal' && priorityMode === 'normal') return;
  const P = os.constants.priority;
  for (const m of app.getAppMetrics()) {
    const critical = m.type === 'GPU' || m.type === 'Tab' || m.type === 'Utility';
    let cpu = P.PRIORITY_NORMAL;
    if (mode === 'game') cpu = P.PRIORITY_BELOW_NORMAL;
    if (mode === 'stream' && critical) cpu = P.PRIORITY_ABOVE_NORMAL;
    try {
      os.setPriority(m.pid, cpu);
    } catch {
      /* processo já fechou */
    }
    if (process.platform === 'win32') setGpuPriority(m.pid, mode === 'stream' && critical ? 'high' : 'normal');
  }
  priorityMode = mode;
}
ipcMain.on('resenha:streaming', (e, on) => {
  if (!fromMainWindow(e)) return;
  streaming = !!on;
  applyPriority();
});

app.whenReady().then(() => {
  setupSession();
  createWindow();
  overlay.configure({ showWhen: 'game', ...settings.load().overlay });
  // com a janela do Resenha na frente, o overlay sai do caminho
  win.on('focus', () => overlay.setAppFocused(true));
  win.on('blur', () => overlay.setAppFocused(false));
  win.on('hide', () => overlay.setAppFocused(false));
  win.on('minimize', () => overlay.setAppFocused(false));
  overlay.setAppFocused(win.isFocused());
  // Ctrl+Shift+O: esconde/mostra o overlay no meio da partida
  globalShortcut.register('CommandOrControl+Shift+O', () => overlay.toggle());
  app.on('will-quit', () => globalShortcut.unregisterAll());
  createTray();
  setupGlobalHook();
  setupUpdater();
  setupGameWatcher();
  setupMusicWatcher();
});
