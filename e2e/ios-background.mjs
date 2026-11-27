// iPhone: ao sair do Safari o iOS pausa o microfone da página. Enquanto a pessoa está fora, os amigos
// veem o microfone dela desligado; ao voltar, o microfone é reaberto se o iOS o encerrou e ela recebe
// um aviso. Simulamos o iPhone (user agent) e a saída/volta (visibilitychange).
// Uso: npm run build && node e2e/ios-background.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3191;
const BASE = `http://localhost:${PORT}`;
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-ios-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token) =>
  (await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => ({}));

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
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  const open = async (token, iphone) => {
    const ctx = await browser.newContext({ ...(iphone ? { userAgent: devices['iPhone 13'].userAgent } : {}), viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'gtcrn' }));
      // deixa o teste "tirar a página da tela" como o iOS faz
      let vis = 'visible';
      Object.defineProperty(document, 'visibilityState', { get: () => vis, configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => vis === 'hidden', configurable: true });
      window.__setVisible = (v) => {
        vis = v ? 'visible' : 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      };
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  };
  const pa = await open(ana.token, true);
  const pb = await open(bia.token, false);
  // a linha da Ana na lista da call, vista pela Bia
  const anaRow = pb.locator('.voice-participant').filter({ hasText: 'Ana' }).first();
  const anaMutedForBia = () => anaRow.locator('.danger-icon').count();
  await sleep(1500);
  assert((await anaMutedForBia()) === 0, 'Ana começa com o microfone ligado');

  // Ana sai do Safari: a Bia vê o microfone dela desligado
  await pa.evaluate(() => window.__setVisible(false));
  for (let i = 0; i < 20 && (await anaMutedForBia()) === 0; i++) await sleep(200);
  assert((await anaMutedForBia()) === 1, 'enquanto a Ana está fora, a Bia vê o microfone dela desligado');
  assert(!(await pa.evaluate(() => window.__resenhaVoice && document.querySelector('[aria-label="Ativar microfone"]'))), 'para a própria Ana, o botão de microfone continua como ela deixou');

  // o iOS encerrou o microfone enquanto ela estava fora; ela volta
  const before = await pa.evaluate(() => {
    const raw = window.__resenhaVoice.rawMic;
    raw.stop();
    return raw.id;
  });
  await sleep(2100);
  await pa.evaluate(() => window.__setVisible(true));
  await pa.getByText('No iPhone, o microfone pausa quando você sai do Safari').waitFor({ timeout: 8000 });
  const after = await pa.evaluate(() => ({ id: window.__resenhaVoice.rawMic?.id, state: window.__resenhaVoice.rawMic?.readyState }));
  assert(after.id && after.id !== before && after.state === 'live', `microfone reaberto ao voltar (${JSON.stringify(after)})`);
  for (let i = 0; i < 20 && (await anaMutedForBia()) === 1; i++) await sleep(200);
  assert((await anaMutedForBia()) === 0, 'ao voltar, a Bia vê o microfone da Ana ligado de novo');
  // o áudio novo chega para a Bia
  const level = await pb.evaluate(async () => {
    let max = 0;
    for (let i = 0; i < 20; i++) {
      const l = await window.__resenhaVoice.inboundAudioLevels();
      max = Math.max(max, ...Object.values(l), 0);
      await new Promise((r) => setTimeout(r, 200));
    }
    return max;
  });
  assert(level > 0.001, `a voz da Ana volta a chegar para a Bia (nível ${level})`);
  step(`iPhone: fora do Safari os amigos veem o microfone desligado; ao voltar o microfone é reaberto, a voz volta (nível ${level.toFixed(3)}) e aparece o aviso`);

  // quem já estava silenciado continua silenciado ao voltar
  await pa.getByRole('button', { name: 'Silenciar microfone' }).first().click();
  await pa.evaluate(() => window.__setVisible(false));
  await sleep(600);
  await pa.evaluate(() => window.__setVisible(true));
  await sleep(1800);
  assert((await anaMutedForBia()) === 1, 'quem estava silenciado continua silenciado ao voltar');
  step('quem já estava silenciado continua silenciado depois de voltar');
  console.log('\nTUDO CERTO (iPhone em segundo plano)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
