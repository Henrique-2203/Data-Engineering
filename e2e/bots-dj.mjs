// DJ do Resenha Bot (em teste): /tocar /proxima /pular /fila /agora /parar /remover sobre o "Assistir juntos".
//  - precisa estar numa call do servidor; links do YouTube e busca pelo nome (YouTube API de mentira aqui)
//  - pular é por votação (maioria da call); quem colocou a música pula na hora
//  - só quem pediu a música ou quem administra para tudo
// Uso: npm run build && node e2e/bots-dj.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const PORT = 3270;
const FAKE = 3271;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

// YouTube de mentira: oEmbed (título) e busca
const fake = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/oembed') {
    const v = new URL(u.searchParams.get('url')).searchParams.get('v');
    return res.end(JSON.stringify({ title: `Música ${v}`, author_name: 'Canal' }));
  }
  if (u.pathname === '/search') {
    if (u.searchParams.get('key') !== 'chave-teste') return (res.statusCode = 403), res.end('{}');
    const q = u.searchParams.get('q');
    if (q.includes('inexistente')) return res.end(JSON.stringify({ items: [] }));
    return res.end(JSON.stringify({ items: [{ id: { videoId: 'LoFiBeats01' }, snippet: { title: `Resultado para ${q}` } }] }));
  }
  if (u.pathname === '/videos') {
    if (u.searchParams.get('key') !== 'chave-teste') return (res.statusCode = 403), res.end('{}');
    // faixa curta de propósito: o fim automático (quando ninguém ouve) tem que andar a fila sozinho
    const id = u.searchParams.get('id');
    return res.end(JSON.stringify({ items: [{ contentDetails: { duration: id === 'ShortTrack1' ? 'PT3S' : 'PT3M20S' } }] }));
  }
  res.statusCode = 404;
  res.end('{}');
}).listen(FAKE);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: tempDir('resenha-dj-'),
    PLATFORM_ADMINS: 'equipe',
    EMBED_YOUTUBE_OEMBED: `http://localhost:${FAKE}/oembed`,
    YOUTUBE_API_BASE: `http://localhost:${FAKE}`,
    YOUTUBE_API_KEY: 'chave-teste',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.5.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const sockets = [];
