// Fase 2: servidores públicos e Explorar. Privado x público ao criar; só aparece no Explorar com
// descrição, ícone, categoria e regras com "Aceito"; entrar sem convite; busca e categorias; o oficial
// fixo em primeiro; denunciar servidor pelo Explorar; a equipe tira/devolve da lista; contexto da
// denúncia de mensagem (só a equipe, com registro de quem viu).
// Uso: npm run build && node e2e/explore.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3203;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-explore-'), PLATFORM_ADMINS: 'equipe' },
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
  const equipe = await reg('equipe', 'Equipe');
  const dono = await reg('dono', 'Dono');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  // servidor oficial (sempre aparece, em primeiro)
  const ofc = await api('/admin/official', { name: 'Resenha Brasil OFC', moderators: [] }, equipe.token);
  assert(ofc.guildId, 'oficial criado');

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('dialog', { name: /Bem-vindo\(a\)/ }).getByRole('button', { name: 'Agora não' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };

  // o dono cria um servidor público pela tela
  const pd = await open(dono.token);
  await pd.getByRole('button', { name: 'Criar servidor' }).click();
  await pd.getByLabel('Nome do servidor').fill('Clã do Bomb');
  await pd.getByText('🌎 Público').click();
  await pd.getByLabel('Categoria').selectOption('fps');
  await pd.getByRole('button', { name: 'Criar', exact: true }).click();
  await pd.getByRole('heading', { name: 'Comunidade' }).waitFor();
  await pd.getByText('Para aparecer no Explorar, falta: descrição, ícone, regras com "Aceito"').waitFor();
  await pd.screenshot({ path: path.join(shots, 'explorar-comunidade-falta.png') });
  const gid = (await api('/bootstrap', null, dono.token)).guilds.find((g) => g.name === 'Clã do Bomb').id;
  // ainda sem os requisitos: não aparece; servidor privado também nunca aparece
  await api('/guilds', { name: 'Só os amigos' }, dono.token);
  let ex = await api('/explore', null, ana.token);
  assert(ex.guilds.length === 1 && ex.guilds[0].official, `só o oficial aparece por enquanto (${ex.guilds.map((g) => g.name)})`);
  assert((await api(`/explore/${gid}/join`, {}, ana.token)).status === 404, 'sem os requisitos, não dá para entrar sem convite');
  const adm = (await api('/admin/public-guilds', null, equipe.token)).guilds.find((g) => g.id === gid);
  assert(!adm.listed && adm.missing.join() === 'descrição,ícone,regras com "Aceito"', `painel da equipe diz o que falta (${adm.missing})`);
  step('criar servidor público pela tela (com categoria); sem descrição/ícone/regras não aparece; privado nunca aparece');

  // completa os requisitos
  await api(`/guilds/${gid}`, { description: 'Clã de CS: treino toda noite, mix de fim de semana e calls abertas.', rules: '1. Respeito.\n2. Sem trapaça.', rulesRequired: true }, dono.token, 'PATCH');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQ0lEQVR4nO3OMQEAIAzAsPk3DQo4yQxRcNKZu8Z9Hzt7AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH7AQwyAQEf6S0vVgAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(`${BASE}/api/guilds/${gid}/icon`, { method: 'POST', headers: { 'content-type': 'image/png', authorization: `Bearer ${dono.token}` }, body: png });
  assert(up.ok, `ícone enviado (${up.status} ${await up.text().catch(() => '')})`);
  ex = await api('/explore', null, ana.token);
  assert(ex.guilds.length === 2 && ex.guilds[0].official && ex.guilds[1].name === 'Clã do Bomb' && ex.guilds[1].category === 'fps', 'com tudo, aparece (o oficial em primeiro)');
  assert((await api('/explore?q=bomb', null, ana.token)).guilds.some((g) => g.id === gid), 'busca por nome');
  assert(!(await api('/explore?category=rpg', null, ana.token)).guilds.some((g) => g.id === gid), 'filtro de categoria');
  assert((await api('/explore?category=fps', null, ana.token)).guilds.some((g) => g.id === gid), 'categoria certa');
  assert(ex.counts.fps === 1 && !ex.counts.rpg, `contagem por categoria (${JSON.stringify(ex.counts)})`);
  assert((await api('/admin/public-guilds', null, equipe.token)).guilds.find((g) => g.id === gid).missing.length === 0, 'nada faltando');
  step('com descrição, ícone, categoria e regras, aparece no Explorar (oficial fixo em 1º); busca e categorias funcionam');

  // a Ana entra pelo Explorar (bússola)
  const pa = await open(ana.token);
  await pa.getByRole('button', { name: 'Explorar servidores' }).click();
  const dlg = pa.getByRole('dialog', { name: 'Explorar servidores' });
  const card = dlg.getByRole('article', { name: 'Clã do Bomb' });
  await card.waitFor();
  await dlg.getByRole('tab', { name: /FPS/ }).getByText('1').waitFor();
  await sleep(400);
  await pa.screenshot({ path: path.join(shots, 'explorar.png') });
  await dlg.getByRole('tab', { name: /RPG/ }).click();
  await dlg.getByText('Nenhum servidor público aqui ainda').waitFor();
  await dlg.getByRole('tab', { name: /FPS/ }).click();
  await card.waitFor();
  await pa.setViewportSize({ width: 390, height: 800 });
  await pa.screenshot({ path: path.join(shots, 'explorar-celular.png') });
  await pa.setViewportSize({ width: 1280, height: 860 });
  await card.getByRole('button', { name: 'Entrar' }).click();
  await pa.getByText('Você entrou no Clã do Bomb!').waitFor();
  await pa.getByText('leia as regras e clique em').waitFor();
  assert((await api('/bootstrap', null, ana.token)).guilds.some((g) => g.id === gid), 'Ana virou membro');
  step('entrar pelo Explorar, sem convite (com as regras do servidor pedindo "Aceito")');

  // contexto da denúncia de mensagem
  await api(`/guilds/${gid}/rules/accept`, {}, ana.token);
  const geral = (await api(`/guilds/${gid}`, null, dono.token)).guild.channels.find((c) => c.type === 'text');
  for (let i = 1; i <= 10; i++) await api(`/channels/${geral.id}/messages`, { content: `mensagem ${i}` }, i % 2 ? ana.token : dono.token);
  const bad = await api(`/channels/${geral.id}/messages`, { content: 'mensagem ofensiva' }, dono.token);
  for (let i = 11; i <= 14; i++) await api(`/channels/${geral.id}/messages`, { content: `mensagem ${i}` }, ana.token);
  const badId = bad.message?.id ?? bad.id;
  assert(badId, 'mensagem criada');
  assert((await api('/reports', { type: 'message', id: badId, reason: 'harassment' }, ana.token)).ok, 'Ana denuncia a mensagem');
  // a Bia (fora do servidor) denuncia o servidor pelo Explorar
  const pb = await open(bia.token);
  await pb.getByRole('button', { name: 'Explorar servidores' }).click();
  await pb.getByRole('dialog', { name: 'Explorar servidores' }).getByRole('button', { name: 'Denunciar Clã do Bomb' }).click();
  await pb.getByText('Discurso de ódio').click();
  await pb.getByRole('button', { name: /Enviar denúncia/ }).click();
  await pb.getByText(/Denúncia enviada|equipe vai analisar/).first().waitFor({ timeout: 5000 });
  step('denunciar servidor direto pelo Explorar, sem ser membro');

  const reps = (await api('/admin/reports?status=open', null, equipe.token)).reports;
  const msgRep = reps.find((r) => r.type === 'message');
  const gRep = reps.find((r) => r.type === 'guild');
  assert((await api(`/admin/reports/${msgRep.id}/context`, null, ana.token)).status === 404, 'só a equipe vê o contexto');
  const pe = await open(equipe.token);
  await pe.getByRole('button', { name: /^Denúncias/ }).click();
  await pe.getByRole('button', { name: 'Ver conversa em volta' }).click();
  await pe.locator('.report-context li.target', { hasText: 'mensagem ofensiva' }).waitFor();
  const ctxItems = await pe.locator('.report-context li').count();
  assert(ctxItems >= 12 && ctxItems <= 17, `algumas mensagens antes e depois (${ctxItems})`);
  await pe.getByText(/Vistas: @equipe/).waitFor();
  await pe.screenshot({ path: path.join(shots, 'denuncia-contexto.png') });
  step(`contexto da denúncia: ${ctxItems} mensagens em volta, a denunciada destacada, e o acesso fica registrado`);

  // a equipe tira o servidor do Explorar pela denúncia
  await pe.getByRole('button', { name: 'Tirar do Explorar' }).click();
  await sleep(500);
  assert(!(await api('/explore', null, bia.token)).guilds.some((g) => g.id === gid), 'tirado da lista');
  assert((await api(`/explore/${gid}/join`, {}, bia.token)).status === 404, 'tirado da lista: não entra sem convite');
  assert((await api('/bootstrap', null, ana.token)).guilds.some((g) => g.id === gid), 'quem já estava continua no servidor');
  assert((await api(`/guilds/${gid}`, null, dono.token)).guild.unlisted, 'o dono vê que foi tirado');
  // e devolve pelo painel de servidores públicos
  await pe.getByRole('tab', { name: /Servidores públicos/ }).click();
  await pe.getByText('tirado da lista').waitFor();
  await pe.screenshot({ path: path.join(shots, 'explorar-painel.png') });
  await pe.getByRole('button', { name: 'Devolver ao Explorar' }).click();
  await pe.getByText('Voltou para o Explorar.').waitFor();
  assert((await api('/explore', null, bia.token)).guilds.some((g) => g.id === gid), 'voltou para a lista');
  step('equipe tira do Explorar (pela denúncia) e devolve (painel Servidores públicos); quem já estava continua');

  // voltar a privado tira da lista
  await api(`/guilds/${gid}`, { public: false }, dono.token, 'PATCH');
  assert(!(await api('/explore', null, bia.token)).guilds.some((g) => g.id === gid), 'privado sai da lista');
  step('voltar a privado tira do Explorar');
  void gRep;
  console.log('\nTUDO CERTO (Explorar e servidores públicos)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
