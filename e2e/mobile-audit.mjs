// Revisão do Resenha no celular: tira capturas das telas principais em 390x844 e 360x740 e confere se
// algo sai da tela (rolagem para o lado) ou se botões ficam espremidos.
// Uso: npm run build && node e2e/mobile-audit.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots/mobile');
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-mobile-'), PLATFORM_ADMINS: 'ana' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

/** botões redondos espremidos, coisas para fora da tela e rolagem lateral */
const problems = (page) =>
  page.evaluate(() => {
    const out = [];
    const W = innerWidth;
    if (document.documentElement.scrollWidth > W + 1) out.push(`página rola para o lado (${document.documentElement.scrollWidth}px)`);
    for (const el of document.querySelectorAll('button, a, input, [role=button]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden') continue;
      const label = (el.getAttribute('aria-label') || el.textContent || el.className || '').trim().slice(0, 40);
      if (r.right > W + 1 || r.left < -1) out.push(`fora da tela: "${label}" (${Math.round(r.left)}→${Math.round(r.right)})`);
      if (el.classList.contains('round-btn') && Math.abs(r.width - r.height) > 4) out.push(`botão espremido: "${label}" (${Math.round(r.width)}x${Math.round(r.height)})`);
    }
    return [...new Set(out)].slice(0, 12);
  });

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
  const bia = await reg('bia', 'Felipinho 011 Jaqueta de Couro');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Wild Rift' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  for (let i = 0; i < 6; i++) await api(`/channels/${geral.id}/messages`, { content: i % 2 ? 'bora jogar uma ranqueada mais tarde? tô no ouro ainda kkkk' : 'fechou, chama no grupo 🎮' }, i % 2 ? bia.token : ana.token);
  await api('/me', { callBanner: 'preset:cidade-neon' }, bia.token, 'PATCH');
  await api('/me', { callBanner: 'preset:espaco' }, caio.token, 'PATCH');

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const report = {};
  for (const [dev, name] of [[devices['Pixel 7'], 'pixel7'], [{ ...devices['Galaxy S9+'], viewport: { width: 360, height: 740 } }, 'p360']]) {
    const ctx = await browser.newContext({ ...dev });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    const shot = async (n) => {
      await sleep(500);
      await page.screenshot({ path: path.join(shots, `${name}-${n}.png`) });
      report[`${name}-${n}`] = await problems(page);
    };
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await shot('01-inicio');
    // abre o servidor e o chat
    await page.getByRole('button', { name: /menu|Abrir menu/i }).first().click({ timeout: 2000 }).catch(() => {});
    await shot('02-menu');
    await page.getByRole('button', { name: 'Wild Rift' }).first().click({ timeout: 3000 }).catch(() => {});
    await shot('03-servidor');
    await page.getByText('geral', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    await shot('04-chat');
    // call com 3 pessoas
    const others = [];
    for (const t of [bia.token, caio.token]) {
      const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await c2.addInitScript((x) => localStorage.setItem('resenha.token', x), t);
      const p2 = await c2.newPage();
      await p2.goto(`${BASE}/app`);
      await p2.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
      await p2.getByRole('button', { name: 'Sala de voz' }).first().click();
      await p2.getByText('Voz conectada').waitFor({ timeout: 15000 });
      others.push(c2);
    }
    await page.getByRole('button', { name: /menu|Abrir menu/i }).first().click({ timeout: 2000 }).catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click({ timeout: 5000 });
    await page.getByText('Voz conectada').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1500);
    await shot('05-call');
    for (const c of others) await c.close();
    await page.getByRole('button', { name: 'Sair da chamada' }).click({ timeout: 3000 }).catch(() => {});
    // configurações
    await page.locator('textarea').first().fill('teste de mensagem bem comprida no celular').catch(() => {});
    await shot('06-configuracoes');
    await page.keyboard.press('Escape').catch(() => {});
    await ctx.close();
  }
  console.log(JSON.stringify(report, null, 1));
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
