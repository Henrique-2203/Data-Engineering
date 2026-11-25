// Teste do site no navegador (Playwright) contra o servidor local com banco de teste:  node playlink/test/site.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const PORTA = 3199, shots = process.env.SHOTS;
const srv = spawn('node', ['server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: PORTA, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => srv.stdout.on('data', (d) => /PLAYLINK em/.test(String(d)) && ok()));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
// imagens externas (Steam/YouTube) ficam fora do teste
await ctx.route(/steamstatic|ytimg|youtube/, (r) => r.abort());
const p = await ctx.newPage();
const erros = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && erros.push(m.text()));
const foto = async (n) => { if (shots) { await mkdir(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${n}.png` }); } };
const url = `http://localhost:${PORTA}/`;
try {
  await p.goto(url);
  await p.waitForFunction(() => /Conectado ao banco/.test(document.querySelector('#connectionState').textContent));
  await foto('1-inicio');

  // cadastro
  await p.click('#profileButton'); await p.click('#authDialog [data-troca]');
  await p.fill('#authDialog [name=nome_usuario]', 'henrique_teste'); await p.fill('#authDialog [name=email]', 'h@teste.com'); await p.fill('#authDialog [name=senha]', 'senhaboa123');
  await p.selectOption('#authDialog [name=pais]', 'BR'); await foto('2-cadastro');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#profileDialog[open]');
  await p.fill('#profileForm [name=bio]', 'Procuro duo para ranked'); await p.selectOption('#profileForm [name=estilo]', 'Competitivo'); await p.selectOption('#profileForm [name=horario_disponivel]', 'Noites');
  await p.check('#profileForm input[name=jogo][value="1"]'); await p.fill('#profileForm [name=usuario_resenha]', 'henrique_resenha'); await foto('3-perfil');
  await p.click('#profileForm button[type=submit]'); await p.waitForSelector('#profileDialog', { state: 'hidden' });
  assert.match(await p.textContent('#profileButton'), /henrique_teste/);

  // match (consulta SQL: mesmos jogos e horario)
  await p.goto(url + '#match'); await p.waitForSelector('.match-card');
  assert.ok((await p.textContent('.match-grid')).includes('toniz2'), 'match mostra toniz2 (joga Valorant, noites)');
  await foto('4-match');

  // explorar: seguir
  await p.goto(url + '#explorar'); await p.waitForSelector('.player-card');
  const seguir = p.locator('[data-seguir="toniz2"]'); await seguir.click();
  await p.waitForFunction(() => /Seguindo/.test(document.querySelector('[data-seguir="toniz2"]').textContent));
  await p.click('[data-exp=tendencias]'); await p.waitForSelector('.trend-row'); await foto('5-tendencias');
  await p.click('[data-exp=jogadores]');

  // grupos: criar e entrar
  await p.goto(url + '#grupos'); await p.waitForSelector('.generic-card');
  await p.click('[data-novo-grupo]'); await p.fill('#groupForm [name=titulo]', 'Duo do Henrique'); await p.fill('#groupForm [name=max_membros]', '3'); await p.click('#groupForm button[type=submit]');
  await p.waitForSelector('text=Duo do Henrique');
  const card = p.locator('.generic-card', { hasText: 'Ranked sem tilt' }); await card.locator('[data-join]').click();
  await p.waitForFunction(() => [...document.querySelectorAll('.generic-card')].find((c) => /Ranked sem tilt/.test(c.textContent))?.textContent.includes('Participando'));
  await card.locator('[data-ver]').click(); await p.waitForSelector('.integrante'); await foto('6-grupos');

  // mensagens
  await p.goto(url + '#mensagens'); await p.waitForSelector('#newConversation');
  await p.click('#newConversation'); await p.fill('#newContactName', 'toniz2'); await p.click('#newConversationForm button[type=submit]');
  await p.waitForSelector('#chatActive:not(.hidden)'); await p.fill('#messageInput', 'Bora jogar hoje?'); await p.press('#messageInput', 'Enter');
  await p.waitForSelector('.message-bubble:has-text("Bora jogar hoje?")'); await foto('7-mensagens');

  // forum de um jogo
  await p.goto(url + '#jogos'); await p.click('[data-open-game="Valorant"]'); await p.click('[data-game-tab=forum]');
  await p.waitForSelector('.forum-post'); await p.fill('#fTitulo', 'Melhor mapa?'); await p.fill('#fCorpo', 'Ascent ou Bind?'); await p.click('#forumForm button[type=submit]');
  await p.waitForSelector('.forum-post:has-text("Melhor mapa?")'); await foto('8-forum');

  // perfil de outro jogador e logout
  await p.goto(url + '#explorar'); await p.waitForSelector('.player-card'); await p.click('[data-perfil="toniz2"]'); await p.waitForSelector('#playerDialog[open]');
  assert.ok((await p.textContent('#playerDialog')).includes('Avaliações recebidas')); await foto('9-perfil-outro'); await p.click('#playerDialog [data-fechar]');
  await p.click('#profileButton'); await p.click('#btnSair'); await p.waitForFunction(() => /Entrar/.test(document.querySelector('#profileButton').textContent));
  assert.deepEqual(erros, [], 'sem erros no console: ' + erros.join(' | '));
  console.log('Site: fluxo completo ok (cadastro, perfil, match, seguir, grupos, mensagens, forum, logout)');
} finally { await b.close(); srv.kill(); }
