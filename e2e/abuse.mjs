// Testes de ABUSO (checklist seções 2, 3, 4, 8): cada teste tenta fazer o que um atacante faria.
// Se a proteção for removida, o teste falha. Uso: node e2e/abuse.mjs
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const PORT = 3298;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-abuse-'), PLATFORM_ADMINS: 'equipe', ...(process.env.ABUSE_ENV ? JSON.parse(process.env.ABUSE_ENV) : {}) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
function totp(secret) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) (bytes.push((value >>> (bits - 8)) & 255), (bits -= 8));
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
let n = 1;
const fakeIp = () => `10.30.${(n >> 8) % 250}.${n++ % 250}`;
const call = async (method, p, token, body, { ip = fakeIp(), headers = {} } = {}) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, headers: res.headers, ...(await res.json().catch(() => ({}))) };
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const bia = await reg('bia');
  const { guild } = await call('POST', '/guilds', ana.token, { name: 'Galera' });

  // ---- INV-01: adivinhar códigos de convite precisa ser travado ----
  const brute = '10.99.0.1';
  let blocked = false;
  for (let i = 0; i < 120 && !blocked; i++) {
    const r = await call('GET', `/invites/${Math.random().toString(36).slice(2, 10)}`, null, undefined, { ip: brute });
    if (r.status === 429) blocked = true;
  }
  check(blocked, 'INV-01: 120 tentativas de código de convite do mesmo IP não foram travadas (GET /invites/:code)');
  let blockedJoin = false;
  for (let i = 0; i < 60 && !blockedJoin; i++) {
    const r = await call('POST', `/invites/${Math.random().toString(36).slice(2, 10)}/join`, bia.token, undefined, { ip: '10.99.0.2' });
    if (r.status === 429) blockedJoin = true;
  }
  check(blockedJoin, 'INV-01: 60 tentativas de entrar com código inventado não foram travadas (POST /invites/:code/join)');
  check((await call('GET', `/invites/${guild.inviteCode}`, null, undefined, { ip: '10.99.0.3' })).status === 200, 'convite verdadeiro continua funcionando para outro IP');
  step('INV-01: tentar adivinhar códigos de convite (conferir e entrar) é travado');

  // ---- ADM / conta da equipe não pode ser apagada (liberaria o nome para um invasor) ----
  const del = await call('POST', '/me/delete', equipe.token, { password: PASS, confirm: 'EXCLUIR' });
  check(del.status >= 400, 'ADM: conta da equipe conseguiu se excluir (o nome ficaria livre para outra pessoa virar admin)');
  check((await call('GET', '/admin/reports/count', equipe.token)).status === 200, 'ADM: conta da equipe deixou de funcionar');
  step('ADM: a conta da equipe não pode ser excluída (o nome não fica livre para um invasor virar admin)');


  // ---- PERM-08: tetos por servidor e por pessoa ----
  const { guild: big } = await call('POST', '/guilds', bia.token, { name: 'Grande' });
  let chStatus = 0;
  for (let i = 0; i < 170 && chStatus < 400; i++) chStatus = (await call('POST', `/guilds/${big.id}/channels`, bia.token, { name: `c${i}`, type: 'text' })).status;
  check(chStatus === 400, `PERM-08: criar canais sem teto (último status ${chStatus})`);
  let roleStatus = 0;
  for (let i = 0; i < 120 && roleStatus < 400; i++) roleStatus = (await call('POST', `/guilds/${big.id}/roles`, bia.token, { name: `r${i}` })).status;
  check(roleStatus === 400, `PERM-08: criar cargos sem teto (último status ${roleStatus})`);
  let catStatus = 0;
  for (let i = 0; i < 60 && catStatus < 400; i++) catStatus = (await call('POST', `/guilds/${big.id}/categories`, bia.token, { name: `k${i}` })).status;
  check(catStatus === 400, `PERM-08: criar categorias sem teto (último status ${catStatus})`);
  const spammer = await reg('spammer');
  let gStatus = 0;
  for (let i = 0; i < 40 && gStatus < 400; i++) gStatus = (await call('POST', '/guilds', spammer.token, { name: `S${i}` })).status;
  check(gStatus === 429 || gStatus === 400, `PERM-08: criar servidores sem limite (último status ${gStatus})`);
  step('PERM-08: canais, cargos, categorias e servidores por pessoa têm teto (um servidor hostil não cria recursos sem fim)');

  // ---- ADM-01: com ADMIN_REQUIRE_2FA=1 a equipe precisa da verificação em duas etapas ----
  const s2 = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT + 1), DATA_DIR: tempDir('resenha-abuse2-'), PLATFORM_ADMINS: 'equipe', ADMIN_REQUIRE_2FA: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  s2.stderr.on('data', () => {});
  try {
    const B2 = `http://localhost:${PORT + 1}`;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${B2}/api/health`)).ok) break;
      } catch {}
      await sleep(500);
    }
    const c2 = async (m, p, token, body) => {
      const r = await fetch(`${B2}/api${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : m === 'POST' ? '{}' : undefined });
      return { status: r.status, ...(await r.json().catch(() => ({}))) };
    };
    const adm = await c2('POST', '/auth/register', null, { username: 'equipe', password: PASS, displayName: 'equipe', acceptTerms: true });
    const comum = await c2('POST', '/auth/register', null, { username: 'comum', password: PASS, displayName: 'comum', acceptTerms: true });
    const semDois = await c2('GET', '/admin/reports/count', adm.token);
    check(semDois.status === 403 && /duas etapas/.test(semDois.error ?? ''), `ADM-01: equipe SEM 2FA entrou no painel (status ${semDois.status})`);
    check((await c2('GET', '/admin/reports/count', comum.token)).status === 404, 'ADM-01: pessoa comum deixou de receber 404 no painel');
    const setup = await c2('POST', '/me/2fa/setup', adm.token, { password: PASS });
    await c2('POST', '/me/2fa/enable', adm.token, { code: totp(setup.secret) });
    check((await c2('GET', '/admin/reports/count', adm.token)).status === 200, 'ADM-01: equipe COM 2FA não consegue entrar no painel');
    step('ADM-01: com ADMIN_REQUIRE_2FA=1 o painel da equipe só abre com a verificação em duas etapas ligada');
  } finally {
    s2.kill();
  }

  if (fails.length) {
    console.error(`\n✗ ${fails.length} falha(s):\n- ${fails.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('\nTudo certo com os testes de abuso.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  server.kill();
}
