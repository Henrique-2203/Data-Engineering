// Carga no servidor: N pessoas conectadas ao mesmo tempo, em grupos de amigos (servidores de 10),
// conversando e com parte delas em call. Mede processador e memória do servidor e o tempo para uma
// mensagem chegar no amigo. Usa um Postgres de verdade (DATABASE_URL), como o Neon em produção.
// Uso: DATABASE_URL=postgres://... node e2e/capacity/server-load.mjs [100,300,600]
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const PORT = 3192;
const BASE = `http://localhost:${PORT}`;
const STEPS = (process.argv[2] ?? '100,300,600').split(',').map(Number);
const GROUP = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DB = process.env.DATABASE_URL;
if (!DB) throw new Error('defina DATABASE_URL (Postgres vazio para o teste)');

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, PWNED_CHECK: 'off' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY|DATABASE/.test(d) || process.stderr.write(`[server] ${d}`));

const TICK = 100; // clock ticks por segundo no Linux
function cpuTicks(pid) {
  const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return Number(f[11]) + Number(f[12]); // utime + stime
}
const rssMb = (pid) => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
const psql = (sql) => execFileSync('psql', [DB, '-tAc', sql], { encoding: 'utf8' }).trim();

let ip = 0;
async function api(p, body, token) {
  ip++;
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      // cada cadastro "vem" de um endereço diferente (o limite por IP do cadastro continua valendo de verdade)
      'x-forwarded-for': `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const pct = (arr, q) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0);

const users = [];
const groups = [];
async function ensureUsers(n) {
  while (users.length < n) {
    const g = groups.length;
    const members = [];
    for (let i = 0; i < GROUP; i++) {
      const name = `u${g}_${i}`;
      const r = await api('/auth/register', { username: name, password: 'Cor-Forte-Xis-42', displayName: name, acceptTerms: true });
      if (!r.token) throw new Error(`cadastro falhou: ${JSON.stringify(r)}`);
      members.push({ id: r.user.id, token: r.token });
    }
    const { guild } = await api('/guilds', { name: `Grupo ${g}` }, members[0].token);
    for (const m of members.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, m.token);
    const text = guild.channels.find((c) => c.type === 'text').id;
    const voice = guild.channels.find((c) => c.type === 'voice').id;
    groups.push({ text, voice, members });
    users.push(...members.map((m) => ({ ...m, group: g })));
  }
}

const sockets = new Map();
async function connect(u) {
  if (sockets.has(u.id)) return;
  const s = io(BASE, { transports: ['websocket'], auth: { token: u.token }, reconnection: false });
  await new Promise((res, rej) => {
    s.once('ready', res);
    s.once('connect_error', rej);
    setTimeout(() => rej(new Error('timeout')), 15000);
  });
  sockets.set(u.id, s);
}

try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(250);
  }
  const pid = server.pid;
  const results = [];
  for (const n of STEPS) {
    process.stdout.write(`\n— ${n} pessoas: cadastrando e conectando… `);
    await ensureUsers(n);
    const active = users.slice(0, n);
    for (let i = 0; i < active.length; i += 25) await Promise.all(active.slice(i, i + 25).map(connect));
    // 20% em call (um grupo a cada 5 entra na call do seu servidor)
    const inVoice = groups.slice(0, Math.ceil(n / GROUP)).filter((_, i) => i % 5 === 0);
    for (const g of inVoice) {
      for (const m of g.members) {
        const s = sockets.get(m.id);
        await new Promise((r) => s.emit('voice:join', { channelId: g.voice, muted: false, deafened: false }, r));
      }
    }
    console.log('ok');
    await sleep(3000);

    // ---- fase normal: cada pessoa manda 1 mensagem por minuto e "digita" antes ----
    const measure = async (label, perUserEverySec, secs) => {
      const lat = [];
      const t0 = cpuTicks(pid);
      const w0 = Date.now();
      const groupsNow = groups.slice(0, Math.ceil(n / GROUP));
      let sent = 0;
      let errors = 0;
      const pending = new Map();
      // quem recebe: o segundo membro de cada grupo mede a chegada
      const listeners = groupsNow.map((g) => {
        const s = sockets.get(g.members[1].id);
        const fn = ({ message }) => {
          const t = pending.get(message.content);
          if (t) {
            lat.push(Date.now() - t);
            pending.delete(message.content);
          }
        };
        s.on('message:new', fn);
        return () => s.off('message:new', fn);
      });
      const deadline = Date.now() + secs * 1000;
      const intervalMs = (perUserEverySec * 1000) / n; // espalha os envios no tempo
      let k = 0;
      while (Date.now() < deadline) {
        const u = active[k % active.length];
        k++;
        const g = groups[u.group];
        const content = `msg ${label} ${k} ${Date.now()}`;
        sockets.get(u.id).emit('typing', { channelId: g.text });
        pending.set(content, Date.now());
        sent++;
        void api(`/channels/${g.text}/messages`, { content }, u.token).then((r) => r.status !== 200 && errors++);
        await sleep(intervalMs);
      }
      await sleep(2000);
      listeners.forEach((off) => off());
      const cpu = ((cpuTicks(pid) - t0) / TICK / ((Date.now() - w0) / 1000)) * 100;
      return { label, msgsPerSec: Math.round((sent / secs) * 10) / 10, cpuPct: Math.round(cpu), p50: pct(lat, 0.5), p95: pct(lat, 0.95), lost: pending.size, errors };
    };
    const normal = await measure('normal', 60, 30);
    const busy = await measure('agitado', 10, 30);
    const r = { people: n, inVoice: inVoice.length * GROUP, rssMb: Math.round(rssMb(pid)), normal, busy };
    results.push(r);
    console.log(
      `  memória ${r.rssMb} MB · em call ${r.inVoice}\n` +
        `  normal  (1 msg/min por pessoa = ${normal.msgsPerSec}/s): processador ${normal.cpuPct}% de 1 núcleo · mensagem chega em ${normal.p50} ms (p95 ${normal.p95} ms)\n` +
        `  agitado (1 msg/10 s por pessoa = ${busy.msgsPerSec}/s): processador ${busy.cpuPct}% · ${busy.p50} ms (p95 ${busy.p95} ms) · erros ${busy.errors}`,
    );
  }

  // ---- espaço no banco por mensagem ----
  const count = Number(psql('select count(*) from messages'));
  const dbBytes = Number(psql('select pg_database_size(current_database())'));
  const msgBytes = Number(psql("select pg_total_relation_size('messages')"));
  const perMsg = Math.round(msgBytes / Math.max(1, count));
  console.log(`\n  banco: ${(dbBytes / 1e6).toFixed(1)} MB no total · ${count} mensagens · ~${perMsg} bytes por mensagem (com índices)`);
  console.log(`\nRESULTADO ${JSON.stringify({ results, perMessageBytes: perMsg, users: users.length })}`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  for (const s of sockets.values()) s.close();
  server.kill();
}
