// Matriz de autorização (checklist TST-01/02/11, AUZ, PERM, DM, ADM):
//  A) TODAS as rotas da API sem sessão: só as de uma lista pública, escrita à mão, podem responder sem login.
//     Uma rota NOVA que ficar aberta por esquecimento faz este teste falhar.
//  B) papéis (dono, administrador, moderador, membro, de fora, banido) × ações de servidor.
//  C) IDOR: uma pessoa tentando ler/mexer no que é de outra (mensagens, DMs, arquivos, sessões, cargos de outro servidor...).
//  D) mass assignment: campos extras (is_admin, ownerId, authorId...) são ignorados.
// Uso: node e2e/authz-matrix.mjs
import { spawn, execFileSync } from 'node:child_process';
import { tempDir } from './_tmp.mjs';

const PORT = 3297;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-authz-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const call = async (method, p, token, body, extra = {}) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.20.${(ip >> 8) % 250}.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

// rotas que PODEM responder sem login (cada uma é uma decisão consciente)
const PUBLIC = new Set([
  'GET /health', 'GET /version', 'GET /config', 'POST /auth/register', 'GET /auth/username-available', 'POST /auth/register/start', 'POST /auth/register/resend',
  'POST /auth/register/confirm', 'POST /auth/login', 'GET /invites/:code', 'POST /auth/cookie', 'POST /auth/logout', 'POST /auth/recover', 'POST /auth/forgot', 'POST /auth/reset',
  'POST /waitlist', 'POST /waitlist/remove', 'GET /download/windows', 'GET /download/info', 'GET /download/android', 'GET /app/android', 'GET /push/key', 'POST /stats/view',
  'GET /images/:id', 'GET /emojis/:id', 'GET /attachments/:id/:name', 'GET /embed', 'GET /embed/thumb', 'GET /sfu/status', 'GET /apoio', 'POST /telemetry/call-health', 'GET /ice',
]);

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }

  // ---------- A) varredura sem sessão ----------
  const dump = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { createServer } from 'node:http';
    import { createDb } from './server/src/db.ts';
    import { Realtime } from './server/src/realtime.ts';
    import { createRoutes } from './server/src/routes.ts';
    const db = await createDb(); const rt = new Realtime(createServer(), db); const router = createRoutes(db, rt); const out = [];
    const walk = (s) => { for (const l of s) { if (l.route) for (const m of Object.keys(l.route.methods)) out.push(m.toUpperCase() + ' ' + l.route.path); else if (l.handle?.stack) walk(l.handle.stack); } };
    walk(router.stack); console.log('@@ROTAS@@' + JSON.stringify(out)); process.exit(0);`], { encoding: 'utf8', env: { ...process.env, DATA_DIR: tempDir('resenha-routes-') } });
  const routes = JSON.parse(dump.split('@@ROTAS@@')[1]);
  check(routes.length > 150, `lista de rotas (${routes.length})`);
  const open = [];
  for (const r of routes) {
    if (PUBLIC.has(r)) continue;
    const [method, p] = r.split(' ');
    const url = p.replace(/:[A-Za-z]+/g, 'x');
    const res = await call(method, url, null, method === 'GET' || method === 'DELETE' ? undefined : {});
    if (res.status !== 401) open.push(`${r} → ${res.status}`);
  }
  check(open.length === 0, `rotas SEM login que não estão na lista pública: ${open.join(' | ')}`);
  // com um token de pessoa comum, as rotas da equipe respondem 404 (como se não existissem)
  step(`A) ${routes.length} rotas varridas sem sessão (${PUBLIC.size} públicas de propósito, o resto exige login)`);

  // ---------- contas e servidor de teste ----------
  const reg = async (u) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const dono = await reg('dono'); const adm = await reg('adm'); const mod = await reg('mod'); const membro = await reg('membro');
  const fora = await reg('fora'); const banido = await reg('banido'); const equipe = await reg('equipe');
  const { guild } = await call('POST', '/guilds', dono.token, { name: 'Matriz' });
  const G = guild.id; const geral = guild.channels.find((c) => c.type === 'text').id;
  for (const u of [adm, mod, membro, banido]) await call('POST', `/invites/${guild.inviteCode}/join`, u.token);
  const rAdm = (await call('POST', `/guilds/${G}/roles`, dono.token, { name: 'Adm', permissions: 1 })).roleId;
  const rMod = (await call('POST', `/guilds/${G}/roles`, dono.token, { name: 'Mod', permissions: (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 2) })).roleId;
  await call('PUT', `/guilds/${G}/members/${adm.user.id}/roles`, dono.token, { roleIds: [rAdm] });
  await call('PUT', `/guilds/${G}/members/${mod.user.id}/roles`, dono.token, { roleIds: [rMod] });
  await call('POST', `/guilds/${G}/bans`, dono.token, { userId: banido.user.id, reason: 'teste' });
  const msg = (await call('POST', `/channels/${geral}/messages`, membro.token, { content: 'olá' })).message;

  // ---------- B) papéis × ações ----------
  const who = { dono, adm, mod, membro, fora, banido };
  const can = (res) => res.status < 300;
  const expect = async (nome, fn, allowed) => {
    for (const [papel, u] of Object.entries(who)) {
      const res = await fn(u);
      const ok = can(res);
      check(ok === allowed.includes(papel), `${nome}: ${papel} ${ok ? 'conseguiu' : `foi recusado (${res.status})`} — esperado ${allowed.includes(papel) ? 'conseguir' : 'recusar'}`);
    }
  };
  await expect('ver o registro de auditoria', (u) => call('GET', `/guilds/${G}/audit`, u.token), ['dono', 'adm']);
  await expect('ver a lista de banidos', (u) => call('GET', `/guilds/${G}/bans`, u.token), ['dono', 'adm', 'mod']);
  await expect('ver as regras de moderação automática', (u) => call('GET', `/guilds/${G}/automod`, u.token), ['dono', 'adm']);
  await expect('ver o armazenamento do servidor', (u) => call('GET', `/guilds/${G}/storage`, u.token), ['dono', 'adm']);
  await expect('listar bots do servidor', (u) => call('GET', `/guilds/${G}/bots`, u.token), []); // exige recurso em teste: ninguém
  await expect('criar cargo', (u) => call('POST', `/guilds/${G}/roles`, u.token, { name: 'x' + Math.random().toString(36).slice(2, 6) }), ['dono', 'adm']);
  await expect('renomear o servidor', (u) => call('PATCH', `/guilds/${G}`, u.token, { name: 'Matriz' }), ['dono', 'adm']);
  await expect('ler o canal geral', (u) => call('GET', `/channels/${geral}/messages`, u.token), ['dono', 'adm', 'mod', 'membro']);
  await expect('escrever no canal geral', (u) => call('POST', `/channels/${geral}/messages`, u.token, { content: 'oi' }), ['dono', 'adm', 'mod', 'membro']);
  await expect('buscar mensagens do servidor', (u) => call('GET', `/search?text=oi&guildId=${G}`, u.token), ['dono', 'adm', 'mod', 'membro']);
  await expect('criar convite', (u) => call('POST', `/guilds/${G}/invite`, u.token), ['dono', 'adm']);
  step('B) papéis × ações de servidor (auditoria, bans, moderação, armazenamento, cargos, canais, busca)');

  // hierarquia: o moderador (cargo com banir/expulsar) não age sobre administrador nem dono
  check((await call('POST', `/guilds/${G}/bans`, mod.token, { userId: adm.user.id })).status === 403, 'moderador banindo administrador');
  check((await call('POST', `/guilds/${G}/bans`, mod.token, { userId: dono.user.id })).status === 403, 'moderador banindo o dono');
  check((await call('DELETE', `/guilds/${G}/members/${dono.user.id}`, adm.token)).status === 403, 'administrador expulsando o dono');
  check((await call('POST', `/guilds/${G}/members/${adm.user.id}/timeout`, mod.token, { minutes: 5 })).status === 403, 'moderador silenciando administrador');
  check((await call('PUT', `/guilds/${G}/members/${membro.user.id}/roles`, membro.token, { roleIds: [rAdm] })).status === 403, 'membro se dando o cargo de administrador');
  check((await call('PUT', `/guilds/${G}/members/${mod.user.id}/roles`, mod.token, { roleIds: [rMod, rAdm] })).status === 403, 'moderador se promovendo a administrador');
  check((await call('PATCH', `/roles/${rAdm}`, mod.token, { permissions: 1 })).status === 403, 'moderador editando cargo de administrador');
  check((await call('DELETE', `/guilds/${G}`, adm.token, { password: PASS })).status === 403, 'administrador apagando o servidor (só o dono)');
  // moderador apaga mensagem alheia, mas não edita o texto dela
  check((await call('PATCH', `/messages/${msg.id}`, mod.token, { content: 'editado pelo mod' })).status === 403, 'moderador editando o texto de outra pessoa');
  check((await call('PATCH', `/messages/${msg.id}`, adm.token, { content: 'editado pelo adm' })).status === 403, 'administrador editando o texto de outra pessoa');
  check((await call('PATCH', `/messages/${msg.id}`, membro.token, { content: 'editei' })).status < 300, 'autor editando a própria mensagem');
  check((await call('PATCH', `/messages/${msg.id}`, fora.token, { content: 'x' })).status >= 400, 'de fora editando mensagem');
  check((await call('DELETE', `/messages/${msg.id}`, fora.token)).status >= 400, 'de fora apagando mensagem');
  check((await call('DELETE', `/messages/${msg.id}`, banido.token)).status >= 400, 'banido apagando mensagem');
  step('B) hierarquia de cargos e edição/remoção de mensagens (moderador apaga, só o autor edita)');

  // banido: perdeu tudo, inclusive por convite novo
  check((await call('POST', `/invites/${guild.inviteCode}/join`, banido.token)).status >= 400, 'banido voltando pelo convite');
  check((await call('GET', `/guilds/${G}`, banido.token)).status >= 400, 'banido lendo o servidor');

  // ---------- C) IDOR ----------
  const dmRes = await call('POST', '/dms', membro.token, { userId: mod.user.id });
  const dmId = dmRes.dm?.id ?? dmRes.dm?.channelId ?? dmRes.channelId ?? dmRes.id ?? dmRes.channel?.id;
  check(!!dmId, 'criou DM: ' + JSON.stringify(dmRes).slice(0, 160));
  await call('POST', `/channels/${dmId}/messages`, membro.token, { content: 'segredo do membro' });
  for (const [p, u] of [['de fora', fora], ['administrador do servidor', adm], ['dono do servidor', dono], ['equipe da plataforma', equipe]]) {
    check((await call('GET', `/channels/${dmId}/messages`, u.token)).status >= 400, `${p} lendo a DM de outros`);
    check((await call('POST', `/channels/${dmId}/messages`, u.token, { content: 'invasão' })).status >= 400, `${p} escrevendo na DM de outros`);
    check((await call('GET', `/channels/${dmId}/pins`, u.token)).status >= 400, `${p} lendo pins da DM`);
  }
  const srch = await call('GET', '/search?text=segredo&guildId=' + G, adm.token);
  check(!JSON.stringify(srch).includes('segredo do membro'), 'busca de outra pessoa achou texto de DM alheia');
  // outro servidor: ids de cargo/canal/categoria de outro servidor não podem ser mexidos
  const { guild: g2 } = await call('POST', '/guilds', fora.token, { name: 'Outro' });
  const r2 = (await call('POST', `/guilds/${g2.id}/roles`, fora.token, { name: 'R2' })).roleId;
  const ch2 = g2.channels.find((c) => c.type === 'text').id;
  check((await call('PATCH', `/roles/${r2}`, dono.token, { name: 'invasão' })).status >= 400, 'dono de um servidor editando cargo de outro');
  check((await call('DELETE', `/roles/${r2}`, dono.token)).status >= 400, 'dono de um servidor apagando cargo de outro');
  check((await call('PATCH', `/channels/${ch2}`, dono.token, { name: 'invasao' })).status >= 400, 'dono de um servidor editando canal de outro');
  check((await call('DELETE', `/channels/${ch2}`, dono.token)).status >= 400, 'dono de um servidor apagando canal de outro');
  check((await call('GET', `/channels/${ch2}/messages`, dono.token)).status >= 400, 'dono de um servidor lendo canal de outro');
  check((await call('POST', `/channels/${ch2}/messages`, dono.token, { content: 'x' })).status >= 400, 'escrevendo em canal de servidor onde não está');
  check((await call('GET', `/guilds/${g2.id}/audit`, dono.token)).status >= 400, 'lendo auditoria de outro servidor');
  check((await call('GET', `/guilds/${g2.id}`, dono.token)).status >= 400, 'lendo detalhes de servidor privado onde não está');
  check((await call('PUT', `/guilds/${g2.id}/members/${fora.user.id}/roles`, dono.token, { roleIds: [r2] })).status >= 400, 'dando cargo em servidor de outro');
  check((await call('POST', `/guilds/${g2.id}/bans`, dono.token, { userId: fora.user.id })).status >= 400, 'banindo no servidor de outro');
  // reações, pins, enquetes, edição em canal que a pessoa não enxerga
  const m2 = (await call('POST', `/channels/${ch2}/messages`, fora.token, { content: 'privado do outro' })).message;
  check((await call('POST', `/messages/${m2.id}/reactions`, dono.token, { emoji: '👍' })).status >= 400, 'reagindo a mensagem de servidor onde não está');
  check((await call('POST', `/messages/${m2.id}/pin`, dono.token)).status >= 400, 'fixando mensagem de servidor onde não está');
  check((await call('POST', `/channels/${ch2}/read`, dono.token, {})).status >= 400, 'marcando como lido canal alheio');
  // sessões e dados pessoais
  const sess = await call('GET', '/me/sessions', fora.token);
  const sid = sess.sessions?.[0]?.id;
  if (sid) check((await call('DELETE', `/me/sessions/${sid}`, dono.token)).status >= 400 || (await call('GET', '/me/sessions', fora.token)).sessions?.length === sess.sessions.length, 'apagando sessão de outra pessoa');
  const exp = await call('GET', '/me/export', dono.token);
  check(!JSON.stringify(exp).includes('segredo do membro') && !JSON.stringify(exp).includes(fora.user.id + '"'), 'exportação de dados do dono continha dados de outras pessoas');
  check((await call('GET', `/users/${fora.user.id}/profile`, dono.token)).status < 500, 'perfil');
  check(!JSON.stringify(await call('GET', `/users/${fora.user.id}/profile`, dono.token)).match(/password|hash|email"|token/i), 'perfil público vazando senha/e-mail/token');
  step('C) IDOR: DMs, servidores, cargos, canais, reações, pins, sessões e exportação de outras pessoas ficam fechados');


  // ---------- C2) canal privado: nenhum caminho vaza (PERM-03) ----------
  const rDir = (await call('POST', `/guilds/${G}/roles`, dono.token, { name: 'Diretoria' })).roleId;
  const priv = (await call('POST', `/guilds/${G}/channels`, dono.token, { name: 'diretoria', type: 'text', allowedRoleIds: [rDir] })).channel.id;
  const pm = (await call('POST', `/channels/${priv}/messages`, dono.token, { content: 'plano-secreto-xyz' })).message;
  await call('POST', `/messages/${pm.id}/pin`, dono.token);
  await call('POST', `/channels/${priv}/messages`, dono.token, { content: 'enquete', poll: { question: 'Q?', options: ['a', 'b'] } });
  check((await call('GET', `/channels/${priv}/messages`, membro.token)).status === 404, 'membro lendo histórico de canal privado');
  check((await call('GET', `/channels/${priv}/pins`, membro.token)).status === 404, 'membro lendo pins de canal privado');
  check((await call('POST', `/channels/${priv}/messages`, membro.token, { content: 'x' })).status === 404, 'membro escrevendo em canal privado');
  check((await call('POST', `/messages/${pm.id}/reactions`, membro.token, { emoji: '👍' })).status >= 400, 'membro reagindo em canal privado');
  check((await call('POST', `/messages/${pm.id}/pin`, membro.token)).status >= 400, 'membro fixando em canal privado');
  check((await call('PATCH', `/messages/${pm.id}`, membro.token, { content: 'x' })).status >= 400, 'membro editando em canal privado');
  check((await call('DELETE', `/messages/${pm.id}`, mod.token)).status >= 400, 'moderador sem acesso apagando mensagem em canal privado');
  check((await call('GET', `/search?text=plano-secreto-xyz&guildId=${G}`, membro.token)).messages?.length === 0 || !JSON.stringify(await call('GET', `/search?text=plano-secreto-xyz&guildId=${G}`, membro.token)).includes('plano-secreto-xyz'), 'busca do servidor achou texto de canal privado');
  check((await call('GET', `/search?text=plano-secreto-xyz&channelId=${priv}`, membro.token)).status >= 400, 'busca direta em canal privado');
  check((await call('POST', `/channels/${priv}/interactions`, membro.token, { command: 'moeda', args: '' })).status >= 400, 'comando de bot em canal privado sem acesso');
  const bootM = JSON.stringify(await call('GET', '/bootstrap', membro.token));
  check(!bootM.includes(priv) && !bootM.includes('plano-secreto-xyz'), 'bootstrap do membro mostrou canal privado ou conteúdo dele');
  const gdM = JSON.stringify(await call('GET', `/guilds/${G}`, membro.token));
  check(!gdM.includes(priv), 'detalhes do servidor mostraram o canal privado para quem não tem acesso');
  check((await call('GET', `/channels/${priv}/messages`, dono.token)).status === 200, 'dono perdeu acesso ao canal privado');
  step('C2) canal privado: histórico, pins, escrita, reações, edição, busca, comandos de bot e listagens ficam fechados para quem não tem o cargo');

  // ---------- D) mass assignment ----------
  const me = await call('PATCH', '/me', fora.token, { displayName: 'Nome Novo', isAdmin: true, is_bot: true, bot: true, username: 'dono', role: 'admin', platformAdmin: true, emailVerified: true, id: dono.user.id });
  const meNow = await call('GET', '/bootstrap', fora.token);
  const meU = meNow.user ?? meNow.me ?? meNow.self;
  check(meU?.id === fora.user.id && meU?.username === 'fora' && !meU?.bot, `PATCH /me aceitou campo extra: ${JSON.stringify(Object.keys(meNow)).slice(0, 160)} ${JSON.stringify(me).slice(0, 160)}`);
  const g3 = await call('POST', '/guilds', fora.token, { name: 'Mass', ownerId: dono.user.id, public: true, official: true, id: 'meu-id', inviteCode: 'FIXO' });
  check(g3.guild?.ownerId === fora.user.id && g3.guild?.inviteCode !== 'FIXO' && g3.guild?.id !== 'meu-id', `POST /guilds aceitou campo extra: ${JSON.stringify(g3.guild).slice(0, 200)}`);
  const m3 = await call('POST', `/channels/${geral}/messages`, membro.token, { content: 'forjar', authorId: dono.user.id, author: { id: dono.user.id }, createdAt: '2001-01-01', mentionEveryone: true, system: 'join', id: 'meu-id', pinned: true });
  check(m3.message?.author?.id === membro.user.id && m3.message?.id !== 'meu-id' && !m3.message?.system && !m3.message?.pinned, `POST message aceitou campo extra: ${JSON.stringify(m3.message).slice(0, 220)}`);
  check(!m3.message?.mentionEveryone, 'membro sem permissão marcou @everyone');
  const rr = await call('POST', `/guilds/${G}/roles`, dono.token, { name: 'Extra', permissions: 0, guildId: g2.id, position: 0, id: 'x' });
  check(rr.status < 300, 'criar cargo com campos extras');
  step('D) campos extras (isAdmin, ownerId, authorId, id, role...) são ignorados nas rotas de criação/edição');

  if (!fails.length) console.log('\nTudo certo com a matriz de autorização.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (fails.length) {
    console.error(`\n✗ ${fails.length} falha(s) de autorização:\n- ${fails.join('\n- ')}`);
    process.exitCode = 1;
  }
  server.kill();
}
