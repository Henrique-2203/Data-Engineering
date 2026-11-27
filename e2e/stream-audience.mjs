// Quem pode assistir a minha transmissão (todos / só amigos / só quem eu escolher / todos menos) e a
// janela "Transmitir tela" com o "i" de cada opção.
// Uso: npm run build && node e2e/stream-audience.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-audience-') },
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
let spy;
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
  const eve = await reg('eve', 'Eve');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  for (const u of [bia, caio, eve]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  const sala = guild.channels.find((c) => c.type === 'voice').id;
  // Bia é amiga da Ana; o Caio não
  await api('/friends', { username: 'bia' }, ana.token);
  await api(`/friends/${ana.user.id}/accept`, {}, bia.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  async function open(token, streamer = false) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '720p30', performanceMode: false, codec: 'vp8' }));
    }, token);
    if (streamer) {
      await ctx.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const c = document.createElement('canvas');
          c.width = 1280;
          c.height = 720;
          const g = c.getContext('2d');
          let n = 0;
          setInterval(() => {
            n++;
            g.fillStyle = `hsl(${(n * 3) % 360} 70% 40%)`;
            g.fillRect(0, 0, 1280, 720);
          }, 1000 / 30);
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
  const pa = await open(ana.token, true);
  const pb = await open(bia.token);
  const pc = await open(caio.token);

  // ---------- janela "Transmitir tela": cada opção tem um "i" com a explicação ----------
  await pa.getByRole('button', { name: 'Transmitir tela' }).click();
  const dlg = pa.getByRole('dialog', { name: 'Transmitir tela' });
  for (const label of ['Quem pode assistir', 'Resolução e FPS', 'Transmissão turbo', 'Modo desempenho', 'Som do computador', 'Economizar para quem está no 4G']) {
    await dlg.getByRole('button', { name: `O que é: ${label}` }).waitFor();
  }
  await dlg.getByRole('button', { name: 'O que é: Transmissão turbo' }).click();
  await dlg.getByRole('tooltip').getByText('mesma cópia para todos').waitFor();
  await pa.screenshot({ path: path.join(shots, 'transmitir-tela.png') });
  await pa.keyboard.press('Escape');
  await dlg.getByRole('tooltip').waitFor({ state: 'detached' });
  assert(await dlg.isVisible(), 'Esc fecha só o balão, não a janela');
  assert(!(await dlg.getByText('Bitrate máximo').isVisible()), 'opções avançadas ficam guardadas em "Avançado"');
  await dlg.getByText('Avançado').click();
  await dlg.getByText('Bitrate máximo').waitFor();
  await dlg.getByRole('button', { name: 'O que é: Codec' }).waitFor();
  step('janela "Transmitir tela": essencial à vista, "Avançado" guardado, e um "i" explicando cada opção (Esc fecha só o balão)');

  // ---------- só amigos ----------
  await dlg.getByRole('radio', { name: 'Só amigos' }).click();
  await dlg.getByText('1 de 2 pessoas da call é sua amiga').waitFor();
  await dlg.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await pa.getByText('Sua tela').waitFor({ timeout: 15000 });
  await pb.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pb.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await pc.getByText('Ana está transmitindo para outras pessoas').waitFor({ timeout: 8000 });
  assert(!(await pc.getByRole('button', { name: 'Assistir transmissão' }).count()), 'Caio (não é amigo) não tem o botão de assistir');
  await pc.screenshot({ path: path.join(shots, 'transmissao-restrita.png') });
  step('"Só amigos": a Bia (amiga) assiste; o Caio vê "🔒 Ana está transmitindo para outras pessoas"');

  // ---------- segurança: pedido de assistir forjado direto no servidor é barrado ----------
  spy = await new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token: eve.token }, transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
  const joined = await new Promise((r) => spy.emit('voice:join', { channelId: sala }, r));
  assert(joined.ok, `Eve entrou na call pelo socket (${JSON.stringify(joined)})`);
  const anaSock = joined.peers.find((p) => p.userId === ana.user.id).socketId;
  const denied = new Promise((r) => spy.on('screen:access', (m) => m.socketId === anaSock && !m.allowed && r(true)));
  spy.emit('rtc:signal', { to: anaSock, data: { type: 'watch', on: true, decoders: ['vp8'] } });
  assert(await Promise.race([denied, sleep(5000).then(() => false)]), 'servidor barra o pedido de assistir de quem não pode');
  spy.emit('voice:leave');
  step('segurança: um pedido de assistir forjado (direto no servidor) é barrado antes de chegar a quem transmite');

  // ---------- muda no meio: "Todos menos…" a Bia ----------
  await pa.getByRole('button', { name: /Quem pode assistir: Só amigos/ }).click();
  const dlg2 = pa.getByRole('dialog', { name: 'Transmitir tela' });
  await dlg2.getByRole('radio', { name: 'Todos menos…' }).click();
  await dlg2.getByRole('checkbox', { name: 'Bia' }).check();
  await pb.getByText('Ana está transmitindo para outras pessoas').waitFor({ timeout: 8000 });
  assert(!(await pb.locator('.tile.screen video').count()), 'a Bia parou de receber a imagem na hora');
  await pc.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pc.locator('.tile.screen video').waitFor({ timeout: 15000 });
  step('"Todos menos…": mudou no meio da transmissão; a Bia perdeu a imagem na hora e o Caio passou a assistir');

  // ---------- "Só quem eu escolher" e de volta a "Todos" ----------
  await dlg2.getByRole('radio', { name: 'Só quem eu escolher' }).click();
  await dlg2.getByText('Só as pessoas marcadas veem.').waitFor();
  // a Bia continua marcada (a lista é a mesma): agora só ela
  await pc.getByText('Ana está transmitindo para outras pessoas').waitFor({ timeout: 8000 });
  await pb.getByRole('button', { name: 'Assistir transmissão' }).waitFor({ timeout: 8000 });
  await dlg2.getByRole('radio', { name: 'Todos da call' }).click();
  await pc.getByRole('button', { name: 'Assistir transmissão' }).waitFor({ timeout: 8000 });
  await pa.screenshot({ path: path.join(shots, 'quem-pode-assistir.png') });
  step('"Só quem eu escolher" e "Todos da call" valem na hora para cada pessoa');

  console.log('\nTUDO CERTO (quem pode assistir + janela de transmitir)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  spy?.close();
  await browser?.close();
  server.kill();
}
