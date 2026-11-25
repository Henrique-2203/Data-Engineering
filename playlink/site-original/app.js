/* PLAYLINK — lógica do site (somente front-end).
   Por enquanto, deixei os dados salvos no próprio navegador. Da internet vêm apenas imagens e vídeos.
   Assim consigo testar a experiência sem depender de um servidor ou banco de dados. */

/* 1. FERRAMENTAS BÁSICAS — funções que reutilizo em várias partes do código. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Antes de colocar um texto no HTML, trato os caracteres especiais para não interpretar código como conteúdo.
const esc = v => String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const safeColor = v => /^#[0-9a-f]{3,8}$/i.test(v) ? v : '#2330E6';
const hora = v => { const d = new Date(v); return v && !isNaN(d) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; };
const ico = nome => `<svg class="ico" aria-hidden="true"><use href="#${nome}"/></svg>`;   // ícone do sprite do index.html
const reduzirMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 2. Catálogo de jogos ----------
   Para adicionar um jogo, copie uma linha. images = candidatas a fundo/card (usa a primeira que carregar);
   trailers = vídeos do YouTube ({title,id,channel}); id é o que vem depois de "v=" no link. */
const steam = id => ['shared.fastly.steamstatic.com', 'cdn.cloudflare.steamstatic.com'].flatMap(h =>
  [`https://${h}/steam/apps/${id}/library_hero.jpg`, `https://${h}/steam/apps/${id}/header.jpg`,
   `https://${h}/steam/apps/${id}/library_600x900.jpg`, `https://${h}/steam/apps/${id}/capsule_616x353.jpg`]);
