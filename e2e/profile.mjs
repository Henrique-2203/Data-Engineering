// Teste do perfil social: foto (inclusive GIF), banner, bio, pronomes, links, status com prazo,
// "Jogando agora", cartão de perfil e privacidade. Uso: npm run build && node e2e/profile.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const PORT = 3135;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-profile-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

/** GIF animado mínimo (2 quadros 1x1) — para testar foto de perfil animada. */
function tinyGif() {
  const frame = (color) => [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0x02, 0x44, color, 0x00];
  return Buffer.from([
    ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0,
    0xff, 0, 0, 0, 0xff, 0,
    0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00,
    ...frame(0x01), ...frame(0x51), 0x3b,
  ]);
}

let browser;
const sockets = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana' });
  const bia = await api('/auth/register', { username: 'bia', password: 'segredo123', displayName: 'Bia' });
  const caio = await api('/auth/register', { username: 'caio', password: 'segredo123', displayName: 'Caio' });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  await pa.getByPlaceholder('Conversar em #geral').fill('oi galera');
  await pa.keyboard.press('Enter');
  await pb.getByText('oi galera').waitFor();

  // imagens geradas no navegador
  const img = (w, h, color) =>
    pa.evaluate(
      async ({ w, h, color }) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, color);
        grd.addColorStop(1, '#111');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        return Array.from(new Uint8Array(await b.arrayBuffer()));
      },
      { w, h, color },
    );
  const tmp = tempDir('resenha-pimg-');
  const avatarFile = path.join(tmp, 'foto.png');
  const gifFile = path.join(tmp, 'animada.gif');
  const bannerFile = path.join(tmp, 'banner.png');
  writeFileSync(avatarFile, Buffer.from(await img(1000, 800, '#f97316')));
  writeFileSync(bannerFile, Buffer.from(await img(2400, 900, '#8b5cf6')));
  writeFileSync(gifFile, tinyGif());

  // ---- editar perfil ----
  await pa.getByRole('button', { name: 'Configurações', exact: true }).click();
  await pa.getByRole('navigation', { name: 'Categorias' }).getByRole('button', { name: 'Perfil', exact: true }).click();
  const inputs = pa.locator('.profile-editor-preview input[type=file]');
  await inputs.nth(0).setInputFiles(avatarFile);
  await pa.getByText(/Foto atualizado \(\d+ KB\)/).waitFor({ timeout: 10000 });
  await inputs.nth(1).setInputFiles(bannerFile);
  const bannerMsg = await pa.getByText(/Banner atualizado \(\d+ KB\)/).textContent({ timeout: 10000 });
  await pa.getByLabel('Pronomes').fill('ela/dela');
  await pa.getByLabel(/^Bio/).fill('Main Sage no Valorant 💚');
  await pa.getByRole('button', { name: 'Adicionar link' }).click();
  await pa.getByLabel('Tipo de link').selectOption('twitch');
  await pa.getByLabel('Endereço do link').fill('https://twitch.tv/ana');
  await pa.getByRole('button', { name: 'Salvar perfil' }).click();
  await pa.getByText('Perfil salvo.').waitFor();
  await pa.screenshot({ path: `${shots}/23-editar-perfil.png` });
  await pa.getByRole('button', { name: 'Fechar' }).click();
  // a Bia vê a foto nova na lista de membros e no chat, sem recarregar
  await pb.locator('.members .member', { hasText: 'Ana' }).locator('img.avatar-img').waitFor({ timeout: 5000 });
  await pb.locator('.message', { hasText: 'oi galera' }).locator('img.avatar-img').waitFor();
  step(`foto e banner enviados comprimidos (${bannerMsg}); a Bia vê a foto nova em tempo real`);

  // GIF animado mantém a animação (vai como está)
  await pa.getByRole('button', { name: 'Configurações', exact: true }).click();
  await pa.getByRole('navigation', { name: 'Categorias' }).getByRole('button', { name: 'Perfil', exact: true }).click();
  await pa.locator('.profile-editor-preview input[type=file]').nth(0).setInputFiles(gifFile);
  await pa.getByText(/Foto atualizado/).waitFor({ timeout: 10000 });
  const gifType = await pb.waitForFunction(async () => {
    const el = document.querySelector('.members .member img.avatar-img');
    if (!el) return null;
    const r = await fetch(el.src);
    return r.headers.get('content-type') === 'image/gif' ? 'image/gif' : null;
  }, null, { timeout: 5000 });
  step(`foto de perfil em GIF aceita e servida como ${await gifType.jsonValue()} (animação preservada)`);
  await pa.getByRole('button', { name: 'Fechar' }).click();

  // ---- status ----
  await pa.getByRole('button', { name: 'Meu perfil e status' }).click();
  await pa.getByLabel('Texto do status').fill('rankeando até 23h');
  await pa.getByLabel('Escolher emoji do status').click();
  await pa.getByRole('button', { name: 'Reagir com 🎮' }).click();
  await pa.getByRole('button', { name: 'Salvar status' }).click();
  await pa.getByText('Status salvo.').waitFor();
  await pb.locator('.members .member', { hasText: 'Ana' }).getByText('🎮 rankeando até 23h').waitFor({ timeout: 5000 });
  step('status com emoji aparece para a Bia embaixo do nome da Ana');

  // ---- "Jogando agora" (o app de desktop manda o jogo; aqui simulamos o envio) ----
  const s = io(BASE, { auth: { token: ana.token }, transports: ['websocket'] });
  sockets.push(s);
  await new Promise((r) => s.on('ready', r));
  s.emit('activity:set', { name: 'Valorant' });
  await pb.locator('.members .member', { hasText: 'Ana' }).getByText('🎮 Jogando Valorant').waitFor({ timeout: 5000 });
  step('"Jogando Valorant" aparece para a Bia (tem prioridade sobre o status)');

  // ---- cartão de perfil (clicando no nome no chat) ----
  await pb.locator('.message', { hasText: 'oi galera' }).getByRole('button', { name: 'Ana', exact: true }).click();
  const card = pb.locator('.profile-modal');
  await card.getByText('Main Sage no Valorant 💚').waitFor({ timeout: 5000 });
  await card.getByText('ela/dela', { exact: false }).waitFor();
  await card.getByText('Jogando Valorant').waitFor();
  await card.getByRole('link', { name: /Twitch/ }).waitFor();
  await card.getByText(/1 servidor em comum: Galera/).waitFor();
  await card.getByText('rankeando até 23h').waitFor();
  await pb.screenshot({ path: `${shots}/24-cartao-perfil.png` });
  step('cartão de perfil: banner, foto, bio, pronomes, link, status, jogo e servidor em comum');

  s.emit('activity:set', { name: null });
  await pb.locator('.members .member', { hasText: 'Ana' }).getByText('🎮 rankeando até 23h').waitFor({ timeout: 5000 });
  step('ao fechar o jogo, volta a mostrar o status');

  // ---- privacidade ----
  const spy = await api(`/users/${ana.user.id}/profile`, null, caio.token);
  if (spy.status !== 404) throw new Error(`desconhecido viu o perfil (${spy.status})`);
  const bad = await api('/me', { links: [{ type: 'site', url: 'javascript:alert(1)' }] }, ana.token, 'PATCH');
  if (bad.status !== 400) throw new Error('link inseguro foi aceito');
  step('quem não tem nada em comum não vê o perfil; links precisam ser https');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  sockets.forEach((x) => x.disconnect());
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
