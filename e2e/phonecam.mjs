// Câmera do celular como câmera do computador (QR Code), em teste só para contas liberadas:
//  - o servidor barra quem não tem o recurso e quem não está numa call
//  - PC (ana) na call → Câmera → "Câmera do celular" → QR Code + link
//  - QR de outra conta é recusado; o celular (mesma conta, abre o link já deslogado e entra) vira a câmera
//  - a outra pessoa da call (bia) vê a imagem; o código é de uso único
//  - parar no celular desliga no PC; desligar no PC avisa o celular
// Uso: npm run build && node e2e/phonecam.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3268;
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-phonecam-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
/** fala com o servidor pelo tempo real (como um aparelho qualquer) */
const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.once('ready', () => resolve(s));
    s.once('connect_error', reject);
  });
const ask = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));

async function login(browser, who, opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${who} pageerror]`, e.message));
  return { ctx, page };
}
async function signIn(page, user) {
  await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill(user);
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: /^Entrar$/ }).click();
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => api('/auth/register', { username: u, password: PASS, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const bia = await reg('bia');
  const caio = await reg('caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  await api('/admin/beta', { phonecam: ['ana', 'caio'], open: [] }, equipe.token, 'PUT'); // aqui testa o modo "só a lista"

  // ---------- regras no servidor ----------
  const sBia = await connect(bia.token);
  const r1 = await ask(sBia, 'phonecam:create', {});
  assert(!r1.ok && /não liberado/.test(r1.error), `sem o recurso: ${JSON.stringify(r1)}`);
  const sCaio = await connect(caio.token);
  const r2 = await ask(sCaio, 'phonecam:create', {});
  assert(!r2.ok && /Entre numa call/.test(r2.error), `com o recurso mas fora da call: ${JSON.stringify(r2)}`);
  const r3 = await ask(sBia, 'phonecam:claim', { token: 'qualquercoisa' });
  assert(!r3.ok, 'código inventado não resgata');
  step('o servidor barra quem não tem o recurso, quem não está numa call e códigos inventados');

  // ---------- fluxo de verdade ----------
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const pc = await login(browser, 'pc', { viewport: { width: 1280, height: 860 } });
  await pc.page.goto(`${BASE}/app`);
  await signIn(pc.page, 'ana');
  const obs = await login(browser, 'bia', { viewport: { width: 1280, height: 860 } });
  await obs.page.goto(`${BASE}/app`);
  await signIn(obs.page, 'bia');
  for (const p of [pc.page, obs.page]) {
    await p.getByRole('button', { name: 'Galera' }).first().click();
    await p.getByRole('button', { name: 'Sala de voz' }).click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  step('ana (computador) e bia estão na mesma call');

  // quem não tem o recurso (bia) liga a câmera direto, sem a janela de escolha
  const biaCam = obs.page.getByRole('button', { name: 'Ligar câmera' });
  await biaCam.click();
  assert((await obs.page.getByRole('dialog', { name: 'Câmera' }).count()) === 0, 'sem o recurso o botão Câmera funciona como antes');
  await obs.page.getByRole('button', { name: 'Desligar câmera' }).click();

  // ana: Câmera → escolher o celular → QR Code
  await pc.page.getByRole('button', { name: 'Ligar câmera' }).click();
  const dlg = pc.page.getByRole('dialog', { name: 'Câmera' });
  await dlg.getByRole('button', { name: /Câmera do celular/ }).click();
  await dlg.locator('.cam-qr svg').waitFor({ timeout: 10000 });
  const link = await dlg.locator('a[data-phonecam-link]').getAttribute('href');
  assert(/\/app\?camera=[\w-]{20,}$/.test(link), `link do QR: ${link}`);
  await pc.page.screenshot({ path: `${shots}/phonecam-qr.png` });
  step('janela Câmera → "Câmera do celular" mostra o QR Code e o link');

  // outra conta não consegue resgatar o código
  const token = link.split('camera=')[1];
  const wrong = await ask(sBia, 'phonecam:claim', { token });
  assert(!wrong.ok && /outra conta/.test(wrong.error), `outra conta: ${JSON.stringify(wrong)}`);

  // o celular (mesma conta) abre o link sem estar logado: entra e a câmera liga
  const phone = await login(browser, 'celular', { ...devices['Pixel 7'] });
  await phone.page.goto(link);
  await signIn(phone.page, 'ana');
  await phone.page.getByText(/No ar: esta é a sua câmera/).waitFor({ timeout: 30000 });
  await phone.page.screenshot({ path: `${shots}/phonecam-celular.png` });
  step('celular (mesma conta) abriu o link, entrou e está no ar');

  const sees = (page) =>
    page.waitForFunction(() => [...document.querySelectorAll('.tile.user video')].some((v) => v.videoWidth > 0 && v.readyState >= 2), null, { timeout: 20000 });
  await sees(pc.page);
  await sees(obs.page);
  await dlg.waitFor({ state: 'detached', timeout: 8000 }); // a janela fecha sozinha depois do "Conectado"
  assert(await pc.page.evaluate(() => ![...document.querySelectorAll('.tile.user video')].some((v) => v.classList.contains('mirror'))), 'a imagem do celular não é espelhada no computador');
  await obs.page.screenshot({ path: `${shots}/phonecam-bia-ve.png` });
  step('a bia vê a câmera da ana (que vem do celular); no computador a imagem não é espelhada');

  const again = await ask(sCaio, 'phonecam:claim', { token });
  assert(!again.ok, 'o código é de uso único');
  step('o código não funciona de novo');

  // parar no celular desliga no computador
  await phone.page.getByRole('button', { name: 'Parar' }).click();
  await pc.page.getByRole('button', { name: 'Ligar câmera' }).waitFor({ timeout: 10000 });
  await obs.page.waitForFunction(() => ![...document.querySelectorAll('.tile.user video')].some((v) => v.videoWidth > 0), null, { timeout: 10000 });
  step('parar no celular desliga a câmera na call');

  // de novo, e agora desligar no computador avisa o celular
  await pc.page.getByRole('button', { name: 'Ligar câmera' }).click();
  await pc.page.getByRole('dialog', { name: 'Câmera' }).getByRole('button', { name: /Câmera do celular/ }).click();
  const link2 = await pc.page.locator('a[data-phonecam-link]').getAttribute('href');
  await phone.page.goto(link2);
  await phone.page.getByText(/No ar: esta é a sua câmera/).waitFor({ timeout: 30000 });
  await sees(obs.page);
  await pc.page.getByRole('button', { name: 'Desligar câmera' }).click();
  await phone.page.getByText('A câmera foi desligada no computador.').waitFor({ timeout: 10000 });
  step('desligar no computador avisa o celular');

  // sair da call também derruba a câmera do celular
  await pc.page.getByRole('button', { name: 'Ligar câmera' }).click();
  await pc.page.getByRole('dialog', { name: 'Câmera' }).getByRole('button', { name: /Câmera do celular/ }).click();
  const link3 = await pc.page.locator('a[data-phonecam-link]').getAttribute('href');
  await phone.page.goto(link3);
  await phone.page.getByText(/No ar: esta é a sua câmera/).waitFor({ timeout: 30000 });
  await pc.page.getByRole('button', { name: 'Sair da chamada' }).click();
  await phone.page.getByText(/A câmera foi desligada no computador|O computador/).waitFor({ timeout: 10000 });
  step('sair da call desliga a câmera do celular');

  sBia.close();
  sCaio.close();
  console.log('\nTudo certo com a câmera do celular.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
