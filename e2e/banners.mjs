// Banner da call: temas prontos (arte original), imagem enviada e banner do perfil, no quadro da chamada.
// Uso: npm run build && node e2e/banners.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = createRequire(path.resolve('server/package.json'))('sharp');
const PORT = 3187;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-banner-') },
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

  // ---------- API ----------
  assert((await api('/me', { callBanner: 'preset:gta6' }, bia.token, 'PATCH')).status === 400, 'tema que não existe é recusado');
  const set = await api('/me', { callBanner: 'preset:tatico' }, bia.token, 'PATCH');
  assert(set.user.callBanner === 'preset:tatico', 'tema escolhido');
  // imagem enviada (um "print" gerado aqui)
  const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#1d4ed8' } })
    .composite([{ input: Buffer.from('<svg width="1280" height="720"><circle cx="640" cy="360" r="220" fill="#facc15"/></svg>') }])
    .png()
    .toBuffer();
  const up = await (
    await fetch(`${BASE}/api/me/call-banner`, { method: 'POST', headers: { authorization: `Bearer ${caio.token}`, 'content-type': 'image/png' }, body: png })
  ).json();
  assert(up.user?.callBanner?.startsWith('image:'), 'imagem enviada vira o banner');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const noGif = await fetch(`${BASE}/api/me/call-banner`, { method: 'POST', headers: { authorization: `Bearer ${caio.token}`, 'content-type': 'image/gif' }, body: gif });
  assert(noGif.status === 415, 'GIF é recusado (animação pesa na call de todo mundo)');
  assert((await fetch(`${BASE}/api/images/${up.user.callBanner.slice(6)}`)).ok, 'imagem do banner abre');
  step('API: tema pronto, imagem enviada (sem GIF) e tema inexistente recusado');

  // ---------- interface: escolher o tema ----------
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const pa = await open(ana.token);
  await pa.getByRole('button', { name: 'Configurações', exact: true }).click();
  await pa.getByRole('button', { name: 'Perfil', exact: true }).click();
  const editor = pa.getByRole('region', { name: 'Banner da call' });
  await editor.scrollIntoViewIfNeeded();
  await editor.getByRole('radio', { name: 'Cidade Neon' }).click();
  await editor.getByRole('radio', { name: 'Cidade Neon', checked: true }).waitFor();
  await editor.locator('.cb-preview .call-banner svg').first().waitFor();
  await editor.screenshot({ path: path.join(shots, 'banner-da-call-editor.png') });
  assert((await api('/bootstrap', null, ana.token)).user.callBanner === 'preset:cidade-neon', 'escolha salva na conta');
  await pa.keyboard.press('Escape');
  step('interface: escolher o tema com prévia num quadro largo e num estreito');

  // ---------- na call ----------
  const pb = await open(bia.token);
  const pc = await open(caio.token);
  for (const p of [pa, pb, pc]) {
    await p.getByRole('button', { name: 'Sala de voz' }).first().click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  const anaTile = pb.locator('.tile.user', { hasText: 'Ana' });
  await anaTile.locator('.call-banner svg').waitFor({ timeout: 10000 });
  await pb.locator('.tile.user', { hasText: 'Caio' }).locator('.call-banner img').waitFor();
  await pb.locator('.tile.user', { hasText: 'Bia (você)' }).locator('.call-banner svg').waitFor();
  await sleep(500);
  await pb.screenshot({ path: path.join(shots, 'banners-na-call.png') });
  // trocar o tema aparece na hora para os outros
  await api('/me', { callBanner: 'preset:espaco' }, ana.token, 'PATCH');
  await pb.waitForFunction(() => {
    const t = [...document.querySelectorAll('.tile.user')].find((e) => e.textContent?.includes('Ana'));
    return !!t?.querySelector('.call-banner svg radialGradient#es-p');
  });
  await api('/me', { callBanner: 'none' }, ana.token, 'PATCH');
  await anaTile.locator('.call-banner').waitFor({ state: 'detached' });
  step('na call: cada pessoa com o próprio banner (tema ou imagem); trocar aparece na hora para os outros');
  console.log('\nTUDO CERTO (banners da call)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
