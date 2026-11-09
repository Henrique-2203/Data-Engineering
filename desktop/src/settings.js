'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  closeToTray: true,
  openAtLogin: false,
  bounds: null,
  /** overlay no jogo (quem está na chamada, quem fala, sons do soundboard) */
  // showWhen: 'game' = só com um jogo aberto | 'always' = sempre que estiver em call (fora do Resenha)
  overlay: { enabled: true, position: 'top-left', onlySpeaking: false, opacity: 0.95, showWhen: 'game' },
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[settings] não foi possível salvar', err);
  }
  return cache;
}

module.exports = { load, save };
