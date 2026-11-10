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

/** "Artista - Música" -> { track, artist } (ou null se não for uma música tocando) */
function parseTitle(raw) {
  const title = String(raw ?? '').trim();
  if (IDLE.has(title.toLowerCase())) return null;
  const i = title.indexOf(' - ');
  if (i <= 0) return null;
  const artist = title.slice(0, i).trim().slice(0, 100);
  const track = title.slice(i + 3).trim().slice(0, 100);
  if (!artist || !track) return null;
  return { track, artist };
}

/** títulos das janelas do Spotify aberto */
function spotifyTitles() {
  return new Promise((resolve) => {
    // testes (fora do Windows): RESENHA_FAKE_SPOTIFY_TITLE_FILE aponta um arquivo com o título da janela
    const fake = process.env.RESENHA_FAKE_SPOTIFY_TITLE_FILE;
    if (fake) return void readFile(fake, 'utf8').then((t) => resolve([t]), () => resolve([]));
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'tasklist',
      ['/v', '/fo', 'csv', '/nh', '/fi', 'imagename eq spotify.exe'],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve([]);
        // a última coluna é o título da janela
        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => /"([^"]*)"\s*$/.exec(line)?.[1] ?? '')
            .filter(Boolean),
        );
      },
    );
  });
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

module.exports = { watchMusic, detectMusic, parseTitle };
