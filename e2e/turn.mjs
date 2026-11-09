// Teste da economia de cota do TURN: força a conexão pelo TURN (coturn local)
// e confere que a tela chega reduzida e com o aviso "via TURN".
// Requer o coturn instalado (comando `turnserver`). Uso: npm run build && node e2e/turn.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3124;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });

const turn = spawn(
  'turnserver',
  ['-n', '--listening-ip=127.0.0.1', '--relay-ip=127.0.0.1', '--listening-port=3479', '--lt-cred-mech',
    '--user=teste:teste', '--realm=resenha', '--allow-loopback-peers', '--no-tls', '--no-dtls', '--no-cli'],
  { stdio: 'ignore' },
);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-turn-')),
    TURN_URLS: 'turn:127.0.0.1:3479?transport=udp',
    TURN_USERNAME: 'teste',
    TURN_CREDENTIAL: 'teste',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(path, body, token) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // prepara contas e servidor pela API
  const a = await api('/auth/register', { username: 'streamer', password: 'segredo123' });
  const b = await api('/auth/register', { username: 'viewer', password: 'segredo123' });
  const { guild } = await api('/guilds', { name: 'Teste TURN' }, a.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, b.token);

  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
  });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone', 'camera'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.forceTurn', '1');
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    return page;
  };
  const streamer = await open(a.token);
  const viewer = await open(b.token);

  for (const p of [streamer, viewer]) {
    await p.getByRole('button', { name: 'Sala de voz' }).click();
    await p.getByText('Voz conectada').waitFor({ timeout: 10000 });
  }
  await viewer.locator('.tile-badge.turn').waitFor({ timeout: 20000 });
  step('conexão passou pelo TURN e o aviso "via TURN" apareceu');

  await streamer.getByRole('button', { name: 'Transmitir tela' }).click();
  await streamer.locator('.modal select').first().selectOption('1080p60');
  await streamer.getByText('Agora: 1 pessoa via TURN').waitFor({ timeout: 5000 });
  step('janela de transmissão mostra quantas pessoas estão via TURN');
  await streamer.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await viewer.getByRole('button', { name: 'Assistir transmissão' }).click({ timeout: 10000 });
  await viewer.locator('.stream-stats .turn-chip').waitFor({ timeout: 20000 });
  await viewer.waitForTimeout(8000);
  const stats = await viewer.locator('.stream-stats').textContent();
  const height = await viewer.evaluate(() => document.querySelector('.tile.screen video').videoHeight);
  await viewer.screenshot({ path: `${shots}/08-assistindo-via-turn.png` });
  if (height > 720) throw new Error(`esperava no máximo 720p via TURN, chegou ${height}p`);
  step(`tela via TURN chegou reduzida: ${stats}`);

  // desligando a economia, volta para a qualidade cheia
  await streamer.getByRole('button', { name: 'Parar transmissão' }).click();
  await streamer.getByRole('button', { name: 'Transmitir tela' }).click();
  await streamer.getByLabel('Economizar a cota do TURN').uncheck();
  await streamer.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await viewer.waitForFunction(() => (document.querySelector('.tile.screen video')?.videoHeight ?? 0) > 720, null, {
    timeout: 30000,
  });
  step('com a economia desligada, a tela volta para 1080p');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  turn.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
