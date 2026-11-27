// No CELULAR/tablet o botão Câmera liga a câmera do próprio aparelho direto: nada de escolher "câmera do celular"
// nem mostrar QR Code (que só faz sentido no computador). No computador a escolha continua aparecendo.
// Uso: npm run build && node e2e/phonecam-mobile.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3314;
const BASE = `http://localhost:${PORT}`;
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-pcmobile-'), PLATFORM_ADMINS: 'equipe' },
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
  const reg = (u) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api('/admin/beta', { phonecam: ['ana'] }, equipe.token, 'PUT');
  const sala = guild.channels.find((c) => c.type === 'voice');
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  const enterCall = async (userAgent) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'], ...(userAgent ? { userAgent } : {}) });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: sala.name, exact: true }).first().click();
    const enter = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await enter.isVisible().catch(() => false)) await enter.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return { page, ctx };
  };

  // computador: a escolha aparece
  const pc = await enterCall();
  await pc.page.getByRole('button', { name: 'Ligar câmera' }).first().click();
  await pc.page.getByRole('dialog', { name: 'Câmera' }).waitFor({ timeout: 5000 });
  assert(await pc.page.getByText('Câmera do celular').isVisible(), 'no computador a escolha "Câmera do celular" aparece');
  step('computador: o botão Câmera pergunta de onde vem a imagem (câmera do computador ou do celular)');
  await pc.ctx.close();

  // celular (iPhone/Android): liga direto, sem escolha e sem QR Code
  for (const [nome, ua] of [['iPhone', devices['iPhone 13'].userAgent], ['Android', devices['Pixel 7'].userAgent]]) {
    const m = await enterCall(ua);
    await m.page.getByRole('button', { name: 'Ligar câmera' }).first().click();
    await m.page.getByRole('button', { name: 'Desligar câmera' }).first().waitFor({ timeout: 8000 });
    assert((await m.page.getByRole('dialog', { name: 'Câmera' }).count()) === 0, `${nome}: não abriu a escolha de câmera`);
    assert((await m.page.getByText(/QR Code/).count()) === 0, `${nome}: nenhum QR Code`);
    await m.ctx.close();
    step(`${nome}: o botão Câmera liga a câmera do aparelho direto (sem escolha e sem QR Code)`);
  }
  console.log('\nTUDO CERTO (câmera no celular)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
