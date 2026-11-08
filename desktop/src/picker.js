'use strict';
let sources = [];
let type = 'screen';
let selected = null;

const list = document.getElementById('list');
const go = document.getElementById('go');

function render() {
  const items = sources.filter((s) => s.type === type);
  list.replaceChildren();
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = type === 'window' ? 'Nenhuma janela encontrada. Abra o jogo e tente de novo.' : 'Nenhuma tela encontrada.';
    list.append(p);
  }
  for (const s of items) {
    const btn = document.createElement('button');
    btn.className = 'source';
    btn.setAttribute('aria-pressed', String(selected === s.id));
    btn.title = s.name;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = s.thumbnail;
    img.alt = '';
    thumb.append(img);
    const name = document.createElement('div');
    name.className = 'name';
    if (s.icon) {
      const icon = document.createElement('img');
      icon.src = s.icon;
      icon.alt = '';
      name.append(icon);
    }
    name.append(document.createTextNode(s.name));
    btn.append(thumb, name);
    btn.addEventListener('click', () => {
      selected = s.id;
      go.disabled = false;
      render();
    });
    btn.addEventListener('dblclick', () => window.picker.choose(s.id, document.getElementById('audio').checked));
    list.append(btn);
  }
}

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => {
    type = tab.dataset.type;
    for (const t of document.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
    render();
  });
}

go.addEventListener('click', () => selected && window.picker.choose(selected, document.getElementById('audio').checked));
document.getElementById('cancel').addEventListener('click', () => window.picker.cancel());
window.addEventListener('keydown', (e) => e.key === 'Escape' && window.picker.cancel());

window.picker.sources().then((s) => {
  sources = s;
  // pré-seleciona a tela principal
  selected = sources.find((x) => x.type === 'screen')?.id ?? null;
  go.disabled = !selected;
  render();
});
