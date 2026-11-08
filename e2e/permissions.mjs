// Teste da API de cargos, permissões e moderação (sem navegador): dono, moderador e membro comum
// tentando fazer o que podem e o que não podem. Uso: node e2e/permissions.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const PORT = 3132;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-perm-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, token, body, raw) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: {
      ...(raw ? { 'content-type': 'image/png' } : body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}
const ok = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: esperava sucesso, veio ${r.status} ${r.error}`);
  return r;
};
const denied = (r, what, status = 403) => {
  if (r.status !== status) throw new Error(`${what}: esperava ${status}, veio ${r.status} ${r.error ?? ''}`);
  return r;
};

function png(w, h) {
  const chunk = (t, d) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const sockets = [];
function connect(token) {
  const s = io(BASE, { auth: { token }, transports: ['websocket'] });
  sockets.push(s);
  const got = [];
  s.onAny((ev, data) => got.push({ ev, data }));
  return new Promise((resolve) => s.on('ready', () => resolve({ s, got })));
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = async (u) => ok(await call('POST', '/auth/register', null, { username: u, password: 'segredo123', displayName: u }), 'cadastro');
  const A = await reg('dono');
  const B = await reg('moderador');
  const C = await reg('membro');
  const { guild } = ok(await call('POST', '/guilds', A.token, { name: 'Galera' }), 'criar servidor');
  const G = guild.id;
  for (const u of [B, C]) ok(await call('POST', `/invites/${guild.inviteCode}/join`, u.token), 'entrar');
  const textId = guild.channels.find((c) => c.type === 'text').id;
  const voiceId = guild.channels.find((c) => c.type === 'voice').id;

  // ---- cargos e permissões básicas ----
  denied(await call('POST', `/guilds/${G}/channels`, B.token, { name: 'x', type: 'text' }), 'membro sem cargo criando canal');
  const mod = ok(
    await call('POST', `/guilds/${G}/roles`, A.token, { name: 'Mod', color: '#3ba55d', permissions: (1 << 2) | (1 << 4) | (1 << 7) }),
    'criar cargo Mod',
  ).roleId;
  ok(await call('PUT', `/guilds/${G}/members/${B.user.id}/roles`, A.token, { roleIds: [mod] }), 'dar Mod');
  ok(await call('POST', `/guilds/${G}/channels`, B.token, { name: 'Memes do Mod', type: 'text' }), 'Mod cria canal');
  step('sem cargo não cria canal; com cargo "Mod" (Gerenciar canais) cria');

  denied(await call('POST', `/guilds/${G}/roles`, B.token, { name: 'Hack', permissions: 1 }), 'Mod criando cargo (sem permissão)');
  denied(await call('DELETE', `/guilds/${G}/members/${A.user.id}`, B.token), 'Mod expulsando o dono');
  ok(await call('DELETE', `/guilds/${G}/members/${C.user.id}`, B.token), 'Mod expulsa membro');
  ok(await call('POST', `/invites/${guild.inviteCode}/join`, C.token), 'membro volta');
  step('Mod expulsa membro comum, mas não o dono nem cria cargos');

  // ---- hierarquia ----
  ok(await call('PATCH', `/roles/${mod}`, A.token, { permissions: (1 << 2) | (1 << 3) | (1 << 4) | (1 << 7) }), 'Mod ganha Gerenciar cargos');
  const vip = ok(await call('POST', `/guilds/${G}/roles`, A.token, { name: 'VIP', color: '#faa61a' }), 'criar VIP').roleId;
  ok(await call('PUT', `/guilds/${G}/members/${C.user.id}/roles`, B.token, { roleIds: [vip] }), 'Mod dá VIP (abaixo dele)');
  denied(await call('PATCH', `/roles/${mod}`, B.token, { name: 'Super Mod' }), 'Mod editando o próprio cargo');
  denied(await call('POST', `/guilds/${G}/roles`, B.token, { name: 'Admin falso', permissions: 1 }), 'Mod criando cargo com Administrador');
  ok(await call('PUT', `/guilds/${G}/members/${B.user.id}/roles`, B.token, { roleIds: [mod, vip] }), 'Mod se dá VIP (abaixo dele)');
  denied(await call('PUT', `/guilds/${G}/members/${B.user.id}/roles`, B.token, { roleIds: [vip] }), 'Mod mexendo no próprio cargo Mod');
  step('hierarquia: Mod dá cargos abaixo dele, mas não edita o próprio nem cria Administrador');

  // ---- canal privado ----
  const adminsOnly = ok(await call('POST', `/guilds/${G}/roles`, A.token, { name: 'Diretoria', color: '#ed4245' }), 'cargo Diretoria').roleId;
  const priv = ok(await call('POST', `/guilds/${G}/channels`, A.token, { name: 'segredos', type: 'text', allowedRoleIds: [adminsOnly] }), 'canal privado').channel.id;
  const seenBy = async (t) => (await call('GET', `/guilds/${G}`, t)).guild.channels.some((c) => c.id === priv);
  if (!(await seenBy(A.token)) || (await seenBy(B.token)) || (await seenBy(C.token))) throw new Error('visibilidade do canal privado errada');
  denied(await call('GET', `/channels/${priv}/messages`, C.token), 'membro lendo canal privado', 404);
  const cSock = await connect(C.token);
  const bSock = await connect(B.token);
  ok(await call('PUT', `/guilds/${G}/members/${B.user.id}/roles`, A.token, { roleIds: [mod, adminsOnly] }), 'B ganha Diretoria');
  await sleep(300);
  ok(await call('POST', `/channels/${priv}/messages`, A.token, { content: 'plano secreto' }), 'mensagem privada');
  await sleep(500);
  const leaked = cSock.got.some((e) => e.ev === 'message:new' && e.data.message.content === 'plano secreto');
  const delivered = bSock.got.some((e) => e.ev === 'message:new' && e.data.message.content === 'plano secreto');
  if (leaked || !delivered) throw new Error(`entrega do canal privado errada (vazou=${leaked}, entregou=${delivered})`);
  step('canal privado: só o cargo vê; a mensagem chega só para quem pode (sem vazar pelo tempo real)');

  // privado sem nenhum cargo marcado = só dono e administradores (não pode virar público)
  const empty = ok(await call('POST', `/guilds/${G}/channels`, A.token, { name: 'so-dono', type: 'text', allowedRoleIds: [] }), 'privado vazio').channel;
  const seesEmpty = async (t) => (await call('GET', `/guilds/${G}`, t)).guild.channels.some((c) => c.id === empty.id);
  if (!(await seesEmpty(A.token)) || (await seesEmpty(B.token)) || (await seesEmpty(C.token)) || !Array.isArray(empty.allowedRoleIds)) {
    throw new Error('canal privado sem cargos virou público');
  }
  step('canal privado sem cargos marcados fica só para o dono e administradores');

  // ---- @todos ----
  const m1 = ok(await call('POST', `/channels/${textId}/messages`, C.token, { content: '@todos bora?' }), '@todos').message;
  ok(await call('PATCH', `/guilds/${G}`, A.token, { everyonePermissions: (1 << 9) | (1 << 10) }), 'tirar @todos de todos');
  const m2 = ok(await call('POST', `/channels/${textId}/messages`, C.token, { content: '@todos de novo' }), '@todos sem perm').message;
  if (!m1.mentionEveryone || m2.mentionEveryone) throw new Error('@todos não respeitou a permissão');
  step('@todos só notifica quem tem a permissão');

  // ---- apagar mensagem dos outros ----
  const fromA = ok(await call('POST', `/channels/${textId}/messages`, A.token, { content: 'msg do dono' }), 'msg').message;
  denied(await call('DELETE', `/messages/${fromA.id}`, C.token), 'membro apagando msg do dono');
  ok(await call('DELETE', `/messages/${m2.id}`, B.token), 'Mod apaga msg do membro');
  step('só quem tem "Gerenciar mensagens" apaga mensagens dos outros');

  // ---- castigo ----
  denied(await call('POST', `/guilds/${G}/members/${C.user.id}/timeout`, C.token, { minutes: 5 }), 'membro castigando');
  ok(await call('POST', `/guilds/${G}/members/${C.user.id}/timeout`, A.token, { minutes: 10 }), 'castigo');
  const t = await call('POST', `/channels/${textId}/messages`, C.token, { content: 'oi' });
  denied(t, 'membro de castigo escrevendo');
  const vj = await new Promise((r) => cSock.s.emit('voice:join', { channelId: voiceId }, r));
  if (vj.ok) throw new Error('membro de castigo entrou em voz');
  ok(await call('POST', `/guilds/${G}/members/${C.user.id}/timeout`, A.token, { minutes: 0 }), 'tirar castigo');
  ok(await call('POST', `/channels/${textId}/messages`, C.token, { content: 'voltei' }), 'escreve depois do castigo');
  step(`castigo bloqueia escrever e entrar em voz ("${t.error}") e pode ser retirado`);

  // ---- banir ----
  ok(await call('POST', `/guilds/${G}/bans`, A.token, { userId: C.user.id, reason: 'teste' }), 'banir');
  denied(await call('POST', `/invites/${guild.inviteCode}/join`, C.token), 'banido entrando');
  if ((await call('GET', `/guilds/${G}/bans`, A.token)).bans[0]?.user.id !== C.user.id) throw new Error('lista de banidos');
  ok(await call('DELETE', `/guilds/${G}/bans/${C.user.id}`, A.token), 'desbanir');
  ok(await call('POST', `/invites/${guild.inviteCode}/join`, C.token), 'volta após desbanir');
  step('banido não volta pelo convite até ser desbanido');

  // ---- limite de pessoas na voz ----
  ok(await call('PATCH', `/channels/${voiceId}`, A.token, { userLimit: 1, bitrate: 256 }), 'limite 1 + 256 kbps');
  const aSock = await connect(A.token);
  ok(await new Promise((r) => aSock.s.emit('voice:join', { channelId: voiceId }, (x) => r({ status: x.ok ? 200 : 400, ...x }))), 'A entra');
  const full = await new Promise((r) => bSock.s.emit('voice:join', { channelId: voiceId }, r));
  if (full.ok || !/cheio/.test(full.error)) throw new Error(`limite de voz: ${JSON.stringify(full)}`);
  step(`limite de pessoas por canal de voz funciona ("${full.error}")`);

  // ---- tirar o acesso derruba da voz privada ----
  ok(await call('PATCH', `/channels/${voiceId}`, A.token, { userLimit: 0 }), 'sem limite');
  ok(await new Promise((r) => bSock.s.emit('voice:join', { channelId: voiceId }, (x) => r({ status: x.ok ? 200 : 400, ...x }))), 'B entra');
  ok(await call('PATCH', `/channels/${voiceId}`, A.token, { allowedRoleIds: [vip] }), 'voz vira privada (VIP)');
  await sleep(500);
  if (!bSock.got.some((e) => e.ev === 'voice:kicked')) throw new Error('B deveria ter saído da voz privada');
  step('quando um canal de voz vira privado, quem perdeu acesso sai da chamada');

  // ---- ícone sem acumular espaço ----
  denied(await call('POST', `/guilds/${G}/icon`, C.token, null, png(4, 4)), 'membro mudando ícone');
  const icon1 = ok(await call('POST', `/guilds/${G}/icon`, A.token, null, png(4, 4)), 'ícone 1').imageId;
  const icon2 = ok(await call('POST', `/guilds/${G}/icon`, A.token, null, png(8, 8)), 'ícone 2').imageId;
  const old = await fetch(`${BASE}/api/images/${icon1}`);
  const cur = await fetch(`${BASE}/api/images/${icon2}`);
  if (old.status !== 404 || cur.status !== 200) throw new Error('ícone antigo deveria ter sido apagado');
  const st = ok(await call('GET', `/guilds/${G}/storage`, A.token), 'uso do banco');
  step(`trocar o ícone apaga o antigo; uso do banco: ${(st.databaseBytes / 1e6).toFixed(1)} MB de ${(st.limitBytes / 1e6).toFixed(0)} MB`);

  // ---- categorias e organização ----
  const cat = ok(await call('POST', `/guilds/${G}/categories`, B.token, { name: 'Jogos' }), 'categoria').categoryId;
  ok(await call('PUT', `/guilds/${G}/layout`, B.token, { categories: [cat], channels: [{ id: voiceId, categoryId: cat }, { id: textId, categoryId: null }] }), 'layout');
  const gA = (await call('GET', `/guilds/${G}`, A.token)).guild;
  if (gA.channels.find((c) => c.id === voiceId).categoryId !== cat || gA.categories[0]?.name !== 'Jogos') throw new Error('layout não salvou');
  if (!cSock.got.some((e) => e.ev === 'guild:refresh')) throw new Error('membros não foram avisados das mudanças');
  step('categorias e organização da barra salvam e avisam todos em tempo real');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.disconnect());
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
