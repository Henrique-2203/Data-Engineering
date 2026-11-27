// Chaves de emergência (INF-06) e revogar todas as sessões (LOG-05). Uso: node e2e/killswitch.mjs
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { tempDir } from './_tmp.mjs';

const PORT = 3306;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-kill-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY|\[segurança\]/.test(d) || process.stderr.write(`[server] ${d}`));
let n = 1;
const call = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.80.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const connect = (token) =>
  new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], extraHeaders: { origin: BASE } });
    s.on('connect', () => resolve(s));
  });

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe'), ana = await reg('ana'), bia = await reg('bia');
  const { guild } = await call('POST', '/guilds', ana.token, { name: 'Galera' });
  const geral = guild.channels.find((c) => c.type === 'text').id;
  const voz = guild.channels.find((c) => c.type === 'voice').id;

  // só a equipe mexe nas chaves
  check((await call('GET', '/admin/killswitch', ana.token)).status === 404, 'membro comum não deveria ver as chaves');
  check((await call('PUT', '/admin/killswitch', ana.token, { uploads: true })).status === 404, 'membro comum não deveria mexer nas chaves');
  check((await call('PUT', '/admin/killswitch', null, { uploads: true })).status === 401, 'sem login deveria dar 401');
  step('só a equipe mexe nas chaves');

  // convites
  await call('PUT', '/admin/killswitch', equipe.token, { invites: true });
  const j1 = await call('POST', `/invites/${guild.inviteCode}/join`, bia.token);
  check(j1.status === 503, `convite deveria dar 503 com a chave ligada (deu ${j1.status})`);
  await call('PUT', '/admin/killswitch', equipe.token, { invites: false });
  await sleep(100);
  const j2 = await call('POST', `/invites/${guild.inviteCode}/join`, bia.token);
  check(j2.status === 200, `convite deveria voltar (deu ${j2.status} ${j2.error})`);
  step('chave de convites liga e desliga');

  // DMs novas
  await call('PUT', '/admin/killswitch', equipe.token, { dms: true });
  const d1 = await call('POST', '/dms', ana.token, { userId: bia.user.id });
  check(d1.status === 503, `DM nova deveria dar 503 (deu ${d1.status})`);
  await call('PUT', '/admin/killswitch', equipe.token, { dms: false });
  step('chave de DMs');

  // upload
  await call('PUT', '/admin/killswitch', equipe.token, { uploads: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(`${BASE}/api/attachments?channelId=${geral}`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-filename': 'a.png', authorization: `Bearer ${ana.token}`, 'x-forwarded-for': '10.81.0.1' }, body: png });
  check(up.status === 503, `upload deveria dar 503 (deu ${up.status})`);
  await call('PUT', '/admin/killswitch', equipe.token, { uploads: false });
  step('chave de uploads');

  // chamadas
  await call('PUT', '/admin/killswitch', equipe.token, { calls: true });
  await sleep(100);
  const sa = await connect(ana.token);
  const r = await new Promise((res) => sa.emit('voice:join', { channelId: voz }, res));
  check(r && r.ok === false, 'entrar na call deveria ser recusado com a chave ligada');
  await call('PUT', '/admin/killswitch', equipe.token, { calls: false });
  step('chave de chamadas');
  sa.close();

  // bots (API de bot)
  await call('PUT', '/admin/killswitch', equipe.token, { bots: true });
  const st = await call('GET', '/admin/killswitch', equipe.token);
  check(st.state.bots === true && st.state.uploads === false, 'estado salvo errado');
  await call('PUT', '/admin/killswitch', equipe.token, { bots: false });
  step('estado persistido por chave');

  // revogar tudo
  const sb = await connect(bia.token);
  const closed = new Promise((res) => sb.on('disconnect', () => res(true)));
  check((await call('POST', '/admin/security/revoke-all-sessions', ana.token, { confirm: 'REVOGAR TODAS' })).status === 404, 'membro não revoga');
  check((await call('POST', '/admin/security/revoke-all-sessions', equipe.token, {})).status === 400, 'precisa da confirmação');
  const rv = await call('POST', '/admin/security/revoke-all-sessions', equipe.token, { confirm: 'REVOGAR TODAS' });
  check(rv.status === 200 && rv.revoked >= 2, `revogar deveria derrubar as outras sessões (${rv.status} ${rv.revoked})`);
  check((await call('GET', '/dms', ana.token)).status === 401, 'sessão da ana deveria ter caído');
  check((await call('GET', '/dms', bia.token)).status === 401, 'sessão da bia deveria ter caído');
  check((await call('GET', '/dms', equipe.token)).status === 200, 'a sessão de quem clicou deve continuar');
  check(await Promise.race([closed, sleep(3000).then(() => false)]), 'o socket da bia deveria ter sido fechado');
  step('revogar todas as sessões (menos a de quem clicou, sockets fechados)');
} finally {
  server.kill();
}
if (fails.length) {
  console.error('\n✗ Falhas:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('\nTudo certo: chaves de emergência e revogação em massa.');
