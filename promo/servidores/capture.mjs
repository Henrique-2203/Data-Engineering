// Telas reais do app para o vídeo "servidores + Explorar + servidor oficial". Dados de mentira (Lucas,
// Nina, Bia...) e arte nossa (avatares, ícones e banners desenhados aqui; o ícone e o banner do servidor
// oficial são os nossos, de promo/out/oficial). Grava as telas (2560x1600) e as posições (boxes.json).
// Uso: npm run build && node promo/servidores/capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3251;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/servidores/shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = tempDir('resenha-servidores-');
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, 'db'), PLATFORM_ADMINS: 'resenha' },
  stdio: 'ignore',
});
const api = async (p, body, token, method) =>
  (await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => ({}));
const upload = async (p, buf, token, type = 'image/png') => {
  const res = await fetch(`${BASE}/api${p}`, { method: 'POST', headers: { 'content-type': type, authorization: `Bearer ${token}` }, body: buf });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
};

// ---------- arte nossa ----------
const face = (bg1, bg2, skin, hair, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/><path d="M96 512c10-96 76-150 160-150s150 54 160 150z" fill="#1f2b44"/>
  <circle cx="256" cy="230" r="104" fill="${skin}"/><path d="M150 214c0-74 50-120 106-120s108 40 108 116c-24-36-66-50-106-48-40 2-80 14-108 52z" fill="${hair}"/>
  <circle cx="218" cy="240" r="11" fill="#2b1d16"/><circle cx="296" cy="240" r="11" fill="#2b1d16"/><path d="M222 286q34 26 68 0" stroke="#2b1d16" stroke-width="10" fill="none" stroke-linecap="round"/>${extra}</svg>`;
const PEOPLE = [
  ['lucas', 'Lucas', face('#3ddc97', '#1b6fd6', '#e9b48c', '#2b1d16', '<path d="M136 236a120 120 0 0 1 240 0" stroke="#111" stroke-width="22" fill="none"/><rect x="118" y="222" width="40" height="74" rx="18" fill="#3ddc97"/><rect x="354" y="222" width="40" height="74" rx="18" fill="#3ddc97"/>')],
  ['nina', 'Nina', face('#ff9ad5', '#7c3aed', '#c98b62', '#3b1f14', '<path d="M150 210c-20 90-10 170 20 210M362 210c20 90 10 170-20 210" stroke="#3b1f14" stroke-width="34" fill="none" stroke-linecap="round"/>')],
  ['bia', 'Bia', face('#ffd166', '#ef476f', '#f1c7a2', '#a0522d')],
  ['rafa', 'Rafa', face('#06d6a0', '#118ab2', '#8d5a3b', '#111')],
  ['matheus', 'Matheus', face('#ff9f43', '#c2255c', '#b97a56', '#1a1210', '<path d="M146 190c10-70 60-104 110-104s100 34 110 104z" fill="#ff7a1a"/><path d="M250 186h170c-10 14-40 22-80 22h-90z" fill="#e8590c"/>')],
  ['duda', 'Duda', face('#a78bfa', '#2563eb', '#e8b796', '#d97706')],
  ['caio', 'Caio', face('#94a3b8', '#0f172a', '#d4a27c', '#3f2a1d')],
  ['theo', 'Theo', face('#f97316', '#7c2d12', '#f0c09a', '#111')],
  ['lari', 'Lari', face('#22d3ee', '#0e7490', '#a8714f', '#1f1208')],
  ['gabi', 'Gabi', face('#f472b6', '#9d174d', '#f3cfb1', '#5b3a29')],
];
/** ícone de servidor: fundo em degradê + símbolo desenhado (sem arte de jogo nenhum) */
const icon = (c1, c2, sym) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/>${sym}</svg>`;
const SYM = {
  mira: '<circle cx="256" cy="256" r="150" stroke="#fff" stroke-width="30" fill="none"/><circle cx="256" cy="256" r="26" fill="#fff"/><path d="M256 60v120M256 332v120M60 256h120M332 256h120" stroke="#fff" stroke-width="30" stroke-linecap="round"/>',
  bomba: '<circle cx="236" cy="290" r="140" fill="#111"/><path d="M320 170l50-50" stroke="#111" stroke-width="30"/><circle cx="385" cy="105" r="30" fill="#ffd166"/><circle cx="190" cy="250" r="30" fill="#fff" opacity=".35"/>',
  dragao: '<path d="M90 380c60-30 80-120 160-150 50-18 90 10 120-30 10 60-20 110-80 130 60 10 100-20 120-40-10 80-90 130-170 130-60 0-110-20-150-40z" fill="#fff"/><circle cx="330" cy="200" r="14" fill="#7c2d12"/>',
  cidade: '<path d="M60 430V250h80v180M160 430V160h90v270M270 430V210h80v220M370 430V120h80v310" fill="#fff"/><path d="M60 430h392" stroke="#fff" stroke-width="16"/>',
  bloco: '<rect x="120" y="120" width="130" height="130" rx="14" fill="#fff"/><rect x="262" y="120" width="130" height="130" rx="14" fill="#fff" opacity=".75"/><rect x="190" y="262" width="130" height="130" rx="14" fill="#fff" opacity=".9"/>',
  espada: '<path d="M140 372l220-220 30 30-220 220z" fill="#fff"/><path d="M110 330l72 72M150 300l60 60" stroke="#fff" stroke-width="28" stroke-linecap="round"/><path d="M372 140l40-40" stroke="#fff" stroke-width="30" stroke-linecap="round"/>',
  livro: '<path d="M90 140c60-20 120-10 166 20v240c-46-30-106-40-166-20zM422 140c-60-20-120-10-166 20v240c46-30 106-40 166-20z" fill="#fff"/>',
  cafe: '<path d="M130 220h220v90c0 70-50 110-110 110s-110-40-110-110z" fill="#fff"/><path d="M350 250c60 0 60 80 0 80" stroke="#fff" stroke-width="26" fill="none"/><path d="M190 110c-20 30 20 50 0 80M250 100c-20 30 20 50 0 80" stroke="#fff" stroke-width="18" fill="none" stroke-linecap="round"/>',
};
const banner = (c1, c2, c3) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="1600" height="500" fill="url(#g)"/>
  <circle cx="1300" cy="80" r="260" fill="${c3}" opacity=".35"/><circle cx="240" cy="520" r="300" fill="#fff" opacity=".08"/><path d="M0 400 Q400 300 800 380 T1600 340 V500 H0z" fill="#000" opacity=".25"/></svg>`;
const SERVERS = [
  { key: 'bomb', name: 'Clã do Bomb', cat: 'fps', desc: 'Clã de CS: treino toda noite, mix no fim de semana e calls abertas pra quem chegar.', ic: ['#ff6b35', '#c1121f', 'bomba'], bn: ['#3a0ca3', '#f72585', '#ffbe0b'], members: 9 },
  { key: 'mira', name: 'Mira Certa', cat: 'fps', desc: 'Ranqueada de tático toda noite. Chega aí, sem tóxico.', ic: ['#4cc9f0', '#3a0ca3', 'mira'], bn: ['#0b132b', '#3a86ff', '#4cc9f0'], members: 6 },
  { key: 'taverna', name: 'Taverna do Dragão', cat: 'rpg', desc: 'Mesa de RPG de sexta, fichas no canal e campanhas novas todo mês. 🐉', ic: ['#f77f00', '#6a040f', 'dragao'], bn: ['#370617', '#f48c06', '#ffba08'], members: 7 },
  { key: 'cidade', name: 'Cidade Alta RP | Roblox', cat: 'jogos', desc: 'Roleplay no Roblox: polícia, hospital, empregos e eventos todo sábado.', ic: ['#06d6a0', '#118ab2', 'cidade'], bn: ['#023e8a', '#06d6a0', '#90e0ef'], members: 8 },
  { key: 'obby', name: 'Obby dos Amigos | Roblox', cat: 'jogos', desc: 'Obby, torre e jogos de terror do Roblox com a galera. Chama na call!', ic: ['#ffd166', '#ef476f', 'bloco'], bn: ['#ff006e', '#fb5607', '#ffbe0b'], members: 5 },
  { key: 'lane', name: 'Lane Mid', cat: 'moba', desc: 'Duo, flex e treino de rotação. Todo elo é bem-vindo.', ic: ['#8338ec', '#3a0ca3', 'espada'], bn: ['#240046', '#7b2cbf', '#e0aaff'], members: 4 },
  { key: 'estudos', name: 'Estudos à Noite', cat: 'estudos', desc: 'Pomodoro em call, vestibular e faculdade. Câmera opcional, foco obrigatório. 📚', ic: ['#52b788', '#1b4332', 'livro'], bn: ['#081c15', '#2d6a4f', '#95d5b2'], members: 6 },
  { key: 'anime', name: 'Anime & Café', cat: 'anime', desc: 'Lançamentos da temporada, recomendações e maratona de domingo. ☕', ic: ['#ff70a6', '#70d6ff', 'cafe'], bn: ['#ff70a6', '#ff9770', '#ffd670'], members: 5 },
];
const OFC_WELCOME = `Que bom ter você aqui, {usuario}! 💚

Este é o servidor oficial do Resenha, a comunidade de quem usa o app. Por aqui:

📜 #regras: leia e clique em "Aceito" para liberar o chat e as calls.
📣 #novidades: tudo o que chega de novo no Resenha, em primeira mão.
💬 #geral: conversa livre, se apresenta pra galera!
🎮 #procurando-grupo: diga o jogo, o rank e o horário e ache gente pra jogar.
💡 #sugestões: ideias e pedidos para o app (a equipe lê tudo).
🔊 Call 1, 2 e 3: calls abertas, é só entrar.`;

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  browser = await chromium.launch();
  const art = await browser.newPage({ viewport: { width: 1600, height: 500 } });
  const render = async (svg, w, h) => {
    await art.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body>`);
    return art.locator('svg').screenshot();
  };

  // o cadastro tem limite por minuto (anti-spam): espera e tenta de novo
  const reg = async (u, d) => {
    for (let i = 0; i < 30; i++) {
      const r = await api('/auth/register', { username: u, password: 'Pao-de-Queijo-77', displayName: d, acceptTerms: true });
      if (r.token) return r;
      await sleep(5000);
    }
    throw new Error(`cadastro de ${u} falhou`);
  };
  // a equipe cria o servidor oficial ANTES de todo mundo (assim todos entram sozinhos)
  const equipe = await reg('resenha', 'Equipe Resenha');
  await upload('/me/avatar', readFileSync('promo/out/oficial/resenha-brasil-ofc-icon.png'), equipe.token);
  const ofc = await api('/admin/official', { name: 'Resenha Brasil OFC', moderators: [] }, equipe.token);
  const gid = ofc.guildId;
  await upload(`/guilds/${gid}/icon`, readFileSync('promo/out/oficial/resenha-brasil-ofc-icon.png'), equipe.token);
  await upload(`/guilds/${gid}/banner`, readFileSync('promo/out/oficial/resenha-brasil-ofc-banner.png'), equipe.token);
  await api(`/guilds/${gid}`, { welcomeText: OFC_WELCOME }, equipe.token, 'PATCH');
  let g = (await api(`/guilds/${gid}`, null, equipe.token)).guild;
  const ch = (n) => g.channels.find((c) => c.name === n);
  await api(`/channels/${ch('novidades').id}/messages`, { content: '🧭 Chegou o Explorar! Ache servidores públicos da comunidade por categoria: é a bússola na coluna da esquerda.' }, equipe.token);
  await api(`/channels/${ch('novidades').id}/messages`, { content: '👋 Boas-vindas nos servidores: escreva uma mensagem para quem chegar e a galera dá oi. Configurações do servidor → Boas-vindas.' }, equipe.token);

  const users = {};
  for (const [u, d, svg] of PEOPLE) {
    users[u] = await reg(u, d);
    await upload('/me/avatar', await render(svg, 512, 512), users[u].token);
  }
  const ppl = PEOPLE.map(([u]) => u).filter((u) => u !== 'nina');
  // todo mundo (menos a Nina) já abriu o app: entra sozinho no oficial e aceita as regras
  for (const u of ppl) {
    await api('/bootstrap', null, users[u].token);
    await api(`/guilds/${gid}/rules/accept`, {}, users[u].token);
  }
  // a galera fica online (só a conexão, sem abrir o app)
  const sockets = ppl.map((u) => io(BASE, { auth: { token: users[u].token }, transports: ['websocket'] }));
  const pg = ch('procurando-grupo').id;
  const say = async (u, content) => {
    await api(`/channels/${pg}/messages`, { content }, users[u].token);
    await sleep(1100); // o canal tem modo lento (10 s) para membros: um por pessoa
  };
  await say('rafa', 'alguém pra um mix de CS agora? 🎯 tô na Call 1');
  await say('bia', 'bora! só terminar essa partida');
  await say('theo', 'RPG de mesa sexta 20h, faltam 2 jogadores 🐉');
  await say('duda', 'eu topo! primeira vez, pode?');
  await say('lari', 'theo, guarda uma vaga pra mim 🙋');
  await say('gabi', 'Roblox hoje à noite, alguém? 🧱');

  // ---------- servidores públicos (dono: Lucas), com membros ----------
  const made = {};
  for (const s of SERVERS) {
    const owner = users.lucas.token;
    const { guild } = await api('/guilds', { name: s.name, public: true, category: s.cat }, owner);
    made[s.key] = guild;
    await upload(`/guilds/${guild.id}/icon`, await render(icon(s.ic[0], s.ic[1], SYM[s.ic[2]]), 512, 512), owner);
    await upload(`/guilds/${guild.id}/banner`, await render(banner(...s.bn), 1600, 500), owner);
    await api(`/guilds/${guild.id}`, { description: s.desc, rules: '1. Respeito acima de tudo.\n2. Sem spam nem divulgação.\n3. Na call, sem gritar no microfone.\n4. Divirta-se! 💚', rulesRequired: true }, owner, 'PATCH');
    for (const u of ppl.filter((x) => x !== 'lucas').slice(0, s.members - 1)) await api(`/explore/${guild.id}/join`, {}, users[u].token);
  }
  // Clã do Bomb: canal de boas-vindas + texto (mostrado nas configurações e para quem entra)
  const bomb = made.bomb;
  await api(`/guilds/${bomb.id}/channels`, { name: 'boas-vindas', type: 'text' }, users.lucas.token);
  // a Cidade Alta RP tem boas-vindas: aparece para a Nina quando ela entrar pelo Explorar
  const cidade = made.cidade;
  await api(`/guilds/${cidade.id}`, { welcomeText: 'Bem-vindo(a) à Cidade Alta, {usuario}! 🏙️\n\n📜 Leia as regras e clique em "Aceito".\n🎭 Escolha sua profissão no #geral.\n🚓 Eventos todo sábado às 20h na Call 1.' }, users.lucas.token, 'PATCH');

  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
    return page;
  };
  const boxes = {};
  const measure = async (name, sel) => {
    const out = {};
    for (const [k, loc] of Object.entries(sel)) {
      const b = await loc.boundingBox().catch(() => null);
      if (b) out[k] = [b.x / 1280, b.y / 800, b.width / 1280, b.height / 800].map((v) => +v.toFixed(4));
    }
    boxes[name] = out;
  };
  const shot = async (page, name, sel = {}) => {
    await page.mouse.move(1279, 799);
    await sleep(700);
    await measure(name, sel);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  };

  // ---------- 1. a Nina abre o app pela primeira vez: entra sozinha no oficial ----------
  const pn = await open(users.nina.token);
  const wd = pn.getByRole('dialog', { name: /Bem-vindo\(a\) ao Resenha Brasil OFC/ });
  await wd.waitFor({ timeout: 10000 });
  await sleep(600);
  await shot(pn, 'oficial-boasvindas', { modal: pn.locator('.modal').first() });
  await wd.getByRole('button', { name: 'Ler as regras' }).click();
  await pn.getByRole('dialog', { name: /Regras do/ }).getByRole('button', { name: 'Aceito' }).click();
  await sleep(800);
  await pn.getByRole('button', { name: /^procurando-grupo/ }).click();
  await pn.getByText('Roblox hoje à noite').waitFor();
  await pn.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 10000 }).catch(() => {});
  await shot(pn, 'oficial', { chat: pn.locator('.messages, .chat-scroll').first(), members: pn.locator('.member-list, aside').last(), rail: pn.locator('.rail-item').nth(1) });

  await pn.getByRole('button', { name: /^novidades/ }).click();
  await pn.getByText('Chegou o Explorar!').waitFor();
  await shot(pn, 'novidades', { chat: pn.locator('.messages, .chat-scroll').first() });

  // ---------- 2. Explorar ----------
  await pn.getByRole('button', { name: 'Explorar servidores' }).click();
  const ex = pn.getByRole('dialog', { name: 'Explorar servidores' });
  await ex.getByRole('article', { name: 'Clã do Bomb' }).waitFor();
  await sleep(1200);
  await shot(pn, 'explorar', { nav: ex.locator('.settings-nav'), grid: ex.locator('.explore-grid').last(), hero: ex.locator('.explore-hero') });
  for (const [tab, name] of [[/FPS/, 'explorar-fps'], [/RPG/, 'explorar-rpg']]) {
    await ex.getByRole('tab', { name: tab }).click();
    await sleep(900);
    await shot(pn, name, { tab: ex.getByRole('tab', { name: tab }), grid: ex.locator('.explore-grid').last() });
  }
  await ex.getByRole('tab', { name: /Todos/ }).click();
  await ex.getByLabel('Buscar servidores').fill('roblox');
  await ex.getByRole('article', { name: 'Obby dos Amigos | Roblox' }).waitFor();
  await sleep(900);
  const card = ex.getByRole('article', { name: 'Cidade Alta RP | Roblox' });
  await shot(pn, 'explorar-roblox', { search: ex.locator('.explore-search'), card, entrar: card.getByRole('button', { name: 'Entrar' }) });
  await card.getByRole('button', { name: 'Entrar' }).click();
  await pn.getByRole('dialog', { name: /Bem-vindo\(a\) ao Cidade Alta/ }).waitFor();
  await sleep(700);
  await shot(pn, 'entrou', { modal: pn.locator('.modal').first() });

  // ---------- 3. o dono configura o servidor ----------
  const pl = await open(users.lucas.token);
  await pl.locator('.rail-item[aria-label="Clã do Bomb"], .rail-item[title="Clã do Bomb"]').first().click().catch(async () => pl.getByRole('button', { name: 'Clã do Bomb' }).first().click());
  await pl.locator('.sidebar-header .guild-name').click();
  await pl.getByRole('button', { name: 'Configurações do servidor' }).click();
  await pl.getByRole('button', { name: 'Comunidade', exact: true }).click();
  await pl.getByText('Tudo certo').waitFor();
  await shot(pl, 'config-comunidade', { vis: pl.locator('.visibility-choice'), status: pl.locator('.listing-status') });
  await pl.getByRole('button', { name: 'Regras', exact: true }).click();
  await sleep(500);
  await shot(pl, 'config-regras', { text: pl.locator('.settings-section textarea').first() });
  await pl.getByRole('button', { name: 'Boas-vindas', exact: true }).click();
  await pl.getByLabel(/Mensagem de boas-vindas/).fill('Fala, {usuario}! Bem-vindo(a) ao {servidor} 💥\n\n📜 Leia as regras e clique em "Aceito".\n🎯 Treino toda noite às 21h na Sala de voz.\n💬 Se apresenta no #geral: rank e horário!');
  await pl.getByLabel('Avisar no chat quando alguém chegar').selectOption({ label: '#boas-vindas' });
  await pl.getByRole('button', { name: 'Salvar' }).click();
  await pl.getByText('Boas-vindas salvas.').waitFor();
  await pl.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});
  await shot(pl, 'config-boasvindas', { text: pl.getByLabel(/Mensagem de boas-vindas/), preview: pl.locator('.welcome-preview') });
  await pl.keyboard.press('Escape');

  // ---------- 4. alguém entra e a galera dá oi ----------
  await pl.getByRole('button', { name: /^boas-vindas/ }).click();
  // a Nina e o Caio entram pelo Explorar (o Caio ainda não estava no Clã do Bomb)
  for (const u of ['theo', 'duda', 'nina']) {
    await api(`/guilds/${bomb.id}/members/@me`, null, users[u].token, 'DELETE');
    await sleep(300);
    await api(`/explore/${bomb.id}/join`, {}, users[u].token);
    await sleep(1200);
  }
  const line = pl.locator('.system-join', { hasText: 'Nina' });
  await line.waitFor({ timeout: 8000 });
  await shot(pl, 'oi-antes', { line, oi: line.getByRole('button', { name: '👋 Dar oi' }) });
  await line.getByRole('button', { name: '👋 Dar oi' }).click();
  await pl.getByText('👋 Bem-vindo(a), @nina!').waitFor();
  const bv = (await api(`/guilds/${bomb.id}`, null, users.lucas.token)).guild.channels.find((c) => c.name === 'boas-vindas');
  const join = (await api(`/channels/${bv.id}/messages`, null, users.lucas.token)).messages.find((m) => m.system === 'join' && m.author.username === 'nina');
  for (const u of ['rafa', 'bia']) await api(`/guilds/${bomb.id}/rules/accept`, {}, users[u].token);
  await api(`/channels/${bv.id}/messages`, { content: 'chegou mais uma pro mix! 🎯', replyToId: join.id }, users.rafa.token);
  await api(`/channels/${bv.id}/messages`, { content: 'seja bem-vinda, Nina! 💚', replyToId: join.id }, users.bia.token);
  await pl.getByText('seja bem-vinda, Nina!').waitFor();
  await shot(pl, 'oi-depois', { chat: pl.locator('.messages, .chat-scroll').first() });

  writeFileSync(path.resolve('promo/servidores/boxes.json'), JSON.stringify(boxes, null, 1));
  sockets.forEach((x) => x.close());
  console.log('pronto: promo/out/servidores/shots');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
