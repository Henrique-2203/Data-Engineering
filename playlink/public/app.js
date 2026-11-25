/* PLAYLINK — lógica do site.
   Os dados (contas, perfis, grupos, avaliações, mensagens e fórum) ficam num banco PostgreSQL e chegam pela API (/api).
   Só o catálogo visual dos jogos (capas e trailers) continua aqui no código. */
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

const Store = (() => {
  let ok = true; const mem = new Map();
  try { localStorage.setItem('_t', 1); localStorage.removeItem('_t'); } catch { ok = false; }
  return {
    get persistente() { return ok; },
    get(k, pad) { try { const r = ok ? localStorage.getItem(k) : mem.get(k); return r ? JSON.parse(r) : pad; } catch { return pad; } },
    set(k, v) { const r = JSON.stringify(v); if (ok) try { return localStorage.setItem(k, r); } catch { ok = false; } mem.set(k, r); }
  };
})();
const iniciais = n => String(n).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '??';
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

/* 4. API — fala com o servidor. O navegador nunca acessa o banco direto. */
const API = {
  async req(metodo, url, corpo) {
    let r;
    try {
      r = await fetch('/api' + url, { method: metodo, credentials: 'same-origin',
        headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {}, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
    } catch { throw Object.assign(Error('Sem conexão com o servidor.'), { status: 0 }); }
    let d = null; try { d = await r.json(); } catch { /* resposta sem corpo */ }
    if (!r.ok) throw Object.assign(Error(d?.erro || 'Algo deu errado. Tente de novo.'), { status: r.status });
    return d;
  },
  get: u => API.req('GET', u), post: (u, c = {}) => API.req('POST', u, c), put: (u, c) => API.req('PUT', u, c)
};
const state = { page: 'inicio', eu: null, jogosDb: new Map(), conversas: [], ativa: null, messages: [], filtro: '', jogo: null, aba: 'overview', timer: null, exp: 'jogadores', exFiltro: '', prox: null,
  match: { jogo: 'todos', estilo: 'Todos', horario: 'Todos', online: false, busca: '' }, gFiltro: '' };
const HORARIOS = ['Madrugadas', 'Manhãs', 'Tardes', 'Noites', 'Fins de semana'];
const ESTILOS_P = ['Competitivo', 'Cooperativo', 'Relaxante', 'Aventura'];
const idDoJogo = nome => state.jogosDb.get(nome)?.jogo_id;
const nota = v => (Number(v) > 0 ? `★ ${Number(v).toFixed(1).replace('.', ',')}` : 'Sem avaliações');
const cor = p => safeColor(p?.cor_avatar);
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(state.timer); state.timer = setTimeout(() => el.classList.remove('show'), 2800);
}
// Executa uma ação; se der erro mostra o aviso, e se faltar login abre a janela de entrada.
async function tentar(fn) {
  try { return await fn(); }
  catch (e) { if (e.status === 401) { abrirAuth('entrar'); toast('Entre na sua conta para continuar.'); } else toast(e.message); }
}
const logado = () => { if (state.eu) return true; abrirAuth('entrar'); toast('Entre na sua conta para continuar.'); return false; };
async function carregarEu() {
  state.eu = (await API.get('/eu').catch(() => ({ usuario: null }))).usuario;
  const b = $('#profileButton');
  b.innerHTML = state.eu ? `<span class="avatar avatar-small cyan" style="background:${cor(state.eu)}">${esc(iniciais(state.eu.nome_usuario))}</span><span>${esc(state.eu.nome_usuario)}</span>${ico('i-chev')}`
    : `<span class="avatar avatar-small cyan">?</span><span>Entrar</span>${ico('i-chev')}`;
  b.querySelector('span:nth-child(2)').style.display = 'inline';
}

/* 5. NAVEGAÇÃO — controla qual página está aberta. */
const titulos = {
  jogos: ['SEU PRÓXIMO DESAFIO', 'Jogos', 'Encontre comunidades para os jogos que você curte.'],
  match: ['JOGUE COM QUEM COMBINA', 'Match', 'Encontre jogadores com os mesmos jogos e horários que os seus.'],
  explorar: ['DESCUBRA A COMUNIDADE', 'Explorar', 'Descubra jogadores, jogos e grupos para sua próxima partida.'],
  grupos: ['SUA PARTY, SUAS REGRAS', 'Grupos', 'Entre em grupos, encontre seu squad e jogue junto.'],
  comunidade: ['A COMUNIDADE PLAYLINK', 'Comunidade', 'Grupos e pessoas que compartilham sua paixão por games.']
};
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
const ir = p => location.hash.slice(1) === p ? setPage(p) : (location.hash = p);
addEventListener('hashchange', () => setPage(location.hash.slice(1) || 'inicio'));
const abrirJogo = nome => { state.jogo = nome; state.aba = 'overview'; ir('jogos'); };

$$('[data-page]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); if (a.dataset.page === 'jogos') state.jogo = null; ir(a.dataset.page); }));
$$('[data-go]').forEach(b => b.addEventListener('click', () => { if (b.dataset.go === 'jogos') state.jogo = null; ir(b.dataset.go); }));
$$('[data-game]').forEach(b => b.addEventListener('click', () => abrirJogo(b.dataset.game)));
$('#mobileMenu').addEventListener('click', () => $('.main-nav').classList.toggle('open'));
$('#watchDemo').addEventListener('click', () => toast('O Playlink conecta jogadores, grupos e mensagens em um só lugar.'));
$('#notifications').addEventListener('click', () => toast(state.eu ? 'Você está em dia! Nenhuma notificação nova.' : 'Entre para ver suas notificações.'));
$('#profileButton').addEventListener('click', () => state.eu ? abrirMeuPerfil() : abrirAuth('entrar'));
$('#genericAction').addEventListener('click', () => {
  if (state.page === 'explorar') { state.exp = 'jogadores'; renderGeneric('explorar'); }
  else if (state.page === 'match') { $('#matchSearch')?.focus(); $('#genericContent')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (state.page === 'jogos') { state.jogo = null; renderGeneric('jogos'); }
  else if (state.page === 'grupos' || state.page === 'comunidade') abrirNovoGrupo(null);
  else ir('explorar');
});
$('#globalSearch').addEventListener('keydown', e => {
  const q = e.target.value.trim();
  if (e.key === 'Enter' && q) { state.exp = 'jogadores'; state.exFiltro = ''; ir('explorar'); }
});

/* ---------- Janelas: entrar / criar conta, meu perfil, perfil de outro jogador, novo grupo ---------- */
const janela = id => { let d = document.getElementById(id); if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'dialog'; document.body.appendChild(d); } return d; };
const fecharJanela = d => d.close();
async function abrirAuth(modo) {
  const d = janela('authDialog');
  const [paises, idiomas] = modo === 'criar' ? await Promise.all([API.get('/paises').catch(() => []), API.get('/idiomas').catch(() => [])]) : [[], []];
  d.innerHTML = `<form id="authForm" autocomplete="on">
    <div class="dialog-head"><h2>${modo === 'criar' ? 'Criar conta' : 'Entrar'}</h2><button type="button" class="icon-button small" data-fechar aria-label="Fechar">${ico('i-x')}</button></div>
    <p>${modo === 'criar' ? 'Crie seu perfil de jogador e encontre pessoas para jogar.' : 'Entre para formar grupos, avaliar jogadores e mandar mensagens.'}</p>
    ${modo === 'criar' ? `
      <label>Nome de usuário<input name="nome_usuario" required minlength="3" maxlength="30" pattern="[A-Za-z0-9_.]{3,30}" autocomplete="username" placeholder="ex.: gamer123"></label>
      <label>E-mail<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label>Senha (mínimo 8 caracteres)<input name="senha" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></label>
      <label>País<select name="pais"><option value="">Prefiro não informar</option>${paises.map(p => `<option value="${esc(p.codigo_iso)}">${esc(p.nome_pais)}</option>`).join('')}</select></label>
      <label>Idioma<select name="idioma"><option value="">Prefiro não informar</option>${idiomas.map(i => `<option value="${esc(i.codigo_iso)}">${esc(i.nome_idioma)}</option>`).join('')}</select></label>`
    : `<label>Usuário ou e-mail<input name="login" required maxlength="254" autocomplete="username"></label>
       <label>Senha<input name="senha" type="password" required maxlength="72" autocomplete="current-password"></label>`}
    <div id="authErro" class="form-erro" role="alert"></div>
    <div class="dialog-actions"><button type="button" class="subtle-button" data-troca>${modo === 'criar' ? 'Já tenho conta' : 'Criar conta'}</button><button class="primary-button" type="submit">${modo === 'criar' ? 'Criar conta' : 'Entrar'}</button></div>
  </form>`;
  $('[data-fechar]', d).addEventListener('click', () => fecharJanela(d));
  $('[data-troca]', d).addEventListener('click', () => abrirAuth(modo === 'criar' ? 'entrar' : 'criar'));
  $('#authForm', d).addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); for (const k of ['pais', 'idioma']) if (!f[k]) delete f[k];
    try {
      await API.post(modo === 'criar' ? '/auth/registrar' : '/auth/entrar', f);
      fecharJanela(d); await carregarEu(); toast(modo === 'criar' ? 'Conta criada! Complete seu perfil para aparecer no Match.' : `Bem-vindo, ${state.eu.nome_usuario}!`);
      setPage(state.page); if (modo === 'criar') abrirMeuPerfil();
    } catch (err) { $('#authErro', d).textContent = err.message; }
  });
  if (!d.open) d.showModal();
}
async function abrirMeuPerfil() {
  await carregarEu(); if (!state.eu) return abrirAuth('entrar');
  const u = state.eu, d = janela('profileDialog'), meus = new Set(u.jogos.map(j => j.jogo_id));
  d.innerHTML = `<form id="profileForm">
    <div class="dialog-head"><h2>Meu perfil</h2><button type="button" class="icon-button small" data-fechar aria-label="Fechar">${ico('i-x')}</button></div>
    <p><b>${esc(u.nome_usuario)}</b> · ${nota(u.reputacao)} · ${u.seguidores} seguidor(es)</p>
    <label>Sobre você<textarea name="bio" maxlength="300" rows="2" placeholder="Ex.: procuro duo para ranked">${esc(u.bio || '')}</textarea></label>
    <div class="form-linha">
      <label>Estilo<select name="estilo"><option value="">—</option>${ESTILOS_P.map(v => `<option ${u.estilo === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Horário em que joga<select name="horario_disponivel"><option value="">—</option>${HORARIOS.map(v => `<option ${u.horario_disponivel === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label>Nível / rank<input name="nivel" maxlength="60" value="${esc(u.nivel || '')}" placeholder="Ex.: Diamante"></label>
    <fieldset class="jogos-check"><legend>Jogos que você joga</legend>${[...state.jogosDb.values()].map(j => `<label class="check"><input type="checkbox" name="jogo" value="${j.jogo_id}" ${meus.has(j.jogo_id) ? 'checked' : ''}> ${esc(j.titulo)}</label>`).join('')}</fieldset>
    <label>Seu usuário no Resenha (chat gratuito)<input name="usuario_resenha" maxlength="30" pattern="[A-Za-z0-9_.]{3,30}" value="${esc(u.usuario_resenha || '')}" placeholder="opcional — para seus amigos te adicionarem"></label>
    <div id="perfilErro" class="form-erro" role="alert"></div>
    <div class="dialog-actions"><button type="button" class="subtle-button" id="btnSair">Sair da conta</button><button class="primary-button" type="submit">Salvar</button></div>
  </form>`;
  $('[data-fechar]', d).addEventListener('click', () => fecharJanela(d));
  $('#btnSair', d).addEventListener('click', async () => { await API.post('/auth/sair').catch(() => {}); fecharJanela(d); await carregarEu(); toast('Você saiu da conta.'); setPage(state.page); });
  $('#profileForm', d).addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      await API.put('/perfil', { bio: f.get('bio') || null, estilo: f.get('estilo') || null, nivel: f.get('nivel') || null, horario_disponivel: f.get('horario_disponivel') || null,
        jogos: f.getAll('jogo').map(Number), usuario_resenha: f.get('usuario_resenha') || null });
      fecharJanela(d); await carregarEu(); toast('Perfil salvo!'); setPage(state.page);
    } catch (err) { $('#perfilErro', d).textContent = err.message; }
  });
  if (!d.open) d.showModal();
}
// Perfil de outro jogador: reputação, jogos, avaliações e o botão para adicionar no Resenha
async function abrirPerfil(nome) {
  const u = await tentar(() => API.get('/usuarios/' + encodeURIComponent(nome))); if (!u) return;
  const d = janela('playerDialog'), resenha = u.usuario_resenha;
  d.innerHTML = `<div class="dialog-body">
    <div class="dialog-head"><h2>${esc(u.nome_usuario)}</h2><button type="button" class="icon-button small" data-fechar aria-label="Fechar">${ico('i-x')}</button></div>
    <p>${u.online ? '● Online agora' : 'Offline'} · ${nota(u.reputacao)} · ${u.seguidores} seguidor(es)${u.pais ? ' · ' + esc(u.pais) : ''}</p>
    ${u.bio ? `<p>${esc(u.bio)}</p>` : ''}
    <div class="player-meta">${[u.estilo, u.nivel, u.horario_disponivel].filter(Boolean).map(v => `<span class="tag">${esc(v)}</span>`).join('')}</div>
    <p class="player-games">${u.jogos.map(j => esc(j.titulo)).join(', ') || 'Ainda não escolheu jogos.'}</p>
    <h3 class="sub-h">Avaliações recebidas</h3>
    ${u.avaliacoes.length ? u.avaliacoes.map(a => `<p class="aval"><b>★ ${a.nota}</b> ${esc(a.avaliador)} <small>em ${esc(a.grupo)}</small>${a.comentario ? `<br>${esc(a.comentario)}` : ''}</p>`).join('') : '<p class="sub">Nenhuma avaliação ainda.</p>'}
    <div class="dialog-actions">
      ${resenha ? `<span class="sub">No Resenha: <b>${esc(resenha)}</b></span><a class="primary-button" href="https://resenhabr.com.br/app?add=${encodeURIComponent(resenha)}" target="_blank" rel="noopener noreferrer">Adicionar no Resenha</a>` : '<span class="sub">Ainda não vinculou uma conta do Resenha.</span>'}
      <button type="button" class="mini-button" data-msg>Mensagem</button>
    </div></div>`;
  $('[data-fechar]', d).addEventListener('click', () => fecharJanela(d));
  $('[data-msg]', d).addEventListener('click', () => { fecharJanela(d); abrirConversaCom(u.nome_usuario); });
  if (!d.open) d.showModal();
}
function abrirNovoGrupo(jogoPadrao) {
  if (!logado()) return;
  const d = janela('groupDialog');
  d.innerHTML = `<form id="groupForm">
    <div class="dialog-head"><h2>Criar grupo</h2><button type="button" class="icon-button small" data-fechar aria-label="Fechar">${ico('i-x')}</button></div>
    <label>Jogo<select name="jogo_id" required>${[...state.jogosDb.values()].map(j => `<option value="${j.jogo_id}" ${j.titulo === jogoPadrao ? 'selected' : ''}>${esc(j.titulo)}</option>`).join('')}</select></label>
    <label>Título<input name="titulo" required minlength="3" maxlength="100" placeholder="Ex.: Squad da madrugada"></label>
    <label>Descrição<textarea name="descricao" maxlength="500" rows="2" placeholder="O que vocês vão jogar?"></textarea></label>
    <label>Máximo de integrantes<input name="max_membros" type="number" min="2" max="100" value="5" required></label>
    <div id="grupoErro" class="form-erro" role="alert"></div>
    <div class="dialog-actions"><button type="button" class="subtle-button" data-fechar>Cancelar</button><button class="primary-button" type="submit">Criar grupo</button></div></form>`;
  $$('[data-fechar]', d).forEach(b => b.addEventListener('click', () => fecharJanela(d)));
  $('#groupForm', d).addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await API.post('/grupos', { jogo_id: Number(f.jogo_id), titulo: f.titulo, descricao: f.descricao || undefined, max_membros: Number(f.max_membros) }); fecharJanela(d); toast('Grupo criado!'); ir('grupos'); if (state.page === 'grupos') renderGeneric('grupos'); }
    catch (err) { $('#grupoErro', d).textContent = err.message; }
  });
  d.showModal();
}

