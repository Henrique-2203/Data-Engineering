// Bots da casa (Resenha Bot), em teste só para contas liberadas:
//  - só quem tem o recurso "bots" E "Gerenciar servidor" instala; o servidor também confere
//  - instalar põe o bot na lista de membros (bot: true), sem boas-vindas, com auditoria
//  - comandos: /dado /moeda /sortear /enquete /lembrar /ajuda, com limites e erros claros
//  - o texto digitado passa por moderação automática e modo lento; comandos podem ser desligados
//  - bot não recebe DM nem amizade, ninguém loga como ele, remover tira do servidor
// Uso: npm run build && node e2e/bots.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3269;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-bots-'), PLATFORM_ADMINS: 'equipe', BOT_TIME_SCALE: '60', BOT_REMINDER_TICK_MS: '400' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.4.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

let browser;
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
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const voz = guild.channels.find((c) => c.type === 'voice');
  await api('/admin/beta', { bots: ['ana'] }, equipe.token, 'PUT');

  // ---------- quem pode instalar ----------
  assert((await api(`/guilds/${guild.id}/bots`, {}, equipe.token)).status === 404, 'a equipe sozinha não instala: precisa do recurso');
  assert((await api(`/guilds/${guild.id}/bots`, {}, bia.token)).status === 404, 'sem o recurso: 404');
  await api('/admin/beta', { bots: ['ana', 'bia'] }, equipe.token, 'PUT');
  assert((await api(`/guilds/${guild.id}/bots`, {}, bia.token)).status === 403, 'com o recurso mas sem Gerenciar servidor: 403');
  await api('/admin/beta', { bots: ['ana'] }, equipe.token, 'PUT');
  step('só quem tem o recurso e "Gerenciar servidor" instala (o servidor confere os dois)');

  // ---------- instalar ----------
  const biaSock = io(BASE, { auth: { token: bia.token }, transports: ['websocket'] });
  const seen = [];
  biaSock.onAny((ev, d) => seen.push({ ev, d }));
  await new Promise((r) => biaSock.on('ready', r));
  const before = await api(`/guilds/${guild.id}/commands`, null, bia.token);
  assert(before.commands.length === 0, 'sem bot instalado não há comandos');
  const inst = await api(`/guilds/${guild.id}/bots`, {}, ana.token);
  assert(inst.status === 200 && inst.installed && inst.commands.length === 17, `instalou: ${JSON.stringify(inst).slice(0, 120)}`);
  assert((await api(`/guilds/${guild.id}/bots`, {}, ana.token)).status === 409, 'instalar duas vezes: 409');
  const g = (await api(`/guilds/${guild.id}`, null, bia.token)).guild;
  const botMember = g.members.find((m) => m.bot);
  assert(botMember && botMember.displayName === 'Resenha Bot', 'o bot aparece na lista de membros com bot: true');
  await sleep(200);
  assert(seen.some((e) => e.ev === 'member:join' && e.d.member?.bot), 'os membros recebem o aviso em tempo real');
  const msgs0 = await api(`/channels/${geral.id}/messages`, null, bia.token);
  assert(!msgs0.messages.some((m) => m.system === 'join' && m.author.bot), 'sem mensagem de boas-vindas do bot');
  const audit = await api(`/guilds/${guild.id}/audit`, null, ana.token);
  assert(audit.entries.some((e) => e.action === 'bot_add'), 'auditoria registra bot_add');
  step('instalar: bot entra como membro (bot: true), avisa em tempo real, sem boas-vindas, com auditoria');

  // ---------- comandos ----------
  const burst = (token, command, args = '', ch = geral.id) => api(`/channels/${ch}/interactions`, { command, args }, token);
  // o limite é de 10 comandos a cada 10 s por pessoa: o teste anda devagar para não esbarrar nele sem querer
  const cmd = async (...a) => (await sleep(1100), burst(...a));
  let r = await cmd(bia.token, 'dado', 'd20');
  assert(r.status === 200 && r.message.author.bot && r.message.interaction.command === 'dado' && r.message.interaction.userId === bia.user.id, `dado: ${JSON.stringify(r).slice(0, 200)}`);
  const n = Number(/\*\*(\d+)\*\*/.exec(r.message.embeds[0].description)?.[1]);
  assert(n >= 1 && n <= 20, `d20 entre 1 e 20: ${n}`);
  await sleep(200);
  assert(seen.some((e) => e.ev === 'message:new' && e.d.message.id === r.message.id), 'a resposta chega em tempo real');
  r = await cmd(bia.token, 'dado', '2d6');
  assert(/=/.test(r.message.embeds[0].description), '2d6 mostra a soma');
  for (const bad of ['d1000000', '21d6', 'abc', '0d6', 'd1']) assert((await cmd(bia.token, 'dado', bad)).status === 400, `dado ${bad} recusado`);
  r = await cmd(bia.token, 'moeda');
  assert(/cara|coroa/.test(r.message.embeds[0].description), 'moeda');
  r = await cmd(bia.token, 'sortear', 'pizza, sushi, hambúrguer');
  assert(/pizza|sushi|hambúrguer/.test(r.message.embeds[0].description), 'sortear');
  assert((await cmd(bia.token, 'sortear', 'só uma')).status === 400, 'sortear precisa de 2 opções');
  r = await cmd(bia.token, 'enquete', 'Qual jogo hoje? | Valorant | CS | Minecraft');
  assert(r.status === 200 && r.message.poll?.question === 'Qual jogo hoje?' && r.message.poll.options.length === 3, `enquete: ${JSON.stringify(r).slice(0, 200)}`);
  const vote = await api(`/messages/${r.message.id}/poll`, { options: [1] }, caio.token);
  assert(vote.status === 200 && vote.message.poll.options[1].userIds[0] === caio.user.id, 'dá para votar na enquete do bot');
  assert((await cmd(bia.token, 'enquete', 'sem opções')).status === 400, 'enquete precisa de opções');
  r = await cmd(bia.token, 'ajuda');
  assert(r.message.embeds[0].fields.length === 14, 'ajuda lista os 14 comandos (os 3 de IA ficam travados até o servidor ligar)');
  assert((await cmd(bia.token, 'naoexiste')).status === 404, 'comando inexistente');
  step('comandos /dado /moeda /sortear /enquete /ajuda funcionam, com limites e erros claros');

  // lembrete (tempo encurtado nos testes: 1 minuto vira 1 segundo)
  r = await cmd(bia.token, 'lembrar', '1m tirar a pizza do forno');
  assert(r.status === 200, `lembrar: ${JSON.stringify(r)}`);
  assert((await cmd(bia.token, 'lembrar', 'daqui a pouco')).status === 400, 'lembrar com formato errado');
  assert((await cmd(bia.token, 'lembrar', '8d algo')).status === 400, 'lembrar além de 7 dias');
  let got = null;
  for (let i = 0; i < 30 && !got; i++) {
    await sleep(300);
    got = (await api(`/channels/${geral.id}/messages`, null, bia.token)).messages.find((m) => m.author.bot && /lembrete: tirar a pizza/.test(m.content));
  }
  assert(got && /@bia/.test(got.content), 'o bot avisou o lembrete no canal');
  step('/lembrar: o bot avisa quando chega a hora');

  // ---------- moderação do servidor vale para o bot também ----------
  await api(`/guilds/${guild.id}/automod`, { words: ['proibida'], blockLinks: false, blockInvites: false, antiSpam: false, exemptRoleIds: [] }, ana.token, 'PUT');
  const am = await cmd(bia.token, 'sortear', 'palavra proibida, outra');
  assert(am.status === 400 && /moderação automática/.test(am.error), `automod pega o texto do comando: ${am.status} ${am.error}`);
  await api(`/channels/${geral.id}`, { slowmode: 5 }, ana.token, 'PATCH');
  await sleep(5200);
  assert((await cmd(caio.token, 'moeda')).status === 200, 'primeiro comando passa no modo lento');
  const slow = await cmd(caio.token, 'moeda');
  assert(slow.status === 429 && /Modo lento/.test(slow.error), `modo lento vale para comandos: ${slow.status} ${slow.error}`);
  assert((await cmd(ana.token, 'moeda')).status === 200 && (await cmd(ana.token, 'moeda')).status === 200, 'quem gerencia não espera');
  await api(`/channels/${geral.id}`, { slowmode: 0 }, ana.token, 'PATCH');
  assert((await cmd(bia.token, 'moeda', '', voz.id)).status === 400, 'comando em canal de voz é recusado');
  step('o texto do comando passa pela moderação automática e pelo modo lento do servidor');

  // ---------- ligar/desligar comando ----------
  assert((await api(`/guilds/${guild.id}/bots/commands`, { name: 'dado', enabled: false }, bia.token, 'PATCH')).status === 404, 'só quem tem o recurso mexe nos comandos');
  const off = await api(`/guilds/${guild.id}/bots/commands`, { name: 'dado', enabled: false }, ana.token, 'PATCH');
  assert(off.status === 200 && !off.commands.find((c) => c.name === 'dado').enabled, 'desligou o /dado');
  assert((await cmd(bia.token, 'dado')).status === 400, 'comando desligado é recusado');
  assert((await api(`/guilds/${guild.id}/commands`, null, bia.token)).commands.every((c) => c.name !== 'dado'), 'sai do popup');
  await api(`/guilds/${guild.id}/bots/commands`, { name: 'dado', enabled: true }, ana.token, 'PATCH');
  assert((await cmd(bia.token, 'dado')).status === 200, 'religou');
  step('comandos podem ser desligados e religados no servidor');

  // ---------- o bot não é uma pessoa ----------
  const botId = botMember.id;
  const dm = await api('/dms', { userId: botId }, bia.token);
  assert(dm.status === 400 && /Bots/.test(dm.error), `DM com bot recusada: ${dm.status} ${dm.error}`);
  const fr = await api('/friends', { username: botMember.username }, bia.token);
  assert(fr.status === 400 && /Bots/.test(fr.error), `amizade com bot recusada: ${fr.status} ${fr.error}`);
  const lg = await api('/auth/login', { username: botMember.username, password: '' }, null);
  assert(lg.status >= 400 && !lg.token, `ninguém loga como bot: ${lg.status}`);
  const lg2 = await api('/auth/login', { username: botMember.username, password: 'bot$sem-login' }, null);
  assert(lg2.status >= 400 && !lg2.token, 'nem com o texto guardado como senha');
  const stats = await api('/admin/stats?days=7', null, equipe.token);
  assert(stats.totals.users === 4, `o bot não conta como pessoa nas estatísticas: ${stats.totals.users}`);
  const su = await api('/admin/signups', null, equipe.token);
  assert(su.totals.total === 4 && !su.users.some((u) => u.username === botMember.username), 'nem em Novas contas');
  step('bot não recebe DM nem amizade, ninguém loga como ele e ele não conta como conta nova');

  // ---------- limite de uso ----------
  let limited = 0;
  for (let i = 0; i < 14; i++) if ((await burst(bia.token, 'moeda')).status === 429) limited++;
  assert(limited > 0, 'muitos comandos seguidos levam 429');
  await sleep(10_500);
  step('muitos comandos seguidos são segurados');

  // ---------- remover ----------
  assert((await api(`/guilds/${guild.id}/bots`, null, bia.token, 'DELETE')).status === 404, 'só quem tem o recurso remove');
  assert((await api(`/guilds/${guild.id}/bots`, null, ana.token, 'DELETE')).status === 200, 'removeu');
  assert(!(await api(`/guilds/${guild.id}`, null, bia.token)).guild.members.some((m) => m.bot), 'o bot sai da lista de membros');
  const gone = await cmd(bia.token, 'dado');
  assert(gone.status === 404 && /não tem o Resenha Bot/.test(gone.error), `sem bot, sem comandos: ${gone.status} ${gone.error}`);
  const audit2 = await api(`/guilds/${guild.id}/audit`, null, ana.token);
  assert(audit2.entries.some((e) => e.action === 'bot_remove'), 'auditoria registra bot_remove');
  // as mensagens antigas continuam
  assert((await api(`/channels/${geral.id}/messages`, null, bia.token)).messages.some((m) => m.author.bot), 'mensagens antigas do bot continuam');
  // DM: comando não funciona fora de servidor
  const dmWithCaio = await api('/dms', { userId: caio.user.id }, bia.token);
  assert((await cmd(bia.token, 'dado', '', dmWithCaio.dm?.id ?? dmWithCaio.channelId ?? dmWithCaio.id)).status === 400, 'comando em DM recusado');
  step('remover: sai dos membros, comandos param, auditoria e histórico ficam');

  biaSock.close();
  console.log('\nTudo certo com a API dos bots.');

  // ---------- telas ----------
  const ui = (await api('/guilds', { name: 'Galera UI' }, ana.token)).guild;
  await api(`/invites/${ui.inviteCode}/join`, {}, bia.token);
  browser = await chromium.launch();
  const open = async (user) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`[${user} pageerror]`, e.message));
    await page.goto(`${BASE}/app`);
    await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill(user);
    await page.getByLabel('Senha', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: /^Entrar$/ }).click();
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera UI' }).first().click();
    return page;
  };
  const anaPage = await open('ana');
  await anaPage.locator('.guild-name').click();
  await anaPage.getByRole('button', { name: 'Configurações do servidor' }).click();
  await anaPage.getByRole('button', { name: 'Integrações', exact: true }).click();
  await anaPage.getByText('Resenha Bot').first().waitFor();
  await anaPage.getByRole('button', { name: 'Adicionar ao servidor' }).click();
  await anaPage.getByLabel('Comando /dado').waitFor();
  await anaPage.screenshot({ path: `${shots}/bots-integracoes.png` });
  await anaPage.getByLabel('Comando /moeda').uncheck();
  await anaPage.getByLabel('Comando /moeda').waitFor();
  await anaPage.keyboard.press('Escape');
  step('tela: Configurações → Integrações → adicionar o bot e desligar um comando');

  // quem não tem o recurso não vê a aba (e quem não gerencia também não)
  const biaPage = await open('bia');
  // Bia vê o bot na lista de membros e usa os comandos pelo "/"
  await biaPage.locator('.member-list, aside').getByText('Resenha Bot').first().waitFor({ timeout: 10000 });
  assert((await biaPage.locator('aside .bot-tag').count()) > 0, 'selo BOT na lista de membros');
  const box = biaPage.getByPlaceholder(/Conversar em #geral/);
  await box.click();
  await box.pressSequentially('/');
  const pop = biaPage.getByRole('listbox', { name: 'Comandos' });
  await pop.waitFor({ timeout: 8000 });
  assert((await pop.getByRole('option').count()) === 8, 'o popup lista até 8 comandos (o /moeda foi desligado)');
  await biaPage.screenshot({ path: `${shots}/bots-popup.png` });
  await box.pressSequentially('da');
  await biaPage.keyboard.press('Enter'); // completa "/dado "
  assert((await box.inputValue()) === '/dado ', 'Enter completa o comando');
  await box.pressSequentially('d20');
  await biaPage.keyboard.press('Enter'); // envia
  const msg = biaPage.locator('.message', { hasText: 'usou' }).last();
  await msg.locator('.bot-embed').waitFor({ timeout: 10000 });
  assert((await msg.locator('.bot-tag').count()) === 1, 'selo BOT na mensagem');
  assert(/usou\s*\/dado/.test(await msg.locator('.interaction-line').innerText()), 'mostra quem usou o comando');
  await biaPage.screenshot({ path: `${shots}/bots-resposta.png` });
  // comando desconhecido ou desligado vira mensagem normal
  await box.fill('/moeda');
  await biaPage.keyboard.press('Enter');
  await biaPage.locator('.message-content', { hasText: '/moeda' }).waitFor({ timeout: 8000 });
  await box.fill('/enquete Hoje? | Sim | Não');
  await biaPage.keyboard.press('Enter');
  await biaPage.getByText('Hoje?').first().waitFor({ timeout: 8000 });
  step('tela: "/" abre a lista, Enter completa, o bot responde com selo BOT e "usou /dado"; comando desligado vira texto; enquete do bot aparece');
  console.log('\nTudo certo com os bots (telas).');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
