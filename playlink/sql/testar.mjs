// Roda os 3 arquivos SQL num PostgreSQL de teste (PGlite) e confere as regras do banco.
//   node playlink/sql/testar.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir = new URL('.', import.meta.url);
const db = new PGlite();
for (const f of ['01_schema.sql', '02_dados_exemplo.sql']) await db.exec(await readFile(new URL(f, dir), 'utf8'));
const q = async (s, p) => (await db.query(s, p)).rows;
const falha = async (s, msg) => { try { await db.exec(s); } catch (e) { return assert.match(String(e.message), msg); } assert.fail('devia falhar: ' + s); };
await db.exec('SET search_path = playlink, public');

// consultas de demonstracao rodam sem erro
const consultas = (await readFile(new URL('03_consultas.sql', dir), 'utf8')).split(/;\s*\n/).map(s => s.trim()).filter(s => /select/i.test(s));
for (const c of consultas) await db.query(c);
console.log(`consultas: ${consultas.length} ok`);

// regras
assert.equal((await q(`select count(*)::int n from membros_grupo m join grupos g using(grupo_id) where m.usuario_id = g.lider_id and m.cargo='lider'`))[0].n, 5, 'lider entra sozinho');
assert.equal((await q(`select status from grupos where titulo='Trio de elite'`))[0].status, 'cheio', 'grupo lotado fica cheio');
await falha(`insert into membros_grupo(grupo_id,usuario_id) select g.grupo_id,u.usuario_id from grupos g, usuarios u where g.titulo='Trio de elite' and u.nome_usuario='Luna.exe'`, /cheio/);
await db.exec(`delete from membros_grupo where grupo_id=(select grupo_id from grupos where titulo='Trio de elite') and usuario_id=(select usuario_id from usuarios where nome_usuario='toniz2')`);
assert.equal((await q(`select status from grupos where titulo='Trio de elite'`))[0].status, 'aberto', 'volta a abrir ao sair alguem');
await falha(`insert into avaliacoes(avaliador_id,avaliado_id,grupo_id,nota) select a.usuario_id,a.usuario_id,g.grupo_id,5 from usuarios a,grupos g where a.nome_usuario='toniz2' and g.titulo='Squad da madrugada'`, /check|violates/i);
await falha(`insert into avaliacoes(avaliador_id,avaliado_id,grupo_id,nota) select a.usuario_id,b.usuario_id,g.grupo_id,5 from usuarios a,usuarios b,grupos g where a.nome_usuario='drako' and b.nome_usuario='toniz2' and g.titulo='Squad da madrugada'`, /participado/);
await falha(`insert into avaliacoes(avaliador_id,avaliado_id,grupo_id,nota) select a.usuario_id,b.usuario_id,g.grupo_id,9 from usuarios a,usuarios b,grupos g where a.nome_usuario='vitorbr' and b.nome_usuario='toniz2' and g.titulo='Squad da madrugada'`, /check|violates/i);
assert.equal(Number((await q(`select reputacao from usuarios where nome_usuario='toniz2'`))[0].reputacao), 4.5, 'reputacao = media');
await falha(`insert into usuarios(nome_usuario,email,senha_hash) values('x','a@b.com','h')`, /check|violates/i);
await falha(`insert into usuarios(nome_usuario,email,senha_hash) values('toniz2','novo@b.com','h')`, /unique|duplicate/i);
console.log('regras do banco: ok');
