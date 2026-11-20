// Chat privado da call: só quem está na call vê, nada fica salvo e some quando a call acaba.
// Uso: npm run build && node e2e/call-private-chat.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-callchat-') },
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
const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
const emit = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));

let browser;
let spy;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const sala = guild.channels.find((c) => c.type === 'voice').id;
  await api(`/guilds/${guild.id}/automod`, { words: ['palavrafeia'] }, ana.token, 'PUT');

  // Caio está no servidor mas NÃO está na call: fica "escutando" pelo socket
  spy = await connect(caio.token);
  const leaked = [];
  spy.on('callchat:message', (m) => leaked.push(m));

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    await ctx.route('https://www.youtube-nocookie.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body>player</body>' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  const join = async (page) => {
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    const btn = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  };
  await join(pa);
  await join(pb);

  // ---------- conversa privada ----------
  await pa.getByRole('button', { name: /Abrir o chat da call/ }).click();
  await pa.getByRole('tab', { name: /Só da call/ }).waitFor();
  assert((await pa.getByRole('tab', { name: /Só da call/ }).getAttribute('aria-selected')) === 'true', 'abre no chat privado');
  await pa.getByText('Só quem está na call vê. Nada fica salvo').waitFor();
  const box = pa.getByLabel('Mensagem só para quem está na call');
  await box.fill('segredo da call 🤫');
  await box.press('Enter');
  await pa.locator('.call-private-list').getByText('segredo da call').waitFor();
  // a Bia vê o aviso de mensagem nova no botão e a mensagem ao abrir
  await pb.getByRole('button', { name: /Abrir o chat da call \(1 nova\)/ }).waitFor({ timeout: 5000 });
  await pb.getByRole('button', { name: /Abrir o chat da call/ }).click();
  await pb.locator('.call-private-list').getByText('segredo da call').waitFor();
  await pb.locator('.call-private-list').getByText('Ana', { exact: true }).waitFor();
  step('mensagem no chat privado chega para quem está na call (com aviso de mensagem nova)');

  // quem não está na call não recebe, não consegue ler e não consegue mandar
  await sleep(500);
  assert(!leaked.length, 'quem está fora da call não recebe as mensagens');
  const got = await emit(spy, 'callchat:get', {});
  assert(got.messages.length === 0, 'quem está fora da call não lê o que foi conversado');
  const sent = await emit(spy, 'callchat:send', { content: 'oi' });
  assert(!sent.ok && /Entre na call/.test(sent.error), `quem está fora da call não manda (${JSON.stringify(sent)})`);
  const saved = await api(`/channels/${sala}/messages`, null, caio.token);
  assert(!JSON.stringify(saved).includes('segredo da call'), 'nada foi salvo no canal');
  step('quem está fora da call não recebe, não lê e não manda; nada vai para o histórico do canal');

  // moderação automática do servidor vale aqui também
  const boxB = pb.getByLabel('Mensagem só para quem está na call');
  await boxB.fill('isso é palavrafeia');
  await boxB.press('Enter');
  await pb.getByText(/moderação automática/).waitFor({ timeout: 5000 });
  assert(!(await pa.locator('.call-private-list').getByText('palavrafeia').count()), 'mensagem bloqueada não chegou');
  // apagar a própria mensagem some para todo mundo
  await boxB.fill('mensagem errada');
  await boxB.press('Enter');
  await pa.locator('.call-private-list').getByText('mensagem errada').waitFor();
  const mine = pb.locator('.call-private-msg', { hasText: 'mensagem errada' });
  await mine.hover();
  await mine.getByRole('button', { name: 'Apagar mensagem' }).click();
  await pa.locator('.call-private-list').getByText('mensagem errada').waitFor({ state: 'detached' });
  assert(!(await pb.locator('.call-private-msg', { hasText: 'segredo da call' }).getByRole('button', { name: 'Apagar mensagem' }).count()), 'só apaga as suas');
  step('moderação automática vale no chat privado; apagar a própria mensagem some para todos');

  // "Assistir juntos" avisa no chat privado
  await pa.getByRole('button', { name: 'Assistir juntos (YouTube)' }).click();
  await pa.getByLabel('Link do YouTube').fill('https://youtu.be/aaaaaaaaaaa');
  await pa.getByRole('dialog', { name: 'Assistir juntos' }).getByRole('button', { name: 'Assistir juntos' }).click();
  await pb.locator('.call-private-event', { hasText: 'Ana colocou' }).waitFor({ timeout: 5000 });
  await pa.locator('.call-private-event', { hasText: 'Você colocou' }).waitFor();
  await pa.getByRole('button', { name: 'Parar para todos' }).click();
  step('"Assistir juntos" aparece no chat privado ("Ana colocou … para assistir junto")');

  // a aba "Canal" continua sendo o chat salvo do canal de voz
  await pb.getByRole('tab', { name: /Canal/ }).click();
  await pb.getByPlaceholder('Mandar no canal (fica salvo)').fill('isso fica salvo');
  await pb.getByPlaceholder('Mandar no canal (fica salvo)').press('Enter');
  await sleep(800);
  assert(JSON.stringify(await api(`/channels/${sala}/messages`, null, caio.token)).includes('isso fica salvo'), 'aba Canal salva no canal');
  await pb.getByRole('tab', { name: /Só da call/ }).click();
  await pb.screenshot({ path: path.join(shots, 'chat-privado-da-call.png') });
  step('aba "Canal" continua sendo o chat salvo do canal de voz');

  // Caio entra: vê o que foi conversado nesta call; quando todo mundo sai, tudo some
  const pc = await open(caio.token);
  await join(pc);
  await pc.getByRole('button', { name: /Abrir o chat da call/ }).click();
  await pc.locator('.call-private-list').getByText('segredo da call').waitFor();
  for (const p of [pa, pb, pc]) await p.getByRole('button', { name: 'Sair da chamada' }).click();
  await sleep(800);
  await join(pa);
  await pa.getByText('Ninguém escreveu ainda').waitFor({ timeout: 5000 });
  assert(!(await pa.locator('.call-private-list').getByText('segredo da call').count()), 'call acabou: mensagens sumiram');
  step('quem entra vê a conversa desta call; quando todo mundo sai, o chat privado é apagado');

  console.log('\nTUDO CERTO (chat privado da call)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  spy?.close();
  await browser?.close();
  server.kill();
}
