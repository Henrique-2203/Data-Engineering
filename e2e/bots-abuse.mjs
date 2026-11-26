// Bots como PORTA DE ENTRADA (checklist seção 11 + SSRF/API): o servidor roda SEM a opção de testes
// BOT_ALLOW_LOCAL_URLS, então valem as regras de produção. Uso: node e2e/bots-abuse.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tempDir } from './_tmp.mjs';

const PORT = 3303;
const HONEY = 3304;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
let honeyHits = 0;
const honey = http.createServer((_req, res) => {
  honeyHits++;
  res.end('{}');
});
await new Promise((r) => honey.listen(HONEY, '127.0.0.1', r));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-botabuse-'), PLATFORM_ADMINS: 'equipe', BOT_ALLOW_LOCAL_URLS: '' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let n = 1;
const call = async (method, p, token, body, auth = 'Bearer') => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.70.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `${auth} ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe'), ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio');
  const { guild } = await call('POST', '/guilds', ana.token, { name: 'Galera' });
  await call('POST', `/invites/${guild.inviteCode}/join`, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text').id;
  await call('PUT', '/admin/beta', equipe.token, { botdev: ['ana'], bots: ['ana'] }).catch(() => {});
  await fetch(`${BASE}/api/admin/beta`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${equipe.token}` }, body: JSON.stringify({ botdev: ['ana'], bots: ['ana'] }) });
  const made = await call('POST', '/bot-apps', ana.token, { name: 'Eco Bot', password: PASS });
  check(made.status === 200, `setup: criar bot (${made.status} ${made.error})`);
  const botId = made.bot.id;
  await call('PUT', '/bot/commands', made.token, { commands: [{ name: 'ping', description: 'x' }] }, 'Bot').catch(() => {});
  await fetch(`${BASE}/api/bot/commands`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bot ${made.token}` }, body: JSON.stringify({ commands: [{ name: 'ping', description: 'x' }] }) });
  await call('POST', `/guilds/${guild.id}/bot-apps`, ana.token, { botId });

  // ---- SSRF no endereço do bot (SSRF-01/02, API-07) ----
  const ruins = ['http://example.com/hook', 'https://127.0.0.1/hook', 'https://[::1]/hook', 'https://10.0.0.5/x', 'https://169.254.169.254/latest/meta-data/', 'https://localhost/x', 'https://exemplo.com:8443/x', 'https://user:senha@exemplo.com/x', 'file:///etc/passwd', 'ftp://exemplo.com/x', 'https://servidor.internal/x', 'https://semponto/x', `https://127.0.0.1:${HONEY}/x`, 'https://0177.0.0.1/x', 'https://2130706433/x', 'https://[::ffff:127.0.0.1]/x', 'https://0x7f.0.0.1/x'];
  for (const u of ruins) {
    const r = await call('PATCH', `/bot-apps/${botId}`, ana.token, { interactionsUrl: u });
    check(r.status === 400, `SSRF-01: endereço de bot "${u}" foi aceito (status ${r.status})`);
  }
  // nome que PARECE público mas resolve para a rede interna (DNS): barrado na hora da chamada, sem abrir conexão
  const setUrl = await call('PATCH', `/bot-apps/${botId}`, ana.token, { interactionsUrl: 'https://localhost.localdomain/hook' });
  check(setUrl.status === 200, `setup: endereço com nome que resolve para 127.0.0.1 (status ${setUrl.status} ${setUrl.error})`);
  await sleep(1100);
  const use = await call('POST', `/channels/${geral}/interactions`, bia.token, { command: 'ping', args: '' });
  // (neste ambiente o DNS pode nem resolver o nome; o importante é: erro 424 e NENHUMA conexão. A regra "IP privado é bloqueado depois de resolver" é provada em e2e/safe-fetch.mjs)
  check(use.status === 424 && /não é público|encontrar o servidor/.test(use.error ?? ''), `SSRF-02: nome que resolve para rede interna não foi barrado: ${use.status} ${use.error}`);
  check(honeyHits === 0, 'SSRF-02: o servidor chegou a conectar numa porta interna');
  step('SSRF-01/02: endereços de bot com IP, rede interna, porta diferente, usuário:senha, esquemas estranhos (incl. 0177.0.0.1, 2130706433, ::ffff:127.0.0.1) e nomes que resolvem para 127.0.0.1 são barrados sem abrir conexão');

  // ---- chutar tokens ----
  let throttled = false;
  for (let i = 0; i < 90 && !throttled; i++) {
    const r = await fetch(`${BASE}/api/bot/me`, { headers: { authorization: `Bot ${botId}.${Math.random().toString(36).repeat(4).slice(0, 43)}`, 'x-forwarded-for': '10.71.0.1' } });
    if (r.status === 429) throttled = true;
  }
  check(throttled, 'BOT-01: 90 tokens chutados do mesmo IP não foram travados');
  step('BOT-01: chutar tokens é travado por IP');

  // ---- o token do bot não abre nada de pessoa, e a sessão de pessoa não abre nada de bot ----
  const sweep = ['/me/security', '/me/sessions', '/me/export', '/bootstrap', '/friends', '/dms', '/admin/stats', `/guilds/${guild.id}`, `/guilds/${guild.id}/audit`, '/me/files'];
  for (const p of sweep) {
    const r = await fetch(`${BASE}/api${p}`, { headers: { authorization: `Bot ${made.token}`, 'x-forwarded-for': '10.71.0.9' } });
    check(r.status === 401, `BOT: o token de bot abriu rota de pessoa ${p} (${r.status})`);
  }
  check((await call('GET', '/bot/me', ana.token)).status === 401, 'BOT: sessão de pessoa abriu a API de bot (Authorization: Bearer)');
  check((await call('GET', '/bot/me', ana.token, undefined, 'Bot')).status === 401, 'BOT: sessão de pessoa usada como token de bot');
  // o bot só enxerga onde foi instalado: o canal do servidor onde está instalado funciona, o de outro não
  const { guild: g2 } = await call('POST', '/guilds', caio.token, { name: 'Outro' });
  const ch2 = g2.channels.find((c) => c.type === 'text').id;
  const bot = (p, body, m = 'POST') => fetch(`${BASE}/api${p}`, { method: m, headers: { 'content-type': 'application/json', authorization: `Bot ${made.token}`, 'x-forwarded-for': '10.71.0.20' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  check((await bot(`/bot/channels/${ch2}/messages`, { content: 'invasão' })).status === 403, 'BOT-02: o bot escreveu num servidor onde não foi instalado');
  check((await bot(`/bot/guilds/${g2.id}/channels`, undefined, 'GET')).status === 403, 'BOT-02: o bot listou canais de servidor onde não foi instalado');
  // um dono de servidor não consegue instalar o bot de outra pessoa sem Gerenciar servidor, nem por ID de outro servidor
  check((await call('POST', `/guilds/${g2.id}/bot-apps`, bia.token, { botId })).status !== 200, 'BOT: pessoa sem permissão instalou bot em servidor alheio');
  step('BOT-01/02: tokens de bot não abrem nada de pessoa (e vice-versa); o bot só enxerga e escreve onde está instalado');

  // ---- limites de volume ----
  let sent429 = false;
  await sleep(1000);
  for (let i = 0; i < 12 && !sent429; i++) sent429 = (await bot(`/bot/channels/${geral}/messages`, { content: `rajada ${i}` })).status === 429;
  check(sent429, 'BOT-03: rajada de 12 mensagens do bot no mesmo canal não foi travada');
  step('BOT-03: rajada de mensagens do bot é travada');

  if (fails.length) {
    console.error(`\n✗ ${fails.length} falha(s):\n- ${fails.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('\nTudo certo com a segurança dos bots.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (fails.length) process.exitCode = 1;
  honey.close();
  server.kill();
}
