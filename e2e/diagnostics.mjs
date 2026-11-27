// "Relatar problema da call": mede a call, mostra o que encontrou e manda os números para o suporte.
// Uso: npm run build && node e2e/diagnostics.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3188;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-diag-'), PLATFORM_ADMINS: 'equipe' },
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
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const equipe = await reg('equipe', 'Equipe');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token, streamer) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
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
            g.fillStyle = `hsl(${(n * 3) % 360} 60% 40%)`;
            g.fillRect(0, 0, 1280, 720);
            g.fillStyle = '#fff';
            g.fillRect((n * 9) % 1200, 300, 80, 80);
          }, 1000 / 60);
          return c.captureStream(60);
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const pa = await open(ana.token, false);
  const pb = await open(bia.token, true);
  for (const p of [pa, pb]) {
    await p.getByRole('button', { name: 'Sala de voz' }).first().click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  await pb.getByRole('button', { name: 'Transmitir tela' }).click();
  await pb.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await pa.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pa.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await sleep(4000);

  // ---------- quem assiste relata ----------
  await pa.getByRole('button', { name: 'Relatar problema da call' }).click();
  const dlg = pa.getByRole('dialog', { name: 'Relatar problema da call' });
  await dlg.getByText('Medindo a call por 5 segundos').waitFor();
  await dlg.getByText('O que encontramos').waitFor({ timeout: 15000 });
  await dlg.getByText('Ver exatamente o que vai ser enviado').click();
  await dlg.locator('.diag-view td', { hasText: 'Bia' }).first().waitFor();
  await dlg.locator('.diag-view th', { hasText: 'Assistindo Bia' }).waitFor();
  await dlg.getByLabel('O que está acontecendo?').selectOption('Transmissão travando ou com FPS baixo');
  await dlg.getByLabel('Conte com suas palavras (opcional)').fill('A tela da Bia trava às vezes.');
  await pa.screenshot({ path: path.join(shots, 'relatar-problema.png') });
  await dlg.getByRole('button', { name: 'Enviar para o suporte' }).click();
  await pa.getByText('Relatório enviado!').waitFor();
  step('quem assiste: mede 5 s, mostra o que encontrou e a tabela do que vai, e envia');

  // ---------- quem transmite relata ----------
  await pb.getByRole('button', { name: 'Relatar problema da call' }).click();
  const dlgB = pb.getByRole('dialog', { name: 'Relatar problema da call' });
  await dlgB.getByText('O que encontramos').waitFor({ timeout: 15000 });
  await dlgB.getByText('Ver exatamente o que vai ser enviado').click();
  await dlgB.locator('.diag-view th', { hasText: 'Minha transmissão' }).waitFor();
  await dlgB.getByRole('button', { name: 'Enviar para o suporte' }).click();
  await pb.getByText('Relatório enviado!').waitFor();

  // ---------- o que chegou ----------
  const queue = (await api('/admin/support', null, equipe.token)).tickets;
  assert(queue.length === 2, 'dois relatórios na fila da equipe');
  const fromAna = queue.find((t) => t.user.username === 'ana');
  const fromBia = queue.find((t) => t.user.username === 'bia');
  const d = fromAna.diagnostics;
  assert(fromAna.subject === 'Transmissão travando ou com FPS baixo' && /trava às vezes/.test(fromAna.messages[0].body), 'assunto e texto');
  assert(d?.v === 1 && d.peers.length === 1 && d.peers[0].name === 'Bia' && d.peers[0].state === 'connected', `conexão com a Bia (${JSON.stringify(d?.peers)})`);
  assert(typeof d.peers[0].rttMs === 'number' && d.peers[0].voiceIn && typeof d.peers[0].voiceIn.lossPct === 'number', 'atraso e perda da voz medidos');
  assert(d.watching.length === 1 && d.watching[0].turbo && d.watching[0].fps > 20, `transmissão assistida (${JSON.stringify(d.watching)})`);
  assert(d.watching[0].audio && d.watching[0].audio !== 'old', `quem assiste sabe como o som da transmissão é capturado (${d.watching[0].audio})`);
  assert(d.app.browser && d.app.os && d.log.length > 0, 'aparelho e eventos');
  const s = fromBia.diagnostics.stream;
  assert(s && s.turbo && s.captureFps > 20 && s.sentFps > 20 && s.viewers === 1, `transmissão de quem relata (${JSON.stringify(s)})`);
  const all = JSON.stringify(queue.map((t) => t.diagnostics));
  assert(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(all), 'nenhum endereço IP no relatório');
  assert(!/sdp|a=candidate|fingerprint/i.test(all), 'nada de dados de conexão crus');
  step('equipe recebe os números (conexão, voz, transmissão, aparelho, eventos), sem IP nem dados crus');

  // ---------- painel da equipe ----------
  const pe = await open(equipe.token, false);
  await pe.getByRole('button', { name: /^Denúncias/ }).click();
  await pe.getByRole('tab', { name: /^Suporte/ }).click();
  await pe.getByRole('button', { name: /Transmissão travando/ }).click();
  await pe.getByText('Diagnóstico da call').waitFor();
  await pe.locator('.admin-diag .diag-view th', { hasText: 'Assistindo Bia' }).waitFor();
  await pe.screenshot({ path: path.join(shots, 'diagnostico-equipe.png') });
  step('painel da equipe: o chamado mostra o diagnóstico com as dicas e as tabelas');
  console.log('\nTUDO CERTO (diagnóstico da call)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
