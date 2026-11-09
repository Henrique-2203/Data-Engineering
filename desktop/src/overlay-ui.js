'use strict';
// Desenha o overlay a partir do estado mandado pelo site (via app). Só texto e imagens públicas.
const root = document.getElementById('root');
let state = null;
let config = { onlySpeaking: false, opacity: 0.95, position: 'top-left' };
const bursts = new Map(); // id da pessoa -> { text, until }
const toasts = []; // { text, until }

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function render() {
  const now = Date.now();
  for (const [k, b] of bursts) if (b.until < now) bursts.delete(k);
  while (toasts.length && toasts[0].until < now) toasts.shift();
  document.body.style.opacity = String(config.opacity ?? 0.95);
  document.body.className = String(config.position || '').startsWith('bottom') ? 'bottom' : '';
  root.replaceChildren();
  if (!state?.inCall) return;
  if (state.channel && !config.onlySpeaking) root.append(el('div', 'chip', `🎧 ${state.channel}`));
  for (const p of state.people ?? []) {
    const burst = bursts.get(p.id);
    if (config.onlySpeaking && !p.speaking && !burst) continue;
    const row = el('div', `p${p.speaking ? ' speaking' : ''}`);
    row.dataset.name = p.name;
    const av = el('div', 'av');
    av.style.background = p.color || '#555';
    if (p.avatar) {
      const img = document.createElement('img');
      img.src = p.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      av.append(img);
    } else av.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
    row.append(av, el('span', 'name', p.name + (p.me ? ' (você)' : '')));
    if (p.deafened) row.append(el('span', 'icons', '🎧✕'));
    else if (p.muted) row.append(el('span', 'icons', '🔇'));
    if (p.streaming) row.append(el('span', 'live', 'AO VIVO'));
    if (burst) row.append(el('span', 'burst', burst.text));
    root.append(row);
  }
  for (const t of toasts) root.append(el('div', 'toast', t.text));
}

window.overlay.onState((s) => {
  state = s;
  render();
});
window.overlay.onConfig((c) => {
  config = { ...config, ...c };
  render();
});
window.overlay.onEvent((e) => {
  if (e?.type !== 'sound') return;
  const text = `${e.emoji || '🔊'} ${e.sound}`;
  if (e.id) bursts.set(e.id, { text, until: Date.now() + 3000 });
  toasts.push({ text: `${e.emoji || '🔊'} ${e.name} tocou "${e.sound}"`, until: Date.now() + 3500 });
  if (toasts.length > 3) toasts.shift();
  render();
  setTimeout(render, 3600);
});
