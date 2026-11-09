// Teste do app de desktop (Electron) numa tela virtual (Linux/Xvfb):
// ponte com o site, push-to-talk global (tecla simulada no sistema, fora da página),
// atalho global de silenciar, seletor de tela e "fechar para a bandeja".
// Uso: npm run build && (cd desktop && npm install) && xvfb-run -a node e2e/desktop.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const desktopRequire = createRequire(path.resolve('desktop/package.json'));
const { uIOhook, UiohookKey } = desktopRequire('uiohook-napi');

const PORT = 3131;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-desktop-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let app;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana' });
  await api('/guilds', { name: 'Galera' }, ana.token);

  // "jogo" de teste: um processo qualquer que o app vai reconhecer pelo nome
  const fakeGame = spawn('sleep', ['300'], { stdio: 'ignore' });
  process.on('exit', () => fakeGame.kill());

  app = await electron.launch({
    executablePath: path.resolve('desktop/node_modules/electron/dist/electron'),
    args: [
      path.resolve('desktop'),
      `--url=${BASE}`,
      `--profile=${mkdtempSync(path.join(tmpdir(), 'resenha-profile-'))}`, // perfil limpo a cada rodada
      '--no-sandbox', // só porque este ambiente de teste roda como root
      '--use-fake-device-for-media-stream',
    ],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0', RESENHA_EXTRA_GAMES: 'sleep=Jogo de Teste', RESENHA_GAME_INTERVAL_MS: '1000' },
  });
  // registros do processo principal do app (ex.: avisos do hook de teclado)
  const appLog = [];
  app.process().stdout?.on('data', (d) => appLog.push(String(d)));
  app.process().stderr?.on('data', (d) => appLog.push(String(d)));
  process.on('exit', () => {
    const relevant = appLog.join('').split('\n').filter((l) => /\[(atalhos|picker|boot)\]/.test(l));
    if (process.exitCode) console.log(relevant.map((l) => `[app] ${l}`).join('\n'));
  });
  await app.evaluate(({ app: a }) => {
    globalThis.__navLog = [];
    a.on('web-contents-created', (_e, wc) => {
      wc.on('did-start-navigation', (d) => d.isMainFrame && globalThis.__navLog.push(`start ${d.url.slice(0, 60)}`));
      wc.on('did-fail-load', (_e2, code, desc, url, main) => main && globalThis.__navLog.push(`fail ${code} ${desc} ${url.slice(0, 60)}`));
      wc.on('did-finish-load', () => globalThis.__navLog.push(`finish ${wc.getURL().slice(0, 60)}`));
    });
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e));
  win.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  win.on('requestfailed', (r) => console.error('[requestfailed]', r.url(), r.failure()?.errorText));
  await win.waitForURL(`${BASE}/**`, { timeout: 30000 });
  step('o app abriu a tela de espera e depois o Resenha do servidor');

  // login + push-to-talk na tecla T
  await win.evaluate((t) => {
    localStorage.setItem('resenha.token', t);
    localStorage.setItem('resenha.voiceSettings', JSON.stringify({ inputMode: 'ptt', pttKey: 'KeyT' }));
  }, ana.token);
  await win.reload();
  const bridge = await win.evaluate(() => typeof window.resenhaDesktop?.setGlobalKeys);
  if (bridge !== 'function') throw new Error('ponte resenhaDesktop não existe');
  step('o site detecta o app (window.resenhaDesktop)');

  // ---- "Jogando agora" detectado pelo app ----
  await win.locator('.user-panel').getByText('🎮 Jogando Jogo de Teste').waitFor({ timeout: 15000 });
  await win.locator('.members').getByText('🎮 Jogando Jogo de Teste').waitFor();
  // o jogo primeiro: com jogo aberto, todos os processos do Resenha ficam com prioridade abaixo do normal
  const priorities = () =>
    app.evaluate(({ app: a }) => {
      const os = process.mainModule.require('node:os');
      return a.getAppMetrics().map((m) => {
        try {
          return { type: m.type, p: os.getPriority(m.pid) };
        } catch {
          return { type: m.type, p: null };
        }
      });
    });
  // o processo principal e o da página (que codifica a transmissão e a voz); no Linux alguns processos
  // auxiliares do Chromium têm prioridade própria, no Windows a troca vale para todos
  const keyProcs = (list) => list.filter((x) => (x.type === 'Browser' || x.type === 'Tab') && x.p !== null).map((x) => x.p);
  let below = [];
  for (let i = 0; i < 10; i++) {
    below = keyProcs(await priorities());
    if (below.length >= 2 && below.every((p) => p > 0)) break;
    await sleep(500);
  }
  assert(below.length >= 2 && below.every((p) => p > 0), `processos do Resenha atrás do jogo (${JSON.stringify(await priorities())})`);
  assert((await win.evaluate(() => window.resenhaDesktop.getSettings())).gamePriority === true, '"Dar prioridade ao jogo" ligado por padrão');
  fakeGame.kill();
  await win.locator('.user-panel').getByText('🎮 Jogando Jogo de Teste').waitFor({ state: 'detached', timeout: 15000 });
  const normal = keyProcs(await priorities());
  assert(normal.every((p) => p === 0), `prioridade volta ao normal quando o jogo fecha (${normal.join(',')})`);
  step('"Jogando agora": o app detecta o jogo aberto, mostra no perfil e tira quando fecha');
  step('o jogo primeiro: com jogo aberto, o Resenha fica com prioridade abaixo do normal (e volta quando o jogo fecha)');

  await win.getByRole('button', { name: 'Sala de voz' }).click();
  await win.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await win.getByText('Segure T para falar').waitFor();

  // ---- overlay no jogo ----
  // mesmo módulo do app (cache compartilhado): simula foco da janela e jogo aberto
  const overlayPath = path.resolve('desktop/src/overlay.js');
  const ovCall = (fn, arg) => app.evaluate((_e, [p, f, a]) => process.mainModule.constructor._load(p)[f](a), [overlayPath, fn, arg]);
  const ovVisible = () =>
    app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Resenha overlay' && x.isVisible()));
  await ovCall('setAppFocused', true);
  await ovCall('setGameOpen', false);
  await sleep(300);
  if (await ovVisible()) throw new Error('o overlay apareceu sem jogo aberto');
  await ovCall('setGameOpen', true); // um jogo abriu...
  await sleep(300);
  if (await ovVisible()) throw new Error('o overlay apareceu por cima da própria janela do Resenha');
  await ovCall('setAppFocused', false); // ...e o jogo ficou na frente
  let ov;
  for (let i = 0; i < 40 && !ov; i++) {
    ov = app.windows().find((w) => w.url().includes('overlay.html'));
    if (!ov) await sleep(250);
  }
  if (!ov) throw new Error('o overlay não abriu ao entrar na chamada');
  await ov.locator('.p', { hasText: 'Ana' }).waitFor({ timeout: 8000 });
  await ov.getByText('🎧 Sala de voz').waitFor();
  const overlayWin = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Resenha overlay');
      return w && { visible: w.isVisible(), top: w.isAlwaysOnTop(), focusable: w.isFocusable(), x: w.getBounds().x };
    });
  const info = await overlayWin();
  if (!info?.visible || !info.top || info.focusable) throw new Error(`overlay deveria estar visível, por cima e sem pegar foco: ${JSON.stringify(info)}`);
  // soundboard: quem tocou aparece no overlay
  await win.evaluate(() => window.resenhaDesktop.overlayEvent({ type: 'sound', id: 'x', name: 'Bia', sound: 'Bruh', emoji: '😂' }));
  await ov.getByText('😂 Bia tocou "Bruh"').waitFor({ timeout: 3000 });
  // mudar o canto da tela e "só quem fala"
  await win.evaluate(() => window.resenhaDesktop.setSettings({ overlay: { position: 'top-right', onlySpeaking: true } }));
  await sleep(300);
  const moved = await overlayWin();
  if (!(moved.x > info.x)) throw new Error('o overlay não mudou de canto');
  if (await ov.locator('.p', { hasText: 'Ana' }).isVisible()) throw new Error('"só quem fala" ainda mostra quem está calado');
  await win.evaluate(() => window.resenhaDesktop.setSettings({ overlay: { position: 'top-left', onlySpeaking: false } }));
  await ov.locator('.p', { hasText: 'Ana' }).waitFor({ timeout: 3000 });
  // voltar para o Resenha esconde; "Sempre" mostra mesmo sem jogo reconhecido
  await ovCall('setAppFocused', true);
  await sleep(200);
  if ((await overlayWin()).visible) throw new Error('o overlay não sumiu com o Resenha na frente');
  await ovCall('setAppFocused', false);
  await ovCall('setGameOpen', false);
  await sleep(200);
  if ((await overlayWin()).visible) throw new Error('o overlay continuou sem jogo aberto');
  await win.evaluate(() => window.resenhaDesktop.setSettings({ overlay: { showWhen: 'always' } }));
  await sleep(300);
  if (!(await overlayWin()).visible) throw new Error('"Sempre" não mostrou o overlay');
  const protectedFromCapture = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Resenha overlay');
    // só existe no Windows e no Mac (no Linux do teste não há como proteger)
    return process.platform !== 'linux' && typeof w.isContentProtected === 'function' ? w.isContentProtected() : null;
  });
  if (protectedFromCapture === false) throw new Error('o overlay apareceria na transmissão de tela');
  // Ctrl+Shift+O esconde e mostra (chama o mesmo toggle do atalho global)
  const toggle = () => app.evaluate((_e, p) => process.mainModule.constructor._load(p).toggle(), overlayPath);
  await toggle();
  if ((await overlayWin()).visible) throw new Error('Ctrl+Shift+O não escondeu o overlay');
  await toggle();
  if (!(await overlayWin()).visible) throw new Error('Ctrl+Shift+O não mostrou o overlay de novo');
  step(`overlay no jogo: só com jogo aberto e fora do Resenha (ou "Sempre"), por cima e sem roubar o foco${protectedFromCapture ? ', fora da transmissão de tela' : ''}; quem tocou som; canto; "só quem fala"; Ctrl+Shift+O`);

  // ---- push-to-talk global ----
  // O Xvfb não repassa teclas sintéticas ao hook (XRecord), então injetamos o evento no próprio
  // hook dentro do processo do app. A partir daí tudo é real: mapa de teclas, filtro de teclas,
  // proteção contra repetição, IPC até o site e o microfone abrindo. A captura da tecla pelo
  // sistema operacional em si (Windows) é coberta pela biblioteca uiohook-napi.
  // mesmo arquivo que o app carrega (cache de módulos compartilhado = mesma instância do hook)
  const hookPath = desktopRequire.resolve('uiohook-napi');
  const hookEmit = (event, data) =>
    app.evaluate((_electron, [p, ev, d]) => process.mainModule.constructor._load(p).uIOhook.emit(ev, d), [hookPath, event, data]);
  const key = (keycode, mods = {}) => ({ keycode, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  await hookEmit('keydown', key(UiohookKey.T));
  await hookEmit('keydown', key(UiohookKey.T)); // repetição automática do teclado: deve ser ignorada
  await win.getByText('Transmitindo…').waitFor({ timeout: 5000 });
  // quem fala ganha o contorno verde no overlay
  const spoke = await ov.locator('.p.speaking', { hasText: 'Ana' }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  await hookEmit('keyup', key(UiohookKey.T));
  if (spoke) step('overlay: quem está falando ganha o contorno verde');
  else console.log('  (o microfone de teste não fez som suficiente para marcar "falando" no overlay)');
  await win.getByText('Segure T para falar').waitFor({ timeout: 5000 });
  step('push-to-talk global: segurar T abre o microfone, soltar fecha (com o site sem foco de teclado)');

  // tecla que não é a do push-to-talk não é repassada ao site
  await hookEmit('keydown', key(UiohookKey.G));
  await sleep(300);
  if (await win.getByText('Transmitindo…').isVisible()) throw new Error('outra tecla abriu o microfone');
  await hookEmit('keyup', key(UiohookKey.G));

  // botão lateral do mouse não é o push-to-talk configurado (T): deve ser ignorado
  await hookEmit('mousedown', { button: 4 });
  await sleep(300);
  const mousePtt = await win.getByText('Transmitindo…').isVisible();
  await hookEmit('mouseup', { button: 4 });
  if (mousePtt) throw new Error('botão lateral abriu o microfone sem estar configurado');
  step('teclas e botões que não são o push-to-talk são ignorados (filtro de privacidade)');

  // ---- atalho global Ctrl+Shift+M ----
  await hookEmit('keydown', key(UiohookKey.M, { ctrlKey: true, shiftKey: true }));
  await win.getByRole('button', { name: 'Ativar microfone' }).first().waitFor({ timeout: 5000 });
  step('Ctrl+Shift+M global silencia');
  await win.getByRole('button', { name: 'Ativar microfone' }).first().click();

  // ---- seletor de tela do app ----
  await win.getByRole('button', { name: 'Transmitir tela' }).click();
  const pickerPromise = app.waitForEvent('window', { predicate: (p) => !p.isClosed() && p.url().includes('picker') });
  await win.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  const picker = await pickerPromise;
  await picker.locator('.source').first().waitFor({ timeout: 15000 });
  await picker.screenshot({ path: `${shots}/17-desktop-seletor.png` });
  await picker.getByRole('button', { name: 'Transmitir', exact: true }).click();
  await win.getByText('Sua tela').waitFor({ timeout: 15000 });
  const size = await win.evaluate(() => {
    const v = document.querySelector('.tile.screen video');
    return v ? `${v.videoWidth}x${v.videoHeight}` : null;
  });
  await win.screenshot({ path: `${shots}/18-desktop-transmitindo.png` });
  step(`seletor de tela do app funciona e a transmissão começou (${size})`);
  await win.getByRole('button', { name: 'Parar transmissão' }).click();

  // cancelar o seletor não quebra nada
  await win.getByRole('button', { name: 'Transmitir tela' }).click();
  const picker2Promise = app.waitForEvent('window', { predicate: (p) => !p.isClosed() && p.url().includes('picker') });
  await win.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  const picker2 = await picker2Promise;
  // jogo aberto sem janela visível (como o Valorant em tela cheia minimizado): o seletor explica o que fazer
  const hiddenGame = spawn('sleep', ['300'], { stdio: 'ignore' });
  process.on('exit', () => hiddenGame.kill());
  await sleep(2500); // detecção de jogos roda a cada 1 s no teste
  await picker2.getByRole('button', { name: '↻ Atualizar' }).click();
  await picker2.getByRole('tab', { name: 'Janela (jogo, programa)' }).click();
  await picker2.getByText('O Jogo de Teste está aberto, mas não aparece aqui.').waitFor({ timeout: 8000 });
  await picker2.getByText(/Janela sem bordas/).waitFor();
  await picker2.screenshot({ path: `${shots}/17b-seletor-jogo-tela-cheia.png` });
  hiddenGame.kill();
  step('seletor: jogo aberto que não aparece como janela (tela cheia) ganha aviso com o que fazer; botão Atualizar');
  const winList = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => `${w.id}:${w.getTitle()}:${w.isVisible()}`));
  console.log('janelas após abrir o 2º seletor:', JSON.stringify(await winList()), 'url:', picker2.url());
  await picker2.getByRole('button', { name: 'Cancelar' }).click();
  await win.getByRole('button', { name: 'Escolher tela e transmitir' }).waitFor({ timeout: 5000 });
  await win.getByRole('button', { name: 'Cancelar' }).click();
  step('cancelar o seletor volta normalmente');

  // ---- fechar = continua na bandeja, e a chamada segue ----
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'Resenha overlay' && !x.webContents.getURL().includes('picker')).close());
  await sleep(500);
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'Resenha overlay' && !x.webContents.getURL().includes('picker'));
    return { exists: !!w, visible: w?.isVisible() };
  });
  if (!state.exists || state.visible) throw new Error(`esperava janela escondida, veio ${JSON.stringify(state)}`);
  const stillInCall = await win.evaluate(() => !!document.querySelector('.voice-panel'));
  if (!stillInCall) throw new Error('a chamada caiu ao fechar a janela');
  step('fechar a janela esconde na bandeja e a chamada continua');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  try {
    const w = app && (await app.firstWindow());
    if (w) {
      await w.screenshot({ path: `${shots}/desktop-falha.png` });
      console.error('URL na falha:', w.url());
      console.error('navegação:', JSON.stringify(await app.evaluate(() => globalThis.__navLog), null, 1));
      console.error('token presente:', await w.evaluate(() => !!localStorage.getItem('resenha.token')));
    }
  } catch {}
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
