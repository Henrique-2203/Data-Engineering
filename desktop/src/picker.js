'use strict';
let sources = [];
let type = 'screen';
let selected = null;
let game = null;
let gameMissing = false;

const list = document.getElementById('list');
const go = document.getElementById('go');

function render() {
  const items = sources.filter((s) => s.type === type);
  list.replaceChildren();
  // o jogo está aberto mas não aparece como janela: explica o porquê e o que fazer
  const hint = document.getElementById('game-hint');
  hint.hidden = !(gameMissing && type === 'window');
  if (!hint.hidden) {
    hint.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `O ${game} está aberto, mas não aparece aqui.`;
    const p1 = document.createElement('p');
    p1.textContent =
      'Em tela cheia, o jogo é minimizado pelo Windows quando você sai dele, e janelas minimizadas não podem ser transmitidas.';
    const p2 = document.createElement('p');
    p2.textContent = `Para transmitir só o jogo: no ${game}, abra as configurações de vídeo e escolha o modo "Janela sem bordas" (ou "Tela cheia em janela"). Ele vai aparecer nesta lista sozinho. Ou transmita a Tela inteira.`;
    hint.append(strong, p1, p2);
  }
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

async function refresh(first = false) {
  const r = await window.picker.sources();
  // versões antigas devolviam só a lista
  sources = Array.isArray(r) ? r : r.sources;
  game = Array.isArray(r) ? null : r.game;
  gameMissing = Array.isArray(r) ? false : r.gameMissing;
  if (first) selected = sources.find((x) => x.type === 'screen')?.id ?? null; // pré-seleciona a tela principal
  else if (selected && !sources.some((x) => x.id === selected)) selected = null;
  go.disabled = !selected;
  render();
}

document.getElementById('refresh').addEventListener('click', () => void refresh());
void refresh(true);
// a lista se atualiza sozinha (ex.: você trocou o jogo para "janela sem bordas")
setInterval(() => void refresh(), 4000);
