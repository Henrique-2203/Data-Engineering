// Bloqueio de pessoas (DM-01): mensagens, pedidos, ligações, presença e avisos na call. Uso: node e2e/blocks.mjs
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { tempDir } from './_tmp.mjs';

const PORT = 3307;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-blocks-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY|\[segurança\]/.test(d) || process.stderr.write(`[server] ${d}`));
let n = 1;
const call = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.90.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const sockets = [];
const connect = (token) =>
  new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], extraHeaders: { origin: BASE } });
    s.events = [];
    s.onAny((ev, payload) => s.events.push({ ev, payload }));
    s.on('ready', (r) => ((s.ready = r), resolve(s)));
    sockets.push(s);
  });
const join = (s, channelId, extra = {}) => new Promise((res) => s.emit('voice:join', { channelId, ...extra }, res));

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio'), dani = await reg('dani');
  const { guild } = await call('POST', '/guilds', ana.token, { name: 'Galera' });
  for (const u of [bia, caio, dani]) await call('POST', `/invites/${guild.inviteCode}/join`, u.token);
  const voz = guild.channels.find((c) => c.type === 'voice').id;
  const geral = guild.channels.find((c) => c.type === 'text').id;

  // amigos + uma DM com histórico
  await call('POST', '/friends', ana.token, { username: 'bia' });
  await call('POST', `/friends/${ana.user.id}/accept`, bia.token);
  const dm = (await call('POST', '/dms', bia.token, { userId: ana.user.id })).dm;
  check((await call('POST', `/channels/${dm.id}/messages`, bia.token, { content: 'oi ana' })).status === 200, 'setup: DM antes do bloqueio');

  // ---- bloquear ----
  check((await call('POST', '/blocks', ana.token, { userId: ana.user.id })).status === 400, 'não deveria bloquear a si mesma');
  check((await call('POST', '/blocks', ana.token, { userId: 'nao-existe' })).status === 404, 'bloquear id inexistente deveria dar 404');
  check((await call('POST', '/blocks', null, { userId: bia.user.id })).status === 401, 'sem login deveria dar 401');
  const bl = await call('POST', '/blocks', ana.token, { userId: bia.user.id });
  check(bl.status === 200 && bl.blocks.length === 1 && bl.blocks[0].username === 'bia', 'bloquear deveria listar a bia');
  check((await call('GET', '/friends', ana.token)).friends.length === 0, 'bloquear deveria desfazer a amizade');
  check((await call('GET', '/blocks', bia.token)).blocks.length === 0, 'a bia NÃO pode ver que foi bloqueada (a lista dela é só dela)');
  step('bloquear: lista, desfaz amizade, e quem foi bloqueado não vê nada');

  // ---- mensagens privadas, pedidos, conversa nova: nos dois sentidos ----
  const m1 = await call('POST', `/channels/${dm.id}/messages`, bia.token, { content: 'por que me bloqueou?' });
  check(m1.status === 403 && !/bloque/i.test(m1.error), `bloqueada não pode mandar DM (e a mensagem não revela o bloqueio): ${m1.status} ${m1.error}`);
  const m2 = await call('POST', `/channels/${dm.id}/messages`, ana.token, { content: 'oi' });
  check(m2.status === 403 && /bloqueou/i.test(m2.error), `quem bloqueou também não manda (recebe o motivo): ${m2.status} ${m2.error}`);
  check((await call('POST', '/friends', bia.token, { username: 'ana' })).status === 403, 'bloqueada não pede amizade');
  check((await call('POST', '/friends', ana.token, { username: 'bia' })).status === 403, 'quem bloqueou não pede amizade sem desbloquear');
  check((await call('POST', '/dms', bia.token, { userId: ana.user.id })).status === 403, 'bloqueada não abre conversa');
  // o histórico continua legível para quem bloqueou
  const hist = await call('GET', `/channels/${dm.id}/messages`, ana.token);
  check(hist.status === 200 && hist.messages.some((m) => m.content === 'oi ana'), 'histórico da DM continua disponível');
  // servidor em comum continua funcionando (o app só recolhe as mensagens para quem bloqueou)
  check((await call('POST', `/channels/${geral}/messages`, bia.token, { content: 'oi galera' })).status === 200, 'servidor em comum continua funcionando');
  step('DM, pedido de amizade e conversa nova barrados nos dois sentidos; histórico preservado');

  // ---- ligação privada ----
  const sb = await connect(bia.token);
  const sa = await connect(ana.token);
  const r1 = await join(sb, dm.id);
  check(r1.ok === false, 'bloqueada não deveria ligar para a ana');
  const r2 = await join(sa, dm.id);
  check(r2.ok === false, 'a ana não deveria ligar para a bloqueada');
  step('ligação privada barrada nos dois sentidos');

  // ---- presença escondida ----
  check(!(sb.ready.online ?? []).includes(ana.user.id), 'a bia não deveria ver a ana online (ready)');
  check(!(sa.ready.online ?? []).includes(bia.user.id), 'a ana não deveria ver a bia online (ready)');
  const caioSock = await connect(caio.token);
  check((caioSock.ready.online ?? []).includes(ana.user.id), 'a caio continua vendo a ana (sem bloqueio)');
  sa.events.length = 0; sb.events.length = 0;
  sa.close();
  await sleep(300);
  const sa2 = await connect(ana.token);
  await sleep(500);
  check(!sb.events.some((e) => e.ev === 'presence:update' && e.payload.userId === ana.user.id), 'a bia não deveria receber presença da ana');
  check(caioSock.events.some((e) => e.ev === 'presence:update' && e.payload.userId === ana.user.id), 'a caio deveria receber a presença da ana');
  step('presença escondida entre quem tem bloqueio (e visível para os demais)');

  // ---- call de servidor: aviso ao entrar e aviso quando o bloqueado chega ----
  const rb = await join(sb, voz);
  check(rb.ok === true && !rb.blocked && !rb.needsConfirm, 'a bia entra na call sem nenhum aviso sobre bloqueio');
  const ra = await join(sa2, voz);
  check(ra.ok === false && ra.needsConfirm === true && ra.blocked?.length === 1 && ra.blocked[0].username === 'bia', `a ana deveria ser avisada (@bia) antes de entrar: ${JSON.stringify(ra)}`);
  const ra2 = await join(sa2, voz, { confirmBlocked: true });
  check(ra2.ok === true, 'a ana entra depois de confirmar');
  sa2.leave?.();
  sa2.emit('voice:leave');
  sb.emit('voice:leave');
  await sleep(300);
  // o bloqueado chega numa call onde quem bloqueou já está: só quem bloqueou é avisado
  await call('POST', '/blocks', caio.token, { userId: bia.user.id });
  const sd = await connect(dani.token);
  await join(caioSock, voz);
  await join(sd, voz);
  sd.events.length = 0; caioSock.events.length = 0; sa2.events.length = 0;
  const rb2 = await join(sb, voz);
  await sleep(400);
  check(rb2.ok === true && !rb2.blocked, 'a bia entra normalmente e não recebe aviso');
  const warn = caioSock.events.find((e) => e.ev === 'voice:blocked-joined');
  check(warn && warn.payload.user.username === 'bia', 'a caio deveria ser avisada: a pessoa bloqueada (@bia) entrou na call');
  check(!sd.events.some((e) => e.ev === 'voice:blocked-joined'), 'a dani (sem bloqueio) não recebe aviso');
  check(!sb.events.some((e) => e.ev === 'voice:blocked-joined'), 'a bia não recebe aviso nenhum');
  step('call: aviso com @ antes de entrar (entrar mesmo assim) e aviso quando o bloqueado chega; só quem bloqueou é avisado');
  for (const s of [sb, sd, caioSock]) s.emit('voice:leave');

  // ---- desbloquear ----
  const ub = await call('DELETE', `/blocks/${bia.user.id}`, ana.token);
  check(ub.status === 200 && ub.blocks.length === 0, 'desbloquear esvazia a lista');
  check((await call('POST', `/channels/${dm.id}/messages`, bia.token, { content: 'voltei' })).status === 200, 'depois de desbloquear a DM volta');
  check((await call('POST', '/friends', ana.token, { username: 'bia' })).status === 200, 'depois de desbloquear dá para pedir amizade de novo');
  // bloquear duas vezes é inofensivo
  await call('POST', '/blocks', ana.token, { userId: bia.user.id });
  check((await call('POST', '/blocks', ana.token, { userId: bia.user.id })).blocks.length === 1, 'bloquear duas vezes não duplica');
  step('desbloquear restaura DM e amizade; bloquear duas vezes é inofensivo');
} finally {
  for (const s of sockets) s.close();
  server.kill();
}
if (fails.length) {
  console.error('\n✗ Falhas:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('\nTudo certo: bloqueio de pessoas.');
