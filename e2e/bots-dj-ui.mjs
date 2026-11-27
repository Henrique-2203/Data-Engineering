// DJ do Resenha Bot na tela: só a música (sem o "Assistir juntos" grande), como um participante da call,
// com silenciar/volume só para cada pessoa e a votação para pular no próprio cartão.
// Uso: npm run build && node e2e/bots-dj-ui.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3279;
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-djui-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.10.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  const reg = (u) => api('/auth/register', { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const bia = await reg('bia');
  const caio = await reg('caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api('/admin/beta', { bots: ['ana'] }, equipe.token, 'PUT');
  await api(`/guilds/${guild.id}/bots`, {}, ana.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (user) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`[${user}]`, e.message));
    await page.goto(`${BASE}/app`);
    await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill(user);
    await page.getByLabel('Senha', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: /^Entrar$/ }).click();
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera' }).first().click();
    await page.getByRole('button', { name: 'Sala de voz' }).click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  };
  const A = await open('ana');
  const B = await open('bia');

  // bia pede a música pelo bot
  await sleep(1100);
  const r = await api(`/channels/${geral.id}/interactions`, { command: 'tocar', args: 'https://youtu.be/AAAAAAAAAAA' }, bia.token);
  assert(r.status === 200, `tocar: ${r.status} ${r.error}`);
  for (const [name, page] of [['ana', A], ['bia', B]]) {
    await page.locator('.tile.together.dj').waitFor({ timeout: 10000 });
    assert((await page.getByText('Resenha Bot · DJ').count()) === 1, `${name}: cartão do DJ`);
    assert((await page.locator('.together-controls').count()) === 0, `${name}: sem barra de vídeo (pausar/posição)`);
    assert((await page.locator('.tile.together:not(.dj)').count()) === 0, `${name}: sem o "Assistir juntos" grande`);
    assert((await page.locator('.stage.focused').count()) === 0, `${name}: o DJ não vai para o destaque`);
  }
  // quem pediu a música (bia) ouve sozinha: o player existe, mas é INVISÍVEL (só o som, nunca a imagem do vídeo)
  assert((await B.locator('.tile.together.dj iframe').count()) === 1, 'bia (pediu a música): o player do YouTube está dentro do cartão');
  assert((await B.locator('.tile.together.dj iframe').evaluate((el) => getComputedStyle(el).opacity)) === '0', 'o player do YouTube fica invisível (só áudio)');
  assert((await B.locator('.tile.together.dj iframe').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none', 'o player invisível não recebe cliques');
  // quem NÃO pediu (ana) não ouve nada até escolher: nenhum player carrega
  assert((await A.locator('.tile.together.dj iframe').count()) === 0, 'ana (não pediu): nenhum player do YouTube foi carregado, nada toca');
  await A.getByRole('button', { name: 'Ouvir', exact: true }).waitFor();
  await B.screenshot({ path: `${shots}/dj-cartao.png` });
  await A.screenshot({ path: `${shots}/dj-cartao-ouvir.png` });
  step('o DJ é um cartão só de áudio (player invisível); quem não pediu vê "Ouvir" e nada toca até escolher');

  // o Resenha Bot aparece como participante na lista do canal de voz, para todo mundo (inclusive quem não está na call)
  for (const [name, page] of [['ana', A], ['bia', B]]) {
    assert((await page.locator('.dj-participant').count()) === 1, `${name}: o Resenha Bot aparece na lista do canal de voz`);
  }
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const C = await ctxC.newPage();
  await C.goto(`${BASE}/app`);
  await C.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('caio');
  await C.getByLabel('Senha', { exact: true }).fill(PASS);
  await C.getByRole('button', { name: /^Entrar$/ }).click();
  await C.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
  await C.getByRole('button', { name: 'Galera' }).first().click();
  await C.locator('.dj-participant').waitFor({ timeout: 8000 });
  assert((await C.locator('.tile.together').count()) === 0, 'quem não está na call não vê cartão nem ouve nada');
  step('o Resenha Bot aparece na lista do canal de voz (inclusive para quem está fora da call)');

  // a ana escolhe ouvir -> o player passa a existir (invisível); parar de ouvir volta ao cartão
  await A.getByRole('button', { name: 'Ouvir', exact: true }).click();
  await A.locator('.tile.together.dj iframe').waitFor({ timeout: 8000 });
  assert((await A.locator('.tile.together.dj iframe').evaluate((el) => getComputedStyle(el).opacity)) === '0', 'ana ouvindo: o player também é invisível');
  await A.getByRole('button', { name: 'Parar de ouvir' }).click();
  await A.getByRole('button', { name: 'Ouvir', exact: true }).waitFor();
  assert((await A.locator('.tile.together.dj iframe').count()) === 0, 'parar de ouvir descarrega o player');
  // "ouvir sempre" fica guardado
  await A.getByLabel('Ouvir sempre que o DJ tocar').check();
  assert((await A.evaluate(() => localStorage.getItem('resenha.djAuto'))) === '1', '"ouvir sempre" fica guardado');
  await A.getByLabel('Ouvir sempre que o DJ tocar').uncheck();
  await A.getByRole('button', { name: 'Ouvir', exact: true }).click();
  await A.locator('.tile.together.dj iframe').waitFor({ timeout: 8000 });
  step('cada um escolhe ouvir ou parar de ouvir; a escolha de "ouvir sempre" fica guardada');

  // silenciar só para si
  const muteB = B.getByRole('button', { name: 'Silenciar a música (só para você)' });
  await muteB.click();
  await B.getByRole('button', { name: 'Ativar a música (só para você)' }).waitFor();
  assert((await B.evaluate(() => localStorage.getItem('resenha.djMuted'))) === '1', 'a escolha de silenciar fica guardada');
  assert((await A.getByRole('button', { name: 'Silenciar a música (só para você)' }).count()) === 1, 'a Ana continua ouvindo (silenciar é só para quem clicou)');
  step('silenciar a música vale só para quem clicou e fica guardado');

  // votação para pular pelo cartão: pedido da bia, ana vota (2 pessoas: precisa dos 2; quem pediu pula na hora)
  await A.getByRole('button', { name: 'Pular (votação)' }).click();
  await A.locator('.dj-bar .together-count', { hasText: '1/2' }).waitFor({ timeout: 8000 });
  await B.locator('.dj-bar .together-count', { hasText: '1/2' }).waitFor({ timeout: 8000 });
  step('votar para pular pelo cartão mostra 1/2 para todos');

  // /parar tira o cartão
  await sleep(1100);
  assert((await api(`/channels/${geral.id}/interactions`, { command: 'parar', args: '' }, ana.token)).status === 200, 'a dona não pediu essa música, mas administra: pode parar');
  await A.locator('.tile.together.dj').waitFor({ state: 'detached', timeout: 8000 });
  await B.locator('.tile.together.dj').waitFor({ state: 'detached', timeout: 8000 });
  await C.locator('.dj-participant').waitFor({ state: 'detached', timeout: 8000 });
  step('/parar tira o cartão do DJ da call e o Resenha Bot sai da lista do canal');
  console.log('\nTudo certo com o DJ na tela.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