const connect = (token) =>
  new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    sockets.push(s);
    const states = [];
    const djEvents = [];
    s.on('together:state', (d) => states.push(d));
    s.on('voice:dj', (d) => djEvents.push(d));
    s.on('ready', (p) => resolve({ s, states, djEvents, ready: p }));
  });
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => api('/auth/register', { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const bia = await reg('bia');
  const caio = await reg('caio');
  const dudu = await reg('dudu');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  for (const u of [bia, caio, dudu]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const voz = guild.channels.find((c) => c.type === 'voice');
  await api('/admin/beta', { bots: ['ana'] }, equipe.token, 'PUT');
  assert((await api(`/guilds/${guild.id}/bots`, {}, ana.token)).status === 200, 'instalou o bot');
  const cmd = async (token, command, args = '') => (await sleep(1100), api(`/channels/${geral.id}/interactions`, { command, args }, token));
  const A = await connect(ana.token);
  const B = await connect(bia.token);
  const C = await connect(caio.token);

  // ---------- precisa estar na call ----------
  let r = await cmd(bia.token, 'tocar', 'https://youtu.be/AAAAAAAAAAA');
  assert(r.status === 400 && /canal de voz/.test(r.error), `fora da call: ${r.status} ${r.error}`);
  for (const x of [A, B, C]) assert((await ack(x.s, 'voice:join', { channelId: voz.id })).ok, 'entrou na call');
  step('o DJ só funciona para quem está num canal de voz do servidor');

  // ---------- tocar, fila, próxima ----------
  r = await cmd(bia.token, 'tocar', 'https://youtu.be/AAAAAAAAAAA');
  assert(r.status === 200 && /Tocando agora/.test(r.message.embeds[0].title), `tocar: ${r.status} ${r.error}`);
  assert(/Música AAAAAAAAAAA/.test(r.message.embeds[0].description), 'o título vem do YouTube');
  await sleep(300);
  assert(B.states.at(-1).state.videoId === 'AAAAAAAAAAA' && B.states.at(-1).state.by === bia.user.id, 'a call recebe o vídeo (Assistir juntos)');
  r = await cmd(caio.token, 'tocar', 'lofi para estudar');
  assert(r.status === 200 && /Na fila/.test(r.message.embeds[0].title) && /Resultado para lofi para estudar/.test(r.message.embeds[0].description), `busca pelo nome: ${JSON.stringify(r).slice(0, 200)}`);
  r = await cmd(ana.token, 'proxima', 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
  assert(/próxima/.test(r.message.embeds[0].title), 'proxima');
  await sleep(200);
  const q = B.states.at(-1).state.queue;
  assert(q.length === 2 && q[0].videoId === 'BBBBBBBBBBB' && q[1].videoId === 'LoFiBeats01', 'a "próxima" passa na frente da fila');
  r = await cmd(caio.token, 'fila');
  assert(/Próximas \(2\)/.test(r.message.embeds[0].fields[0].name) && /1\. .*BBBBBBBBBBB/.test(r.message.embeds[0].fields[0].value), 'fila mostra as próximas');
  assert((await cmd(caio.token, 'tocar', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).status === 400, 'Spotify não toca no DJ');
  assert((await cmd(caio.token, 'tocar', 'coisa inexistente')).status === 400, 'busca sem resultado');
  assert((await cmd(caio.token, 'tocar', '')).status === 400, 'sem nome nem link');
  step('/tocar (link e busca pelo nome), /proxima passa na frente, /fila mostra tudo');

  // ---------- votação para pular ----------
  r = await cmd(caio.token, 'pular');
  assert(r.status === 200 && /Voto para pular/.test(r.message.embeds[0].title) && /1\/2/.test(r.message.embeds[0].description), `1º voto: ${JSON.stringify(r).slice(0, 200)}`);
  await sleep(200);
  assert(B.states.at(-1).state.skip?.votes === 1 && B.states.at(-1).state.skip?.needed === 2, 'a call vê os votos');
  assert(B.states.at(-1).state.videoId === 'AAAAAAAAAAA', 'ainda não pulou');
  r = await cmd(caio.token, 'pular');
  assert(/1\/2/.test(r.message.embeds[0].description), 'o mesmo voto não conta duas vezes');
  r = await cmd(ana.token, 'pular');
  assert(/Pulou/.test(r.message.embeds[0].title) && /BBBBBBBBBBB/.test(r.message.embeds[0].description), `2º voto pula: ${JSON.stringify(r).slice(0, 200)}`);
  await sleep(200);
  assert(B.states.at(-1).state.videoId === 'BBBBBBBBBBB' && !B.states.at(-1).state.skip, 'toca a próxima, sem votos antigos');
  // quem colocou a música pula na hora (a Ana pediu a BBBB)
  r = await cmd(ana.token, 'pular');
  assert(/Pulou/.test(r.message.embeds[0].title), 'quem colocou pula na hora');
  await sleep(200);
  assert(B.states.at(-1).state.videoId === 'LoFiBeats01', 'a próxima da fila começou');
  // o botão do site usa a mesma votação
  const socketVote = await ack(C.s, 'together:action', { action: 'voteskip' });
  assert(socketVote.ok && socketVote.skipped === undefined || socketVote.ok, 'o botão Pular do site usa a votação');
  step('pular é por votação (maioria), voto repetido não conta, quem colocou pula na hora');

  // ---------- agora, parar, remover ----------
  await cmd(bia.token, 'tocar', 'https://youtu.be/CCCCCCCCCCC');
  await cmd(bia.token, 'tocar', 'https://youtu.be/DDDDDDDDDDD');
  r = await cmd(bia.token, 'agora');
  assert(/Música/.test(r.message.embeds[0].description), '/agora mostra a música');
  assert((await cmd(bia.token, 'remover', '9')).status === 400, 'remover número inválido');
  assert((await cmd(caio.token, 'remover', '1')).status === 400, 'só tira da fila quem pediu (ou administra)');
  r = await cmd(bia.token, 'remover', '1');
  assert(r.status === 200, `remover a própria: ${r.error}`);
  r = await cmd(caio.token, 'parar');
  assert(r.status === 400 && /Só quem pediu/.test(r.error), 'quem não pediu nem administra não para tudo');
  r = await cmd(ana.token, 'parar');
  assert(r.status === 200, 'a dona do servidor para tudo');
  await sleep(200);
  assert(B.states.at(-1).state === null, 'a call fica sem música');
  r = await cmd(bia.token, 'fila');
  assert(/Fila vazia/.test(r.message.embeds[0].title), 'fila vazia');
  assert((await cmd(bia.token, 'pular')).status === 400, 'pular sem nada tocando');
  step('/agora, /remover (só a sua), /parar (quem pediu ou administra), fila vazia');

  // ---------- o Resenha Bot "entra" e "sai" da call para o servidor inteiro ----------
  const D = await connect(dudu.token); // dudu NÃO está na call
  await cmd(bia.token, 'tocar', 'https://youtu.be/EEEEEEEEEEE');
  await sleep(300);
  assert(D.djEvents.some((e) => e.channelId === voz.id && e.active === true), 'quem está fora da call é avisado: o DJ entrou no canal de voz');
  const D2 = await connect(dudu.token);
  assert(D2.ready.djChannels?.includes(voz.id), 'quem conecta depois já recebe o canal com DJ no ready');
  await cmd(ana.token, 'parar');
  await sleep(300);
  assert(D.djEvents.at(-1).active === false, 'o DJ saiu do canal quando parou');
  step('o Resenha Bot aparece/some na lista do canal para todo o servidor (voice:dj e ready)');

  // ---------- fim automático da faixa: ninguém ouve, o servidor avança pela duração (YouTube API) ----------
  await cmd(bia.token, 'tocar', 'https://youtu.be/ShortTrack1');
  await cmd(bia.token, 'tocar', 'https://youtu.be/FFFFFFFFFFF');
  await sleep(300);
  assert(B.states.at(-1).state.videoId === 'ShortTrack1', 'a faixa curta começou');
  await sleep(7500); // 3 s da faixa + 2,5 s de folga + margem; nenhum cliente avisou "acabou"
  assert(B.states.at(-1).state?.videoId === 'FFFFFFFFFFF', `sem ninguém ouvindo, o servidor avançou a fila (tocando: ${B.states.at(-1).state?.videoId})`);
  await cmd(ana.token, 'parar');
  step('o servidor avança a fila sozinho pela duração (nada trava quando ninguém está ouvindo)');

  // ---------- canal de voz PRIVADO: o DJ dele não vaza para quem não tem acesso ----------
  const roleId = (await api(`/guilds/${guild.id}/roles`, { name: 'Diretoria' }, ana.token)).roleId;
  const privVoz = (await api(`/guilds/${guild.id}/channels`, { name: 'sala-secreta', type: 'voice', allowedRoleIds: [roleId] }, ana.token)).channel;
  assert(privVoz?.id, `criou o canal de voz privado `);
  const D3 = await connect(dudu.token); // dudu não tem o cargo
  D3.djEvents.length = 0;
  await ack(A.s, 'voice:join', { channelId: privVoz.id });
  await cmd(ana.token, 'tocar', 'https://youtu.be/GGGGGGGGGGG');
  await sleep(400);
  assert(!D3.djEvents.some((e) => e.channelId === privVoz.id), 'o DJ do canal privado não vaza para quem não tem acesso (evento)');
  const D4 = await connect(dudu.token);
  assert(!(D4.ready.djChannels ?? []).includes(privVoz.id), 'o DJ do canal privado não vaza no ready');
  await cmd(ana.token, 'parar');
  step('o DJ de um canal de voz privado não aparece para quem não tem acesso');

  console.log('\nTudo certo com o DJ.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.close());
  fake.close();
  server.kill();
}
