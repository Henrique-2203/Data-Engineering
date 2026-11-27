// Captura as telas reais da câmera do celular (QR Code) no ambiente de teste, com fotos de amigos como "câmera".
// Antes: gerar os .y4m das fotos (ffmpeg -loop 1 -i promo/qrcam/assets/face-kevin.png -t 4 -r 15 -pix_fmt yuv420p promo/qrcam/assets/face-kevin.y4m, idem henrique).
// Uso: npm run build && node promo/qrcam/capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3290, BASE = `http://localhost:${PORT}`, PASS = 'Cor-Forte-Xis-42';
const out = path.resolve('promo/qrcam/shots'), assets = path.resolve('promo/qrcam/assets');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-qrcam-'), PLATFORM_ADMINS: 'equipe' }, stdio: ['ignore', 'ignore', 'pipe'] });
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const launch = (face) => chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${assets}/face-${face}.y4m`] });
async function signIn(page, user) {
  await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill(user);
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: /^Entrar$/ }).click();
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
}
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(500); }
  const reg = (u, d) => api('/auth/register', { username: u, password: PASS, displayName: d, acceptTerms: true });
  const kevin = await reg('kevin', 'Kevin'), henrique = await reg('henrique', 'Henrique');
  const { guild } = await api('/guilds', { name: 'LOLZIN MOBILE' }, kevin.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, henrique.token);
  const bK = await launch('kevin'), bH = await launch('henrique');
  const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
  const pcCtx = await bK.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const pc = await pcCtx.newPage(); await pc.goto(`${BASE}/app`); await signIn(pc, 'kevin');
  const hCtx = await bH.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const hp = await hCtx.newPage(); await hp.goto(`${BASE}/app`); await signIn(hp, 'henrique');
  for (const p of [pc, hp]) { await p.getByRole('button', { name: 'LOLZIN MOBILE' }).first().click(); await p.getByRole('button', { name: 'Sala de voz' }).click(); await p.getByText('Voz conectada').waitFor({ timeout: 15000 }); }
  // Henrique liga a câmera dele (rosto dele)
  await hp.getByRole('button', { name: 'Ligar câmera' }).click(); await hp.getByRole('button', { name: /Câmera do computador/ }).click({ timeout: 4000 }).catch(() => {});
  await sleep(1500); await shot(pc, '1-call-antes');
  await pc.getByRole('button', { name: 'Ligar câmera' }).click();
  await pc.getByRole('dialog', { name: 'Câmera' }).waitFor(); await sleep(400); await shot(pc, '2-escolha');
  await pc.getByRole('dialog', { name: 'Câmera' }).getByRole('button', { name: /Câmera do celular/ }).click();
  await pc.locator('.cam-qr svg').waitFor(); await sleep(500); await shot(pc, '3-qrcode');
  const link = await pc.locator('a[data-phonecam-link]').getAttribute('href');
  // nas capturas o link aparece com o endereço oficial (o QR Code é só ilustração)
  await pc.evaluate(() => { const a = document.querySelector('a[data-phonecam-link]'); if (a) a.textContent = 'https://resenhabr.com.br/app?camera=' + a.textContent.split('camera=')[1]; });
  await sleep(200); await shot(pc, '3-qrcode');
  const bP = await launch('kevin');
  const phCtx = await bP.newContext({ ...devices['Pixel 7'] });
  const phone = await phCtx.newPage(); await phone.goto(link); await signIn(phone, 'kevin');
  await phone.getByText(/No ar: esta é a sua câmera/).waitFor({ timeout: 30000 }); await sleep(1200); await shot(phone, '4-celular-no-ar');
  await sleep(2500); await shot(pc, '5-call-com-celular'); await shot(hp, '6-henrique-ve');
  console.log('capturas em', out);
  await bK.close(); await bH.close(); await bP.close();
} catch (e) { console.error(e); process.exitCode = 1; } finally { server.kill(); }