/* 6. MENSAGENS — conversas diretas entre contas, guardadas no banco. */
async function carregarConversas() {
  const lista = $('#conversationList');
  if (!state.eu) {
    state.conversas = []; state.ativa = null;
    lista.innerHTML = '<div class="loading">Entre na sua conta para ver suas conversas.</div>';
    $('#chatActive').classList.add('hidden'); $('#chatEmpty').classList.remove('hidden');
    return;
  }
  const do_servidor = await tentar(() => API.get('/conversas')) || [];
  // mantém a conversa recém-iniciada (ainda sem mensagens) na lista
  const extra = state.conversas.filter(c => c.local && !do_servidor.some(x => x.nome_usuario === c.nome_usuario));
  state.conversas = [...extra, ...do_servidor.map(c => ({ ...c, local: false }))].sort((a, b) => String(b.quando || '9').localeCompare(String(a.quando || '9')));
  renderConversas();
  if (state.conversas.some(c => c.nome_usuario === state.ativa)) carregarMensagens();
  else if (state.conversas.length) abrirConversa(state.conversas[0].nome_usuario);
  else { $('#chatActive').classList.add('hidden'); $('#chatEmpty').classList.remove('hidden'); }
}
function renderConversas() {
  const lista = $('#conversationList');
  const f = state.conversas.filter(c => `${c.nome_usuario} ${c.ultima || ''}`.toLowerCase().includes(state.filtro));
  lista.innerHTML = f.length ? f.map(c => `
    <button class="conversation-item ${c.nome_usuario === state.ativa ? 'selected' : ''}" data-nome="${esc(c.nome_usuario)}">
      <span class="avatar" style="background:${cor(c)}">${esc(iniciais(c.nome_usuario))}</span>
      <span class="conversation-meta"><b>${esc(c.nome_usuario)}</b><small>${esc(c.ultima || 'Nova conversa')}</small></span>
      <span class="conversation-time">${hora(c.quando)}</span>
    </button>`).join('') : '<div class="loading">Nenhuma conversa ainda. Use o + para começar uma.</div>';
  $$('.conversation-item', lista).forEach(b => b.addEventListener('click', () => abrirConversa(b.dataset.nome)));
}
function abrirConversa(nome) {
  state.ativa = nome; renderConversas();
  $('#chatEmpty').classList.add('hidden'); $('#chatActive').classList.remove('hidden');
  const c = state.conversas.find(x => x.nome_usuario === nome);
  $('#chatName').textContent = nome; $('#chatSubtitle').textContent = c?.online ? 'Online agora' : 'Conversa direta';
  $('#chatAvatar').textContent = iniciais(nome); $('#chatAvatar').style.background = cor(c);
  carregarMensagens();
}
async function carregarMensagens() {
  const nome = state.ativa; if (!nome) return;
  const m = await API.get('/mensagens/' + encodeURIComponent(nome)).catch(() => null); if (!m || nome !== state.ativa) return;
  const h = $('#messageHistory'), fim = h.scrollTop + h.clientHeight >= h.scrollHeight - 40;
  state.messages = m;
  h.innerHTML = m.map(x => `<div class="message-row ${x.minha ? 'mine' : ''}"><div class="message-bubble">${esc(x.texto)}</div><span class="message-time">${hora(x.enviada_em)}</span></div>`).join('')
    || '<div class="loading">Diga olá! Esta é o começo da conversa.</div>';
  if (fim) h.scrollTop = h.scrollHeight;
}
// abre (ou cria) uma conversa com um jogador e vai para a página de mensagens
async function abrirConversaCom(nome) {
  if (!logado()) return;
  const u = await tentar(() => API.get('/usuarios/' + encodeURIComponent(nome))); if (!u) return;
  if (u.nome_usuario === state.eu.nome_usuario) return toast('Você não pode conversar consigo mesmo.');
  if (!state.conversas.some(c => c.nome_usuario === u.nome_usuario)) state.conversas.unshift({ nome_usuario: u.nome_usuario, cor_avatar: u.cor_avatar, ultima: '', quando: '', online: u.online, local: true });
  state.ativa = u.nome_usuario;
  if (state.page === 'mensagens') { renderConversas(); abrirConversa(u.nome_usuario); } else ir('mensagens');
}
$('#messageForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#messageInput'), texto = input.value.trim();
  if (!state.ativa || !texto) return;
  await tentar(async () => { await API.post('/mensagens/' + encodeURIComponent(state.ativa), { texto }); input.value = ''; const c = state.conversas.find(x => x.nome_usuario === state.ativa); if (c) c.local = false; await carregarConversas(); });
});
$('#chatSearch').addEventListener('click', () => {
  const q = prompt('Buscar texto nesta conversa:');
  if (q !== null) toast(q ? `${state.messages.filter(m => m.texto.toLowerCase().includes(q.toLowerCase())).length} mensagem(ns) encontrada(s).` : 'Busca cancelada.');
});
$('#chatDetails').addEventListener('click', () => state.ativa && abrirPerfil(state.ativa));
$('#conversationSearch').addEventListener('input', e => { state.filtro = e.target.value.toLowerCase(); renderConversas(); });
setInterval(() => { if (state.page === 'mensagens' && state.eu && !document.hidden) { carregarMensagens(); } }, 5000);   // mensagens novas aparecem sozinhas

