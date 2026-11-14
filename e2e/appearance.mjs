// Aparência: modo claro/escuro/sistema, cor de destaque, fundos e papel de parede (geral, por conversa
// e foto própria, que fica só no aparelho). Tira prints das telas principais no modo claro.
// Uso: npm run build && node e2e/appearance.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = createRequire(path.resolve('server/package.json'))('sharp');
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-appearance-') },
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
    await sleep(400);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text').id;
  await api('/friends', { username: 'bia' }, ana.token);
  await api(`/friends/${ana.user.id}/accept`, {}, bia.token);
  const m1 = await api(`/channels/${geral}/messages`, { content: 'Bom dia, galera! Quem joga hoje à noite? 🎮' }, bia.token);
  await api(`/channels/${geral}/messages`, { content: 'Eu! Entro na call às 21h. @bia leva o fone novo' }, ana.token);
  await api(`/channels/${geral}/messages`, { content: 'Link do clipe: https://exemplo.com/clipe e `código` aqui', replyToId: m1.message?.id }, ana.token);
  await api(`/messages/${m1.message?.id}/reactions`, { emoji: '🔥' }, ana.token, 'PUT').catch(() => {});
  await api(`/channels/${geral}/messages`, { content: '', poll: { question: 'Qual jogo hoje?', options: ['Valorant', 'CS2', 'Minecraft'], hours: 24 } }, bia.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'geral' }).first().click();
  await page.getByText('Qual jogo hoje?').waitFor();

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const cssVar = (v) => page.evaluate((x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim(), v);
  assert((await theme()) === 'dark', 'começa no escuro (como sempre foi)');

  // ---------- Configurações → Aparência ----------
  const openAppearance = async () => {
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('button', { name: 'Aparência' }).click();
  };
  await openAppearance();
  await page.getByRole('radio', { name: 'Claro', exact: true }).click();
  assert((await theme()) === 'light', 'modo claro aplicado na hora');
  assert((await cssVar('--bg-1')) === '#f4f6f9', 'fundo claro');
  await page.getByRole('radio', { name: 'Roxo', exact: true }).click();
  assert((await cssVar('--accent')) === '#6d3fd9', 'cor de destaque roxa (versão do claro)');
  await page.screenshot({ path: path.join(shots, 'aparencia-claro.png') });
  await page.getByRole('radio', { name: 'Seguir o sistema', exact: true }).click();
  await page.getByText(/Agora: (escuro|claro)/).waitFor();
  await page.getByRole('radio', { name: 'Escuro', exact: true }).click();
  await page.getByRole('radio', { name: 'Preto total', exact: true }).click();
  assert(/^#000(000)?$/.test(await cssVar('--bg-1')), 'fundo preto total');
  assert((await cssVar('--accent')) === '#a78bfa', 'roxo na versão do escuro');
  await page.getByRole('radio', { name: 'Meia-noite', exact: true }).click();
  // papel de parede de todos os chats
  await page.getByRole('radio', { name: 'Doodles gamer', exact: true }).click();
  await page.screenshot({ path: path.join(shots, 'aparencia-escuro-papel.png') });
  await page.keyboard.press('Escape');
  await page.locator('.chat .chat-wallpaper').first().waitFor();
  await page.screenshot({ path: path.join(shots, 'chat-papel-de-parede.png') });
  step('Aparência: escuro/claro/sistema, 8 cores de destaque, 3 fundos e papel de parede valem na hora');

  // ---------- recarregar: continua igual (sem piscar) ----------
  await page.reload();
  assert((await theme()) === 'dark' && (await cssVar('--bg-1')) === '#0b1120', 'continua Meia-noite depois de recarregar');
  await page.getByRole('button', { name: 'geral' }).first().click();
  await page.locator('.chat .chat-wallpaper').first().waitFor();
  step('as escolhas ficam guardadas no aparelho');

  // ---------- papel de parede só desta conversa, com foto própria ----------
  const photo = path.join(tempDir('resenha-wp-'), 'foto.jpg');
  writeFileSync(photo, await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#3a6ea5' } }).jpeg().toBuffer());
  await page.getByRole('button', { name: 'Papel de parede desta conversa' }).click();
  const dlg = page.getByRole('dialog', { name: 'Papel de parede desta conversa' });
  await dlg.getByRole('radio', { name: /Só para #geral/ }).click();
  await dlg.getByLabel('Escolher foto para o papel de parede').setInputFiles(photo);
  await dlg.getByText('Trocar foto').waitFor();
  await dlg.getByText('Desfocar').waitFor();
  await dlg.getByRole('button', { name: 'Pronto' }).click();
  const bgImg = await page.locator('.chat .chat-wallpaper-img').first().evaluate((el) => getComputedStyle(el).backgroundImage);
  assert(/^url\("blob:/.test(bgImg), `foto própria vem do próprio aparelho (blob), não do servidor (${bgImg.slice(0, 40)})`);
  // a foto nunca foi enviada: nenhum pedido de upload aconteceu
  step('papel de parede só desta conversa, com foto própria guardada só no aparelho');

  // ---------- ícone do app: no navegador, muda o ícone da aba ----------
  await openAppearance();
  await page.getByRole('radio', { name: 'Ícone Halloween', exact: true }).click();
  const fav = await page.locator('link[rel="icon"]').getAttribute('href');
  assert(fav.startsWith('data:image/svg+xml'), 'ícone da aba trocado');
  await page.reload();
  assert((await page.locator('link[rel="icon"]').getAttribute('href')).startsWith('data:image/svg+xml'), 'continua depois de recarregar');
  await openAppearance();
  await page.getByRole('radio', { name: 'Ícone Halloween', exact: true }).scrollIntoViewIfNeeded();
  await sleep(500);
  await page.screenshot({ path: path.join(shots, 'icones-do-app.png') });
  await page.getByRole('radio', { name: 'Ícone Clássico', exact: true }).click();
  assert((await page.locator('link[rel="icon"]').getAttribute('href')) === '/icon.svg', 'Clássico volta ao ícone original');
  await page.keyboard.press('Escape');
  step('ícone do app: no navegador troca o ícone da aba (e guarda a escolha)');

  // ---------- telas principais no modo claro (para revisar) ----------
  await openAppearance();
  await page.getByRole('radio', { name: 'Claro', exact: true }).click();
  await page.getByRole('radio', { name: 'Verde Resenha', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(shots, 'claro-chat.png') });
  await page.getByRole('button', { name: 'Sala de voz' }).first().click();
  await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(shots, 'claro-call.png') });
  await page.getByRole('button', { name: 'Transmitir tela' }).click();
  await page.screenshot({ path: path.join(shots, 'claro-transmitir.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sair da chamada' }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.screenshot({ path: path.join(shots, 'claro-configuracoes.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'geral' }).first().click();
  await page.getByRole('button', { name: /Perfil de Bia/ }).first().click();
  await page.screenshot({ path: path.join(shots, 'claro-perfil.png') });
  await page.keyboard.press('Escape');
  assert(!errors.length, `sem erros na página (${errors.join(' | ')})`);
  console.log('\nTUDO CERTO (aparência)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
