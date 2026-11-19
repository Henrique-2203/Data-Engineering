// Sugestões da comunidade:
//  1. botão direito numa pessoa da call (no quadro ou no nome da lista do canal de voz) abre as opções dela:
//     ver perfil, enviar mensagem, volume e silenciar só para você; quem modera vê também a moderação.
//  2. rolando a conversa para cima aparece uma seta para voltar ao fim, com quantas mensagens novas chegaram.
// Uso: npm run build && node e2e/call-menu-scroll.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3209;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-cms-') },
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
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera' }).first().click();
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  for (const p of [pa, pb]) {
    await p.getByRole('button', { name: 'Sala de voz' }).first().click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }

  // ---------- menu da pessoa na call ----------
  // a Bia (sem cargo) clica com o botão direito no quadro da Ana
  await pb.locator('.tile.user', { hasText: 'Ana' }).click({ button: 'right' });
  const menuB = pb.getByRole('menu', { name: 'Opções de Ana' });
  for (const n of ['Ver perfil', 'Enviar mensagem', 'Silenciar para mim']) await menuB.getByRole('menuitem', { name: n }).or(menuB.getByRole('menuitemcheckbox', { name: n })).waitFor();
  await menuB.getByLabel('Volume de Ana').waitFor();
  assert((await menuB.getByText('Moderação').count()) === 0, 'quem não modera não vê a moderação');
  await menuB.getByRole('menuitemcheckbox', { name: 'Silenciar para mim' }).click();
  const vol = await pb.evaluate(() => JSON.parse(localStorage.getItem('resenha.voiceSettings') || '{}').volumes);
  assert(Object.values(vol ?? {}).includes(0), `silenciar para mim zera o volume dela (${JSON.stringify(vol)})`);
  await menuB.getByRole('menuitemcheckbox', { name: 'Ouvir de novo' }).waitFor();
  await pb.keyboard.press('Escape');
  await menuB.waitFor({ state: 'detached' });
  step('botão direito no quadro da call: ver perfil, mensagem, volume e silenciar só para mim (sem moderação para quem não modera)');

  // a Ana (dona) clica com o botão direito no nome da Bia na lista do canal de voz
  await pa.locator('.voice-participant', { hasText: 'Bia' }).click({ button: 'right' });
  const menuA = pa.getByRole('menu', { name: 'Opções de Bia' });
  await menuA.getByText('Moderação').waitFor();
  for (const n of ['Mover para outro canal…', 'Silenciar na call', 'Ensurdecer na call', 'Tirar da call']) await menuA.getByRole('menuitem', { name: new RegExp(n) }).waitFor();
  await sleep(200);
  await pa.screenshot({ path: path.join(shots, 'call-menu-botao-direito.png') });
  await menuA.getByRole('menuitem', { name: /Ver perfil/ }).click();
  await pa.getByRole('dialog').getByText('@bia').first().waitFor();
  await pa.keyboard.press('Escape');
  step('botão direito no nome da lista do canal de voz: quem modera vê mover, silenciar, ensurdecer e tirar da call; "Ver perfil" abre o perfil');

  // ---------- seta para o fim da conversa ----------
  // mensagens compridas (poucas, para não esbarrar no anti-spam)
  for (let i = 0; i < 24; i++) {
    const r = await api(`/channels/${geral.id}/messages`, { content: `mensagem número ${i}\n- linha a\n- linha b\n- linha c` }, i % 2 ? ana.token : bia.token);
    if (r.status >= 400) {
      await sleep(1500);
      i--;
    }
  }
  await pa.getByText('geral', { exact: true }).first().click();
  await pa.locator('.message', { hasText: 'mensagem número 23' }).waitFor();
  assert((await pa.locator('.to-bottom').count()) === 0, 'no fim da conversa não tem seta');
  await pa.locator('.messages').evaluate((el) => el.scrollTo({ top: 0 }));
  await pa.locator('.to-bottom').waitFor();
  const caio = await reg('caio', 'Caio');
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const sent = await api(`/channels/${geral.id}/messages`, { content: 'chegou agora' }, caio.token);
  assert(sent.status < 400, `mensagem nova enviada (${sent.status} ${sent.error ?? ''})`);
  await pa.locator('.to-bottom', { hasText: '1 nova' }).waitFor({ timeout: 5000 });
  await sleep(200);
  await pa.screenshot({ path: path.join(shots, 'seta-fim-conversa.png') });
  await pa.locator('.to-bottom').click();
  await pa.locator('.to-bottom').waitFor({ state: 'detached' });
  await sleep(700);
  const dist = await pa.locator('.messages').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  assert(dist < 80, `voltou para o fim (${dist}px do fim)`);
  step('rolando para cima aparece a seta; chegou mensagem nova e ela mostra "1 nova"; tocar leva ao fim e a seta some');
  console.log('\nTUDO CERTO (menu da call e seta para o fim)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