const dialogo = $('#newConversationDialog');
$('#newConversation').addEventListener('click', () => { if (logado()) dialogo.showModal(); });
['#closeDialog', '#cancelDialog'].forEach(s => $(s).addEventListener('click', () => dialogo.close()));
$('#newConversationForm').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('#newContactName').value.trim();
  dialogo.close(); $('#newContactName').value = '';
  await abrirConversaCom(nome);
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
  $('#genericAction').textContent = p === 'grupos' || p === 'comunidade' ? 'Criar grupo' : p === 'match' ? 'Buscar jogadores' : 'Encontrar jogadores';
  if (p === 'grupos' || p === 'comunidade') return renderGrupos(box);
  if (p === 'explorar') return renderExplorar(box);
  if (p === 'match') return renderMatch(box);
  if (p === 'jogos') {
    if (state.jogo) return renderJogo(box, jogoPorNome(state.jogo) || GAMES[0]);
    Fundo.release();
    box.innerHTML = GAMES.map(g => {
      const db = state.jogosDb.get(g.name);
      return card(esc(g.tag), esc(g.name), esc(g.genre), esc(g.pitch),
        `<span>${db ? `${db.jogadores} jogador(es) · ${db.grupos_abertos} grupo(s)` : ''}</span><button data-open-game="${esc(g.name)}">Abrir comunidade</button>`, ` data-img-game="${g.key}"`);
    }).join('');
    $$('[data-open-game]', box).forEach(b => b.addEventListener('click', () => { state.jogo = b.dataset.openGame; state.aba = 'overview'; renderGeneric('jogos'); scrollTo({ top: 0, behavior: 'smooth' }); }));
    return aplicarImagens(box);
  }
  box.innerHTML = '<div class="empty-state">Conteúdo indisponível no momento.</div>';
}

