'use strict';
/**
 * Converte os códigos de tecla do hook global (libuiohook) para os mesmos nomes que o site usa
 * (KeyboardEvent.code), assim a tecla escolhida nas configurações vale nos dois.
 */
const RENAME = {
  Ctrl: 'ControlLeft',
  CtrlRight: 'ControlRight',
  Alt: 'AltLeft',
  AltRight: 'AltRight',
  Shift: 'ShiftLeft',
  ShiftRight: 'ShiftRight',
  Meta: 'MetaLeft',
  MetaRight: 'MetaRight',
};

function buildKeymap(UiohookKey) {
  const map = new Map();
  for (const [name, keycode] of Object.entries(UiohookKey)) {
    if (typeof keycode !== 'number') continue;
    let code;
    if (/^[A-Z]$/.test(name)) code = `Key${name}`;
    else if (/^[0-9]$/.test(name)) code = `Digit${name}`;
    else code = RENAME[name] ?? name; // F1, Numpad0, Space, Backquote, Tab, CapsLock…
    if (!map.has(keycode)) map.set(keycode, code);
  }
  return map;
}

/** Botões do mouse no hook (1 esq., 2 dir., 3 meio, 4/5 laterais) -> nomes usados no site. */
const MOUSE = { 3: 'Mouse1', 4: 'Mouse3', 5: 'Mouse4' };

module.exports = { buildKeymap, MOUSE };
