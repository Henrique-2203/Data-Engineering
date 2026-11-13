// Servidor oficial ("Resenha Brasil OFC"): a equipe cria pelo painel; quem já tem conta entra uma vez
// (com aviso), quem cria conta também; quem sai não volta; banido não entra. Regras com "Aceito"
// (antes só lê) e canal de avisos (só a equipe publica).
// Uso: npm run build && node e2e/official.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3201;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-ofc-'), PLATFORM_ADMINS: 'mercurio_1411' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const hen = await reg('mercurio_1411', 'Henrique');
  const kevin = await reg('kevin', 'Kevin');
  const rb = await reg('resenha_brasil', 'Resenha Brasil');
  const ana = await reg('ana', 'Ana');
  const caio = await reg('caio', 'Caio');

  // antes de existir o servidor oficial: ninguém entra, e a vez da pessoa não é gasta
  let b = await api('/bootstrap', null, ana.token);
  assert(!b.joinedOfficial && b.guilds.length === 0, 'sem servidor oficial, nada acontece');
  assert((await api('/admin/official', null, ana.token)).status === 404, 'só a equipe vê o painel do servidor oficial');

  // a equipe cria pelo painel
  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const ph = await open(hen.token);
  await ph.getByRole('button', { name: /^Denúncias/ }).click();
  await ph.getByRole('tab', { name: /Servidor oficial/ }).click();
  assert((await ph.getByLabel('Nome do servidor').inputValue()) === 'Resenha Brasil OFC', 'nome padrão');
  await ph.getByRole('button', { name: 'Criar o servidor oficial' }).click();
  await ph.getByText('Servidor oficial criado!').waitFor();
  await ph.getByText('está no ar com').waitFor();
  const ofc = await api('/admin/official', null, hen.token);
  const gid = ofc.guild.id;
  let g = (await api(`/guilds/${gid}`, null, hen.token)).guild;
  const names = g.channels.map((c) => c.name);
  for (const n of ['regras', 'novidades', 'geral', 'procurando-grupo', 'sugestões', 'Call 1', 'Call 2', 'Call 3']) assert(names.includes(n), `canal ${n}`);
  assert(g.channels.find((c) => c.name === 'novidades').announce && g.channels.find((c) => c.name === 'regras').announce, 'regras e novidades são canais de avisos');
  assert(g.categories.length === 3 && g.rulesRequired && g.rules.includes('Respeito'), 'categorias e regras prontas');
  const modRole = g.roles.find((r) => r.name === 'Moderação Suprema');
  for (const u of [kevin, rb]) assert(g.members.find((m) => m.id === u.user.id)?.roleIds.includes(modRole.id), `${u.user.username} é Moderação Suprema`);
  assert(g.ownerId === hen.user.id && g.official, 'dono é quem criou; marcado como oficial');
  step('equipe cria o "Resenha Brasil OFC" pelo painel: canais, categorias, regras, avisos e Moderação Suprema (@kevin e @resenha_brasil)');

  // o Caio foi banido antes de abrir o app: não entra
  await api(`/guilds/${gid}/bans`, { userId: caio.user.id, reason: 'teste' }, hen.token);
  b = await api('/bootstrap', null, caio.token);
  assert(!b.joinedOfficial && !b.guilds.some((x) => x.id === gid), 'banido não entra');

  // quem já tinha conta: entra na próxima vez que abrir o app, com o aviso
  const pa = await open(ana.token);
  const welcome = pa.getByRole('dialog', { name: 'Bem-vindo(a) ao Resenha Brasil OFC! 🎉' });
  await welcome.waitFor();
  await pa.screenshot({ path: path.join(shots, 'oficial-boas-vindas.png') });
  await welcome.getByRole('button', { name: 'Depois' }).click();
  // antes de aceitar as regras: só lê
  await pa.getByRole('button', { name: 'geral', exact: true }).click();
  await pa.getByText('leia as regras e clique em').waitFor();
  const geral = g.channels.find((c) => c.name === 'geral');
  let r = await api(`/channels/${geral.id}/messages`, { content: 'oi' }, ana.token);
  assert(r.status === 403 && /regras/.test(r.error), 'sem aceitar as regras, não escreve');
  const s = io(BASE, { auth: { token: ana.token }, transports: ['websocket'] });
  await new Promise((res) => s.once('connect', res));
  const call1 = g.channels.find((c) => c.name === 'Call 1');
  const join = await new Promise((res) => s.emit('voice:join', { channelId: call1.id }, res));
  s.close();
  assert(!join.ok && /regras/.test(join.error), 'sem aceitar as regras, não entra na call');
  await pa.screenshot({ path: path.join(shots, 'oficial-regras-pendentes.png') });
  await pa.getByRole('button', { name: 'Ler as regras' }).click();
  await pa.getByRole('dialog', { name: 'Regras do Resenha Brasil OFC' }).getByRole('button', { name: 'Aceito' }).click();
  await pa.getByText('Agora você participa do Resenha Brasil OFC').waitFor();
  r = await api(`/channels/${geral.id}/messages`, { content: 'oi galera!' }, ana.token);
  assert(r.status < 300, 'depois do Aceito, escreve');
  step('quem já tinha conta entra uma vez, com o aviso; antes do "Aceito" só lê (sem escrever nem entrar na call)');

  // canal de avisos
  const news = g.channels.find((c) => c.name === 'novidades');
  await pa.getByRole('button', { name: 'novidades', exact: true }).click();
  await pa.getByText('Canal de avisos: só a equipe do servidor publica aqui').waitFor();
  r = await api(`/channels/${news.id}/messages`, { content: 'posso?' }, ana.token);
  assert(r.status === 403, 'membro não publica nos avisos');
  r = await api(`/channels/${news.id}/messages`, { content: '🚀 Novidade: moderação de voz chegou!' }, kevin.token);
  assert(r.status < 300, 'moderação publica nos avisos');
  await pa.getByText('Novidade: moderação de voz chegou!').waitFor();
  await pa.screenshot({ path: path.join(shots, 'oficial-novidades.png') });
  step('#novidades: todo mundo lê, só a equipe publica');

  // quem cria conta agora: entra direto
  const bia = await reg('bia', 'Bia');
  b = await api('/bootstrap', null, bia.token);
  assert(b.joinedOfficial?.guildId === gid && b.guilds.some((x) => x.id === gid), 'conta nova entra no oficial');
  b = await api('/bootstrap', null, bia.token);
  assert(!b.joinedOfficial, 'o aviso aparece uma vez só');
  // e a Ana, que já está lá, vê a Bia chegar na lista sem recarregar
  await pa.waitForFunction(() => document.body.innerText.includes('Bia'), null, { timeout: 5000 }).catch(() => {});
  step('conta nova entra no servidor oficial na hora, e o aviso aparece uma vez só');

  // quem sai não é colocado de volta
  await api(`/guilds/${gid}/members/@me`, null, bia.token, 'DELETE');
  b = await api('/bootstrap', null, bia.token);
  assert(!b.joinedOfficial && !b.guilds.some((x) => x.id === gid), 'quem saiu não volta');
  step('quem sai do servidor oficial não é colocado de volta; banido não entra');

  // mudar as regras: todo mundo aceita de novo
  await api(`/guilds/${gid}`, { rules: g.rules + '\n9. Divirta-se!' }, hen.token, 'PATCH');
  g = (await api(`/guilds/${gid}`, null, ana.token)).guild;
  assert(g.rulesPending, 'regras novas: aceitar de novo');
  step('regras mudaram: todo mundo aceita de novo (a moderação não precisa)');
  console.log('\nTUDO CERTO (servidor oficial)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
