// Qualidade por pessoa: cada um escolhe em que qualidade assiste a transmissão (Automático, Original,
// 720p, 480p), sem mudar nada para os outros. No automático, o Resenha desce só para quem está com a
// internet sofrendo; quem escolheu "Original" e está sofrendo recebe uma sugestão.
// Uso: npm run build && node e2e/stream-quality.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-quality-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
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
  const users = [await reg('ana', 'Ana'), await reg('bia', 'Bia'), await reg('caio', 'Caio'), await reg('duda', 'Duda')];
  const { guild } = await api('/guilds', { name: 'Galera' }, users[0].token);
  for (const u of users.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  async function open(token, { turbo = true, streamer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, turboOn]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: turboOn, noiseMode: 'browser', screenPreset: '1080p30', performanceMode: false, codec: 'vp8' }));
        // "internet ruim" de mentira: quem assiste conta para quem transmite que só consegue mostrar 5 FPS
        const send = RTCDataChannel.prototype.send;
        RTCDataChannel.prototype.send = function (data) {
          if (window.__slow && typeof data === 'string' && data.includes('"t":"st"')) data = JSON.stringify({ t: 'st', fps: 5 });
          return send.call(this, data);
        };
      },
      [token, turbo],
    );
    if (streamer) {
      // "tela" 1080p a 30 FPS (muda todo quadro, como um jogo)
      await ctx.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const c = document.createElement('canvas');
          c.width = 1920;
          c.height = 1080;
          const g = c.getContext('2d');
          let n = 0;
          const draw = () => {
            n++;
            g.fillStyle = `hsl(${(n * 3) % 360} 70% 40%)`;
            g.fillRect(0, 0, 1920, 1080);
            g.fillStyle = '#fff';
            g.font = 'bold 160px sans-serif';
            g.fillText(String(n), 100 + ((n * 7) % 1400), 560);
          };
          setInterval(draw, 1000 / 30);
          draw();
          return c.captureStream(30);
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  }

  const ana = await open(users[0].token, { streamer: true });
  const bia = await open(users[1].token);
  const caio = await open(users[2].token);
  const duda = await open(users[3].token, { turbo: false }); // assiste pelo modo normal (WebRTC)

  await ana.getByRole('button', { name: 'Transmitir tela' }).click();
  await ana.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await ana.getByText('Sua tela').waitFor({ timeout: 15000 });
  for (const v of [bia, caio, duda]) await v.getByRole('button', { name: 'Assistir transmissão' }).click();
  for (const v of [bia, caio, duda]) await v.locator('.tile.screen video').waitFor({ timeout: 15000 });

  const height = (page) => page.locator('.tile.screen video').evaluate((v) => v.videoHeight);
  const waitHeight = async (page, test, label, ms = 15000) => {
    const t0 = Date.now();
    let h = 0;
    while (Date.now() - t0 < ms) {
      h = await height(page);
      if (test(h)) return h;
      await sleep(400);
    }
    throw new Error(`FALHOU: ${label} (altura ${h})`);
  };
  const choose = async (page, label) => {
    await page.locator('.tile.screen').hover();
    await page.locator('.quality-chip').click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).click();
  };

  await waitHeight(bia, (h) => h === 1080, 'Bia começa na original (1080p)');
  await waitHeight(caio, (h) => h === 1080, 'Caio começa na original (1080p)');
  assert(/Auto · 1080p/.test(await bia.locator('.quality-chip').textContent()), 'botão mostra "Auto · 1080p"');
  step('todo mundo começa no Automático, na qualidade original (1080p)');

  // ---------- escolha manual: só muda para quem escolheu ----------
  await choose(bia, '720p');
  await waitHeight(bia, (h) => h === 720, 'Bia passou para 720p');
  await sleep(1500);
  assert((await height(caio)) === 1080, 'Caio continua em 1080p');
  await choose(bia, '480p');
  await waitHeight(bia, (h) => h === 480, 'Bia passou para 480p');
  await choose(caio, '720p');
  await waitHeight(caio, (h) => h === 720, 'Caio passou para 720p');
  assert((await height(bia)) === 480, 'Bia continua em 480p');
  await bia.screenshot({ path: path.join(shots, 'qualidade-por-pessoa.png') });
  // a versão 720p e a 480p são codificadas só enquanto alguém está nelas
  await choose(caio, 'Original');
  await waitHeight(caio, (h) => h === 1080, 'Caio voltou para a original');
  await choose(bia, 'Automático');
  await waitHeight(bia, (h) => h === 1080, 'Bia voltou para o automático (1080p)');
  step('cada um escolhe a sua qualidade (720p, 480p, Original, Automático) sem mudar a dos outros');

  // ---------- modo normal (WebRTC): a pessoa recebe menor só para ela ----------
  await choose(duda, '480p');
  await waitHeight(duda, (h) => h > 0 && h <= 480, 'Duda (modo normal) recebe 480p', 20000);
  assert((await height(bia)) === 1080, 'Bia continua em 1080p');
  step('modo normal (sem turbo) também respeita a qualidade escolhida, só para quem escolheu');

  // ---------- automático: a internet da Bia piora -> desce só para ela ----------
  await bia.evaluate(() => (window.__slow = true));
  await sleep(3000);
  console.log('  quem transmite:', await ana.locator('.send-stats').textContent().catch(() => '?'));
  await waitHeight(bia, (h) => h === 720, 'automático desceu a Bia para 720p', 20000);
  await waitHeight(bia, (h) => h === 480, 'automático desceu a Bia para 480p', 20000);
  assert(/Auto · 480p/.test(await bia.locator('.quality-chip').textContent()), 'botão mostra "Auto · 480p"');
  assert((await height(caio)) === 1080, 'Caio continua em 1080p (a internet dele está boa)');
  step('automático: com a internet da Bia sofrendo, desce para 720p e depois 480p só para ela');
  await bia.evaluate(() => (window.__slow = false));
  await waitHeight(bia, (h) => h === 720, 'automático subiu a Bia de volta para 720p quando a internet melhorou', 45000);
  step('automático: quando a internet melhora, a qualidade sobe de novo (com calma, para não ficar pulando)');

  // ---------- quem escolheu "Original" e está sofrendo: sugestão ----------
  await choose(caio, 'Original');
  await caio.evaluate(() => (window.__slow = true));
  await caio.getByText('Sua internet não está dando conta desta transmissão').waitFor({ timeout: 20000 });
  assert((await height(caio)) === 1080, 'a sugestão não muda nada sozinha');
  await caio.screenshot({ path: path.join(shots, 'qualidade-sugestao.png') });
  await caio.getByRole('button', { name: 'Assistir em 720p' }).click();
  await waitHeight(caio, (h) => h === 720, 'aceitou a sugestão: 720p');
  assert(!(await caio.getByText('Sua internet não está dando conta').count()), 'a sugestão some');
  step('"Original" com a internet sofrendo: o Resenha sugere 720p (e só muda se a pessoa aceitar)');

  console.log('\nTUDO CERTO (qualidade por pessoa)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
