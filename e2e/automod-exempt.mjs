// Moderação automática: "bloquear links" com CARGOS ISENTOS. Quem tem o cargo isento manda link; quem não tem, não.
// Uso: node e2e/automod-exempt.mjs
import { spawn } from 'node:child_process';
import { tempDir } from './_tmp.mjs';

const PORT = 3313;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-amexempt-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let n = 1;
const api = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.20.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const LINK = 'olha isso https://www.google.com/search?q=resenha&x=1 e também www.exemplo.com.br/pagina';
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => api('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const ana = await reg('ana'), gus = await reg('gustavo'), bia = await reg('bia');
  const { guild } = await api('POST', '/guilds', ana.token, { name: 'Galera' });
  for (const u of [gus, bia]) await api('POST', `/invites/${guild.inviteCode}/join`, u.token);
  const geral = guild.channels.find((c) => c.type === 'text').id;
  const roleId = (await api('POST', `/guilds/${guild.id}/roles`, ana.token, { name: 'Pode link' })).roleId;
  await api('PUT', `/guilds/${guild.id}/members/${gus.user.id}/roles`, ana.token, { roleIds: [roleId] });
  const put = (exempt) => api('PUT', `/guilds/${guild.id}/automod`, ana.token, { words: [], blockLinks: true, blockInvites: false, antiSpam: false, exemptRoleIds: exempt });
  const send = async (u) => (await sleep(1100), api('POST', `/channels/${geral}/messages`, u.token, { content: LINK }));

  check((await put([])).status === 200, 'ligar bloqueio de links');
  check((await send(bia)).status === 400, 'sem cargo isento: link bloqueado');
  check((await send(gus)).status === 400, 'o cargo ainda NÃO é isento: link bloqueado');
  const r = await put([roleId]);
  check(r.status === 200 && r.automod.exemptRoleIds.includes(roleId), `cargo isento salvo (${JSON.stringify(r).slice(0, 120)})`);
  const g = await send(gus);
  check(g.status === 200, `com o cargo isento o link passa (status ${g.status}: ${g.error})`);
  check((await send(bia)).status === 400, 'quem não tem o cargo continua bloqueado');
  // tirar o cargo do membro volta a bloquear
  await api('PUT', `/guilds/${guild.id}/members/${gus.user.id}/roles`, ana.token, { roleIds: [] });
  check((await send(gus)).status === 400, 'sem o cargo de novo: bloqueado');
  step('links bloqueados, liberados só para o cargo isento (e voltam a ser bloqueados ao tirar o cargo)');
} finally {
  server.kill();
}
if (fails.length) {
  console.error('\n✗ Falhas:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('\nTudo certo: links e cargos isentos.');
