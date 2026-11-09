// Pedidos da call: chat da call (texto no canal de voz), volume da transmissão assistida (separado da voz)
// e ligar/desligar o áudio da minha transmissão sem parar a imagem.
// Uso: npm run build && node e2e/call-extras.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3181;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-call-')) },
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
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const voiceCh = guild.channels.find((c) => c.type === 'voice');

  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'],
  });
  const open = async (token, withStreamAudio) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    if (withStreamAudio) {
      // o navegador de teste não captura o som do computador: a transmissão ganha um tom gerado aqui
      await ctx.addInitScript(() => {
        const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = async (c) => {
          const stream = await original({ ...c, audio: false });
          const ac = new AudioContext();
          const osc = ac.createOscillator();
          const dest = ac.createMediaStreamDestination();
          osc.connect(dest);
          osc.start();
          stream.addTrack(dest.stream.getAudioTracks()[0]);
          return stream;
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('button', { name: 'Galera' }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    return page;
  };
  const pa = await open(ana.token, true);
  const pb = await open(bia.token, false);

  // ---------- chat da call ----------
  await pa.getByRole('button', { name: /^Abrir o chat da call/ }).click();
  await pa.getByText('Chat de Sala de voz').waitFor();
  await pa.locator('.call-chat textarea').fill('link do clipe: https://exemplo.com/clipe');
  await pa.keyboard.press('Enter');
  await pa.locator('.call-chat .message-content', { hasText: 'link do clipe' }).waitFor();
  await pb.getByRole('button', { name: 'Abrir o chat da call (1 nova)' }).waitFor({ timeout: 10000 });
  await pb.getByRole('button', { name: /^Abrir o chat da call/ }).click();
  await pb.locator('.call-chat .message-content', { hasText: 'link do clipe' }).waitFor();
  const stored = await api(`/channels/${voiceCh.id}/messages`, null, bia.token);
  assert(stored.messages?.some((m) => m.content.startsWith('link do clipe')), 'mensagem fica guardada no canal de voz');
  await pb.screenshot({ path: path.join(shots, 'chat-da-call.png') });
  step('chat da call: painel ao lado da chamada, contador de mensagens novas, mensagens guardadas no canal de voz');

  // ---------- entrar na call e transmitir com áudio ----------
  for (const p of [pa, pb]) {
    // clicar no canal de voz já entra na chamada; o botão só aparece se não entrou
    const join = p.getByRole('button', { name: 'Entrar na chamada' });
    if (await join.isVisible().catch(() => false)) await join.click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  await pa.getByRole('button', { name: 'Transmitir tela' }).click();
  await pa.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await pa.getByText('Sua tela').waitFor({ timeout: 15000 });

  // ---------- ligar/desligar o áudio da minha transmissão ----------
  const toggle = pa.getByRole('button', { name: 'Desligar o áudio da transmissão' });
  await toggle.waitFor({ timeout: 8000 });
  await toggle.click();
  await pa.getByRole('button', { name: 'Ligar o áudio da transmissão' }).waitFor();
  const enabled = await pa.evaluate(() => {
    const v = document.querySelector('.tile.screen video');
    const s = v?.srcObject;
    return s ? s.getAudioTracks().map((t) => t.enabled) : null;
  });
  assert(enabled && enabled.length === 1 && enabled[0] === false, `a trilha de áudio da transmissão foi desligada (${JSON.stringify(enabled)})`);
  await pb.locator('.tile.screen .muted-stream').waitFor({ timeout: 8000 });
  assert(await pa.getByText('Sua tela').isVisible(), 'a transmissão continua (só o som foi desligado)');
  await pa.screenshot({ path: path.join(shots, 'audio-da-transmissao-desligado.png') });
  await pa.getByRole('button', { name: 'Ligar o áudio da transmissão' }).click();
  await pb.locator('.tile.screen .muted-stream').waitFor({ state: 'detached', timeout: 8000 });
  step('quem transmite liga/desliga o áudio da transmissão sem parar a imagem; os outros veem "sem áudio"');

  // ---------- volume da transmissão assistida ----------
  await pb.getByRole('button', { name: 'Assistir transmissão' }).click();
  const slider = pb.getByRole('slider', { name: 'Volume da transmissão de Ana' });
  await slider.waitFor({ timeout: 15000 });
  await slider.fill('0.3');
  const volumes = async () =>
    pb.evaluate(() =>
      [...document.querySelectorAll('audio')].map((a) => ({ v: Math.round(a.volume * 100) / 100, video: (a.srcObject?.getVideoTracks?.().length ?? 0) > 0 })),
    );
  // a trilha da transmissão chega depois da renegociação: espera o <audio> dela aparecer
  let vols = [];
  for (let i = 0; i < 40 && !vols.some((a) => a.video); i++) {
    await sleep(250);
    vols = await volumes();
  }
  assert(vols.some((a) => a.video && a.v === 0.3), `som da transmissão em 30% (${JSON.stringify(vols)})`);
  assert(vols.some((a) => !a.video && a.v === 1), 'a voz da Ana continua em 100%');
  await pb.getByRole('button', { name: 'Silenciar a transmissão de Ana' }).click();
  vols = await volumes();
  assert(vols.some((a) => a.video && a.v === 0), 'transmissão silenciada');
  await pb.getByRole('button', { name: 'Ativar o som da transmissão de Ana' }).click();
  vols = await volumes();
  assert(vols.some((a) => a.video && a.v === 0.3), 'volta ao volume de antes');
  await pb.locator('.tile.screen').hover();
  await pb.screenshot({ path: path.join(shots, 'volume-da-transmissao.png') });
  step('volume da transmissão separado da voz (30%, silenciar e voltar), só para quem assiste');

  // ---------- modo desempenho: codificando no processador, a transmissão fica leve sozinha ----------
  // (o navegador de teste não tem placa de vídeo, então codifica no processador)
  await pa.getByText(/Sua transmissão ficou em 720p · 30 FPS/).waitFor({ timeout: 30000 });
  let sent = null;
  for (let i = 0; i < 20; i++) {
    sent = await pb.evaluate(() => {
      const v = document.querySelector('.tile.screen video');
      return v ? { h: v.videoHeight } : null;
    });
    if (sent && sent.h > 0 && sent.h <= 720) break;
    await sleep(500);
  }
  assert(sent && sent.h > 0 && sent.h <= 720, `quem assiste recebe a versão leve (${JSON.stringify(sent)})`);
  await pa.getByRole('button', { name: 'Tela' }).first().click().catch(() => {});
  step('modo desempenho: sem placa de vídeo, a transmissão vai sozinha para 720p · 30 FPS e avisa (o jogo vem primeiro)');

  console.log('\nTUDO CERTO (pedidos da call)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
