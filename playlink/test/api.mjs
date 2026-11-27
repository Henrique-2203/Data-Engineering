// Testa a API inteira contra um PostgreSQL de teste:  node playlink/test/api.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { criarApp } from '../src/app.js';
import { conectarTeste } from '../src/db.js';
const sql = (f) => fileURLToPath(new URL(`../sql/${f}`, import.meta.url));
const db = await conectarTeste([sql('01_schema.sql'), sql('02_dados_exemplo.sql')]);
const srv = criarApp({ db, segredo: 'teste' }).listen(0);
const base = `http://localhost:${srv.address().port}`;

function cliente() {
  let cookie = '';
  const f = async (metodo, rota, corpo, extra = {}) => {
    const r = await fetch(base + rota, { method: metodo, headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let dados = null; try { dados = await r.json(); } catch {}
    return { status: r.status, dados, headers: r.headers };
  };
  return { get: (r) => f('GET', r), post: (r, c = {}) => f('POST', r, c), put: (r, c) => f('PUT', r, c), raw: f };
}
const ok = async (p, st = 200) => { const r = await p; assert.equal(r.status, st, JSON.stringify(r.dados)); return r.dados; };

const ana = cliente(), bia = cliente(), anon = cliente(), cat = cliente();

// ---- conta ----
await ok(ana.post('/api/auth/registrar', { nome_usuario: 'ana_gamer', email: 'ana@teste.com', senha: 'senhaboa123', pais: 'BR', idioma: 'pt' }), 201);
await ok(bia.post('/api/auth/registrar', { nome_usuario: 'bia', email: 'bia@teste.com', senha: 'senhaboa123' }), 201);
assert.equal((await anon.post('/api/auth/registrar', { nome_usuario: 'ana_gamer', email: 'outra@teste.com', senha: 'senhaboa123' })).status, 409, 'nome repetido');
assert.equal((await anon.post('/api/auth/registrar', { nome_usuario: 'x', email: 'a@b.co', senha: 'senhaboa123' })).status, 400, 'nome curto');
assert.equal((await anon.post('/api/auth/registrar', { nome_usuario: 'curta', email: 'c@b.co', senha: '123' })).status, 400, 'senha curta');
assert.equal((await anon.post('/api/auth/entrar', { login: 'ana_gamer', senha: 'errada123' })).status, 401, 'senha errada');
assert.equal((await anon.post('/api/auth/entrar', { login: 'toniz2', senha: 'qualquer123' })).status, 401, 'conta de demonstracao nao loga');
const ent = cliente(); await ok(ent.post('/api/auth/entrar', { login: 'ANA@teste.com', senha: 'senhaboa123' }));
assert.equal((await ok(ent.get('/api/eu'))).usuario.nome_usuario, 'ana_gamer');
assert.equal((await anon.get('/api/eu')).dados.usuario, null);
assert.equal((await anon.get('/api/conversas')).status, 401, 'precisa de login');
assert.equal((await anon.raw('POST', '/api/grupos', undefined, { 'Content-Type': 'text/plain' })).status, 401);
await ok(ent.post('/api/auth/sair')); assert.equal((await ent.get('/api/eu')).dados.usuario, null, 'sair');
assert.equal((await anon.get('/api/eu', undefined, { Cookie: 'pl_sess=adulterado.abc' })).dados.usuario, null);

// ---- catalogo e perfil ----
const jogos = await ok(anon.get('/api/jogos')); assert.equal(jogos.length, 19);
const id = (t) => jogos.find((j) => j.titulo === t).jogo_id;
await ok(ana.put('/api/perfil', { bio: 'Procuro duo', estilo: 'Competitivo', nivel: 'Ouro', horario_disponivel: 'Noites', jogos: [id('Valorant'), id('Apex Legends')], usuario_resenha: 'ana_resenha' }));
await ok(bia.put('/api/perfil', { estilo: 'Competitivo', horario_disponivel: 'Noites', jogos: [id('Valorant')] }));
assert.equal((await ana.put('/api/perfil', { estilo: 'Invalido' })).status, 400);
const perfil = await ok(anon.get('/api/usuarios/ana_gamer'));
assert.equal(perfil.usuario_resenha, 'ana_resenha'); assert.equal(perfil.jogos.length, 2); assert.equal(perfil.pais, 'Brasil'); assert.ok(!('usuario_id' in perfil));
assert.equal((await anon.get('/api/usuarios/ninguem')).status, 404);

// ---- jogadores, match, seguir ----
const lista = await ok(ana.get(`/api/jogadores?jogo=${id('Valorant')}`));
assert.ok(lista.some((p) => p.nome_usuario === 'toniz2') && lista.some((p) => p.nome_usuario === 'bia') && !lista.some((p) => p.nome_usuario === 'ana_gamer'));
const match = await ok(ana.get('/api/match'));
assert.equal(match[0].jogos_em_comum >= 1, true); assert.ok(match.find((m) => m.nome_usuario === 'bia').mesmo_horario);
assert.equal((await ok(ana.post('/api/seguir/bia'))).seguindo, true);
assert.equal((await ok(ana.post('/api/seguir/bia'))).seguindo, false);
assert.equal((await ana.post('/api/seguir/ana_gamer')).status, 400);

// ---- grupos ----
const g = await ok(ana.post('/api/grupos', { jogo_id: id('Valorant'), titulo: 'Duo de teste', descricao: 'so um', max_membros: 2 }), 201);
const det = await ok(anon.get(`/api/grupos/${g.grupo_id}`)); assert.equal(det.membros, 1); assert.equal(det.integrantes[0].cargo, 'lider');
await ok(bia.post(`/api/grupos/${g.grupo_id}/entrar`));
assert.equal((await ok(bia.get(`/api/grupos/${g.grupo_id}`))).status, 'cheio');
const cheio = await cat.post('/api/auth/registrar', { nome_usuario: 'gato', email: 'g@t.com', senha: 'senhaboa123' }); assert.equal(cheio.status, 201);
const r1 = await cat.post(`/api/grupos/${g.grupo_id}/entrar`); assert.equal(r1.status, 400); assert.match(r1.dados.erro, /cheio/);
assert.ok([400, 409].includes((await bia.post(`/api/grupos/${g.grupo_id}/entrar`)).status), 'entrar duas vezes');
assert.equal((await ana.post(`/api/grupos/${g.grupo_id}/sair`)).status, 400, 'lider nao sai');
await ok(bia.post(`/api/grupos/${g.grupo_id}/sair`)); assert.equal((await ok(ana.get(`/api/grupos/${g.grupo_id}`))).status, 'aberto');
await ok(bia.post(`/api/grupos/${g.grupo_id}/entrar`));
assert.equal((await anon.post('/api/grupos', { jogo_id: 1, titulo: 'abc' })).status, 401);
assert.ok((await ok(ana.get('/api/grupos'))).find((x) => x.grupo_id === g.grupo_id).participando);

// ---- avaliacoes e reputacao ----
await ok(ana.post('/api/avaliacoes', { avaliado: 'bia', grupo_id: g.grupo_id, nota: 5, comentario: 'Top' }), 201);
await ok(ana.post('/api/avaliacoes', { avaliado: 'bia', grupo_id: g.grupo_id, nota: 4 }), 201);   // reavaliar atualiza
assert.equal((await anon.get('/api/usuarios/bia')).dados.reputacao, 4);
assert.equal((await cat.post('/api/avaliacoes', { avaliado: 'bia', grupo_id: g.grupo_id, nota: 5 })).status, 400, 'quem nao participou nao avalia');
assert.equal((await ana.post('/api/avaliacoes', { avaliado: 'ana_gamer', grupo_id: g.grupo_id, nota: 5 })).status, 400, 'auto-avaliacao');
assert.equal((await ana.post('/api/avaliacoes', { avaliado: 'bia', grupo_id: g.grupo_id, nota: 9 })).status, 400);

// ---- mensagens ----
await ok(ana.post('/api/mensagens/bia', { texto: 'Bora jogar?' }), 201);
await ok(bia.post('/api/mensagens/ana_gamer', { texto: 'Bora!' }), 201);
const msgs = await ok(ana.get('/api/mensagens/bia')); assert.deepEqual(msgs.map((m) => [m.minha, m.texto]), [[true, 'Bora jogar?'], [false, 'Bora!']]);
const conv = await ok(bia.get('/api/conversas')); assert.equal(conv.length, 1); assert.equal(conv[0].nome_usuario, 'ana_gamer'); assert.equal(conv[0].ultima, 'Bora!');
assert.equal((await ana.post('/api/mensagens/bia', { texto: '   ' })).status, 400);
assert.equal((await ana.post('/api/mensagens/ana_gamer', { texto: 'oi' })).status, 400);
assert.equal((await cat.get('/api/mensagens/bia')).dados.length, 0, 'conversa so mostra as proprias mensagens');

// ---- forum ----
const t = await ok(ana.post(`/api/jogos/${id('Valorant')}/forum`, { titulo: 'Qual mapa?', corpo: 'Ascent ou Bind?' }), 201);
await ok(bia.post(`/api/forum/${t.topico_id}/respostas`, { corpo: 'Bind!' }), 201);
assert.equal((await ok(bia.post(`/api/forum/${t.topico_id}/curtir`))).curti, true);
const forum = (await ok(ana.get(`/api/jogos/${id('Valorant')}/forum`))).find((x) => x.topico_id === t.topico_id);
assert.equal(forum.curtidas, 1); assert.equal(forum.respostas[0].autor, 'bia'); assert.equal(forum.curti, false);
assert.equal((await ana.post('/api/forum/99999/curtir')).status, 404);

// ---- injecao e escape: o texto fica guardado como texto ----
await ok(ana.post('/api/mensagens/bia', { texto: `x'); DROP TABLE usuarios;--` }), 201);
assert.ok((await anon.get('/api/jogos')).dados.length === 19, 'tabelas intactas');
const tend = await ok(anon.get('/api/tendencias')); assert.ok(tend[0].pontos >= tend.at(-1).pontos);
assert.equal((await anon.get('/api/saude')).status, 200);
assert.equal((await anon.get('/api/nao-existe')).status, 404);

console.log('API: todos os testes passaram');
srv.close(); await db.close();