/* ---------- Grupos: criar, entrar, sair, ver integrantes e avaliar ---------- */
async function renderGrupos(box) {
  box.innerHTML = '<div class="loading">Carregando grupos…</div>';
  const grupos = await tentar(() => API.get('/grupos' + (state.gFiltro ? `?jogo=${state.gFiltro}` : ''))) || [];
  box.innerHTML = `<div class="explore-wrap">
    <div class="chip-row"><button type="button" class="chip" data-gf="" aria-pressed="${!state.gFiltro}">Todos</button>
      ${[...state.jogosDb.values()].filter(j => j.grupos_abertos > 0 || String(j.jogo_id) === String(state.gFiltro)).map(j => `<button type="button" class="chip" data-gf="${j.jogo_id}" aria-pressed="${String(state.gFiltro) === String(j.jogo_id)}">${esc(j.titulo)}</button>`).join('')}
      <button type="button" class="mini-button" data-novo-grupo>+ Criar grupo</button></div>
    <div class="generic-content">${grupos.map(g => `
      <article class="generic-card" data-gid="${g.grupo_id}"><span class="tag">${esc(g.jogo)}</span><h3>${esc(g.titulo)}</h3>
        <b class="card-sub">Líder: ${esc(g.lider)}${g.idioma ? ' · ' + esc(g.idioma) : ''} · ${g.status === 'cheio' ? 'Lotado' : 'Aberto'}</b>
        <p>${esc(g.descricao || 'Sem descrição.')}</p>
        <div class="card-foot"><span>${g.membros}/${g.max_membros} integrantes</span>
          <span style="display:flex;gap:8px"><button type="button" data-ver="${g.grupo_id}">Integrantes</button>
          <button type="button" data-join="${g.grupo_id}" class="${g.participando ? 'joined' : ''}" ${!g.participando && g.status === 'cheio' ? 'disabled' : ''}>${g.participando ? 'Participando ✓' : g.status === 'cheio' ? 'Lotado' : 'Participar +'}</button></span></div>
        <div class="integrantes" hidden></div></article>`).join('') || '<div class="empty-state" style="grid-column:1/-1">Nenhum grupo por aqui ainda. Que tal criar o primeiro?</div>'}</div></div>`;
  $$('[data-gf]', box).forEach(b => b.addEventListener('click', () => { state.gFiltro = b.dataset.gf; renderGrupos(box); }));
  $('[data-novo-grupo]', box).addEventListener('click', () => abrirNovoGrupo(null));
  $$('[data-join]', box).forEach(b => b.addEventListener('click', () => tentar(async () => {
    if (!logado()) return;
    const id = Number(b.dataset.join), g = grupos.find(x => x.grupo_id === id);
    if (g.participando) { await API.post(`/grupos/${id}/sair`); toast(`Você saiu de ${g.titulo}.`); }
    else { await API.post(`/grupos/${id}/entrar`); toast(`Você entrou em ${g.titulo}!`); }
    renderGrupos(box);
  })));
  $$('[data-ver]', box).forEach(b => b.addEventListener('click', () => tentar(async () => {
    const el = b.closest('.generic-card').querySelector('.integrantes');
    if (!el.hidden) { el.hidden = true; return; }
    const g = await API.get(`/grupos/${b.dataset.ver}`);
    el.innerHTML = g.integrantes.map(m => `<div class="integrante"><button type="button" class="link" data-perfil="${esc(m.nome_usuario)}">${esc(m.nome_usuario)}</button>
      <small>${esc(m.cargo)} · ${nota(m.reputacao)}</small>
      ${g.participando && state.eu && m.nome_usuario !== state.eu.nome_usuario ? `<button type="button" class="mini-button" data-avaliar="${esc(m.nome_usuario)}" data-grupo="${g.grupo_id}">Avaliar</button>` : ''}</div>`).join('');
    el.hidden = false;
    $$('[data-perfil]', el).forEach(x => x.addEventListener('click', () => abrirPerfil(x.dataset.perfil)));
    $$('[data-avaliar]', el).forEach(x => x.addEventListener('click', () => tentar(async () => {
      const n = Number(prompt(`Nota para ${x.dataset.avaliar} (1 a 5):`)); if (!n) return;
      const c = prompt('Comentário (opcional):') || undefined;
      await API.post('/avaliacoes', { avaliado: x.dataset.avaliar, grupo_id: Number(x.dataset.grupo), nota: n, comentario: c });
      toast('Avaliação enviada!');
    })));
  })));
}

