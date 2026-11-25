// Bots de terceiros (recurso "botdev"): criar o próprio bot, token, comandos, instalar, chamada assinada e API do bot.
//  - só contas liberadas criam bot (o servidor confere); o token aparece uma vez e vira hash no banco
//  - a API do bot exige "Authorization: Bot <token>"; token errado/antigo/bot desligado não passa
//  - comandos do bot aparecem no "/", e usar um comando chama o endereço do bot com ASSINATURA (HMAC) e posta a resposta
//  - o bot só escreve onde está instalado (moderação do servidor vale), com limite de mensagens
// Uso: node e2e/bots-apps.mjs   (não precisa de build)
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { tempDir } from './_tmp.mjs';

const PORT = 3291;
const BOT_PORT = 3292;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-botapps-'), PLATFORM_ADMINS: 'equipe', BOT_ALLOW_LOCAL_URLS: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
// chamadas "como bot": Authorization: Bot <token>
const botApi = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.0.${ip++ % 250}`, ...(token ? { authorization: `Bot ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

// o "bot" de verdade: um servidor HTTP que confere a assinatura e responde
let secret = '';
let mode = 'ok';
const received = [];
const botServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ts = req.headers['x-resenha-timestamp'];
    const good = `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
    received.push({ ok: req.headers['x-resenha-signature'] === good, ts, body: JSON.parse(body || '{}'), url: req.url });
    if (req.headers['x-resenha-signature'] !== good) {
      res.writeHead(401);
      return res.end('{}');
    }
    const j = JSON.parse(body);
    if (mode === 'ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ content: `pong ${j.args}`, embed: { title: 'Eco', description: `de ${j.user.username}` } }));
    }
    if (mode === 'deferred') {
      res.writeHead(202);
      return res.end();
    }
    if (mode === 'junk') {
      res.writeHead(200);
      return res.end('isto não é json');
    }
    if (mode === 'wrong') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ oi: 1 }));
    }
    if (mode === 'error') {
      res.writeHead(500);
      return res.end('x');
    }
    if (mode === 'slow') return setTimeout(() => res.end('{}'), 4000);
  });
});
await new Promise((r) => botServer.listen(BOT_PORT, r));

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
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const { guild: g2 } = await api('/guilds', { name: 'Outro' }, caio.token);
  const outro = g2.channels.find((c) => c.type === 'text');

  // ---------- quem cria ----------
  assert((await api('/bot-apps', { name: 'Eco' }, ana.token)).status === 404, 'sem o recurso botdev: 404');
  assert((await api('/bot-apps', null, ana.token)).status === 404, 'listar sem o recurso: 404');
  await api('/admin/beta', { botdev: ['ana'], bots: ['ana'] }, equipe.token, 'PUT');
  assert((await api('/bot-apps', { name: 'Eco' }, caio.token)).status === 404, 'outra conta continua sem acesso');
  assert((await api('/bot-apps', { name: 'x' }, ana.token)).status === 400, 'nome muito curto');
  const made = await api('/bot-apps', { name: 'Eco Bot', description: 'Repete o que você diz' }, ana.token);
  assert(made.status === 200 && /^bot_[a-f0-9]{16}\.[A-Za-z0-9_-]{40,}$/.test(made.token) && made.signingSecret.length === 64, `criou: ${JSON.stringify(made).slice(0, 150)}`);
  const botId = made.bot.id;
  const token = made.token;
  secret = made.signingSecret;
  const list = await api('/bot-apps', null, ana.token);
  assert(list.bots.length === 1 && !JSON.stringify(list).includes(token.split('.')[1]) && !JSON.stringify(list).includes(secret), 'a lista nunca devolve token nem segredo');
  assert(made.bot.username.endsWith('_bot') || /_bot/.test(made.bot.username), `nome de usuário do bot: ${made.bot.username}`);
  assert((await api('/auth/login', { username: made.bot.username, password: 'bot$sem-login' })).status !== 200, 'ninguém loga como o bot');
  for (const n of ['B2', 'B3']) assert((await api('/bot-apps', { name: n }, ana.token)).status === 200, `bot ${n}`);
  assert((await api('/bot-apps', { name: 'Quarto' }, ana.token)).status === 400, 'limite de 3 bots por pessoa');
  for (const x of (await api('/bot-apps', null, ana.token)).bots.filter((b) => b.name !== 'Eco Bot')) await api(`/bot-apps/${x.id}`, null, ana.token, 'DELETE');
  assert((await api('/bot-apps', null, ana.token)).bots.length === 1, 'apagar bot libera a vaga');
  step('criar bot: só contas liberadas, token e segredo aparecem uma vez, limite de 3, ninguém loga como bot');

  // ---------- API do bot: autenticação e comandos ----------
  assert((await botApi('/bot/me')).status === 401, 'sem token: 401');
  assert((await botApi('/bot/me', null, 'lixo')).status === 401, 'token inválido: 401');
  assert((await botApi('/bot/me', null, `${botId}.${'a'.repeat(43)}`)).status === 401, 'token com o ID certo e segredo errado: 401');
  assert((await api('/bot/me', null, token)).status === 401, 'o token do bot não vale como sessão de pessoa (e vice-versa)');
  const me = await botApi('/bot/me', null, token);
  assert(me.status === 200 && me.id === botId && me.name === 'Eco Bot' && me.guilds.length === 0, `bot/me: ${JSON.stringify(me)}`);
  let r = await botApi('/bot/commands', { commands: [{ name: 'dado', description: 'x' }] }, token, 'PUT');
  assert(r.status === 400 && /Resenha Bot/.test(r.error), `nome reservado recusado: ${r.error}`);
  assert((await botApi('/bot/commands', { commands: [{ name: 'a', description: 'x' }, { name: 'a', description: 'y' }] }, token, 'PUT')).status === 400, 'nomes repetidos recusados');
  assert((await botApi('/bot/commands', { commands: [{ name: 'Maiuscula', description: 'x' }] }, token, 'PUT')).status === 400, 'nome inválido recusado');
  r = await botApi('/bot/commands', { commands: [{ name: 'ping', description: 'Responde pong', usage: '/ping texto' }, { name: 'eco', description: 'Repete' }] }, token, 'PUT');
  assert(r.status === 200 && r.commands.length === 2, 'registrou 2 comandos');
  step('API do bot: token obrigatório (errado/ausente recusado), nomes reservados e repetidos recusados, comandos registrados');

  // ---------- endereço do bot ----------
  await api(`/bot-apps/${botId}`, { interactionsUrl: `http://localhost:${BOT_PORT}/hook` }, ana.token, 'PATCH');
  assert((await api(`/bot-apps/${botId}`, { interactionsUrl: 'não é um endereço' }, ana.token, 'PATCH')).status === 400, 'endereço inválido recusado');
  assert((await api(`/bot-apps/${botId}`, { name: 'Novo Nome' }, caio.token, 'PATCH')).status === 404, 'só o dono mexe no bot');

  // ---------- instalar ----------
  const pub = await api(`/bot-apps/${botId}/public`, null, ana.token);
  assert(pub.status === 200 && pub.name === 'Eco Bot' && pub.commands.length === 2 && !('token' in pub) && !JSON.stringify(pub).includes(secret), 'dados públicos do bot (sem segredos)');
  assert((await api(`/guilds/${guild.id}/bot-apps`, { botId }, bia.token)).status === 404, 'sem o recurso bots: 404');
  await api('/admin/beta', { botdev: ['ana'], bots: ['ana', 'bia'] }, equipe.token, 'PUT');
  assert((await api(`/guilds/${guild.id}/bot-apps`, { botId }, bia.token)).status === 403, 'sem Gerenciar servidor: 403');
  assert((await api(`/guilds/${guild.id}/bot-apps`, { botId: 'bot_0000000000000000' }, ana.token)).status === 404, 'bot que não existe: 404');
  assert((await api(`/guilds/${guild.id}/bot-apps`, { botId: 'qualquer' }, ana.token)).status === 400, 'ID mal formado: 400');
  const inst = await api(`/guilds/${guild.id}/bot-apps`, { botId }, ana.token);
  assert(inst.status === 200 && inst.installed, `instalou: ${JSON.stringify(inst)}`);
  assert((await api(`/guilds/${guild.id}/bot-apps`, { botId }, ana.token)).status === 409, 'instalar de novo: 409');
  const gd = (await api(`/guilds/${guild.id}`, null, bia.token)).guild;
  assert(gd.members.some((m) => m.bot && m.displayName === 'Eco Bot'), 'o bot aparece na lista de membros');
  assert((await api(`/guilds/${guild.id}/audit`, null, ana.token)).entries.some((e) => e.action === 'bot_add' && e.targetId === botId), 'auditoria registra');
  assert((await botApi('/bot/me', null, token)).guilds.length === 1, 'bot/me lista o servidor');
  const cmds = await api(`/guilds/${guild.id}/commands`, null, bia.token);
  const ping = cmds.commands.find((c) => c.name === 'ping');
  assert(ping && ping.group === 'Eco Bot' && ping.botId === botId, `o "/" mostra o comando do bot: ${JSON.stringify(cmds.commands).slice(0, 200)}`);
  step('instalar pelo ID: confere permissão, avisa, entra como membro bot, comandos aparecem no "/"');

  // ---------- usar um comando: chamada assinada ----------
  const use = (command, args = '', ch = geral.id, token2 = bia.token) => sleep(1100).then(() => api(`/channels/${ch}/interactions`, { command, args }, token2));
  r = await use('ping', 'olá');
  assert(r.status === 200 && r.message.author.bot && r.message.author.id === botId && r.message.content === 'pong olá', `resposta do bot: ${JSON.stringify(r).slice(0, 250)}`);
  assert(r.message.embeds?.[0]?.title === 'Eco' && r.message.interaction.command === 'ping' && r.message.interaction.userId === bia.user.id, 'embed e "usou /ping" na mensagem');
  const got = received.at(-1);
  assert(got.ok, 'a assinatura (HMAC) confere');
  assert(got.body.type === 'command' && got.body.command === 'ping' && got.body.args === 'olá' && got.body.user.username === 'bia' && got.body.channel.id === geral.id && got.body.guild.id === guild.id, `corpo da chamada: ${JSON.stringify(got.body)}`);
  assert(Math.abs(Number(got.ts) - Date.now() / 1000) < 30, 'carimbo de tempo atual');
  assert(!JSON.stringify(got.body).includes('token') && !JSON.stringify(got.body).includes(bia.token), 'a chamada não leva sessões nem tokens');
  step('comando: o Resenha chama o endereço do bot com assinatura válida e posta a resposta (com embed) como o bot');

  mode = 'deferred';
  r = await use('eco', 'x');
  assert(r.status === 200 && r.message === null, 'bot que responde depois (202): sem mensagem na hora');
  for (const m of ['junk', 'wrong', 'error']) {
    mode = m;
    r = await use('ping', 'x');
    assert(r.status === 502 && /Eco Bot/.test(r.error), `bot com resposta ruim (${m}): ${r.status} ${r.error}`);
  }
  mode = 'slow';
  r = await use('ping', 'x');
  assert(r.status === 502 && /demorou/.test(r.error), `bot lento: ${r.status} ${r.error}`);
  mode = 'ok';
  r = await use('naoexiste');
  assert(r.status === 404, 'comando que ninguém tem: 404');
  step('respostas ruins do bot (JSON inválido, formato errado, erro 500, demora) viram erro claro, sem derrubar nada');

  // ---------- o bot posta sozinho (API) ----------
  const send = (ch, body, t = token) => botApi(`/bot/channels/${ch}/messages`, body, t);
  r = await send(geral.id, { content: 'Oi, eu sou o bot!' });
  assert(r.status === 200 && r.message.author.id === botId && r.message.author.bot && r.message.content === 'Oi, eu sou o bot!', `bot postou: ${JSON.stringify(r).slice(0, 200)}`);
  r = await send(geral.id, { content: '@everyone olá', embed: { title: 'T', description: 'D', fields: [{ name: 'a', value: 'b' }] } });
  assert(r.status === 200 && r.message.mentionEveryone !== true, 'bot não consegue @everyone');
  assert((await send(geral.id, {})).status === 400, 'mensagem vazia recusada');
  assert((await send(geral.id, { content: 'x'.repeat(2001) })).status === 400, 'mensagem grande demais recusada');
  assert((await send(outro, { content: 'invasão' })).status === 403, 'canal de um servidor onde o bot NÃO está: 403');
  const dm = await api('/dms', { userId: caio.user.id }, bia.token);
  assert((await send(dm.dm?.id ?? dm.channelId ?? dm.id ?? 'x', { content: 'espiando' })).status === 403, 'conversa privada: 403');
  await api(`/guilds/${guild.id}/automod`, { words: ['proibida'], blockLinks: false, blockInvites: false, antiSpam: false, exemptRoleIds: [] }, ana.token, 'PUT');
  r = await send(geral.id, { content: 'palavra proibida aqui' });
  assert(r.status === 400 && /moderação automática/.test(r.error), `a moderação do servidor vale para o bot: ${r.status} ${r.error}`);
  await api(`/guilds/${guild.id}/automod`, { words: [], blockLinks: false, blockInvites: false, antiSpam: false, exemptRoleIds: [] }, ana.token, 'PUT');
  await sleep(5200);
  let last = 0;
  for (let i = 0; i < 7; i++) last = (await send(geral.id, { content: `rajada ${i}` })).status;
  assert(last === 429, `limite por canal (5 a cada 5 s): ${last}`);
  step('API do bot: posta só onde está instalado, sem @everyone, sem conversas privadas, com moderação e limite de velocidade');

  // ---------- token, desligar, apagar ----------
  const rot = await api(`/bot-apps/${botId}/token`, {}, ana.token);
  assert(rot.status === 200 && rot.token !== token && rot.signingSecret !== secret, 'gerou token e segredo novos');
  assert((await botApi('/bot/me', null, token)).status === 401, 'o token antigo parou na hora');
  assert((await botApi('/bot/me', null, rot.token)).status === 200, 'o token novo funciona');
  assert((await api(`/bot-apps/${botId}/token`, {}, caio.token)).status === 404, 'só o dono gera token');
  const oldSecret = secret;
  secret = rot.signingSecret;
  await sleep(5200); // o limite de mensagens por canal da rajada anterior
  r = await use('ping', 'novo');
  assert(r.status === 200 && received.at(-1).ok, 'a chamada passa a ser assinada com o segredo novo: ' + JSON.stringify(r).slice(0, 200) + ' ' + received.at(-1)?.ok);
  assert(oldSecret !== secret, 'segredo trocado');
  assert((await api(`/admin/bot-apps/${botId}/disable`, { disabled: true }, ana.token)).status === 404, 'só a equipe desliga bot dos outros');
  await api(`/admin/bot-apps/${botId}/disable`, { disabled: true }, equipe.token);
  assert((await botApi('/bot/me', null, rot.token)).status === 403, 'bot desligado pela equipe: API recusa');
  assert((await use('ping', 'x')).status === 404, 'bot desligado: o comando some');
  assert(!(await api(`/guilds/${guild.id}/commands`, null, bia.token)).commands.some((c) => c.name === 'ping'), 'bot desligado: some do "/"');
  await api(`/admin/bot-apps/${botId}/disable`, { disabled: false }, equipe.token);
  assert((await botApi('/bot/me', null, rot.token)).status === 200, 'religado pela equipe');
  assert((await api(`/guilds/${guild.id}/bot-apps/${botId}`, null, bia.token, 'DELETE')).status === 403, 'tirar o bot exige Gerenciar servidor');
  await api(`/guilds/${guild.id}/bot-apps/${botId}`, null, ana.token, 'DELETE');
  assert(!(await api(`/guilds/${guild.id}`, null, bia.token)).guild.members.some((m) => m.id === botId), 'tirado do servidor');
  assert((await send(geral.id, { content: 'sem permissão' }, rot.token)).status === 403, 'bot removido do servidor não escreve mais');
  await api(`/guilds/${guild.id}/bot-apps`, { botId }, ana.token);
  assert((await api(`/bot-apps/${botId}`, null, ana.token, 'DELETE')).status === 200, 'apagou o bot');
  assert((await botApi('/bot/me', null, rot.token)).status === 401, 'bot apagado: o token deixou de existir');
  assert(!(await api(`/guilds/${guild.id}`, null, bia.token)).guild.members.some((m) => m.bot), 'bot apagado sai de todos os servidores');
  assert((await api(`/channels/${geral.id}/messages`, null, bia.token)).messages.some((m) => m.content === 'pong olá'), 'as mensagens antigas continuam');
  step('trocar token, desligar pela equipe, tirar do servidor e apagar o bot funcionam');

  console.log('\nTudo certo com os bots de terceiros.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  botServer.close();
  server.kill();
}
