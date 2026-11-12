'use strict';
/**
 * "Ouvindo agora": a música tocando no Spotify do PC. Quando toca, o Spotify troca o título da
 * própria janela para "Artista - Música" (pausado, fica só "Spotify"/"Spotify Premium"). Lemos só a
 * janela do Spotify (nenhum outro programa) e só o nome da música e do artista sai do computador.
 */
const { execFile } = require('node:child_process');
const { readFile } = require('node:fs/promises');

/** títulos que o Spotify usa quando NÃO está tocando nada */
const IDLE = new Set(['', 'n/a', 'spotify', 'spotify premium', 'spotify free', 'advertisement', 'spotify - advertisement']);

/** corta em até `max` unidades de texto sem partir um emoji no meio (metade de emoji vira "�") */
function cut(str, max) {
  let out = '';
  for (const ch of str) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** "Artista - Música" -> { track, artist } (ou null se não for uma música tocando) */
function parseTitle(raw) {
  const title = String(raw ?? '').trim();
  if (IDLE.has(title.toLowerCase())) return null;
  const i = title.indexOf(' - ');
  if (i <= 0) return null;
  const artist = cut(title.slice(0, i).trim(), 100);
  const track = cut(title.slice(i + 3).trim(), 100);
  if (!artist || !track) return null;
  return { track, artist };
}

/**
 * Funções do Windows para ler o título das janelas em Unicode (versões "W"). Antes o título vinha do
 * comando tasklist, que escreve na codificação antiga do console: "Paredões" virava "Pared�es" e
 * emojis sumiam. Carregado uma vez; fora do Windows ou sem o koffi, fica desligado (false).
 */
let win32 = null;
function loadWin32() {
  if (win32 !== null) return win32;
  win32 = false;
  if (process.platform !== 'win32') return win32;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
    koffi.alias('HWND', HANDLE);
    win32 = {
      FindWindowExW: user32.func('HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, const char16_t *lpszClass, const char16_t *lpszWindow)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32_t *lpdwProcessId)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hWnd, _Out_ uint16_t *lpString, int nMaxCount)'),
    };
  } catch {
    win32 = false;
  }
  return win32;
}

const run = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 8000 }, (err, stdout) => resolve(err ? null : String(stdout))),
  );

/** PIDs do Spotify (só números e o nome do programa: não depende da codificação do console) */
async function spotifyPids() {
  const out = await run('tasklist', ['/fo', 'csv', '/nh', '/fi', 'imagename eq spotify.exe']);
  const pids = new Set();
  for (const line of (out ?? '').split(/\r?\n/)) {
    const m = /^"spotify\.exe","(\d+)"/i.exec(line.trim());
    if (m) pids.add(Number(m[1]));
  }
  return pids;
}

/** títulos (Unicode) das janelas do Spotify: percorre as janelas principais e fica com as dele */
async function unicodeTitles(api) {
  const pids = await spotifyPids();
  if (!pids.size) return [];
  const titles = [];
  const buf = Buffer.alloc(1024); // 512 caracteres
  let hwnd = null;
  for (let i = 0; i < 10000; i++) {
    hwnd = api.FindWindowExW(0, hwnd, null, null);
    if (!hwnd) break;
    const pid = [0];
    if (!api.GetWindowThreadProcessId(hwnd, pid) || !pids.has(pid[0])) continue;
    const n = api.GetWindowTextW(hwnd, buf, 512);
    if (n > 0) titles.push(buf.toString('utf16le', 0, n * 2));
  }
  return titles;
}

/** títulos das janelas do Spotify aberto */
async function spotifyTitles() {
  // testes (fora do Windows): RESENHA_FAKE_SPOTIFY_TITLE_FILE aponta um arquivo com o título da janela
  const fake = process.env.RESENHA_FAKE_SPOTIFY_TITLE_FILE;
  if (fake) return readFile(fake, 'utf8').then((t) => [t], () => []);
  if (process.platform !== 'win32') return [];
  const api = loadWin32();
  if (api) {
    try {
      return await unicodeTitles(api);
    } catch {
      /* cai para o jeito antigo */
    }
  }
  // sem o koffi: PowerShell com saída em UTF-8 (acentos e emojis certos)
  const ps = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }",
  ]);
  if (ps !== null) return ps.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  return [];
}

async function detectMusic() {
  for (const t of await spotifyTitles()) {
    const m = parseTitle(t);
    if (m) return m;
  }
  return null;
}

/** Observa o Spotify e chama onChange({ track, artist } | null) quando muda a música. */
function watchMusic(onChange, intervalMs = 10_000) {
  let current = null;
  let stopped = false;
  const key = (m) => (m ? `${m.artist}\n${m.track}` : '');
  const tick = async () => {
    if (stopped) return;
    const m = await detectMusic().catch(() => null);
    if (key(m) !== key(current)) {
      current = m;
      onChange(m);
    }
  };
  void tick();
  const t = setInterval(tick, intervalMs);
  return {
    current: () => current,
    stop() {
      stopped = true;
      clearInterval(t);
    },
  };
}

module.exports = { watchMusic, detectMusic, parseTitle, cut };
