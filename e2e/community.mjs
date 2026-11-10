// Etapa 4: busca, mensagens fixadas, enquetes, moderação automática, modo lento, eventos e notificações no celular.
// Uso: npm run build && node e2e/community.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3182;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-com-')), PUSH_TEST_OUTBOX: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const voiceCh = guild.channels.find((c) => c.type === 'voice');
  const send = (token, content, extra = {}) => api(`/channels/${geral.id}/messages`, { content, ...extra }, token);

  // ---------- API: enquete ----------
  const bad = await send(bia.token, '', { poll: { question: 'Qual jogo?', options: ['Valorant'], hours: 24 } });
  assert(bad.status === 400, 'enquete com uma opção só é recusada');
  const pollMsg = await send(bia.token, '', { poll: { question: 'Qual jogo hoje?', options: ['Valorant', 'CS2', 'Minecraft'], hours: 4 } });
  assert(pollMsg.status === 200 && pollMsg.message.poll.options.length === 3, 'enquete criada');
  const v1 = await api(`/messages/${pollMsg.message.id}/poll`, { options: [0] }, ana.token);
  assert(v1.message.poll.options[0].userIds.includes(ana.user.id), 'voto da Ana contado');
  const v2 = await api(`/messages/${pollMsg.message.id}/poll`, { options: [0, 1] }, caio.token);
  assert(v2.status === 400, 'enquete de uma opção só não aceita duas');
  await api(`/messages/${pollMsg.message.id}/poll`, { options: [1] }, ana.token);
  const v3 = await api(`/messages/${pollMsg.message.id}/poll`, { options: [2] }, caio.token);
  assert(v3.message.poll.options[0].userIds.length === 0 && v3.message.poll.options[1].userIds.length === 1, 'trocar o voto tira o anterior');
  step('API: enquete (mínimo de 2 opções, uma escolha só, trocar o voto)');

  // ---------- API: fixar ----------
  const m1 = await send(bia.token, 'O servidor do mine é play.exemplo.com');
  const noPin = await api(`/messages/${m1.message.id}/pin`, {}, caio.token);
  assert(noPin.status === 403, 'membro comum não fixa');
  const pinned = await api(`/messages/${m1.message.id}/pin`, {}, ana.token);
  assert(pinned.message.pinnedAt, 'dona fixa a mensagem');
  const pins = await api(`/channels/${geral.id}/pins`, null, caio.token);
  assert(pins.messages.length === 1 && pins.messages[0].id === m1.message.id, 'lista de fixadas');
  step('API: fixar mensagens (só quem gerencia mensagens) e lista de fixadas');

  // ---------- API: busca ----------
  await send(caio.token, 'Amanhã tem campeonato às 21h, quem vai?');
  await send(ana.token, 'Vou sim! Campeão é a gente');
  let s = await api(`/search?guildId=${guild.id}&text=${encodeURIComponent('amanha campeonato')}`, null, bia.token);
  assert(s.total === 1 && s.messages[0].content.startsWith('Amanhã'), `busca sem acento acha "Amanhã" (${s.total})`);
  s = await api(`/search?guildId=${guild.id}&text=campe&authorId=${ana.user.id}`, null, bia.token);
  assert(s.total === 1 && s.messages[0].author.id === ana.user.id, 'filtro por pessoa');
  s = await api(`/search?guildId=${guild.id}&has=pinned`, null, bia.token);
  assert(s.total === 1, 'filtro fixadas');
  s = await api(`/search?guildId=${guild.id}&text=jogo%20hoje`, null, bia.token);
  assert(s.total === 1 && s.messages[0].poll, 'busca acha a pergunta da enquete');
  // canal privado: quem não vê o canal não acha as mensagens
  const { channel: secret } = await api(`/guilds/${guild.id}/channels`, { name: 'segredo', type: 'text', allowedRoleIds: [] }, ana.token);
  await api(`/channels/${secret.id}/messages`, { content: 'campeonato secreto' }, ana.token);
  s = await api(`/search?guildId=${guild.id}&text=secreto`, null, bia.token);
  assert(s.total === 0, 'busca não mostra canal privado para quem não vê');
  s = await api(`/search?guildId=${guild.id}&text=secreto`, null, ana.token);
  assert(s.total === 1, 'dona acha no canal privado');
  step('API: busca (sem acento, por pessoa, fixadas, enquetes; respeita canais privados)');

  // ---------- API: modo lento ----------
  await api(`/channels/${geral.id}`, { slowmode: 5 }, ana.token, 'PATCH');
  const early = await send(bia.token, 'logo depois da anterior');
  assert(early.status === 429, 'conta a última mensagem mandada antes de ligar o modo lento');
  await sleep(5200);
  assert((await send(bia.token, 'primeira')).status === 200, 'primeira mensagem passa');
  const slow = await send(bia.token, 'segunda');
  assert(slow.status === 429 && /Modo lento/.test(slow.error), 'modo lento segura a segunda');
  assert((await send(ana.token, 'dona não espera')).status === 200, 'quem gerencia não espera');
  await api(`/channels/${geral.id}`, { slowmode: 0 }, ana.token, 'PATCH');
  step('API: modo lento (segura quem manda rápido; quem gerencia não espera)');

  // ---------- API: moderação automática ----------
  const forbidden = await api(`/guilds/${guild.id}/automod`, null, bia.token);
  assert(forbidden.status === 403, 'membro comum não vê as palavras proibidas');
  await api(`/guilds/${guild.id}/automod`, { words: ['bobão', 'idiot*'], blockLinks: false, blockInvites: true, antiSpam: true, exemptRoleIds: [] }, ana.token, 'PUT');
  let b = await send(bia.token, 'você é um B0B4O mesmo');
  assert(b.status === 400 && /moderação automática/.test(b.error), `palavra proibida bloqueada mesmo disfarçada (${b.error})`);
  b = await send(bia.token, 'que idiotice');
  assert(b.status === 400, 'prefixo idiot* pega "idiotice"');
  b = await send(bia.token, 'entra lá: https://discord.gg/abcdef');
  assert(b.status === 400 && /convites/.test(b.error), 'convite de outro lugar bloqueado');
  b = await send(bia.token, `nosso: ${BASE}/invite/${guild.inviteCode}`);
  assert(b.status === 200, 'convite do próprio servidor pode');
  assert((await send(caio.token, 'spam spam')).status === 200, 'mensagem 1');
  assert((await send(caio.token, 'spam spam')).status === 200, 'mensagem 2');
  b = await send(caio.token, 'spam spam');
  assert(b.status === 400 && /repetida/.test(b.error), `terceira repetida é bloqueada (${b.status} ${b.error})`);
  await sleep(1000);
  const edit = await api(`/messages/${m1.message.id}`, { content: 'bobão' }, bia.token, 'PATCH');
  assert(edit.status === 400, 'editar também passa pelo filtro');
  assert((await send(ana.token, 'bobão (dona pode)')).status === 200, 'quem gerencia não é filtrado');
  const auditRes = await api(`/guilds/${guild.id}/audit`, null, ana.token);
  const blocks = auditRes.entries.filter((e) => e.action === 'automod_block');
  assert(blocks.length >= 3 && blocks.some((e) => e.details.rule === 'invites'), 'bloqueios vão para o registro');
  assert(auditRes.entries.some((e) => e.action === 'automod_update') && auditRes.entries.some((e) => e.action === 'message_pin'), 'mudanças no registro');
  await api(`/guilds/${guild.id}/automod`, { words: [], blockLinks: false, blockInvites: false, antiSpam: false, exemptRoleIds: [] }, ana.token, 'PUT');
  step('API: moderação automática (palavras disfarçadas, prefixo, convites, spam, edição, registro)');

  // ---------- API: eventos ----------
  const past = await api(`/guilds/${guild.id}/events`, { title: 'Ontem', startsAt: new Date(Date.now() - 3600e3).toISOString() }, bia.token);
  assert(past.status === 400, 'evento no passado é recusado');
  const soon = new Date(Date.now() + 2 * 3600e3).toISOString();
  const ev = await api(`/guilds/${guild.id}/events`, { title: 'Jogatina de sexta', description: 'Valorant 5x5', startsAt: soon, channelId: voiceCh.id }, bia.token);
  assert(ev.status === 200 && ev.event.interestedIds.includes(bia.user.id), 'membro cria evento (e já fica interessado)');
  const int = await api(`/events/${ev.event.id}/interest`, { interested: true }, caio.token);
  assert(int.event.interestedIds.length === 2, 'Caio tem interesse');
  const noEdit = await api(`/events/${ev.event.id}`, { title: 'Hackeado', startsAt: soon }, caio.token, 'PATCH');
  assert(noEdit.status === 403, 'só quem criou (ou gerencia) muda o evento');
  const boot = await api('/bootstrap', null, caio.token);
  assert(boot.guilds?.[0]?.events?.length === 1, 'eventos chegam junto com o servidor');
  step('API: eventos (no futuro, interesse, só quem criou muda, aparecem no servidor)');

  // ---------- API: notificações no celular ----------
  const fakeEndpoint = 'https://fcm.googleapis.com/fcm/send/teste-caio';
  const keys = { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) };
  const evil = await api('/push/subscribe', { endpoint: 'https://169.254.169.254/latest', keys }, caio.token);
  assert(evil.status === 400, 'endereço que não é serviço de push é recusado');
  assert((await api('/push/subscribe', { endpoint: fakeEndpoint, keys }, caio.token)).status === 200, 'inscrição do Caio');
  assert((await api('/push/key', null, caio.token)).key?.length > 40, 'chave pública VAPID');
  await send(bia.token, 'oi @caio, bora?');
  const dm = await api('/dms', { userId: caio.user.id }, bia.token);
  const dmId = dm.channel?.id ?? dm.dm?.id ?? dm.id;
  await api(`/channels/${dmId}/messages`, { content: 'mensagem direta' }, bia.token);
  await send(bia.token, 'mensagem sem menção');
  await sleep(500);
  const outbox = (await (await fetch(`${BASE}/api/push/test-outbox`)).json()).items;
  const forCaio = outbox.filter((i) => i.userId === caio.user.id);
  assert(forCaio.some((i) => /em #geral/.test(i.payload.title) && /@caio/.test(i.payload.body)), `menção vira notificação (${JSON.stringify(outbox)})`);
  assert(forCaio.some((i) => i.payload.title === 'Bia' && i.payload.body === 'mensagem direta'), 'mensagem direta vira notificação');
  assert(!forCaio.some((i) => /sem menção/.test(i.payload.body)), 'mensagem comum não notifica');
  const exp = await (await fetch(`${BASE}/api/me/export`, { headers: { authorization: `Bearer ${caio.token}` } })).json();
  assert(exp.pollVotes?.[0]?.choice === 'Minecraft' && exp.events?.length === 1 && exp.pushDevices?.[0]?.service === 'fcm.googleapis.com', `"Baixar meus dados" inclui votos, eventos e aparelhos (${JSON.stringify([exp.pollVotes, exp.events, exp.pushDevices])})`);
  step('API: notificações no celular (só serviços de push conhecidos; menções e DMs, não mensagens comuns)');

  // ---------- interface ----------
  await sleep(10_000); // o limite de 12 mensagens a cada 10 s vale para a interface também
  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('button', { name: 'Galera' }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'geral' }).first().click();
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);

  // enquete pela interface
  await pb.getByRole('button', { name: 'Criar enquete' }).click();
  await pb.getByLabel('Pergunta').fill('Pizza ou hambúrguer?');
  await pb.getByLabel('Opção 1').fill('Pizza');
  await pb.getByLabel('Opção 2').fill('Hambúrguer');
  await pb.getByRole('button', { name: 'Publicar enquete' }).click();
  const poll = pa.locator('.poll', { hasText: 'Pizza ou hambúrguer?' });
  await poll.waitFor({ timeout: 8000 }).catch(async (e) => {
    await pb.screenshot({ path: path.join(shots, 'debug-enquete.png') });
    throw e;
  });
  await poll.getByRole('button', { name: /^Pizza/ }).click();
  await pb.locator('.poll', { hasText: 'Pizza ou hambúrguer?' }).getByText('1 voto').waitFor({ timeout: 8000 });
  // quem votou: aparece para quem já votou (ou depois que a enquete acaba)
  await pa.locator('.poll', { hasText: 'Pizza ou hambúrguer?' }).getByRole('button', { name: 'Ver quem votou' }).click();
  await pa.getByRole('region', { name: 'Quem votou' }).getByText('Você').waitFor();
  const pbPoll = pb.locator('.poll', { hasText: 'Pizza ou hambúrguer?' });
  await pbPoll.getByText('vote para ver o resultado e quem votou').waitFor();
  await pbPoll.getByRole('button', { name: /^Hambúrguer/ }).click();
  await pbPoll.getByRole('button', { name: 'Ver quem votou' }).click();
  const region = pb.getByRole('region', { name: 'Quem votou' });
  await region.locator('.poll-voters-option', { hasText: 'Pizza' }).getByText('Ana').waitFor();
  await region.locator('.poll-voters-option', { hasText: 'Hambúrguer' }).getByText('Você').waitFor();
  await pb.screenshot({ path: path.join(shots, 'enquete.png') });
  step('interface: criar enquete e votar (o voto aparece na hora para os outros); "Ver quem votou" mostra o nome de quem votou em cada opção');

  // fixar pela interface
  const target = pa.locator('.message', { hasText: 'Amanhã tem campeonato' });
  await target.hover();
  await target.getByRole('button', { name: 'Fixar' }).click();
  await pa.getByRole('button', { name: 'Mensagens fixadas' }).click();
  await pa.locator('.side-panel .message', { hasText: 'Amanhã tem campeonato' }).waitFor();
  await pa.screenshot({ path: path.join(shots, 'fixadas.png') });
  step('interface: fixar mensagem e ver a lista de fixadas');

  // busca pela interface + pular para a mensagem
  await pa.getByRole('searchbox', { name: 'Buscar mensagens' }).fill('mine');
  await pa.keyboard.press('Enter');
  const result = pa.locator('.side-panel .search-result', { hasText: 'play.exemplo.com' });
  await result.waitFor();
  await pa.screenshot({ path: path.join(shots, 'busca.png') });
  await result.click();
  await pa.locator('.messages .message.flash', { hasText: 'play.exemplo.com' }).waitFor({ timeout: 8000 });
  step('interface: buscar e pular para a mensagem');

  // eventos pela interface
  await pa.getByRole('button', { name: /^Eventos/ }).click();
  await pa.getByText('Jogatina de sexta').waitFor();
  await pa.getByRole('button', { name: 'Tenho interesse' }).click();
  await pa.getByRole('button', { name: 'Interessado' }).waitFor();
  await pa.screenshot({ path: path.join(shots, 'eventos.png') });
  await pa.keyboard.press('Escape');
  step('interface: lista de eventos e "Tenho interesse"');

  // configurações do servidor: moderação automática e modo lento
  await pa.locator('.sidebar-header .guild-name').click();
  await pa.getByRole('button', { name: 'Configurações do servidor' }).click();
  await pa.getByRole('button', { name: 'Moderação automática', exact: true }).click();
  await pa.getByLabel('Palavras proibidas').fill('bobão, chato*');
  await pa.getByLabel(/Bloquear convites/).check();
  await pa.getByRole('button', { name: 'Salvar moderação' }).click();
  await pa.getByText('Moderação automática salva').waitFor();
  await pa.screenshot({ path: path.join(shots, 'moderacao-automatica.png') });
  const saved = await api(`/guilds/${guild.id}/automod`, null, ana.token);
  assert(saved.automod.words.includes('chato*') && saved.automod.blockInvites, 'configuração salva');
  step('interface: configurar a moderação automática');

  // service worker das notificações + painel no celular
  const sw = await fetch(`${BASE}/sw.js`);
  assert(sw.ok && /javascript/.test(sw.headers.get('content-type') ?? '') && /showNotification/.test(await sw.text()), 'service worker servido');
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phoneCtx.addInitScript((t) => localStorage.setItem('resenha.token', t), caio.token);
  const ph = await phoneCtx.newPage();
  ph.on('pageerror', (e) => console.error('[pageerror]', e));
  await ph.goto(`${BASE}/app`);
  await ph.getByRole('button', { name: 'geral' }).first().click();
  await ph.getByRole('button', { name: 'Buscar', exact: true }).click();
  await ph.getByRole('searchbox', { name: 'O que procurar' }).fill('campeonato');
  await ph.keyboard.press('Enter');
  await ph.locator('.side-panel .search-result', { hasText: 'Amanhã tem campeonato' }).waitFor();
  await ph.screenshot({ path: path.join(shots, 'busca-celular.png') });
  await ph.locator('.side-panel .search-result', { hasText: 'Amanhã tem campeonato' }).click();
  await ph.locator('.messages .message.flash', { hasText: 'Amanhã tem campeonato' }).waitFor({ timeout: 8000 });
  step('celular: busca em tela cheia e pula para a mensagem; service worker das notificações no ar');

  console.log('\nTUDO CERTO (Etapa 4)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
