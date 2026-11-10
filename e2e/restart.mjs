// Atualização no meio da call: o servidor reinicia (como num deploy do Render) e a voz não pode cair.
// As conexões de voz são diretas entre os aparelhos: elas continuam tocando enquanto o app reconecta,
// e só são trocadas quando as novas ficam prontas.
// Uso: npm run build && node e2e/restart.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3185;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = tempDir('resenha-restart-');
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
let server;
function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
}
async function waitServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('servidor não subiu');
}
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
  startServer();
  await waitServer();
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 3000 }).catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);

  /** a voz da Ana chegando na Bia: algum <audio> com faixa ao vivo recebendo pacotes */
  const liveAudio = () =>
    pb.evaluate(() =>
      [...document.querySelectorAll('audio')].filter((a) => {
        const t = a.srcObject?.getAudioTracks?.()[0];
        return t && t.readyState === 'live' && !t.muted;
      }).length,
    );
  for (let i = 0; i < 40 && !(await liveAudio()); i++) await sleep(250);
  assert((await liveAudio()) === 1, 'Bia ouve a Ana antes da atualização');

  // ---------- "deploy": o servidor cai ----------
  server.kill('SIGTERM');
  await pb.getByText(/O Resenha está se atualizando|Reconectando/).waitFor({ timeout: 10000 });
  const during = [];
  for (let i = 0; i < 8; i++) {
    during.push(await liveAudio());
    await sleep(250);
  }
  assert(during.every((n) => n === 1), `a voz continua com o servidor fora do ar (${during.join(',')})`);
  step('com o servidor fora do ar, a voz entre os dois continua (aviso: "O Resenha está se atualizando")');

  // ---------- servidor novo ----------
  startServer();
  await waitServer();
  await pb.getByText(/O Resenha está se atualizando|Reconectando/).waitFor({ state: 'detached', timeout: 20000 });
  const after = [];
  for (let i = 0; i < 60; i++) {
    after.push(await liveAudio());
    await sleep(250);
  }
  assert(after.every((n) => n >= 1), `a voz não cai durante a troca (${after.join(',')})`);
  assert(after.slice(-8).every((n) => n === 1), `no fim fica só a conexão nova, sem áudio dobrado (${after.slice(-8).join(',')})`);
  await pa.getByText('Voz conectada').waitFor();
  await pb.locator('.tile', { hasText: 'Ana' }).first().waitFor();
  step('servidor de volta: as duas reentram sozinhas, a conexão nova assume e a antiga é fechada (sem cortar e sem áudio dobrado)');
  console.log('\nTUDO CERTO (atualização no meio da call)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}
