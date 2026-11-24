// Tickets de ajuda do servidor (Resenha Bot, em teste): /ticket abrir | fechar | adicionar | lista
//  - o canal do ticket é PRIVADO: só quem abriu, o dono, administradores e cargos escolhidos
//  - quem não pode ver não lê, não escreve e não recebe a mensagem em tempo real
//  - limites (2 por pessoa), fechar (autor ou equipe), adicionar pessoas, lista só para a equipe
// Uso: npm run build && node e2e/bots-tickets.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const PORT = 3272;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-tickets-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.6.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const sockets = [];
const watch = (token) =>
  new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    sockets.push(s);
    const got = [];
    s.onAny((ev, d) => ev === 'message:new' && got.push(d.message));
    s.on('ready', () => resolve({ s, got }));
  });

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => api('/auth/register', { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const bia = await reg('bia');
  const caio = await reg('caio');
  const mod = await reg('moderador');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  for (const u of [bia, caio, mod]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api('/admin/beta', { bots: ['ana'] }, equipe.token, 'PUT');
  assert((await api(`/guilds/${guild.id}/bots`, {}, ana.token)).status === 200, 'instalou o bot');
  const cmd = async (token, args, ch = geral.id) => (await sleep(1100), api(`/channels/${ch}/interactions`, { command: 'ticket', args }, token));
  const channelsOf = async (token) => (await api(`/guilds/${guild.id}`, null, token)).guild?.channels ?? [];
  const sBia = await watch(bia.token);
  const sCaio = await watch(caio.token);
  const sAna = await watch(ana.token);

  // ---------- abrir ----------
  assert((await cmd(bia.token, 'abrir')).status === 400, 'assunto é obrigatório');
  assert((await cmd(bia.token, 'ajuda')).status === 400, 'subcomando desconhecido mostra o uso');
  let r = await cmd(bia.token, 'abrir Não consigo entrar na call');
  assert(r.status === 200 && /Ticket \*\*#1\*\* aberto/.test(r.message.content), `abrir: ${r.status} ${r.error}`);
  const t1 = /<#([0-9a-f-]+)>/.exec(r.message.content)[1];
  const chBia = (await channelsOf(bia.token)).find((c) => c.id === t1);
  assert(chBia && /^ticket-1-bia$/.test(chBia.name), `a Bia vê o canal ticket-1-bia (${chBia?.name})`);
  assert((await channelsOf(ana.token)).some((c) => c.id === t1), 'a dona (administradora) vê');
  assert(!(await channelsOf(caio.token)).some((c) => c.id === t1), 'outro membro NÃO vê o canal');
  assert(!(await channelsOf(mod.token)).some((c) => c.id === t1), 'membro sem cargo de atendimento NÃO vê');
  const cats = (await api(`/guilds/${guild.id}`, null, ana.token)).guild.categories;
  assert(cats.some((c) => c.name === 'Tickets') && chBia.categoryId === cats.find((c) => c.name === 'Tickets').id, 'o canal fica na categoria Tickets');
  assert((await api(`/channels/${t1}/messages`, null, caio.token)).status === 404, 'outro membro não lê as mensagens (404)');
  assert((await api(`/channels/${t1}/messages`, { content: 'oi' }, caio.token)).status === 404, 'outro membro não escreve');
  const first = await api(`/channels/${t1}/messages`, null, bia.token);
  assert(first.messages.some((m) => m.author.bot && /Não consigo entrar na call/.test(m.embeds?.[0]?.description ?? '')), 'o bot explica como funciona dentro do ticket');
  assert((await api(`/channels/${t1}/messages`, { content: 'estou sem som' }, bia.token)).status === 200, 'quem abriu escreve');
  await sleep(300);
  assert(sBia.got.some((m) => m.channelId === t1) && sAna.got.some((m) => m.channelId === t1), 'autor e dona recebem em tempo real');
  assert(!sCaio.got.some((m) => m.channelId === t1), 'quem não vê NÃO recebe a mensagem em tempo real');
  const aud = await api('/guilds/' + guild.id + '/audit', null, ana.token);
  assert(aud.entries.some((e) => e.action === 'channel_create' && /ticket-1-bia/.test(e.targetLabel ?? '')), 'auditoria registra o canal do ticket');
  step('abrir: canal privado só do autor + dono/ADM; os outros não veem, não leem, não escrevem nem recebem em tempo real');

  // ---------- limites ----------
  assert((await cmd(bia.token, 'abrir Segundo assunto')).status === 200, '2º ticket');
  r = await cmd(bia.token, 'abrir Terceiro assunto');
  assert(r.status === 400 && /2 tickets abertos/.test(r.error), `limite de 2 por pessoa: ${r.error}`);
  step('limite de 2 tickets abertos por pessoa');

  // ---------- adicionar ----------
  assert((await cmd(caio.token, 'adicionar @caio', t1)).status === 404, 'quem não vê o canal nem consegue usar comando nele');
  r = await cmd(bia.token, 'adicionar @naoexiste', t1);
  assert(r.status === 400, 'pessoa que não está no servidor');
  r = await cmd(bia.token, 'adicionar @caio', t1);
  assert(r.status === 200, `adicionar: ${r.error}`);
  assert((await channelsOf(caio.token)).some((c) => c.id === t1), 'o Caio passou a ver o ticket');
  assert((await api(`/channels/${t1}/messages`, null, caio.token)).status === 200, 'e a ler');
  step('/ticket adicionar @pessoa libera o canal para mais alguém');

  // ---------- cargo de atendimento ----------
  const role = await api(`/guilds/${guild.id}/roles`, { name: 'Atendente', permissions: 0 }, ana.token);
  const roleId = role.roleId ?? role.role?.id ?? role.id;
  assert(roleId, `cargo criado: ${JSON.stringify(role).slice(0, 100)}`);
  assert((await api(`/guilds/${guild.id}/members/${mod.user.id}/roles`, { roleIds: [roleId] }, ana.token, 'PUT')).status === 200, 'deu o cargo');
  assert((await cmd(mod.token, 'lista')).status === 400, 'sem estar na equipe de tickets, não vê a lista');
  assert((await api(`/guilds/${guild.id}/bots/config`, { ticketRoleIds: [roleId] }, bia.token, 'PATCH')).status === 404, 'só quem tem o recurso mexe na configuração');
  const cfg = await api(`/guilds/${guild.id}/bots/config`, { ticketRoleIds: [roleId] }, ana.token, 'PATCH');
  assert(cfg.status === 200 && cfg.config.ticketRoleIds[0] === roleId, 'configurou o cargo');
  assert((await api(`/guilds/${guild.id}/bots/config`, { ticketRoleIds: ['nao-existe'] }, ana.token, 'PATCH')).status === 400, 'cargo inválido');
  assert((await channelsOf(mod.token)).some((c) => c.id === t1), 'o cargo de atendimento passou a ver os tickets abertos');
  r = await cmd(mod.token, 'lista');
  assert(r.status === 200 && /#1/.test(r.message.embeds[0].description) && /#2/.test(r.message.embeds[0].description), 'a equipe vê a lista');
  assert((await cmd(bia.token, 'lista')).status === 400, 'quem abriu não vê a lista geral');
  // um ticket novo já nasce visível para o cargo
  const sMod = await watch(mod.token);
  r = await cmd(caio.token, 'abrir Dúvida sobre cargos');
  const t3 = /<#([0-9a-f-]+)>/.exec(r.message.content)[1];
  assert((await channelsOf(mod.token)).some((c) => c.id === t3), 'ticket novo nasce visível para o cargo de atendimento');
  step('cargo de atendimento: vê os tickets (antigos e novos) e a lista; só quem tem o recurso configura');

  // ---------- fechar ----------
  r = await cmd(mod.token, 'fechar', geral.id);
  assert(r.status === 400, 'fechar fora de um canal de ticket');
  assert((await cmd(caio.token, 'fechar', t1)).status === 400, 'quem foi só adicionado não fecha (nem é equipe)');
  r = await cmd(bia.token, 'fechar já resolveu', t1);
  assert(r.status === 200 && /fechado/.test(r.message.embeds[0].title) && /já resolveu/.test(r.message.embeds[0].description), `fechar: ${r.error}`);
  assert(!(await channelsOf(bia.token)).some((c) => c.id === t1), 'quem abriu deixa de ver o ticket fechado');
  assert(!(await channelsOf(caio.token)).some((c) => c.id === t1), 'quem foi adicionado também');
  assert((await channelsOf(ana.token)).find((c) => c.id === t1)?.name === 'fechado-1', 'a dona continua vendo (nome vira fechado-1)');
  assert((await channelsOf(mod.token)).some((c) => c.id === t1), 'a equipe continua vendo');
  assert((await cmd(bia.token, 'fechar', t1)).status === 404, 'o autor não entra mais no canal fechado');
  r = await cmd(ana.token, 'fechar', t3);
  assert(r.status === 200, 'a dona fecha o ticket de outra pessoa');
  // fechou: dá para abrir outro (o limite conta só os abertos)
  assert((await cmd(bia.token, 'abrir Outro assunto depois')).status === 200, 'depois de fechar, abre outro');
  step('fechar: o autor ou a equipe fecha; o autor perde o acesso, a equipe continua vendo; o limite conta só os abertos');

  sockets.forEach((s) => s.close());
  console.log('\nTudo certo com os tickets.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.close());
  server.kill();
}
