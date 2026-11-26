// O bot de exemplo (exemplos/bot-exemplo) funcionando de ponta a ponta contra o Resenha:
// painel registra os comandos, /ping /eco /hora /piada /clima respondem com assinatura válida,
// chamada forjada é recusada e o painel manda um aviso num canal escolhido pelo NOME.
// Uso: node e2e/bot-exemplo.mjs
import { spawn } from 'node:child_process';
import { tempDir } from './_tmp.mjs';
import { criarBot, COMANDOS } from '../exemplos/bot-exemplo/bot.js';

const PORT = 3295;
const BOT_PORT = 3296;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-botex-'), PLATFORM_ADMINS: 'equipe', BOT_ALLOW_LOCAL_URLS: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.14.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
let botServer;
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
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api('/admin/beta', { botdev: ['ana'], bots: ['ana'] }, equipe.token, 'PUT');
  const made = await api('/bot-apps', { name: 'Bot Exemplo' }, ana.token);

  // sobe o bot de exemplo (o mesmo código que vai para a Vercel) com as chaves que o Resenha deu
  botServer = criarBot({ token: made.token, signingSecret: made.signingSecret, adminKey: 'senha-do-painel', resenhaUrl: BASE }).listen(BOT_PORT);
  await sleep(300);
  await api(`/bot-apps/${made.bot.id}`, { interactionsUrl: `http://localhost:${BOT_PORT}/resenha` }, ana.token, 'PATCH');
  const bot = (path, init) => fetch(`http://localhost:${BOT_PORT}${path}`, init);
  const painel = (path, dados) => bot(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados).toString() }).then((r) => r.text());

  assert((await (await bot('/')).text()).includes('no ar'), 'página inicial do bot');
  assert((await (await bot('/painel')).text()).includes('Registrar comandos'), 'painel abre');
  assert((await painel('/painel/registrar', { chave: 'errada' })).includes('Senha incorreta'), 'painel recusa senha errada');
  assert((await painel('/painel/registrar', { chave: 'senha-do-painel' })).includes(`${COMANDOS.length} comandos registrados`), 'painel registra os comandos no Resenha');
  step('painel do bot: senha confere e os comandos são registrados no Resenha');

  await api(`/guilds/${guild.id}/bot-apps`, { botId: made.bot.id }, ana.token);
  const lista = await api(`/guilds/${guild.id}/commands`, null, bia.token);
  assert(['ping', 'eco', 'hora', 'piada', 'clima'].every((n) => lista.commands.some((c) => c.name === n)), 'os 5 comandos aparecem no "/"');
  const use = async (command, args = '') => (await sleep(1100), api(`/channels/${geral.id}/interactions`, { command, args }, bia.token));
  let r = await use('ping');
  assert(r.status === 200 && r.message.author.bot && /pong.*Bia/.test(r.message.content), `ping: ${JSON.stringify(r).slice(0, 160)}`);
  r = await use('eco', 'olá mundo');
  assert(r.message.content === 'olá mundo', 'eco repete');
  r = await use('hora');
  assert(/Hora certa/.test(r.message.embeds[0].title) && /\d/.test(r.message.embeds[0].description), 'hora');
  r = await use('piada');
  assert(r.message.content.length > 10, 'piada');
  r = await use('clima', 'São Paulo');
  assert(r.status === 200 && (r.message.content || r.message.embeds?.[0]?.title), 'clima responde (com a previsão, ou com aviso amigável se a internet do teste estiver fechada)');
  step('/ping /eco /hora /piada /clima respondem pelo bot com assinatura válida');

  // chamada forjada (sem o segredo) não passa
  const corpo = JSON.stringify({ type: 'command', command: 'ping', args: '', user: { displayName: 'x' } });
  const forjada = await bot('/resenha', { method: 'POST', headers: { 'content-type': 'application/json', 'x-resenha-timestamp': String(Math.floor(Date.now() / 1000)), 'x-resenha-signature': 'v1=' + '0'.repeat(64) }, body: corpo });
  assert(forjada.status === 401, 'assinatura falsa: 401');
  const semAssinatura = await bot('/resenha', { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo });
  assert(semAssinatura.status === 401, 'sem assinatura: 401');
  step('quem não tem o segredo não consegue fazer o bot responder (assinatura obrigatória)');

  // aviso pelo painel, escolhendo o canal pelo nome
  assert((await painel('/painel/anunciar', { chave: 'errada', canal: 'geral', texto: 'x' })).includes('Senha incorreta'), 'aviso: senha errada');
  assert((await painel('/painel/anunciar', { chave: 'senha-do-painel', canal: 'canal-que-nao-existe', texto: 'x' })).includes('Não achei o canal'), 'canal inexistente');
  await sleep(5200); // o limite de 5 mensagens a cada 5 s por canal vale também para os avisos
  const resp = await painel('/painel/anunciar', { chave: 'senha-do-painel', canal: '#Geral', texto: 'Aviso: live às 21h!' });
  assert(resp.includes('Aviso enviado em #geral'), 'aviso enviado pelo nome do canal: ' + resp.replace(/<[^>]+>/g, ' ').slice(0, 300));
  const msgs = await api(`/channels/${geral.id}/messages`, null, bia.token);
  assert(msgs.messages.some((m) => m.content === 'Aviso: live às 21h!' && m.author.bot), 'o aviso aparece no canal, assinado pelo bot');
  step('aviso pelo painel: acha o canal pelo nome e o bot posta no servidor');

  console.log('\nTudo certo com o bot de exemplo.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  botServer?.close();
  server.kill();
}
