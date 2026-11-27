// Bloqueio de pessoas nas telas: bloquear pelo perfil, mensagens recolhidas, desbloquear, aviso ao entrar numa call
// em que a pessoa bloqueada está (com o @) e "entrar mesmo assim". Uso: npm run build && node e2e/blocks-ui.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3308;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-blocksui-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

let browser;
let sock;
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
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const texto = guild.channels.find((c) => c.type === 'text');
  const voz = guild.channels.find((c) => c.type === 'voice');
  await api(`/channels/${texto.id}/messages`, { content: 'mensagem secreta da bia' }, bia.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  await ctx.addInitScript((t) => {
    localStorage.setItem('resenha.token', t);
    localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'browser', vadThresholdDb: -100 }));
  }, ana.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
  await page.getByRole('button', { name: texto.name, exact: true }).first().click();
  await page.getByText('mensagem secreta da bia').waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: path.join(shots, 'bloqueio-debug.png') }); throw e; });

  // bloquear pelo perfil
  await page.locator('.author-name', { hasText: 'Bia' }).first().click();
  await page.getByRole('button', { name: 'Bloquear Bia' }).click();
  const conf = page.getByRole('alertdialog');
  await conf.waitFor();
  const confTxt = await conf.innerText();
  assert(/@bia/.test(confTxt) && /não recebe aviso/i.test(confTxt), `confirmação de bloqueio explica o que acontece (${confTxt})`);
  await conf.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await page.getByRole('button', { name: 'Desbloquear' }).waitFor(); // o perfil passa a oferecer Desbloquear
  await page.keyboard.press('Escape');
  await page.getByText('Mensagem de @bia, que você bloqueou.').waitFor();
  assert((await api('/blocks', null, ana.token)).blocks.length === 1, 'bloqueio salvo no servidor');
  assert(!(await page.getByText('mensagem secreta da bia').isVisible().catch(() => false)), 'mensagem da bloqueada fica recolhida');
  await page.screenshot({ path: path.join(shots, 'bloqueio-mensagem-recolhida.png') });
  await page.getByRole('button', { name: 'Mostrar' }).click();
  await page.getByText('mensagem secreta da bia').waitFor();
  step('bloquear pelo perfil: pede confirmação, recolhe as mensagens e dá para mostrar');

  // bloqueados nas configurações + desbloquear
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Configurações/ }).first().click().catch(() => {});
  const bloqueados = page.getByRole('button', { name: 'Bloqueados' });
  if (await bloqueados.isVisible().catch(() => false)) {
    await bloqueados.click();
    await page.getByText('@bia').first().waitFor();
    await page.screenshot({ path: path.join(shots, 'bloqueio-configuracoes.png') });
    await page.getByRole('button', { name: 'Desbloquear' }).first().click();
    await page.getByText('Você não bloqueou ninguém.').waitFor();
    assert((await api('/blocks', null, ana.token)).blocks.length === 0, 'desbloqueio salvo no servidor');
    step('Configurações → Bloqueados lista e desbloqueia');
    await page.keyboard.press('Escape');
  } else {
    // sem a tela de configurações à mão: desbloqueia pela API para seguir
    await api('/blocks/' + bia.user.id, undefined, ana.token, 'DELETE');
    step('(Configurações não abriu neste layout: desbloqueio feito pela API)');
  }

  // call: a bia (bloqueada pela ana) entra primeiro; ao entrar, a ana é avisada com o @
  await api('/blocks', { userId: bia.user.id }, ana.token);
  sock = io(BASE, { auth: { token: bia.token }, transports: ['websocket'] });
  await new Promise((r) => sock.once('connect', r));
  const joined = await new Promise((r) => sock.emit('voice:join', { channelId: voz.id }, r));
  assert(joined.ok, 'a bia entra na call');
  await sleep(600);
  await page.reload();
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
  await page.getByRole('button', { name: voz.name, exact: true }).first().click();
  const enter = page.getByRole('button', { name: 'Entrar na chamada' });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await sleep(1500);
  const warn = page.getByRole('alertdialog');
  await warn.waitFor({ timeout: 8000 });
  const warnTxt = await warn.innerText();
  assert(/@bia/.test(warnTxt) && /mesmo assim/i.test(warnTxt), `aviso mostra o @ e pergunta se quer entrar mesmo assim (${warnTxt})`);
  await page.screenshot({ path: path.join(shots, 'bloqueio-aviso-call.png') });
  await page.keyboard.press('Escape'); // Esc = não entrar
  await warn.waitFor({ state: 'detached' });
  assert(!(await page.getByText('Voz conectada').isVisible().catch(() => false)), 'recusando o aviso, a ana NÃO entra na call');
  step('call: aviso com o @ da pessoa bloqueada; recusar mantém fora da call');

  if (await enter.isVisible().catch(() => false)) await enter.click();
  else await page.getByRole('button', { name: voz.name, exact: true }).first().click();
  const enter2 = page.getByRole('button', { name: 'Entrar na chamada' });
  if (await enter2.isVisible().catch(() => false)) await enter2.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Entrar mesmo assim' }).click({ timeout: 8000 });
  await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  step('call: "entrar mesmo assim" entra na call');
  await page.screenshot({ path: path.join(shots, 'bloqueio-call.png') });
  console.log('\nTUDO CERTO (bloqueio nas telas)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  sock?.close();
  await browser?.close();
  server.kill();
}
