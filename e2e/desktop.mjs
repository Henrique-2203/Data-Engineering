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

  app = await electron.launch({
    executablePath: path.resolve('desktop/node_modules/electron/dist/electron'),
    args: [
      path.resolve('desktop'),
      `--url=${BASE}`,
      `--profile=${mkdtempSync(path.join(tmpdir(), 'resenha-profile-'))}`, // perfil limpo a cada rodada
      '--no-sandbox', // só porque este ambiente de teste roda como root
      '--use-fake-device-for-media-stream',
    ],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
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

  await win.getByRole('button', { name: 'Sala de voz' }).click();
  await win.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await win.getByText('Segure T para falar').waitFor();

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
  await hookEmit('keyup', key(UiohookKey.T));
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
  const pickerPromise = app.waitForEvent('window', { predicate: (p) => !p.isClosed() });
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
  const winList = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => `${w.id}:${w.getTitle()}:${w.isVisible()}`));
  console.log('janelas após abrir o 2º seletor:', JSON.stringify(await winList()), 'url:', picker2.url());
  await picker2.getByRole('button', { name: 'Cancelar' }).click();
  await win.getByRole('button', { name: 'Escolher tela e transmitir' }).waitFor({ timeout: 5000 });
  await win.getByRole('button', { name: 'Cancelar' }).click();
  step('cancelar o seletor volta normalmente');

  // ---- fechar = continua na bandeja, e a chamada segue ----
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await sleep(500);
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
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
