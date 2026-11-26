// Testes de ABUSO do tempo real / WebSocket (checklist WS-01..08, TST-03, TST-16, PERM-07).
// Uso: node e2e/ws-abuse.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const PORT = 3299;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-wsabuse-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', (d) => {
  if (!/\[ice\]|BACKUP_KEY/.test(d)) serverErr += d;
});
let n = 1;
const call = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.40.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const sockets = [];
function connect(token, opts = {}) {
  const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false, ...opts });
  sockets.push(s);
  const got = [];
  s.onAny((ev, data) => got.push({ ev, data }));
  return new Promise((resolve) => {
    s.on('ready', (ready) => resolve({ s, got, ready }));
    s.on('connect_error', (e) => resolve({ s, got, error: e.message }));
  });
}
const events = (c, ev) => c.got.filter((g) => g.ev === ev);

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
  await call('POST', `/invites/${guild.inviteCode}/join`, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text').id;

  // ---------- WS-08: presença e atividade só para quem se relaciona ----------
  const sCaio = await connect(caio.token);
  const sBia = await connect(bia.token);
  const sDani = await connect(dani.token);
  const sAna = await connect(ana.token);
  await sleep(400);
  check(!events(sCaio, 'presence:update').some((e) => [ana.user.id, bia.user.id].includes(e.data.userId)), 'WS-08: pessoa sem relação recebeu "online" de ana/bia');
  check(events(sBia, 'presence:update').some((e) => e.data.userId === ana.user.id && e.data.online), 'WS-08: colega de servidor NÃO recebeu o "online" da ana');
  check(!events(sDani, 'presence:update').some((e) => e.data.userId === ana.user.id), 'WS-08: pessoa sem relação (dani) recebeu o "online" da ana');
  check(!sAna.ready.online.includes(caio.user.id) && !sAna.ready.online.includes(dani.user.id), 'WS-08: a lista "online" inicial mostra pessoas sem relação');
  const sCaio2 = await connect(caio.token);
  check(!sCaio2.ready.online.includes(ana.user.id) && !sCaio2.ready.online.includes(bia.user.id), 'WS-08: lista "online" de quem não tem relação mostra desconhecidos');
  check(sBia.ready.online.includes(ana.user.id) || events(sBia, 'presence:update').length > 0, 'WS-08: colega de servidor não vê quem está online');
  sAna.s.emit('activity:set', { name: 'Valorant' });
  await sleep(300);
  check(events(sBia, 'activity:update').some((e) => e.data.userId === ana.user.id), 'WS-08: colega de servidor NÃO recebeu o "Jogando agora"');
  check(!events(sCaio, 'activity:update').length && !events(sDani, 'activity:update').length, 'WS-08: "Jogando agora" vazou para quem não tem relação');
  await call('PATCH', '/me', ana.token, { displayName: 'Ana Nova' });
  await sleep(300);
  check(events(sBia, 'user:update').some((e) => e.data.id === ana.user.id), 'WS-08: colega não recebeu a mudança de perfil');
  check(!events(sCaio, 'user:update').some((e) => e.data.id === ana.user.id), 'WS-08: mudança de perfil vazou para quem não tem relação');
  // amizade: passa a ver a presença na hora
  await call('POST', '/friends', dani.token, { username: 'ana' });
  const before = events(sDani, 'presence:update').length;
  await call('POST', `/friends/${dani.user.id}/accept`, ana.token);
  await sleep(300);
  check(events(sDani, 'presence:update').length > before && events(sDani, 'presence:update').some((e) => e.data.userId === ana.user.id && e.data.online), 'WS-08: depois de aceitar a amizade, dani não vê a presença da ana');
  step('WS-08: presença, "Jogando agora" e mudanças de perfil só vão para colegas de servidor e amigos (amizade aceita já mostra na hora)');

  // ---------- TST-03: tentar escutar/forjar eventos ----------
  sCaio.s.emit('typing', { guildId: guild.id, channelId: geral });
  sCaio.s.emit('join', `guild:${guild.id}`);
  sCaio.s.emit('subscribe', { room: `guild:${guild.id}` });
  await call('POST', `/channels/${geral}/messages`, ana.token, { content: 'só para o servidor' });
  await sleep(300);
  check(!events(sCaio, 'message:new').length, 'TST-03: quem não está no servidor recebeu mensagem do canal');
  check(events(sBia, 'message:new').length > 0, 'TST-03: membro não recebeu a mensagem do canal');
  check(!events(sBia, 'typing').some((e) => e.data.userId === caio.user.id), 'TST-03: "digitando" forjado por quem não é do servidor chegou ao membro');
  // sinalização de call para quem não está na call: ignorada
  sCaio.s.emit('rtc:signal', { to: sBia.s.id, data: { type: 'offer', sdp: 'x' } });
  await sleep(200);
  check(!events(sBia, 'rtc:signal').length, 'TST-03: sinal de call de quem não está na call chegou a outra pessoa');
  step('TST-03: quem não é do servidor não escuta mensagens, não forja "digitando" nem sinais de call');

  // ---------- WS-02: origem ----------
  const evil = await connect(ana.token, { extraHeaders: { Origin: 'https://site-malicioso.example' } });
  check(!!evil.error || !evil.ready, 'WS-02: conexão com Origin de outro site foi aceita');
  step('WS-02: conexão vinda de outro site é recusada');

  // ---------- WS-06: pacote gigante, flood, limite de conexões ----------
  const big = await connect(bia.token);
  let bigDisc = false;
  big.s.on('disconnect', () => (bigDisc = true));
  big.s.emit('callchat:send', { text: 'x'.repeat(400_000) });
  await sleep(600);
  check(bigDisc || !big.s.connected, 'WS-06: pacote de 400 KB não derrubou a conexão (limite de tamanho)');
  const flood = await connect(bia.token);
  let floodDisc = false;
  flood.s.on('disconnect', () => (floodDisc = true));
  for (let i = 0; i < 3500; i++) flood.s.emit('typing', { guildId: guild.id, channelId: geral });
  await sleep(1500);
  check(floodDisc, 'WS-06: flood de 3500 eventos em 1 s não derrubou a conexão');
  check((await fetch(`${BASE}/api/health`)).ok, 'WS-06: o servidor caiu/travou depois do flood');
  const many = [];
  for (let i = 0; i < 18; i++) many.push(await connect(dani.token));
  check(many.filter((m) => m.error).length >= 1, 'WS-06: 18 conexões da mesma conta foram aceitas (teto 15)');
  for (const m of many) m.s.close();
  step('WS-06: pacote gigante, flood de eventos e excesso de conexões por conta são cortados e o servidor continua de pé');

  // ---------- WS-04: lixo em todos os eventos ----------
  const fuzz = await connect(bia.token);
  const names = ['typing', 'voice:join', 'voice:leave', 'voice:mod', 'activity:set', 'voice:update', 'together:get', 'together:action', 'callchat:get', 'callchat:send', 'callchat:delete', 'soundboard:play', 'rtc:signal', 'screen:audience', 'client:active', 'call:decline', 'phonecam:create', 'phonecam:claim', 'phonecam:signal', 'phonecam:stop'];
  const junk = [null, undefined, 0, -1, 1e308, 'x'.repeat(5000), [], [[]], {}, { __proto__: { admin: true } }, JSON.parse('{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}'), { channelId: { $ne: 1 } }, { to: [1], data: 'x' }, { name: 'a'.repeat(2000) }, true, () => {}, { a: { b: { c: { d: { e: 1 } } } } }];
  for (const name of names) for (const j of junk) {
    try {
      fuzz.s.timeout(300).emit(name, j, () => {});
      fuzz.s.emit(name, j);
    } catch {}
  }
  await sleep(1500);
  check((await fetch(`${BASE}/api/health`)).ok, 'WS-04: o servidor caiu com eventos de lixo');
  check(!/TypeError|Unhandled|Cannot read|ReferenceError|RangeError/.test(serverErr), `WS-04: erro não tratado no servidor: ${serverErr.slice(0, 300)}`);
  check(({}).admin === undefined && Object.prototype.admin === undefined, 'poluição de protótipo no cliente do teste');
  step('WS-04: 20 eventos × 17 tipos de lixo (nulo, enormes, __proto__, objetos aninhados) não derrubam nem sujam o servidor');

  // ---------- TST-16 / PERM-07: perder acesso corta o tempo real na hora ----------
  const sBia2 = await connect(bia.token);
  const rDir = (await call('POST', `/guilds/${guild.id}/roles`, ana.token, { name: 'Diretoria' })).roleId;
  const priv = (await call('POST', `/guilds/${guild.id}/channels`, ana.token, { name: 'diretoria', type: 'text', allowedRoleIds: [rDir] })).channel.id;
  await call('PUT', `/guilds/${guild.id}/members/${bia.user.id}/roles`, ana.token, { roleIds: [rDir] });
  await sleep(300);
  await call('POST', `/channels/${priv}/messages`, ana.token, { content: 'com acesso' });
  await sleep(300);
  check(events(sBia2, 'message:new').some((e) => e.data.message.content === 'com acesso'), 'PERM-07: com o cargo, bia não recebeu a mensagem do canal privado');
  await call('PUT', `/guilds/${guild.id}/members/${bia.user.id}/roles`, ana.token, { roleIds: [] });
  await sleep(300);
  await call('POST', `/channels/${priv}/messages`, ana.token, { content: 'depois de perder o cargo' });
  await sleep(300);
  check(!events(sBia2, 'message:new').some((e) => e.data.message.content === 'depois de perder o cargo'), 'TST-16: perdeu o cargo mas continuou recebendo mensagens do canal privado em tempo real');
  await call('POST', `/guilds/${guild.id}/bans`, ana.token, { userId: bia.user.id });
  await sleep(300);
  const countBefore = events(sBia2, 'message:new').length;
  await call('POST', `/channels/${geral}/messages`, ana.token, { content: 'depois do ban' });
  await sleep(400);
  check(events(sBia2, 'message:new').length === countBefore, 'TST-16: banida, a bia continuou recebendo mensagens do servidor em tempo real');
  const rejoin = await connect(bia.token);
  await call('POST', `/channels/${geral}/messages`, ana.token, { content: 'ban 2' });
  await sleep(300);
  check(!events(rejoin, 'message:new').length, 'TST-16: banida, reconectou e recebeu mensagens do servidor');
  step('PERM-07/TST-16: perder cargo, ser banido e reconectar cortam o tempo real do canal/servidor na hora');

  // ---------- WS-07: sessão encerrada derruba a conexão ----------
  const sDani2 = await connect(dani.token);
  let ended = false;
  sDani2.s.on('disconnect', () => (ended = true));
  await call('POST', '/auth/logout', dani.token);
  await sleep(700);
  check(ended, 'WS-07: sair da conta não derrubou a conexão aberta');
  const afterLogout = await connect(dani.token);
  check(!!afterLogout.error, 'WS-07: token de sessão encerrada ainda conecta');
  step('WS-07: sair da conta derruba a conexão aberta e o token antigo não conecta mais');

  if (fails.length) {
    console.error(`\n✗ ${fails.length} falha(s):\n- ${fails.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('\nTudo certo com os testes de abuso do tempo real.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (fails.length) process.exitCode = 1;
  for (const s of sockets) s.close();
  server.kill();
}
