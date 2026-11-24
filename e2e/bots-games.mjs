// Comandos para jogar em grupo do Resenha Bot: /times /marcar /call /procurando /8bola
// Uso: npm run build && node e2e/bots-games.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const PORT = 3276;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-games-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const sockets = [];
const connect = (token) =>
  new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    sockets.push(s);
    s.on('ready', () => resolve(s));
  });
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: PASS, displayName: d ?? u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const dudu = await reg('dudu', 'Dudu');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  for (const u of [bia, caio, dudu]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const voz = guild.channels.find((c) => c.type === 'voice');
  await api('/admin/beta', { bots: ['ana'] }, equipe.token, 'PUT');
  await api(`/guilds/${guild.id}/bots`, {}, ana.token);
  const cmd = async (token, command, args = '') => (await sleep(1100), api(`/channels/${geral.id}/interactions`, { command, args }, token));
  const teamsOf = (r) => r.message.embeds[0].fields.map((f) => f.value.split(', '));

  // ---------- /call vazio ----------
  let r = await cmd(dudu.token, 'call');
  assert(/Ninguém em call/.test(r.message.embeds[0].title), 'ninguém em call');
  assert((await cmd(dudu.token, 'times')).status === 400, '/times sem nomes e sem estar numa call');
  r = await cmd(dudu.token, 'procurando', 'Valorant 2 vagas');
  assert(!r.message.content && /Valorant 2 vagas/.test(r.message.embeds[0].description) && /Entre num canal de voz/.test(r.message.embeds[0].description), '/procurando fora da call');

  // ---------- /times ----------
  r = await cmd(dudu.token, 'times', '2 Ana, Bia, Caio, Duda, Edu');
  let t = teamsOf(r);
  assert(t.length === 2 && t.flat().sort().join() === 'Ana,Bia,Caio,Duda,Edu' && Math.abs(t[0].length - t[1].length) <= 1, `times com nomes: ${JSON.stringify(t)}`);
  r = await cmd(dudu.token, 'times', '3 a b c d e f');
  assert(teamsOf(r).length === 3 && teamsOf(r).every((x) => x.length === 2), 'nomes separados por espaço');
  assert((await cmd(dudu.token, 'times', '1 a, b')).status === 400, 'mínimo 2 times');
  assert((await cmd(dudu.token, 'times', '3 a, b')).status === 400, 'mais times que pessoas');
  assert((await cmd(dudu.token, 'times', '2 ' + Array.from({ length: 51 }, (_, i) => `p${i}`).join(', '))).status === 400, 'máximo 50 nomes');
  // diferentes sorteios: em 12 tentativas não pode sair sempre igual
  const seen = new Set();
  for (let i = 0; i < 12; i++) seen.add(JSON.stringify(teamsOf(await cmd(dudu.token, 'times', '2 a, b, c, d, e, f'))));
  assert(seen.size > 1, 'o sorteio é aleatório');
  step('/times: com nomes (vírgula ou espaço), de 2 a 10 times, aleatório, com limites');

  // ---------- com gente na call ----------
  const [A, B, C] = [await connect(ana.token), await connect(bia.token), await connect(caio.token)];
  for (const s of [A, B, C]) assert((await ack(s, 'voice:join', { channelId: voz.id })).ok, 'entrou na call');
  r = await cmd(ana.token, 'times');
  t = teamsOf(r);
  assert(t.flat().sort().join() === 'Ana,Bia,Caio', `sem nomes usa quem está na call: ${JSON.stringify(t)}`);
  r = await cmd(dudu.token, 'call');
  assert(r.message.embeds[0].fields[0].name.includes('Sala de voz (3)') && ['Ana', 'Bia', 'Caio'].every((n) => r.message.embeds[0].fields[0].value.includes(n)), '/call lista quem está em cada call');
  r = await cmd(bia.token, 'procurando', 'Valorant 2 vagas');
  assert(r.message.content.includes(`<#${voz.id}>`), '/procurando leva para a call de quem chamou');
  step('/times usa quem está na sua call; /call lista a galera; /procurando aponta a sua call');

  // ---------- /marcar e /8bola ----------
  r = await cmd(ana.token, 'marcar', 'hoje 20h | Valorant ranqueada');
  assert(r.message.poll.question === '🎮 Valorant ranqueada · hoje 20h' && r.message.poll.options.map((o) => o.text).join() === '✅ Vou,🤔 Talvez,❌ Não vou', `marcar: ${JSON.stringify(r.message.poll)}`);
  assert((await api(`/messages/${r.message.id}/poll`, { options: [0] }, bia.token)).status === 200, 'dá para votar');
  assert((await cmd(ana.token, 'marcar', 'só o horário')).status === 400, 'marcar precisa de quando e o quê');
  r = await cmd(ana.token, '8bola', 'vamos ganhar hoje?');
  assert(/vamos ganhar hoje\?/.test(r.message.embeds[0].description) && r.message.embeds[0].description.split('\n').length === 2, '8bola');
  assert((await cmd(ana.token, '8bola', '')).status === 400, '8bola sem pergunta');
  step('/marcar cria a enquete Vou/Talvez/Não vou; /8bola responde');

  console.log('\nTudo certo com os comandos de grupo.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.close());
  server.kill();
}
