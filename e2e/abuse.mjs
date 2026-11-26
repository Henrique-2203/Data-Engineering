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



  // ---- AUTH-04/05: sem enumeração de contas e sem "credential stuffing" por IP ----
  const IPX = '10.77.0.1';
  const wrongKnown = await call('POST', '/auth/login', null, { username: 'ana', password: 'errada-123456' }, { ip: IPX });
  const wrongUnknown = await call('POST', '/auth/login', null, { username: 'ninguem-existe', password: 'errada-123456' }, { ip: IPX });
  check(wrongKnown.status === wrongUnknown.status && wrongKnown.error === wrongUnknown.error, `AUTH-04: login revela se a conta existe (${wrongKnown.status} "${wrongKnown.error}" vs ${wrongUnknown.status} "${wrongUnknown.error}")`);
  let stuffed = false;
  for (let i = 0; i < 60 && !stuffed; i++) {
    const r = await call('POST', '/auth/login', null, { username: `vitima${i}`, password: 'tentativa-123456' }, { ip: IPX });
    if (r.status === 429) stuffed = true;
  }
  check(stuffed, 'AUTH-05: 60 logins errados de contas diferentes vindos do mesmo IP não foram travados');
  check((await call('POST', '/auth/login', null, { username: 'ana', password: PASS }, { ip: '10.77.0.2' })).status === 200, 'AUTH-05: o travamento de um IP atrapalhou outro IP');
  step('AUTH-04/05: login não revela quem tem conta; tentar muitas contas do mesmo IP é travado');

  // ---- AUTH-05: cadastro em massa do mesmo IP ----
  let flooded = false;
  for (let i = 0; i < 40 && !flooded; i++) {
    const r = await call('POST', '/auth/register', null, { username: `massa${i}`, password: PASS, displayName: 'm', acceptTerms: true }, { ip: '10.77.0.3' });
    if (r.status === 429) flooded = true;
  }
  check(flooded, 'AUTH-05: 40 cadastros do mesmo IP não foram travados');
  step('AUTH-05: criar contas em massa do mesmo IP é travado');


  // ---- IMP-01/02: nomes que enganam (letras parecidas, inversão de leitura, se passar pela equipe) ----
  const RLO = String.fromCharCode(0x202e), ZW = String.fromCharCode(0x200b), CYR_E = String.fromCharCode(0x0435);
  for (const nome of ['Resenha Oficial', 'Resenh@ 0ficial', `R${CYR_E}senha`, 'SUPORTE', 'Suport3 Resenha', 'Admin', 'resenha_bot', 'Equipe']) {
    const r = await call('POST', '/auth/register', null, { username: `u${n}${Math.random().toString(36).slice(2, 5)}`, password: PASS, displayName: nome, acceptTerms: true });
    check(r.status === 400, `IMP-01: nome de exibição "${nome}" foi aceito no cadastro (status ${r.status})`);
  }
  check((await call('POST', '/auth/register', null, { username: 'suporte', password: PASS, displayName: 'x', acceptTerms: true })).status === 400, 'IMP-01: usuário "suporte" foi aceito');
  check((await call('POST', '/auth/register', null, { username: 'resenhaoficial', password: PASS, displayName: 'x', acceptTerms: true })).status === 400, 'IMP-01: usuário "resenhaoficial" foi aceito');
  check((await call('PATCH', '/me', bia.token, { displayName: 'Suporte Resenha' })).status === 400, 'IMP-01: trocar o nome para "Suporte Resenha" foi aceito');
  check((await call('PATCH', '/me', bia.token, { displayName: `Bia ${RLO}exe.txt` })).status === 200, 'setup: nome com inversão');
  const meB = (await call('GET', '/bootstrap', bia.token)).user ?? (await call('GET', '/bootstrap', bia.token)).me;
  check(!JSON.stringify(meB).includes(RLO), 'IMP-01: o caractere de inversão de leitura (U+202E) ficou no nome');
  const m1 = await call('POST', `/channels/${guild.channels.find((c) => c.type === 'text').id}/messages`, ana.token, { content: `fotoferias${RLO}gpj.exe${ZW}` });
  check(m1.status === 200 && !m1.message.content.includes(RLO) && !m1.message.content.includes(ZW), 'IMP-01: mensagem guardou caractere de inversão/largura zero');
  check((await call('POST', '/guilds', bia.token, { name: 'Resenha Oficial' })).status === 400, 'IMP-02: servidor "Resenha Oficial" criado por pessoa comum');
  check((await call('POST', '/guilds', bia.token, { name: 'Resenha dos Crias' })).status === 200, 'IMP: nome legítimo "Resenha dos Crias" foi barrado');
  check((await call('PATCH', '/me', equipe.token, { displayName: 'Equipe Resenha' })).status === 200, 'a equipe de verdade (PLATFORM_ADMINS) não pode usar o próprio nome');
  step('IMP-01/02: nomes que imitam a equipe (inclusive com 0/@/letras russas) são recusados, inversão de leitura e largura zero são removidas, nomes normais passam');


  // ---- DM-03/RL-04: abrir conversas novas em massa (spam/assédio) ----
  const novata = await reg('novata');
  await call('POST', `/invites/${guild.inviteCode}/join`, novata.token);
  const alvos = [];
  for (let i = 0; i < 8; i++) {
    const u = await reg(`alvo${i}`);
    await call('POST', `/invites/${guild.inviteCode}/join`, u.token);
    alvos.push(u);
  }
  let dmBlocked = 0;
  for (const u of alvos) if ((await call('POST', '/dms', novata.token, { userId: u.user.id })).status === 429) dmBlocked++;
  check(dmBlocked >= 3, `DM-03: conta nova abriu 8 conversas novas seguidas sem travar (${dmBlocked} travadas)`);
  step('DM-03/RL-04: conta nova só abre poucas conversas novas por hora (anti-spam de DM em massa)');

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