/* ---------- Match: jogadores com os mesmos jogos e horário que os seus (consulta no banco) ---------- */
async function renderMatch(box) {
  if (!state.eu) {
    box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><b>Entre para encontrar seu squad.</b><p>O Match compara os jogos, o estilo e o horário do seu perfil com os dos outros jogadores.</p><button type="button" class="primary-button" id="matchEntrar">Entrar ou criar conta</button></div>`;
    return $('#matchEntrar', box).addEventListener('click', () => abrirAuth('entrar'));
  }
  box.innerHTML = '<div class="loading">Buscando jogadores compatíveis…</div>';
  const todos = await tentar(() => API.get('/match')) || [];
  const cfg = state.match, q = cfg.busca.trim().toLowerCase();
  const lista = todos.filter(p =>
    (cfg.jogo === 'todos' || p.jogos.includes(cfg.jogo)) && (cfg.estilo === 'Todos' || p.estilo === cfg.estilo) &&
    (cfg.horario === 'Todos' || p.horario_disponivel === cfg.horario) && (!cfg.online || p.online) &&
    (!q || `${p.nome_usuario} ${p.bio || ''} ${p.nivel || ''} ${p.jogos.join(' ')}`.toLowerCase().includes(q)));
  const jogosNos = [...new Set(todos.flatMap(p => p.jogos))].sort();
  box.innerHTML = `
    <section class="match-shell">
      <div class="match-banner"><div><h2>Seu próximo squad começa aqui.</h2><p>Mostramos primeiro quem joga mais jogos em comum com você e tem o mesmo horário. ${state.eu.jogos.length ? '' : '<b>Dica:</b> escolha seus jogos em "Meu perfil" para o Match funcionar.'}</p></div><div class="match-banner-icon" aria-hidden="true">${ico('i-link')}</div></div>
      <div class="match-toolbar">
        <label class="match-search">${ico('i-search')}<input id="matchSearch" value="${esc(cfg.busca)}" placeholder="Buscar jogador, jogo ou nível..." aria-label="Buscar jogador, jogo ou nível"></label>
        <label class="match-select-label"><span>Jogo</span><select id="matchGame"><option value="todos">Todos os jogos</option>${jogosNos.map(g => `<option ${cfg.jogo === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
        <label class="match-select-label"><span>Estilo</span><select id="matchStyle">${['Todos', ...ESTILOS_P].map(v => `<option ${cfg.estilo === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="match-select-label"><span>Horário</span><select id="matchTime">${['Todos', ...HORARIOS].map(v => `<option ${cfg.horario === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="match-online"><input id="matchOnline" type="checkbox" ${cfg.online ? 'checked' : ''}> Só online</label>
        <button type="button" class="mini-button" id="matchReset">Limpar filtros</button>
      </div>
      <div class="match-results-head"><div><h3>Jogadores para você</h3><p>Resultado de uma consulta SQL que cruza seus jogos e horário com os dos outros jogadores.</p></div><span class="tag">${lista.length} encontrado(s)</span></div>
      <div class="match-grid">${lista.map(p => `
        <article class="match-card">
          <div class="match-card-top"><span class="avatar" style="background:${cor(p)}">${esc(iniciais(p.nome_usuario))}</span><div class="match-identity"><b>${esc(p.nome_usuario)}</b><small class="${p.online ? 'on' : ''}"><i></i>${p.online ? 'Online agora' : 'Offline'}${p.horario_disponivel ? ' · ' + esc(p.horario_disponivel) : ''}</small></div><span class="match-fit">${p.jogos_em_comum} em comum${p.mesmo_horario ? ' · mesmo horário' : ''}</span></div>
          <p class="match-bio">${esc(p.bio || 'Sem descrição.')}</p>
          <div class="match-tags">${[p.estilo, p.nivel, nota(p.reputacao)].filter(Boolean).map(v => `<span class="tag">${esc(v)}</span>`).join('')}</div>
          <div class="match-games"><small>Jogos em comum</small><div>${p.jogos.map(k => `<span>${esc(k)}</span>`).join('')}</div></div>
          <div class="match-card-actions"><button type="button" class="mini-button" data-perfil="${esc(p.nome_usuario)}">Perfil</button><button type="button" class="primary-button" data-match-msg="${esc(p.nome_usuario)}">Mensagem</button></div>
        </article>`).join('') || '<div class="empty-state match-empty"><b>Nenhum jogador encontrado.</b><p>Escolha seus jogos no perfil ou mude os filtros.</p><button type="button" class="mini-button" id="matchEmptyReset">Limpar filtros</button></div>'}</div>
    </section>`;
  const refaz = () => renderMatch(box);
  $('#matchSearch', box).addEventListener('input', e => { cfg.busca = e.target.value; const pos = e.target.selectionStart; refaz().then(() => { const i = $('#matchSearch', box); i.focus(); i.setSelectionRange(pos, pos); }); });
  $('#matchGame', box).addEventListener('change', e => { cfg.jogo = e.target.value; refaz(); });
  $('#matchStyle', box).addEventListener('change', e => { cfg.estilo = e.target.value; refaz(); });
  $('#matchTime', box).addEventListener('change', e => { cfg.horario = e.target.value; refaz(); });
  $('#matchOnline', box).addEventListener('change', e => { cfg.online = e.target.checked; refaz(); });
  const reset = () => { Object.assign(cfg, { jogo: 'todos', estilo: 'Todos', horario: 'Todos', online: false, busca: '' }); refaz(); };
  $('#matchReset', box).addEventListener('click', reset); $('#matchEmptyReset', box)?.addEventListener('click', reset);
  $$('[data-perfil]', box).forEach(b => b.addEventListener('click', () => abrirPerfil(b.dataset.perfil)));
  $$('[data-match-msg]', box).forEach(b => b.addEventListener('click', () => abrirConversaCom(b.dataset.matchMsg)));
}

/* ---------- Explorar › Jogadores em destaque ---------- */
async function renderJogadores(painel) {
  painel.innerHTML = '<div class="loading">Carregando jogadores…</div>';
  const f = state.exFiltro, busca = $('#globalSearch').value.trim().toLowerCase();
  let lista = await tentar(() => API.get('/jogadores' + (f ? `?jogo=${f}` : ''))) || [];
  if (busca) lista = lista.filter(p => `${p.nome_usuario} ${p.bio || ''} ${p.jogos.join(' ')}`.toLowerCase().includes(busca));
  painel.innerHTML = `
    <div class="chip-row" role="group" aria-label="Filtrar jogadores por jogo">
      <button type="button" class="chip" data-filtro="" aria-pressed="${!f}">Todos</button>
      ${[...state.jogosDb.values()].filter(j => j.jogadores > 0).map(j => `<button type="button" class="chip" data-filtro="${j.jogo_id}" aria-pressed="${String(f) === String(j.jogo_id)}">${esc(j.titulo)}</button>`).join('')}
    </div>
    <div class="player-grid">${lista.map(p => `
      <article class="player-card">
        <div class="player-head">
          <span class="avatar" style="background:${cor(p)}">${esc(iniciais(p.nome_usuario))}</span>
          <div><b>${esc(p.nome_usuario)}</b><small class="${p.online ? 'on' : ''}">${p.online ? '● Online agora' : 'Offline'}${p.horario_disponivel ? ' · ' + esc(p.horario_disponivel) : ''}</small></div>
        </div>
        <p>${esc(p.bio || 'Sem descrição.')}</p>
        <div class="player-meta">${[p.estilo, p.nivel, nota(p.reputacao)].filter(Boolean).map(v => `<span class="tag">${esc(v)}</span>`).join('')}</div>
        <div class="player-games">${p.jogos.map(esc).join(', ')}</div>
        <div class="player-actions">
          <button type="button" class="mini-button ${p.seguindo ? 'on' : ''}" data-seguir="${esc(p.nome_usuario)}">${p.seguindo ? 'Seguindo ✓' : 'Seguir'}</button>
          <button type="button" class="mini-button" data-perfil="${esc(p.nome_usuario)}">Perfil</button>
          <button type="button" class="mini-button" data-msg="${esc(p.nome_usuario)}">Mensagem</button>
        </div>
      </article>`).join('') || '<div class="empty-state" style="grid-column:1/-1">Nenhum jogador para este filtro ainda.</div>'}</div>`;
  $$('[data-filtro]', painel).forEach(b => b.addEventListener('click', () => { state.exFiltro = b.dataset.filtro; renderJogadores(painel); }));
  $$('[data-seguir]', painel).forEach(b => b.addEventListener('click', () => tentar(async () => {
    if (!logado()) return;
    const r = await API.post('/seguir/' + encodeURIComponent(b.dataset.seguir));
    toast(r.seguindo ? `Você começou a seguir ${b.dataset.seguir}.` : `Você deixou de seguir ${b.dataset.seguir}.`);
    renderJogadores(painel);
  })));
  $$('[data-perfil]', painel).forEach(b => b.addEventListener('click', () => abrirPerfil(b.dataset.perfil)));
  $$('[data-msg]', painel).forEach(b => b.addEventListener('click', () => abrirConversaCom(b.dataset.msg)));
}

/* ---------- Explorar › Tendências (visão v_tendencias do banco) ---------- */
async function renderTendencias(painel) {
  painel.innerHTML = '<div class="loading">Calculando tendências…</div>';
  const [rank, jogadores, grupos] = await Promise.all([API.get('/tendencias').catch(() => []), API.get('/jogadores').catch(() => []), API.get('/grupos').catch(() => [])]);
  const top = rank.slice(0, 8), maximo = top[0]?.pontos || 1;
  const melhores = jogadores.filter(p => p.reputacao > 0).sort((a, b) => b.reputacao - a.reputacao).slice(0, 5);
  const crescendo = [...grupos].sort((a, b) => b.membros - a.membros).slice(0, 3);
  painel.innerHTML = `<div class="trend-layout">
    <section class="trend-box">
      <h3>Jogos em alta</h3>
      <p>Calculado no banco com grupos, jogadores e tópicos de cada jogo.</p>
      ${top.map((r, i) => `
        <button type="button" class="trend-row" data-abrir="${esc(r.titulo)}">
          <span class="trend-rank">${i + 1}</span>
          <span class="trend-name"><b>${esc(r.titulo)}</b><small>${r.grupos} grupo(s) · ${r.jogadores} jogador(es) · ${r.topicos} tópico(s)</small>
            <span class="trend-bar"><i style="width:${Math.max(6, Math.round(r.pontos / maximo * 100))}%"></i></span></span>
          <span class="trend-score">${r.pontos} pts</span>
        </button>`).join('')}
    </section>
    <div class="trend-side">
      <section class="trend-box">
        <h3>Jogadores mais bem avaliados</h3>
        <p>Reputação = média das notas que o jogador recebeu em grupos.</p>
        ${melhores.map(p => `<button type="button" class="topic-item" data-perfil="${esc(p.nome_usuario)}"><b>${esc(p.nome_usuario)}</b><small>${nota(p.reputacao)} · ${esc(p.jogos.slice(0, 2).join(', '))}</small></button>`).join('') || '<div class="empty-state"><b>Ninguém foi avaliado ainda.</b><p>Participe de um grupo e avalie quem jogou com você.</p></div>'}
      </section>
      <section class="trend-box">
        <h3>Grupos em crescimento</h3>
        <p>Os grupos com mais integrantes agora.</p>
        ${crescendo.map(g => `<div class="topic-item static"><b>${esc(g.titulo)}</b><small>${esc(g.jogo)} · ${g.membros}/${g.max_membros} integrantes</small></div>`).join('')}
        <button type="button" class="mini-button" data-ver-grupos style="margin-top:12px">Ver todos os grupos</button>
      </section>
    </div></div>`;
  $$('[data-abrir]', painel).forEach(b => b.addEventListener('click', () => abrirJogo(b.dataset.abrir)));
  $$('[data-perfil]', painel).forEach(b => b.addEventListener('click', () => abrirPerfil(b.dataset.perfil)));
  $('[data-ver-grupos]', painel).addEventListener('click', () => ir('grupos'));
}
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

// Fórum de cada jogo: tópicos, respostas e curtidas ficam no banco
async function renderForum(painel, g) {
  const jid = idDoJogo(g.name);
  painel.innerHTML = `
    <div class="forum-toolbar"><div><h3>Fórum de ${esc(g.name)}</h3><p class="sub">Dúvidas, dicas e conversas da comunidade.</p></div><span class="tag" id="forumCount"></span></div>
    <form id="forumForm" class="forum-form"><input id="fTitulo" maxlength="100" minlength="3" required placeholder="Título do tópico (ex.: dicas para iniciantes)">
      <textarea id="fCorpo" maxlength="1500" required placeholder="Escreva sua publicação..."></textarea>
      <div style="display:flex;justify-content:flex-end"><button class="primary-button" type="submit">Publicar tópico</button></div></form>
    <div class="forum-post-list" id="forumList"><div class="loading">Carregando tópicos…</div></div>`;
  const lista = $('#forumList', painel);
  async function desenhar() {
    const posts = jid ? await tentar(() => API.get(`/jogos/${jid}/forum`)) || [] : [];
    $('#forumCount', painel).textContent = `${posts.length} tópicos`;
    lista.innerHTML = posts.map(p => `
      <article class="forum-post">
        <div class="forum-post-head"><span class="avatar avatar-small cyan">${esc(iniciais(p.autor))}</span><div><button type="button" class="link" data-perfil="${esc(p.autor)}"><b>${esc(p.autor)}</b></button><small>${new Date(p.criado_em).toLocaleString('pt-BR')}</small></div><span class="tag">Discussão</span></div>
        <h4>${esc(p.titulo)}</h4><p>${esc(p.corpo)}</p>
        ${p.respostas.length ? `<div class="replies">${p.respostas.map(r => `<p><b>${esc(r.autor)}:</b> ${esc(r.corpo)}</p>`).join('')}</div>` : ''}
        <div class="forum-post-actions"><button type="button" data-like="${p.topico_id}">${p.curti ? '♥' : '♡'} Curtir (${p.curtidas})</button><button type="button" data-reply="${p.topico_id}">Responder</button></div>
      </article>`).join('') || '<div class="empty-state">Ainda não há tópicos. Seja o primeiro a iniciar uma conversa!</div>';
    $$('[data-perfil]', lista).forEach(b => b.addEventListener('click', () => abrirPerfil(b.dataset.perfil)));
    $$('[data-like]', lista).forEach(b => b.addEventListener('click', () => tentar(async () => { if (!logado()) return; await API.post(`/forum/${b.dataset.like}/curtir`); desenhar(); })));
    $$('[data-reply]', lista).forEach(b => b.addEventListener('click', () => tentar(async () => {
      if (!logado()) return;
      const t = prompt('Responder ao tópico:');
      if (t?.trim()) { await API.post(`/forum/${b.dataset.reply}/respostas`, { corpo: t.trim().slice(0, 1500) }); toast('Resposta adicionada.'); desenhar(); }
    })));
  }
  desenhar();
  $('#forumForm', painel).addEventListener('submit', e => {
    e.preventDefault();
    tentar(async () => {
      if (!logado()) return;
      await API.post(`/jogos/${jid}/forum`, { titulo: $('#fTitulo', painel).value.trim(), corpo: $('#fCorpo', painel).value.trim() });
      e.target.reset(); toast('Tópico publicado!'); desenhar();
    });
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
    if (f === 0) { $('.news-text h2').textContent = 'GTA VI: a data prevista chegou'; $('.news-text p').textContent = 'Já montou seu squad? Encontre quem joga com você na aba Match.'; }
  };
  atualizar(); setInterval(atualizar, 1000);
}

/* 10. INICIALIZAÇÃO — carrega os jogos e a sessão do banco e abre a primeira tela. */
(async () => {
  const jogos = await API.get('/jogos').catch(() => null);
  $('#connectionState').textContent = jogos ? 'Conectado ao banco de dados PostgreSQL' : 'Servidor indisponível';
  (jogos || []).forEach(j => state.jogosDb.set(j.titulo, j));
  await carregarEu();
  contagem();
  aplicarImagens();
  Fundo.start();
  setPage(location.hash.slice(1) || 'inicio');
})();
