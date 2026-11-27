// Anéis de Fundador: só quem teve o apoio CONFIRMADO pela equipe ganha (sem apoio, pendente ou recusado =
// sem anel, mesmo forçando a rota). Começa no Raiz; a pessoa troca entre Raiz, Aurora, Selo ou nenhum, e
// todo mundo vê na hora: chat, lista de membros, perfil e call. Se a equipe recusar depois, o anel some.
// Uso: npm run build && node e2e/aneis.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-aneis-'), PLATFORM_ADMINS: 'equipe' },
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
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api('/admin/apoio', { enabled: true, pixKey: '7d3c2a1b-4e5f-4a6b-8c9d-0e1f2a3b4c5d', name: 'Resenha', city: 'Sao Paulo', deadline: '2026-12-17', minCents: 500, goalSupporters: 10, goalCents: 10000 }, equipe.token, 'PUT');

  const ringOf = async (userId) => (await api(`/users/${userId}/profile`, null, bia.token)).profile.user.ring ?? null;
  const authorRing = async () => {
    const r = await api(`/channels/${geral.id}/messages`, null, bia.token);
    const list = Array.isArray(r) ? r : r.messages ?? Object.values(r).find(Array.isArray);
    return list.filter((m) => m.author?.id === ana.user.id).at(-1)?.author?.ring ?? null;
  };
  await api(`/channels/${geral.id}/messages`, { content: 'bora uma call?' }, ana.token);

  // ---------- sem apoio: sem anel, e a rota recusa ----------
  assert((await ringOf(ana.user.id)) === null, 'sem apoio: sem anel');
  assert((await api('/apoio/ring', { ring: 'raiz' }, ana.token)).status === 403, 'sem apoio: não dá para escolher anel');
  assert((await ringOf(ana.user.id)) === null, 'continua sem anel depois de tentar forçar');
  // pendente (avisou que pagou, equipe ainda não conferiu): ainda sem anel
  await api('/apoio', null, ana.token);
  await api('/apoio/claim', {}, ana.token);
  assert((await api('/apoio', null, ana.token)).me.status === 'pending', 'apoio pendente');
  assert((await api('/apoio/ring', { ring: 'aurora' }, ana.token)).status === 403, 'pendente: não dá para escolher anel');
  assert((await ringOf(ana.user.id)) === null && (await authorRing()) === null, 'pendente: sem anel no perfil nem no chat');
  assert((await api('/apoio/ring', { ring: 'dourado-falso' }, ana.token)).status === 400, 'anel que não existe é recusado');
  step('sem apoio e com apoio pendente: nenhum anel (nem forçando a rota)');

  // ---------- a Bia com o app aberto vê tudo mudar na hora ----------
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token, w = 1280, h = 860) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const pb = await open(bia.token);
  await pb.getByRole('button', { name: 'Galera' }).first().click();
  await pb.getByText('bora uma call?').waitFor();
  const anaMsgRing = (cls) => pb.locator('.message', { hasText: 'bora uma call?' }).locator(`.founder-ring${cls}`);
  assert((await pb.locator('.founder-ring').count()) === 0, 'na tela da Bia, ninguém tem anel');

  // ---------- equipe confirma: anel Raiz aparece sozinho ----------
  await api(`/admin/apoio/${ana.user.id}/confirm`, { amountCents: 1000 }, equipe.token);
  assert((await ringOf(ana.user.id)) === 'raiz', 'confirmado: começa com o Raiz');
  assert((await authorRing()) === 'raiz', 'o anel vem junto do autor da mensagem');
  await anaMsgRing('.fr-raiz').waitFor({ timeout: 5000 });
  assert((await ringOf(bia.user.id)) === null, 'a Bia (que não apoiou) continua sem anel');
  assert((await api('/apoio/ring', { ring: 'selo' }, bia.token)).status === 403, 'a Bia não consegue pegar um anel');
  step('equipe confirma o apoio: o anel Raiz aparece na hora no chat de quem está com o app aberto');

  // ---------- a Ana escolhe na janela de apoio ----------
  const pa = await open(ana.token);
  await pa.getByRole('button', { name: 'Apoie o Resenha' }).click();
  const dlg = pa.getByRole('dialog', { name: 'Apoie o Resenha 💚' });
  const picker = dlg.getByRole('group', { name: 'Anel de Fundador' });
  await picker.getByRole('button', { name: /Raiz/, pressed: true }).waitFor();
  await picker.getByRole('button', { name: /Aurora/ }).click();
  await picker.getByRole('button', { name: /Aurora/, pressed: true }).waitFor();
  await anaMsgRing('.fr-aurora').waitFor({ timeout: 5000 });
  assert((await ringOf(ana.user.id)) === 'aurora', 'Aurora salvo');
  await sleep(300);
  await dlg.screenshot({ path: path.join(shots, 'aneis-escolher.png') });
  await picker.getByRole('button', { name: /Selo/ }).click();
  await anaMsgRing('.fr-selo').waitFor({ timeout: 5000 });
  await picker.getByRole('button', { name: /Nenhum/ }).click();
  await pb.waitForFunction(() => !document.querySelector('.message .founder-ring'));
  assert((await ringOf(ana.user.id)) === null, 'Nenhum: sem anel');
  await picker.getByRole('button', { name: /Raiz/ }).click();
  await anaMsgRing('.fr-raiz').waitFor({ timeout: 5000 });
  await pa.keyboard.press('Escape');
  step('a pessoa troca entre Raiz, Aurora, Selo e Nenhum na janela de apoio, e os outros veem na hora');

  // ---------- lista de membros e perfil ----------
  await pb.locator('.member', { hasText: 'Ana' }).first().locator('.founder-ring.fr-raiz').waitFor({ timeout: 5000 }).catch(async () => {
    await pb.locator('.members-list, .member-list, aside').locator('.founder-ring.fr-raiz').first().waitFor({ timeout: 3000 });
  });
  await sleep(400);
  await pb.screenshot({ path: path.join(shots, 'aneis-chat.png') });
  step('o anel aparece na lista de membros e no chat');

  // ---------- recusado depois: o anel some ----------
  await api('/apoio/ring', { ring: 'selo' }, ana.token);
  await anaMsgRing('.fr-selo').waitFor({ timeout: 5000 });
  await api(`/admin/apoio/${ana.user.id}/reject`, {}, equipe.token);
  await pb.waitForFunction(() => !document.querySelector('.founder-ring'));
  assert((await ringOf(ana.user.id)) === null && (await authorRing()) === null, 'recusado: anel some de todo lugar');
  assert((await api('/apoio/ring', { ring: 'raiz' }, ana.token)).status === 403, 'recusado: não escolhe mais');
  // confirmado de novo: volta o que ela tinha escolhido
  await api(`/admin/apoio/${ana.user.id}/confirm`, {}, equipe.token);
  assert((await ringOf(ana.user.id)) === 'selo', 'confirmado de novo: volta o Selo que ela tinha escolhido');
  step('se a equipe recusar o apoio, o anel some na hora de todo lugar (e volta se confirmar de novo)');

  // ---------- na call ----------
  for (const p of [pa, pb]) {
    await p.getByRole('button', { name: 'Sala de voz' }).first().click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  await pb.locator('.tile.user', { hasText: 'Ana' }).locator('.founder-ring.fr-selo').waitFor({ timeout: 10000 });
  assert((await pb.locator('.tile.user', { hasText: 'Bia' }).locator('.founder-ring').count()) === 0, 'na call, a Bia (sem apoio) não tem anel');
  await sleep(500);
  await pb.screenshot({ path: path.join(shots, 'aneis-call.png') });
  step('na call, o anel aparece em volta da foto de quem é Fundador (e só dela)');

  // ---------- celular: a janela de escolha cabe na tela ----------
  const pm = await open(ana.token, 390, 844);
  await pm.getByRole('button', { name: 'Suporte' }).first().waitFor({ timeout: 8000 }).catch(() => {});
  await pm.screenshot({ path: path.join(shots, 'aneis-celular-inicio.png') });
  await pm.getByRole('button', { name: 'Apoie o Resenha' }).first().click({ timeout: 5000 });
  const dm = pm.getByRole('dialog', { name: 'Apoie o Resenha 💚' });
  {
    await dm.getByRole('group', { name: 'Anel de Fundador' }).scrollIntoViewIfNeeded();
    const over = await pm.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!over, 'no celular, nada sai da tela');
    await pm.screenshot({ path: path.join(shots, 'aneis-celular.png') });
    step('no celular a escolha do anel cabe na tela');
  }
  console.log('\nTUDO CERTO (anéis de Fundador)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