const capa = id => [`https://img.youtube.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
const T = (title, id, channel) => ({ title, id, channel });

const GAMES = [
  { key: 'valorant', name: 'Valorant', genre: 'FPS tático 5v5', tag: 'FPS', pitch: 'Encontre duo, monte seu time e suba de elo.',
    about: 'Tático, competitivo e focado em trabalho em equipe.', images: capa('e_E9W2vsRbQ'),
    trailers: [T('DUELISTS — Trailer cinemático oficial', 'e_E9W2vsRbQ', 'Riot Games')] },
  { key: 'counter-strike-2', name: 'Counter-Strike 2', genre: 'FPS competitivo', tag: 'FPS', pitch: 'Comunique-se com o time e jogue ranked.',
    about: 'Partidas competitivas, estratégias e comunicação fazem a diferença.', images: steam(730),
    trailers: [T('Counter-Strike 2 — Trailer de lançamento', 'nSE38xjMLqE', 'Valve')] },
  { key: 'minecraft', name: 'Minecraft', genre: 'Aventura e sandbox', tag: 'SANDBOX', pitch: 'Explore mundos e construa com a comunidade.',
    about: 'Sobrevivência, construção, exploração e servidores com amigos.', images: capa('qNMfF9TYETM'),
    trailers: [T('Minecraft — Trailer oficial', 'qNMfF9TYETM', 'Minecraft')] },
  { key: 'ea-sports-fc', name: 'EA SPORTS FC', genre: 'Esporte', tag: 'ESPORTE', pitch: 'Ache parceiros para amistosos e clubes.',
    about: 'Monte seu time, encontre adversários e organize partidas.', images: steam(2669320), trailers: [] },
  { key: 'monster-hunter-wilds', name: 'Monster Hunter Wilds', genre: 'Ação e aventura', tag: 'AÇÃO', pitch: 'Prepare sua caçada com outros jogadores.',
    about: 'Prepare equipamentos e reúna caçadores para enfrentar monstros.', images: steam(2246340),
    trailers: [T('Monster Hunter Wilds — Trailer de lançamento', 'a_wNFT4j6qI', 'Monster Hunter')] },
  { key: 'helldivers-2', name: 'Helldivers 2', genre: 'Cooperativo', tag: 'CO-OP', pitch: 'Junte sua equipe para cumprir missões.',
    about: 'Coordene seu esquadrão em missões cooperativas intensas.', images: steam(553850),
    trailers: [T('Helldivers 2 — Trailer oficial', 'TpR2stGRe14', 'PlayStation')] },
  { key: 'gta-vi', name: 'GTA VI', genre: 'Ação e mundo aberto', tag: 'MUNDO ABERTO', pitch: 'Acompanhe novidades e converse com a comunidade.',
    about: 'Espaço comunitário para notícias, teorias e trailers.', images: capa('VQRLujxTm3c'),
    trailers: [T('Grand Theft Auto VI — Trailer 1', 'QdBZY2fkU-0', 'Rockstar Games'), T('Grand Theft Auto VI — Trailer 2', 'VQRLujxTm3c', 'Rockstar Games')] },
  { key: 'elden-ring', name: 'Elden Ring', genre: 'RPG de ação', tag: 'RPG', pitch: 'Encontre Maculados para explorar as Terras Intermédias.',
    about: 'Compartilhe builds, descubra segredos e forme grupos para enfrentar chefes.', images: steam(1245620), trailers: [T('Elden Ring — Trailer de lançamento', 'E3Huy2cdih0', 'Bandai Namco')] },
  { key: 'cyberpunk-2077', name: 'Cyberpunk 2077', genre: 'RPG · Mundo aberto', tag: 'RPG', pitch: 'Monte sua equipe para explorar Night City.',
    about: 'Builds, missões, exploração e discussões sobre Night City.', images: steam(1091500), trailers: [T('Cyberpunk 2077 — Trailer oficial', '8X2kIfS6fb8', 'Cyberpunk 2077')] },
  { key: 'red-dead-redemption-2', name: 'Red Dead Redemption 2', genre: 'Ação · Mundo aberto', tag: 'MUNDO ABERTO', pitch: 'Reúna sua gangue e explore o Velho Oeste.',
    about: 'Converse sobre histórias, desafios e o modo online.', images: steam(1174180), trailers: [] },
  { key: 'apex-legends', name: 'Apex Legends', genre: 'Battle royale · FPS', tag: 'FPS', pitch: 'Encontre sua dupla ou trio para a próxima vitória.',
    about: 'Combine lendas, estratégias e comunicação para vencer.', images: steam(1172470), trailers: [] },
  { key: 'pubg', name: 'PUBG: Battlegrounds', genre: 'Battle royale', tag: 'BATTLE ROYALE', pitch: 'Monte seu esquadrão e sobreviva até o fim.',
    about: 'Estratégias, mapas e partidas em equipe.', images: steam(578080), trailers: [] },
  { key: 'the-witcher-3', name: 'The Witcher 3: Wild Hunt', genre: 'RPG · Fantasia', tag: 'RPG', pitch: 'Troque dicas de quests, builds e exploração.',
    about: 'Uma comunidade para caçadores de monstros e fãs de RPG.', images: steam(292030), trailers: [] },
  { key: 'terraria', name: 'Terraria', genre: 'Aventura · Sandbox', tag: 'SANDBOX', pitch: 'Construa, explore e enfrente chefes em grupo.',
    about: 'Compartilhe mundos, construções e estratégias para chefes.', images: steam(105600), trailers: [] },
  { key: 'stardew-valley', name: 'Stardew Valley', genre: 'Fazenda · Simulação', tag: 'CASUAL', pitch: 'Encontre companhia para cuidar da fazenda.',
    about: 'Plante, pesque, explore minas e organize uma fazenda cooperativa.', images: steam(413150), trailers: [] },
  { key: 'baldurs-gate-3', name: "Baldur's Gate 3", genre: 'RPG · Coop', tag: 'RPG', pitch: 'Monte um grupo e escolha o destino da aventura.',
    about: 'Compartilhe builds, decisões e campanhas cooperativas.', images: steam(1086940), trailers: [] },
  { key: 'destiny-2', name: 'Destiny 2', genre: 'FPS · MMO', tag: 'CO-OP', pitch: 'Encontre fireteam para raids e atividades.',
    about: 'Organize esquadrões para incursões, assaltos e eventos.', images: steam(1085660), trailers: [] },
  { key: 'palworld', name: 'Palworld', genre: 'Sobrevivência · Coop', tag: 'CO-OP', pitch: 'Explore, construa sua base e capture Pals em grupo.',
    about: 'Troque dicas de sobrevivência, bases e exploração cooperativa.', images: steam(1623730), trailers: [] },
  { key: 'god-of-war', name: 'God of War', genre: 'Ação · Aventura', tag: 'AÇÃO', pitch: 'Converse sobre combates, desafios e história.',
    about: 'Comunidade para compartilhar dicas e experiências da jornada.', images: steam(1593500), trailers: [] }
];
const jogoPorNome = n => GAMES.find(g => g.name === n);
const jogoPorKey = k => GAMES.find(g => g.key === k);

/* 3. IMAGENS E PAPEL DE PAREDE — tento carregar as artes e uso as que realmente funcionarem. */
// Testo a imagem antes de usar. Se ela não carregar ou for pequena demais, tento a próxima opção.
const carregar = url => new Promise(ok => {
  const i = new Image();
  i.referrerPolicy = 'no-referrer';
  i.onload = () => ok(i.naturalWidth >= 400 ? url : null);
  i.onerror = () => ok(null);
  i.src = url;
  setTimeout(() => ok(null), 3500);
});
const cache = new Map();   // cada jogo é verificado só uma vez
function imagemDoJogo(g) {
  if (!cache.has(g.key)) cache.set(g.key, Promise.any(g.images.map(u => carregar(u).then(ok => ok || Promise.reject()))).catch(() => null));
  return cache.get(g.key);
}
// Procuro os elementos marcados com data-img-game e aplico a arte correspondente quando ela carregar.
function aplicarImagens(raiz = document) {
  $$('[data-img-game]', raiz).forEach(el => {
    const g = jogoPorKey(el.dataset.imgGame);
    g && imagemDoJogo(g).then(u => { if (u) { el.style.setProperty('--img', `url("${u}")`); el.classList.add('has-img'); } });
  });
}
// O fundo troca as artes sozinho e continua funcionando mesmo quando eu navego entre as páginas.
// Tenta duas CDNs do Steam para cada arte e só adiciona imagens que carregam.
const WALLPAPER_IDS = [730, 1245620, 1091500, 1174180, 292030, 553850, 2246340, 1623730,
  782330, 814380, 1551360, 2050650, 367520, 1145360, 1172620, 230410, 620, 1086940, 105600, 413150];
const wallpaperUrls = WALLPAPER_IDS.flatMap(id => [
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_hero.jpg`,
  `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_hero.jpg`,
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`
]);
const Fundo = {
  camadas: [$('#bgA'), $('#bgB')], ativa: 0, urls: [], i: 0, travado: false, interval: null,
  mostrar(url) {
    if (!url || !this.camadas[0] || !this.camadas[1]) return;
    const nova = this.camadas[1 - this.ativa];
    nova.style.backgroundImage = `url("${url}")`;
    nova.classList.add('visible');
    this.camadas[this.ativa].classList.remove('visible');
    this.ativa = 1 - this.ativa;
  },
  async start() {
    // Carrega em sequência: evita dezenas de requisições simultâneas e mostra a primeira arte assim que possível.
    for (const url of wallpaperUrls) {
      const ok = await carregar(url);
      if (!ok || this.urls.includes(ok)) continue;
      this.urls.push(ok);
      if (this.urls.length === 1) this.mostrar(ok);
    }
    if (this.urls.length < 2 || this.interval || reduzirMovimento) return;
    this.interval = setInterval(() => {
      if (this.travado || this.urls.length < 2) return;
      this.i = (this.i + 1) % this.urls.length;
      this.mostrar(this.urls[this.i]);
    }, 7000);
  },
  async focus(g) {
    this.travado = true;
    const url = await imagemDoJogo(g);
    if (url && this.travado) this.mostrar(url);
  },
  release() {
    if (!this.travado) return;
    this.travado = false;
    if (this.urls.length) this.mostrar(this.urls[this.i]);
  }
};

/* 4. DADOS LOCAIS — salvo conversas e grupos no navegador para não perder tudo ao atualizar a página. */
// Primeiro tento salvar no navegador. Se o armazenamento estiver bloqueado, mantenho os dados só enquanto a página estiver aberta.
const Store = (() => {
  let ok = true; const mem = new Map();
  try { localStorage.setItem('_t', 1); localStorage.removeItem('_t'); } catch { ok = false; }
  return {
    get persistente() { return ok; },
    get(k, pad) { try { const r = ok ? localStorage.getItem(k) : mem.get(k); return r ? JSON.parse(r) : pad; } catch { return pad; } },
    set(k, v) { const r = JSON.stringify(v); if (ok) try { return localStorage.setItem(k, r); } catch { ok = false; } mem.set(k, r); }
  };
})();
const K = { conv: 'playlink:conversas', msgs: id => `playlink:mensagens:${id}`, grupos: 'playlink:grupos', entrou: 'playlink:grupos-participando' };

// Essa parte simula um banco de dados. É aqui que organizo e valido conversas, mensagens e grupos.
const DB = {
  seed() {   // dados de exemplo na primeira visita
    if (Store.get(K.conv)) return;
    const min = m => new Date(Date.now() - m * 6e4).toISOString();
    Store.set(K.conv, [
      { id: 1, title: 'toniz2', subtitle: 'Valorant · CS2 · online', avatar_text: 'TO', avatar_color: '#2330E6' },
      { id: 2, title: 'Luna.exe', subtitle: 'Minecraft · online', avatar_text: 'LU', avatar_color: '#0C8F6A' }]);
    Store.set(K.msgs(1), [
      { sender: 'toniz2', body: 'E aí! Bora fechar uma partida hoje?', sent_at: min(120) },
      { sender: 'Você', body: 'Bora! Me chama quando estiver online.', sent_at: min(118) },
      { sender: 'toniz2', body: 'Fechado! Me chama quando entrar.', sent_at: min(32) }]);
    Store.set(K.msgs(2), [{ sender: 'Luna.exe', body: 'Achei um servidor novo para jogar.', sent_at: min(60) }]);
    Store.set(K.grupos, [
      [1, 'Squad da madrugada', 'Valorant', 'Procurando duo e gente para fechar time.', 18],
      [2, 'Exploradores', 'Minecraft', 'Construção, sobrevivência e boas ideias.', 42],
      [3, 'Ranked sem tilt', 'Counter-Strike 2', 'Jogue sério, mantenha o respeito.', 27],
      [4, 'Valorant Brasil', 'Valorant', 'Encontre duo e monte seu squad.', 128],
      [5, 'Minecraft Creators', 'Minecraft', 'Construção, sobrevivência e servidores.', 94]
    ].map(([id, name, game, description, members]) => ({ id, name, game, description, members })));
  },
  conversas() {   // com a última mensagem, mais recentes primeiro
    return Store.get(K.conv, []).map(c => { const u = DB.msgs(c.id).at(-1); return { ...c, last_message: u?.body || '', last_at: u?.sent_at || '' }; })
      .sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
  },
  criarConversa(t) {
    t = String(t || '').trim();
    if (t.length < 2 || t.length > 40) throw Error('O nome deve ter entre 2 e 40 caracteres.');
    const todas = Store.get(K.conv, []);
    const igual = todas.find(c => c.title.toLowerCase() === t.toLowerCase());
    if (igual) return igual;
    const nova = { id: Date.now(), title: t, subtitle: 'Nova conversa · Playlink', avatar_text: t.slice(0, 2).toUpperCase(), avatar_color: '#1B6FD6' };
    Store.set(K.conv, [nova, ...todas]);
    return nova;
  },
  msgs: id => Store.get(K.msgs(id), []),
  enviar(id, texto) {
    texto = String(texto || '').trim();
    if (!texto) throw Error('Digite uma mensagem.');
    if (texto.length > 2000) throw Error('A mensagem deve ter até 2000 caracteres.');
    Store.set(K.msgs(id), [...DB.msgs(id), { sender: 'Você', body: texto, sent_at: new Date().toISOString() }]);
  },
  grupos: () => Store.get(K.grupos, []),
  participando: () => new Set(Store.get(K.entrou, [])),
  entrar(id) {
    const gs = DB.grupos(), g = gs.find(x => x.id === id), set = DB.participando();
    if (!g) throw Error('Grupo não encontrado.');
    if (!set.has(id)) { g.members++; set.add(id); Store.set(K.grupos, gs); Store.set(K.entrou, [...set]); }
    return g;
  }
};

/* 5. NAVEGAÇÃO — aqui controlo qual página está aberta e o que precisa aparecer nela. */
const state = { page: 'inicio', conversas: [], activeId: null, messages: [], filtro: '', jogo: null, aba: 'overview', timer: null, exp: 'jogadores', exFiltro: '', prox: null };
// Cada página dinâmica tem um pequeno rótulo, um título e uma descrição.
const titulos = {
  jogos: ['SEU PRÓXIMO DESAFIO', 'Jogos', 'Encontre comunidades para os jogos que você curte.'],
  match: ['JOGUE COM QUEM COMBINA', 'Match', 'Encontre jogadores com interesses e estilos de jogo parecidos.'],
  explorar: ['DESCUBRA A COMUNIDADE', 'Explorar', 'Descubra jogadores, jogos e grupos para sua próxima partida.'],
  grupos: ['SUA PARTY, SUAS REGRAS', 'Grupos', 'Entre em grupos, encontre seu squad e jogue junto.'],
  comunidade: ['A COMUNIDADE PLAYLINK', 'Comunidade', 'Novidades, conversas e pessoas que compartilham sua paixão por games.']
};
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(state.timer); state.timer = setTimeout(() => el.classList.remove('show'), 2800);
}
// Deixo visível só a página escolhida e escondo as outras usando a classe .hidden.
function setPage(p) {
  if (!['inicio', 'mensagens', ...Object.keys(titulos)].includes(p)) p = 'inicio';
  state.page = p;
  $('#homePage').classList.toggle('hidden', p !== 'inicio');
  $('#messagesPage').classList.toggle('hidden', p !== 'mensagens');
  $('#genericPage').classList.toggle('hidden', p === 'inicio' || p === 'mensagens');
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === p));
  $('.main-nav').classList.remove('open');
  if (p !== 'jogos') Fundo.release();
  if (titulos[p]) renderGeneric(p);
  if (p === 'mensagens') carregarConversas();
  scrollTo({ top: 0, behavior: 'smooth' });
  document.title = p === 'inicio' ? 'PLAYLINK — Jogue. Conecte-se. Evolua.' : `${titulos[p]?.[1] || 'Mensagens'} — PLAYLINK`;
}
// Uso o endereço com # para trocar de página. Assim o botão voltar do navegador também funciona.
const ir = p => location.hash.slice(1) === p ? setPage(p) : (location.hash = p);
addEventListener('hashchange', () => setPage(location.hash.slice(1) || 'inicio'));
const abrirJogo = nome => { state.jogo = nome; state.aba = 'overview'; ir('jogos'); };

$$('[data-page]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); if (a.dataset.page === 'jogos') state.jogo = null; ir(a.dataset.page); }));
$$('[data-go]').forEach(b => b.addEventListener('click', () => { if (b.dataset.go === 'jogos') state.jogo = null; ir(b.dataset.go); }));
$$('[data-game]').forEach(b => b.addEventListener('click', () => abrirJogo(b.dataset.game)));
$('#mobileMenu').addEventListener('click', () => $('.main-nav').classList.toggle('open'));
$('#watchDemo').addEventListener('click', () => toast('O Playlink conecta jogadores, grupos e mensagens em um só lugar.'));
$('#notifications').addEventListener('click', () => toast('Você está em dia! Nenhuma notificação nova.'));
$('#profileButton').addEventListener('click', () => toast('Perfil de demonstração — o login ainda não foi implementado.'));
$('#genericAction').addEventListener('click', () => {
  if (state.page === 'explorar') { state.exp = 'jogadores'; renderGeneric('explorar'); }
  else if (state.page === 'match') { $('#matchSearch')?.focus(); $('#genericContent')?.scrollIntoView({behavior:'smooth',block:'start'}); }
  else if (state.page === 'jogos') { state.jogo = null; renderGeneric('jogos'); }
  else ir('explorar');
});
$('#globalSearch').addEventListener('keydown', e => {
  const q = e.target.value.trim();
  if (e.key === 'Enter' && q) { ir('explorar'); toast(`Resultados de demonstração para “${q}”.`); }
});

/* 6. MENSAGENS ---------- */
function carregarConversas() {
  state.conversas = DB.conversas();
  renderConversas();
  if (state.conversas.some(c => c.id === state.activeId)) carregarMensagens();
  else if (state.conversas.length) abrirConversa(state.conversas[0].id);
  else { $('#chatActive').classList.add('hidden'); $('#chatEmpty').classList.remove('hidden'); }
}
function renderConversas() {
  const lista = $('#conversationList');
  const f = state.conversas.filter(c => `${c.title} ${c.subtitle} ${c.last_message}`.toLowerCase().includes(state.filtro));
  lista.innerHTML = f.length ? f.map(c => `
    <button class="conversation-item ${c.id === state.activeId ? 'selected' : ''}" data-id="${c.id}">
      <span class="avatar" style="background:${safeColor(c.avatar_color)}">${esc(c.avatar_text)}</span>
      <span class="conversation-meta"><b>${esc(c.title)}</b><small>${esc(c.last_message || c.subtitle)}</small></span>
      <span class="conversation-time">${hora(c.last_at)}</span>
    </button>`).join('') : '<div class="loading">Nenhuma conversa encontrada.</div>';
  $$('.conversation-item', lista).forEach(b => b.addEventListener('click', () => abrirConversa(Number(b.dataset.id))));
}
function abrirConversa(id) {
  state.activeId = id; renderConversas();
  $('#chatEmpty').classList.add('hidden'); $('#chatActive').classList.remove('hidden');
  const c = state.conversas.find(x => x.id === id);
  $('#chatName').textContent = c.title; $('#chatSubtitle').textContent = c.subtitle;
  $('#chatAvatar').textContent = c.avatar_text; $('#chatAvatar').style.background = safeColor(c.avatar_color);
  carregarMensagens();
}
function carregarMensagens() {
  state.messages = DB.msgs(state.activeId);
  const h = $('#messageHistory');   // mensagens "Você" ficam à direita (.mine)
  h.innerHTML = state.messages.map(m => `<div class="message-row ${m.sender === 'Você' ? 'mine' : ''}"><div class="message-bubble">${esc(m.body)}</div><span class="message-time">${hora(m.sent_at)}</span></div>`).join('');
  h.scrollTop = h.scrollHeight;
}
$('#messageForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#messageInput');
  try {
    if (!state.activeId) throw Error('Escolha uma conversa primeiro.');
    if (!input.value.trim()) return;
    DB.enviar(state.activeId, input.value); input.value = '';
    state.conversas = DB.conversas(); renderConversas(); carregarMensagens();
  } catch (err) { toast(err.message); }
});
$('#chatSearch').addEventListener('click', () => {
  const q = prompt('Buscar texto nesta conversa:');
  if (q !== null) toast(q ? `${state.messages.filter(m => m.body.toLowerCase().includes(q.toLowerCase())).length} mensagem(ns) encontrada(s).` : 'Busca cancelada.');
});
$('#chatDetails').addEventListener('click', () => { const c = state.conversas.find(x => x.id === state.activeId); c && toast(`${c.title} · ${c.subtitle}`); });
$('#conversationSearch').addEventListener('input', e => { state.filtro = e.target.value.toLowerCase(); renderConversas(); });

const dialogo = $('#newConversationDialog');
$('#newConversation').addEventListener('click', () => dialogo.showModal());
['#closeDialog', '#cancelDialog'].forEach(s => $(s).addEventListener('click', () => dialogo.close()));
$('#newConversationForm').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const c = DB.criarConversa($('#newContactName').value);
    dialogo.close(); $('#newContactName').value = '';
    state.conversas = DB.conversas();
    abrirConversa(c.id); toast('Conversa criada!');
  } catch (err) { toast(err.message); }
});

/* 7. Páginas genéricas ---------- */
const card = (tag, titulo, sub, texto, acao, attr) => `
  <article class="generic-card"${attr || ''}><span class="tag">${tag}</span><h3>${titulo}</h3>
    <b class="card-sub">${sub}</b><p>${texto}</p>
    <div class="card-foot"><span>Comunidade</span>${acao}</div></article>`;

function renderGeneric(p) {
  const [selo, titulo, desc] = titulos[p];
  $('#genericTitle').textContent = titulo; $('#genericDescription').textContent = desc;
  const box = $('#genericContent');

  if (p === 'grupos' || p === 'comunidade') return renderGrupos(box);
  if (p === 'explorar') return renderExplorar(box);   // abas: jogadores · tendências · próximo jogo
  if (p === 'match') return renderMatch(box);

  if (p === 'jogos') {
    if (state.jogo) return renderJogo(box, jogoPorNome(state.jogo) || GAMES[0]);
    Fundo.release();
    box.innerHTML = GAMES.map(g => card(esc(g.tag), esc(g.name), esc(g.genre), esc(g.pitch),
      `<button data-open-game="${esc(g.name)}">Abrir comunidade</button>`, ` data-img-game="${g.key}"`)).join('');
    $$('[data-open-game]', box).forEach(b => b.addEventListener('click', () => { state.jogo = b.dataset.openGame; state.aba = 'overview'; renderGeneric('jogos'); scrollTo({ top: 0, behavior: 'smooth' }); }));
    return aplicarImagens(box);
  }

  // Outras páginas são tratadas acima; fallback de segurança.
  box.innerHTML = '<div class="empty-state">Conteúdo indisponível no momento.</div>';
}


/* ---------- Match: encontrar jogadores compatíveis ---------- */
function renderMatch(box) {
  const cfgKey = 'playlink:match-preferencias';
  const cfg = Store.get(cfgKey, { jogo: 'todos', estilo: 'Todos', horario: 'Todos', online: false, busca: '' });
  const jogosComJogadores = GAMES.filter(g => PLAYERS.some(p => p.jogos.includes(g.key)));
  const matchesSalvos = new Set(Store.get('playlink:matches', []));
  const jogosNome = key => jogoPorKey(key)?.name || key;
  const salvar = () => Store.set(cfgKey, cfg);
  const common = p => p.jogos.filter(k => cfg.jogo === 'todos' || k === cfg.jogo);
  const filtrados = PLAYERS.filter(p => {
    if (p.nome === 'Você') return false;
    if (cfg.jogo !== 'todos' && !p.jogos.includes(cfg.jogo)) return false;
    if (cfg.estilo !== 'Todos' && p.estilo !== cfg.estilo) return false;
    if (cfg.horario !== 'Todos' && p.horario !== cfg.horario) return false;
    if (cfg.online && !p.online) return false;
    const q = cfg.busca.trim().toLowerCase();
    if (q && !`${p.nome} ${p.bio} ${p.nivel} ${p.jogos.map(jogosNome).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b) => {
    const am = a.jogos.filter(k => b.jogos.includes(k)).length;
    const bm = b.jogos.filter(k => a.jogos.includes(k)).length;
    return Number(b.online)-Number(a.online) || bm-am;
  });
  box.innerHTML = `
    <section class="match-shell">
      <div class="match-banner"><div><h2>Seu próximo squad começa aqui.</h2><p>Filtre por jogo, estilo e horário. Encontre alguém compatível e mande uma mensagem para combinar a partida.</p></div><div class="match-banner-icon" aria-hidden="true">${ico('i-link')}</div></div>
      <div class="match-toolbar">
        <label class="match-search">${ico('i-search')}<input id="matchSearch" value="${esc(cfg.busca)}" placeholder="Buscar jogador, jogo ou nível..." aria-label="Buscar jogador, jogo ou nível"></label>
        <label class="match-select-label"><span>Jogo</span><select id="matchGame"><option value="todos">Todos os jogos</option>${jogosComJogadores.map(g=>`<option value="${g.key}" ${cfg.jogo===g.key?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>
        <label class="match-select-label"><span>Estilo</span><select id="matchStyle">${['Todos','Competitivo','Cooperativo','Relaxado','Desafio'].map(v=>`<option ${cfg.estilo===v?'selected':''}>${v}</option>`).join('')}</select></label>
        <label class="match-select-label"><span>Horário</span><select id="matchTime">${['Todos','Tardes','Noites','Madrugadas','Fins de semana'].map(v=>`<option ${cfg.horario===v?'selected':''}>${v}</option>`).join('')}</select></label>
        <label class="match-online"><input id="matchOnline" type="checkbox" ${cfg.online?'checked':''}> Só online</label>
        <button type="button" class="mini-button" id="matchReset">Limpar filtros</button>
      </div>
      <div class="match-results-head"><div><h3>Jogadores para você</h3><p>Perfis de demonstração para testar o matchmaking local.</p></div><span class="tag">${filtrados.length} encontrado(s)</span></div>
      <div class="match-grid">${filtrados.map(p=>{
        const jogoPrincipal = common(p)[0] || p.jogos[0];
        const comuns = p.jogos.filter(k => cfg.jogo==='todos' || k===cfg.jogo);
        const conectado = matchesSalvos.has(p.nome);
        return `<article class="match-card" data-img-game="${jogoPrincipal}">
          <div class="match-card-top"><span class="avatar" style="background:${safeColor(p.cor)}">${esc(iniciais(p.nome))}</span><div class="match-identity"><b>${esc(p.nome)}</b><small class="${p.online?'on':''}"><i></i>${p.online?'Online agora':'Offline'} · ${esc(p.horario)}</small></div><span class="match-fit">${p.online?'Disponível':'Jogador'}</span></div>
          <p class="match-bio">${esc(p.bio)}</p>
          <div class="match-tags"><span class="tag">${esc(p.estilo)}</span><span class="tag">${esc(p.nivel)}</span></div>
          <div class="match-games"><small>Joga</small><div>${p.jogos.map(k=>`<span>${esc(jogosNome(k))}</span>`).join('')}</div></div>
          <div class="match-card-actions"><button type="button" class="mini-button ${conectado?'on':''}" data-match="${esc(p.nome)}">${conectado?'Match enviado ✓':'Dar match'}</button><button type="button" class="primary-button" data-match-msg="${esc(p.nome)}">Mensagem</button></div>
        </article>`;
      }).join('') || '<div class="empty-state match-empty"><b>Nenhum jogador encontrado.</b><p>Tente mudar os filtros para encontrar mais pessoas.</p><button type="button" class="mini-button" id="matchEmptyReset">Limpar filtros</button></div>'}</div>
      <p class="match-footnote">Demonstração front-end: matches, filtros e conversas ficam salvos somente neste navegador. Não há usuários reais conectados a um servidor.</p>
    </section>`;
  aplicarImagens(box);
  const update = () => { salvar(); renderMatch(box); };
  $('#matchSearch',box).addEventListener('input',e=>{cfg.busca=e.target.value; salvar(); const pos=e.target.selectionStart; renderMatch(box); const input=$('#matchSearch',box); input.focus(); input.setSelectionRange(pos,pos);});
  $('#matchGame',box).addEventListener('change',e=>{cfg.jogo=e.target.value;update();});
  $('#matchStyle',box).addEventListener('change',e=>{cfg.estilo=e.target.value;update();});
  $('#matchTime',box).addEventListener('change',e=>{cfg.horario=e.target.value;update();});
  $('#matchOnline',box).addEventListener('change',e=>{cfg.online=e.target.checked;update();});
  const reset=()=>{Object.assign(cfg,{jogo:'todos',estilo:'Todos',horario:'Todos',online:false,busca:''});update();};
  $('#matchReset',box).addEventListener('click',reset);
  $('#matchEmptyReset',box)?.addEventListener('click',reset);
  $$('[data-match]',box).forEach(b=>b.addEventListener('click',()=>{
    const nome=b.dataset.match, set=new Set(Store.get('playlink:matches',[]));
    if(set.has(nome)){set.delete(nome);toast(`Match removido com ${nome}.`);} else {set.add(nome);toast(`É match! Você marcou interesse em ${nome}.`);}
    Store.set('playlink:matches',[...set]); renderMatch(box);
  }));
  $$('[data-match-msg]',box).forEach(b=>b.addEventListener('click',()=>{
    try { const c=DB.criarConversa(b.dataset.matchMsg); state.conversas=DB.conversas(); abrirConversa(c.id); ir('mensagens'); }
    catch(err){toast(err.message);}
  }));
}

function renderGrupos(box) {
  const dentro = DB.participando();
  box.innerHTML = DB.grupos().map(g => `
    <article class="generic-card"><span class="tag">${esc(g.game)}</span><h3>${esc(g.name)}</h3><p>${esc(g.description)}</p>
      <div class="card-foot"><span>${g.members} membros</span>
        <button data-join="${g.id}" class="${dentro.has(g.id) ? 'joined' : ''}">${dentro.has(g.id) ? 'Participando ✓' : 'Participar +'}</button></div></article>`).join('');
  $$('[data-join]', box).forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.join);
    if (DB.participando().has(id)) return toast('Você já participa deste grupo.');
    const g = DB.entrar(id);
    b.classList.add('joined'); b.textContent = 'Participando ✓';
    b.previousElementSibling.textContent = `${g.members} membros`;
    toast(`Você entrou em ${g.name}!`);
  }));
}

/* ---------- 7b. Explorar: Jogadores em destaque · Tendências da comunidade · Seu próximo jogo ----------
   Três abas dentro da página "Explorar". Tudo funciona só com front-end:
   - Jogadores: perfis de demonstração; "Seguir" e "Enviar mensagem" são reais (localStorage + página Mensagens).
   - Tendências: ranking calculado com a atividade que existe neste navegador (tópicos, curtidas, respostas, membros de grupos).
   - Próximo jogo: escolhe estilo + com quem joga e sugere um jogo do catálogo GAMES. */

// Jogadores fictícios de exemplo. "jogos" usa as chaves de GAMES. Para adicionar um, copie uma linha.
const PLAYERS = [
  { nome: 'toniz2', cor: '#2330E6', jogos: ['valorant', 'counter-strike-2'], estilo: 'Competitivo', nivel: 'Imortal 1', horario: 'Noites', online: true, bio: 'Controlador main. Procuro duo para ranked sem tilt.' },
  { nome: 'Luna.exe', cor: '#0C8F6A', jogos: ['minecraft', 'terraria'], estilo: 'Relaxado', nivel: 'Construtora veterana', horario: 'Tardes', online: true, bio: 'Servidores tranquilos e construções enormes. Aceito ajuda com redstone.' },
  { nome: 'kaiju_rj', cor: '#C21E5B', jogos: ['helldivers-2', 'destiny-2'], estilo: 'Cooperativo', nivel: 'Nível 82', horario: 'Fins de semana', online: false, bio: 'Líder de esquadrão. Comunicação antes de qualquer estratégia.' },
  { nome: 'Mirela', cor: '#7A2FD0', jogos: ['stardew-valley', 'baldurs-gate-3'], estilo: 'Relaxado', nivel: 'Campanha 2', horario: 'Noites', online: true, bio: 'Fazenda de dia, campanha de RPG à noite. Procuro grupo fixo.' },
  { nome: 'drako', cor: '#C24A0A', jogos: ['elden-ring', 'monster-hunter-wilds'], estilo: 'Desafio', nivel: 'Nível 150', horario: 'Madrugadas', online: false, bio: 'Invoco para chefes difíceis e cobro o mesmo de volta.' },
  { nome: 'Pixel.Sam', cor: '#1B6FD6', jogos: ['ea-sports-fc', 'apex-legends'], estilo: 'Competitivo', nivel: 'Diamante', horario: 'Tardes', online: true, bio: 'Montando um clube para amistosos e uma dupla para Apex.' },
  { nome: 'vitorbr', cor: '#B3261E', jogos: ['apex-legends', 'pubg'], estilo: 'Competitivo', nivel: 'Mestre', horario: 'Noites', online: false, bio: 'IGL de squad. Procuro duas pessoas que aceitem call.' },
  { nome: 'nina_plays', cor: '#D6286F', jogos: ['palworld', 'minecraft'], estilo: 'Cooperativo', nivel: 'Base nível 40', horario: 'Fins de semana', online: true, bio: 'Construo base, capturo Pals e divido recursos com o grupo.' }
];
const iniciais = n => String(n).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '??';
const seguindo = () => new Set(Store.get('playlink:seguindo', []));

// Pontos de partida da popularidade (a atividade local soma por cima). Jogo fora da lista começa com 20.
const POPULARIDADE = { 'valorant': 90, 'counter-strike-2': 86, 'minecraft': 84, 'gta-vi': 70, 'apex-legends': 62, 'elden-ring': 60,
  'ea-sports-fc': 55, 'helldivers-2': 52, 'baldurs-gate-3': 50, 'palworld': 46, 'monster-hunter-wilds': 44, 'cyberpunk-2077': 40 };

// Perfil de cada jogo para a aba "Seu próximo jogo": [estilos, formas de jogar]. GTA VI fica de fora (ainda não lançado).
const ESTILOS = ['Competitivo', 'Cooperativo', 'Relaxante', 'Aventura'];
const FORMAS = ['Sozinho', 'Em dupla', 'Em squad'];
const PERFIL = {
  'valorant': [['Competitivo'], ['Em dupla', 'Em squad']], 'counter-strike-2': [['Competitivo'], ['Em squad']],
  'apex-legends': [['Competitivo', 'Cooperativo'], ['Em dupla', 'Em squad']], 'pubg': [['Competitivo'], ['Em squad']],
  'ea-sports-fc': [['Competitivo'], ['Sozinho', 'Em dupla']], 'minecraft': [['Relaxante', 'Cooperativo', 'Aventura'], FORMAS],
  'terraria': [['Aventura', 'Relaxante', 'Cooperativo'], FORMAS], 'stardew-valley': [['Relaxante'], ['Sozinho', 'Em dupla']],
  'palworld': [['Cooperativo', 'Aventura'], ['Em dupla', 'Em squad']], 'helldivers-2': [['Cooperativo'], ['Em squad']],
  'destiny-2': [['Cooperativo'], ['Em squad']], 'baldurs-gate-3': [['Aventura', 'Cooperativo'], ['Sozinho', 'Em dupla']],
  'elden-ring': [['Aventura'], ['Sozinho', 'Em dupla']], 'the-witcher-3': [['Aventura'], ['Sozinho']],
  'cyberpunk-2077': [['Aventura'], ['Sozinho']], 'red-dead-redemption-2': [['Aventura'], ['Sozinho']],
  'god-of-war': [['Aventura'], ['Sozinho']], 'monster-hunter-wilds': [['Cooperativo', 'Aventura'], ['Em dupla', 'Em squad']]
};

// Abre a comunidade de um jogo já em uma aba específica (overview | forum | trailers)
const abrirJogoNaAba = (nome, aba) => { state.jogo = nome; state.aba = aba; ir('jogos'); };

function renderExplorar(box) {
  const abas = [['jogadores', 'Jogadores em destaque'], ['tendencias', 'Tendências da comunidade'], ['proximo', 'Seu próximo jogo']];
  box.innerHTML = `<div class="explore-wrap">
    <div class="game-tabs" role="tablist">${abas.map(([id, nome]) =>
      `<button type="button" class="game-tab ${state.exp === id ? 'active' : ''}" data-exp="${id}" role="tab" aria-selected="${state.exp === id}">${nome}</button>`).join('')}</div>
    <div id="explorePanel" class="game-tab-panel" role="tabpanel"></div></div>`;
  $$('[data-exp]', box).forEach(b => b.addEventListener('click', () => { state.exp = b.dataset.exp; renderExplorar(box); }));
  ({ jogadores: renderJogadores, tendencias: renderTendencias, proximo: renderProximo })[state.exp]($('#explorePanel', box));
}

/* --- Aba 1: Jogadores em destaque --- */
function renderJogadores(painel) {
  const f = state.exFiltro, sig = seguindo();
  const comJogadores = GAMES.filter(g => PLAYERS.some(p => p.jogos.includes(g.key)));
  const lista = PLAYERS.filter(p => !f || p.jogos.includes(f)).sort((a, b) => b.online - a.online);   // quem está online aparece primeiro
  painel.innerHTML = `
    <div class="chip-row" role="group" aria-label="Filtrar jogadores por jogo">
      <button type="button" class="chip" data-filtro="" aria-pressed="${!f}">Todos</button>
      ${comJogadores.map(g => `<button type="button" class="chip" data-filtro="${g.key}" aria-pressed="${f === g.key}">${esc(g.name)}</button>`).join('')}
    </div>
    <div class="player-grid">${lista.map(p => `
      <article class="player-card">
        <div class="player-head">
          <span class="avatar" style="background:${safeColor(p.cor)}">${esc(iniciais(p.nome))}</span>
          <div><b>${esc(p.nome)}</b><small class="${p.online ? 'on' : ''}">${p.online ? '● Online agora' : 'Offline'} · ${esc(p.horario)}</small></div>
        </div>
        <p>${esc(p.bio)}</p>
        <div class="player-meta"><span class="tag">${esc(p.estilo)}</span><span class="tag">${esc(p.nivel)}</span></div>
        <div class="player-games">${p.jogos.map(k => esc(jogoPorKey(k)?.name || k)).join(', ')}</div>
        <div class="player-actions">
          <button type="button" class="mini-button ${sig.has(p.nome) ? 'on' : ''}" data-seguir="${esc(p.nome)}">${sig.has(p.nome) ? 'Seguindo ✓' : 'Seguir'}</button>
          <button type="button" class="mini-button" data-msg="${esc(p.nome)}">Enviar mensagem</button>
        </div>
      </article>`).join('') || '<div class="empty-state" style="grid-column:1/-1">Nenhum jogador para este jogo ainda.</div>'}</div>`;

  $$('[data-filtro]', painel).forEach(b => b.addEventListener('click', () => { state.exFiltro = b.dataset.filtro; renderJogadores(painel); }));
  $$('[data-seguir]', painel).forEach(b => b.addEventListener('click', () => {
    const nome = b.dataset.seguir, s = seguindo();
    s.has(nome) ? s.delete(nome) : s.add(nome);
    Store.set('playlink:seguindo', [...s]);
    toast(s.has(nome) ? `Você começou a seguir ${nome}.` : `Você deixou de seguir ${nome}.`);
    renderJogadores(painel);
  }));
  $$('[data-msg]', painel).forEach(b => b.addEventListener('click', () => {
    try {
      const c = DB.criarConversa(b.dataset.msg);   // reaproveita a conversa se já existir
      state.conversas = DB.conversas(); abrirConversa(c.id); ir('mensagens');
    } catch (err) { toast(err.message); }
  }));
}

/* --- Aba 2: Tendências da comunidade --- */
function tendencias() {
  const grupos = DB.grupos();
  return GAMES.map(g => {
    const posts = Store.get(`playlink:forum:${g.key}`, []);
    const interacoes = posts.reduce((s, p) => s + (p.likes || 0) + (p.replies?.length || 0) * 2, 0);
    const membros = grupos.filter(x => x.game === g.name).reduce((s, x) => s + x.members, 0);
    return { g, posts: posts.length, membros, pontos: (POPULARIDADE[g.key] ?? 20) + posts.length * 8 + interacoes * 3 + membros };
  }).sort((a, b) => b.pontos - a.pontos);
}
function renderTendencias(painel) {
  const rank = tendencias().slice(0, 8), maximo = rank[0].pontos || 1;
  const topicos = GAMES.flatMap(g => Store.get(`playlink:forum:${g.key}`, []).map(p => ({ g, p, calor: (p.likes || 0) + (p.replies?.length || 0) * 2 })))
    .sort((a, b) => b.calor - a.calor).slice(0, 5);
  const grupos = [...DB.grupos()].sort((a, b) => b.members - a.members).slice(0, 3);
  painel.innerHTML = `<div class="trend-layout">
    <section class="trend-box">
      <h3>Jogos em alta</h3>
      <p>Calculado com tópicos, curtidas, respostas e membros de grupos do Playlink.</p>
      ${rank.map((r, i) => `
        <button type="button" class="trend-row" data-abrir="${esc(r.g.name)}">
          <span class="trend-rank">${i + 1}</span>
          <span class="trend-name"><b>${esc(r.g.name)}</b><small>${r.posts} tópico(s) · ${r.membros} membro(s) em grupos</small>
            <span class="trend-bar"><i style="width:${Math.max(6, Math.round(r.pontos / maximo * 100))}%"></i></span></span>
          <span class="trend-score">${r.pontos} pts</span>
        </button>`).join('')}
    </section>
    <div class="trend-side">
      <section class="trend-box">
        <h3>Tópicos mais comentados</h3>
        <p>Os tópicos do fórum com mais curtidas e respostas.</p>
        ${topicos.length ? topicos.map((t, i) => `
          <button type="button" class="topic-item" data-topico="${i}">
            <b>${esc(t.p.title)}</b>
            <small>${esc(t.g.name)} · ♡ ${t.p.likes || 0} · ${t.p.replies?.length || 0} resposta(s)</small>
          </button>`).join('') : `<div class="empty-state"><b>Nenhum tópico publicado ainda.</b>
            <p>Abra o fórum de um jogo e comece a conversa. Os tópicos mais comentados aparecem aqui.</p>
            <button type="button" class="mini-button" data-escolher-jogo>Escolher um jogo</button></div>`}
      </section>
      <section class="trend-box">
        <h3>Grupos em crescimento</h3>
        <p>Os grupos com mais membros agora.</p>
        ${grupos.map(g => `<div class="topic-item static"><b>${esc(g.name)}</b><small>${esc(g.game)} · ${g.members} membros</small></div>`).join('')}
        <button type="button" class="mini-button" data-ver-grupos style="margin-top:12px">Ver todos os grupos</button>
      </section>
    </div></div>`;

  $$('[data-abrir]', painel).forEach(b => b.addEventListener('click', () => abrirJogo(b.dataset.abrir)));
  $$('[data-topico]', painel).forEach(b => b.addEventListener('click', () => abrirJogoNaAba(topicos[+b.dataset.topico].g.name, 'forum')));
  $('[data-escolher-jogo]', painel)?.addEventListener('click', () => { state.jogo = null; ir('jogos'); });
  $('[data-ver-grupos]', painel).addEventListener('click', () => ir('grupos'));
}

/* --- Aba 3: Seu próximo jogo --- */
// Jogos cujo estilo combina com o escolhido; os que também combinam com a forma de jogar vêm primeiro
function sugestoes(estilo, forma) {
  return GAMES.filter(g => PERFIL[g.key])
    .map(g => ({ g, pts: (PERFIL[g.key][0].includes(estilo) ? 2 : 0) + (PERFIL[g.key][1].includes(forma) ? 1 : 0) }))
    .filter(x => x.pts >= 2).sort((a, b) => b.pts - a.pts).map(x => x.g);
}
function renderProximo(painel) {
  const s = state.prox ||= Store.get('playlink:proximo', { estilo: '', forma: '', i: 0 });
  const salvar = () => Store.set('playlink:proximo', s);
  const chips = (lista, campo) => lista.map(v => `<button type="button" class="chip" data-campo="${campo}" data-valor="${esc(v)}" aria-pressed="${s[campo] === v}">${esc(v)}</button>`).join('');
  const lista = s.estilo && s.forma ? sugestoes(s.estilo, s.forma) : [];
  const pick = lista.length ? lista[s.i % lista.length] : null;

  painel.innerHTML = `
    <div class="next-form">
      <div><b>Como você quer jogar?</b><div class="chip-row" role="group" aria-label="Estilo de jogo">${chips(ESTILOS, 'estilo')}</div></div>
      <div><b>Com quem?</b><div class="chip-row" role="group" aria-label="Com quem você vai jogar">${chips(FORMAS, 'forma')}</div></div>
    </div>
    ${!(s.estilo && s.forma) ? '<div class="empty-state">Escolha como quer jogar e com quem para ver uma sugestão.</div>'
      : !pick ? '<div class="empty-state">Não encontramos um jogo para essa combinação. Tente outro estilo.</div>' : `
    <article class="next-pick" data-img-game="${pick.key}">
      <span class="tag">${esc(pick.tag)}</span>
      <h3>${esc(pick.name)}</h3>
      <p>${esc(pick.about)}</p>
      <p>${esc(pick.pitch)}</p>
      <div class="next-actions">
        <button type="button" class="primary-button" data-abrir-pick>Abrir comunidade</button>
        ${pick.trailers.length ? '<button type="button" class="mini-button" data-trailer-pick>Ver trailer</button>' : ''}
        ${lista.length > 1 ? '<button type="button" class="mini-button" data-outra>Outra sugestão</button>' : ''}
      </div>
    </article>
    ${lista.length > 1 ? `<div class="next-others"><span>Também combinam:</span>${lista.filter(g => g !== pick).slice(0, 4).map(g =>
      `<button type="button" class="chip" data-troca="${g.key}" aria-pressed="false">${esc(g.name)}</button>`).join('')}</div>` : ''}`}`;

  aplicarImagens(painel);
  $$('[data-campo]', painel).forEach(b => b.addEventListener('click', () => { s[b.dataset.campo] = b.dataset.valor; s.i = 0; salvar(); renderProximo(painel); }));
  if (!pick) return;
  $('[data-abrir-pick]', painel).addEventListener('click', () => abrirJogo(pick.name));
  $('[data-trailer-pick]', painel)?.addEventListener('click', () => abrirJogoNaAba(pick.name, 'trailers'));
  $('[data-outra]', painel)?.addEventListener('click', () => { s.i = (s.i + 1) % lista.length; salvar(); renderProximo(painel); });
  $$('[data-troca]', painel).forEach(b => b.addEventListener('click', () => { s.i = lista.findIndex(g => g.key === b.dataset.troca); salvar(); renderProximo(painel); }));
}

/* 8. Página de um jogo (abas Visão geral / Fórum / Trailers) ---------- */
function renderJogo(box, g) {
  Fundo.focus(g);   // o fundo do site vira a imagem deste jogo
  const aba = (id, nome) => `<button class="game-tab ${state.aba === id ? 'active' : ''}" data-game-tab="${id}" role="tab" aria-selected="${state.aba === id}">${nome}</button>`;
  box.innerHTML = `
    <section class="game-detail" data-img-game="${g.key}">
      <div class="game-detail-top"><div><span class="tag">${esc(g.tag)}</span><h2>${esc(g.name)}</h2><p>${esc(g.about)}</p></div>
        <button class="back-games" id="backToGames">← Todos os jogos</button></div>
      <div class="game-tabs" role="tablist">${aba('overview', 'Visão geral')}${aba('forum', 'Fórum')}${aba('trailers', 'Trailers')}</div>
      <div id="gameTabPanel" class="game-tab-panel"></div>
    </section>`;
  aplicarImagens(box);
  $('#backToGames').addEventListener('click', () => { state.jogo = null; state.aba = 'overview'; renderGeneric('jogos'); });
  const trocar = aba => { state.aba = aba; renderJogo(box, g); };
  $$('[data-game-tab]', box).forEach(b => b.addEventListener('click', () => trocar(b.dataset.gameTab)));

  const painel = $('#gameTabPanel');
  if (state.aba === 'forum') renderForum(painel, g);
  else if (state.aba === 'trailers') renderTrailers(painel, g);
  else {
    painel.innerHTML = `<div class="game-overview-grid">
      <article class="game-info-tile"><span class="game-info-icon">${ico('f-find')}</span><b>Encontre jogadores</b><p>Procure parceiros para partidas casuais ou competitivas.</p></article>
      <article class="game-info-tile"><span class="game-info-icon">${ico('f-news')}</span><b>Participe do fórum</b><p>Compartilhe dicas, dúvidas, teorias e procure grupos.</p><button class="mini-button" data-jump="forum">Abrir fórum</button></article>
      <article class="game-info-tile"><span class="game-info-icon">${ico('i-play')}</span><b>Trailers e vídeos</b><p>Assista aos trailers sem sair do Playlink.</p><button class="mini-button" data-jump="trailers">Ver trailers</button></article></div>`;
    $$('[data-jump]', painel).forEach(b => b.addEventListener('click', () => trocar(b.dataset.jump)));
  }
}

// Fórum: tópicos salvos por jogo em "playlink:forum:<jogo>"
function renderForum(painel, g) {
  const chave = `playlink:forum:${g.key}`;
  painel.innerHTML = `
    <div class="forum-toolbar"><div><h3>Fórum de ${esc(g.name)}</h3><p class="sub">Dúvidas, dicas e conversas da comunidade.</p></div><span class="tag" id="forumCount"></span></div>
    <form id="forumForm" class="forum-form"><input id="fTitulo" maxlength="100" required placeholder="Título do tópico (ex.: dicas para iniciantes)">
      <textarea id="fCorpo" maxlength="1500" required placeholder="Escreva sua publicação..."></textarea>
      <div style="display:flex;justify-content:flex-end"><button class="primary-button" type="submit">Publicar tópico</button></div></form>
    <div class="forum-post-list" id="forumList"></div>`;
  const lista = $('#forumList', painel);
  const agora = () => new Date().toLocaleString('pt-BR');
  const mudar = (i, fn) => { const a = Store.get(chave, []); fn(a[i]); Store.set(chave, a); desenhar(); };

  function desenhar() {
    const posts = Store.get(chave, []);
    $('#forumCount', painel).textContent = `${posts.length} tópicos`;
    lista.innerHTML = posts.map((p, i) => `
      <article class="forum-post">
        <div class="forum-post-head"><span class="avatar avatar-small cyan">V</span><div><b>${esc(p.author)}</b><small>${esc(p.date)}</small></div><span class="tag">Discussão</span></div>
        <h4>${esc(p.title)}</h4><p>${esc(p.body)}</p>
        ${p.replies?.length ? `<div class="replies">${p.replies.map(r => `<p><b>${esc(r.author)}:</b> ${esc(r.body)}</p>`).join('')}</div>` : ''}
        <div class="forum-post-actions"><button type="button" data-like="${i}">Curtir (${p.likes || 0})</button><button type="button" data-reply="${i}">Responder</button></div>
      </article>`).join('') || '<div class="empty-state">Ainda não há tópicos. Seja o primeiro a iniciar uma conversa!</div>';
    $$('[data-like]', lista).forEach(b => b.addEventListener('click', () => mudar(+b.dataset.like, p => p.likes = (p.likes || 0) + 1)));
    $$('[data-reply]', lista).forEach(b => b.addEventListener('click', () => {
      const t = prompt('Responder ao tópico:');
      if (t?.trim()) { mudar(+b.dataset.reply, p => (p.replies = p.replies || []).push({ author: 'Você', body: t.trim().slice(0, 1500), date: agora() })); toast('Resposta adicionada.'); }
    }));
  }
  desenhar();
  $('#forumForm', painel).addEventListener('submit', e => {
    e.preventDefault();
    const a = Store.get(chave, []);
    a.unshift({ title: $('#fTitulo', painel).value.trim(), body: $('#fCorpo', painel).value.trim(), author: 'Você', date: agora(), likes: 0, replies: [] });
    Store.set(chave, a); e.target.reset(); desenhar(); toast('Tópico publicado!');
  });
}

/* Trailers: reprodução dentro do Playlink.
   O vídeo só é incorporado após o clique, evitando iframes pesados e autoplay inesperado.
   Se o YouTube recusar a incorporação, o player avisa e oferece o link para abrir direto no YouTube. */
// Aceita um ID de 11 caracteres (formato do catálogo GAMES) ou qualquer link do YouTube; devolve o ID ou null.
function youtubeId(v) {
  const s = String(v ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s), h = u.hostname.replace(/^(www|m)\./, '');
    const id = h === 'youtu.be' ? u.pathname.slice(1).split('/')[0]
      : h.endsWith('youtube.com') ? (u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/)?.[1]) : null;
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
function renderTrailers(painel, g) {
  const videos = g.trailers.map(v => ({ ...v, id: youtubeId(v.id) })).filter(v => v.id);
  painel.innerHTML = `
    <div class="trailer-heading"><div><h3>Trailers e vídeos</h3><p class="sub">Assista aqui mesmo, dentro do Playlink.</p></div><span class="tag">${videos.length} vídeo(s)</span></div>
    <div class="trailer-grid">${videos.map(v => `
      <article class="trailer-card" data-video="${esc(v.id)}">
        <div class="trailer-visual"><button type="button" class="trailer-poster" data-play aria-label="Reproduzir ${esc(v.title)}">
          <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="Capa de ${esc(v.title)}" loading="lazy" referrerpolicy="no-referrer"><span class="play">▶</span></button></div>
        <h4>${esc(v.title)}</h4><p>${esc(v.channel)}</p>
        <div class="trailer-actions">
          <button type="button" class="mini-button" data-play-again>▶ Assistir no Playlink</button>
          <a class="mini-button" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener noreferrer">Abrir no YouTube</a>
        </div>
      </article>`).join('') || `<div class="empty-state" style="grid-column:1/-1"><b>Estamos preparando os trailers de ${esc(g.name)}.</b><p>Esta comunidade já está pronta para fóruns e discussões.</p></div>`}</div>
    <p class="trailer-note">Alguns vídeos bloqueiam a incorporação, e o player do YouTube também não funciona se o site for aberto direto do arquivo (endereço file://). Nesses casos, use “Abrir no YouTube” ou publique o site em um servidor (http/https).</p>`;

  function tocar(card) {
    const id = card.dataset.video, visual = $('.trailer-visual', card);
    const origem = /^https?:$/.test(location.protocol) ? `&origin=${encodeURIComponent(location.origin)}` : '';
    visual.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1&enablejsapi=1${origem}" title="${esc($('h4', card).textContent)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    const frame = $('iframe', visual);
    // Com enablejsapi=1 o player avisa quando dá erro (vídeo bloqueado, indisponível...). Aí mostramos o link alternativo.
    const falha = () => {
      removeEventListener('message', ouvir);
      visual.innerHTML = `<div class="trailer-unavailable">Este vídeo não pôde ser reproduzido aqui.<br><a class="mini-button" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">Assistir no YouTube</a></div>`;
    };
    const ouvir = e => {
      if (!frame.isConnected) return removeEventListener('message', ouvir);
      if (e.source !== frame.contentWindow) return;
      try { if (JSON.parse(e.data).event === 'onError') falha(); } catch { /* mensagem que não é do player */ }
    };
    addEventListener('message', ouvir);
    frame.addEventListener('load', () => frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'));
  }
  $$('[data-play], [data-play-again]', painel).forEach(b => b.addEventListener('click', () => tocar(b.closest('.trailer-card'))));
  $$('.trailer-poster img', painel).forEach(img => img.addEventListener('error', () => {
    img.style.display = 'none';
    const poster = img.closest('.trailer-poster');
    if (poster) poster.style.background = 'linear-gradient(135deg,#18264a,#49316f)';
  }));
}

/* 9. Contagem regressiva do GTA VI ---------- */
const LANCAMENTO = new Date(2026, 10, 19);   // mês começa em 0 (10 = novembro); altere aqui se a data mudar
function contagem() {
  const dois = n => String(n).padStart(2, '0');
  const atualizar = () => {
    const f = Math.max(0, LANCAMENTO - new Date());
    [['Days', f / 864e5], ['Hours', f % 864e5 / 36e5], ['Mins', f % 36e5 / 6e4], ['Secs', f % 6e4 / 1e3]]
      .forEach(([id, v]) => $('#cd' + id).textContent = dois(Math.floor(v)));
  };
  atualizar(); setInterval(atualizar, 1000);
}

/* 10. INICIALIZAÇÃO — preparo os dados e carrego a primeira tela quando o site abre. */
DB.seed();
$('#connectionState').textContent = Store.persistente ? 'Modo local · dados salvos neste navegador' : 'Modo local · armazenamento bloqueado (dados temporários)';
contagem();
aplicarImagens();   // imagens nos cards da home
Fundo.start();      // fundo com imagens dos jogos
setPage(location.hash.slice(1) || 'inicio');
