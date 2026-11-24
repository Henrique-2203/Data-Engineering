// Vídeo v4 (estilo "criador": gravações de tela REAIS do Resenha, sem animação feita à parte).
// Grava 3 clipes com o app de verdade (servidor local, contas de teste com nomes fictícios):
//  1) celular assistindo a transmissão do Lucas (jogo a 60 FPS)
//  2) celular na call (quem fala acende)
//  3) computador: call com a transmissão de um lado e a conversa do outro (layout novo)
// Uso: npm run build && node promo/v4/capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3231;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/v4/clips');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-v4-'), PLATFORM_ADMINS: 'lucas' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

// "jogo" de corrida neon desenhado a 60 FPS (o que o Lucas transmite)
const GAME = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const g = c.getContext('2d');
    let t = 0;
    const draw = () => {
      t += 1 / 60;
      const sky = g.createLinearGradient(0, 0, 0, 1080);
      sky.addColorStop(0, '#120a2e');
      sky.addColorStop(0.55, '#5b1a6e');
      sky.addColorStop(0.56, '#0b0716');
      g.fillStyle = sky;
      g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#ffb347';
      g.beginPath();
      g.arc(960, 560, 230, Math.PI, 0);
      g.fill();
      g.strokeStyle = '#ff3ec8';
      g.lineWidth = 3;
      for (let i = 0; i < 14; i++) {
        const y = 600 + ((i * 40 + t * 260) % 560) * (1 + i * 0.02);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(1920, y);
        g.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        g.beginPath();
        g.moveTo(960 + i * 40, 600);
        g.lineTo(960 + i * 260, 1080);
        g.stroke();
      }
      const x = 960 + Math.sin(t * 1.3) * 260;
      g.fillStyle = '#21e6c1';
      g.fillRect(x - 110, 860, 220, 70);
      g.fillStyle = '#ff3e6c';
      g.fillRect(x - 90, 920, 40, 16);
      g.fillRect(x + 50, 920, 40, 16);
      g.fillStyle = '#fff';
      g.font = 'bold 64px sans-serif';
      g.fillText(`${Math.round(180 + Math.sin(t) * 40)} km/h`, 1500, 90);
      g.fillText('VOLTA 2/3', 80, 90);
    };
    setInterval(draw, 1000 / 60);
    draw();
    return c.captureStream(60);
  };
};

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const lucas = await reg('lucas', 'Lucas');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera do CS' }, lucas.token);
  for (const u of [bia, caio]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  await api('/admin/beta', { layout2: ['lucas'] }, lucas.token, 'PUT');
  await api('/dms', { userId: bia.user.id }, lucas.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  for (const [u, t] of [[caio, 'alguém pra fechar o 5? 🎮'], [bia, 'bora, entra na call que eu tô vendo a live do Lucas']]) await api(`/channels/${geral.id}/messages`, { content: t }, u.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (u, device, o = {}) => {
    const ctx = await browser.newContext({ ...device, permissions: ['microphone'], ...(o.record ? { recordVideo: { dir: OUT, size: o.size } } : {}) });
    await ctx.addInitScript(
      ([t, lay]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.androidBanner', '1');
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '1080p60', performanceMode: false }));
        if (lay) localStorage.setItem('resenha.layout', 'novo');
      },
      [u.token, !!o.novo],
    );
    if (o.game) await ctx.addInitScript(GAME);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app`);
    // a gravação é feita num computador sem placa de vídeo: as etiquetas de diagnóstico (FPS deste computador)
    // e os avisos de desempenho não representam um PC de verdade, então não entram no vídeo
    await page.addStyleTag({ content: '.send-stats, .stream-stats, .send-tip { display: none !important; }' });
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return { ctx, page };
  };
  const desk = { viewport: { width: 1280, height: 760 } };

  // Lucas (computador, layout novo) transmite; Caio entra na call
  const L = await open(lucas, desk, { game: true, novo: true, record: true, size: { width: 1280, height: 760 } });
  const tL0 = Date.now();
  const C = await open(caio, desk);
  for (const p of [L.page, C.page]) {
    await p.getByRole('button', { name: 'Galera do CS' }).first().click();
    await p.getByRole('button', { name: 'Sala de voz' }).first().click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  await L.page.getByRole('button', { name: 'Transmitir tela' }).click();
  await L.page.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await L.page.getByText('Sua tela').waitFor({ timeout: 15000 });

  // ---- clipe 1 e 2: Bia no celular entra na call e assiste ----
  const B = await open(bia, devices['Pixel 7'], { record: true, size: { width: 412, height: 915 } });
  const t0 = Date.now();
  await B.page.getByRole('button', { name: 'Galera do CS' }).first().click().catch(() => {});
  await B.page.locator('.nav-drawer').getByText('Sala de voz').first().click();
  await B.page.getByRole('button', { name: /Entrar na chamada/ }).click({ timeout: 3000 }).catch(() => {});
  await B.page.getByRole('button', { name: 'Assistir transmissão' }).click({ timeout: 15000 });
  await B.page.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await sleep(1500);
  await B.page.locator('.tile.screen').first().click().catch(() => {});
  await sleep(6500);
  const bMarks = { assistindo: (Date.now() - t0) / 1000 };

  // ---- clipe 3: Lucas no computador fixa a conversa com a Bia e arrasta para o lado da call ----
  const drag = async (fromLoc, toX, toY) => {
    const f = await fromLoc.boundingBox();
    await L.page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await L.page.mouse.down();
    await L.page.mouse.move(f.x + f.width / 2 + 20, f.y + f.height / 2 + 10, { steps: 4 });
    await L.page.mouse.move(toX, toY, { steps: 22 });
    await sleep(250);
    await L.page.mouse.up();
  };
  await L.page.getByRole('button', { name: 'Início' }).first().click();
  await sleep(600);
  const bar = await L.page.locator('.novo-tabsbar').boundingBox();
  const lMarks = { inicio: (Date.now() - tL0) / 1000 };
  await drag(L.page.locator('.dm-item[data-tab]', { hasText: 'Bia' }).first(), bar.x + 260, bar.y + bar.height / 2);
  await sleep(700);
  await L.page.getByRole('button', { name: 'Galera do CS' }).first().click();
  await L.page.locator('.sidebar').getByText('Sala de voz').first().click();
  await sleep(1200);
  const main = await L.page.locator('.main').boundingBox();
  lMarks.arrasta = (Date.now() - tL0) / 1000;
  await drag(L.page.locator('.novo-tab', { hasText: 'Bia' }).first(), main.x + main.width * 0.82, main.y + main.height * 0.5);
  await L.page.getByRole('region', { name: 'Conversa ao lado' }).waitFor({ timeout: 5000 });
  lMarks.lado = (Date.now() - tL0) / 1000;
  const dmId = (await api('/dms', null, lucas.token)).dms[0].id;
  for (const t of ['viu a curva que eu fiz? 😂', 'tô vendo daqui, liso demais', 'gg, próxima rodada?']) {
    await api(`/channels/${dmId}/messages`, { content: t }, bia.token);
    await sleep(1400);
  }
  await sleep(1200);
  lMarks.fim = (Date.now() - tL0) / 1000;

  await B.ctx.close();
  await L.ctx.close();
  await C.ctx.close();
  // cada contexto grava um arquivo: renomeia pelo dono
  renameSync(await B.page.video().path(), path.join(OUT, 'celular.webm'));
  renameSync(await L.page.video().path(), path.join(OUT, 'computador.webm'));
  for (const f of readdirSync(OUT)) if (!['celular.webm', 'computador.webm'].includes(f)) rmSync(path.join(OUT, f));
  const fs = await import('node:fs');
  fs.writeFileSync(path.join(OUT, 'marcas.json'), JSON.stringify({ celular: bMarks, computador: lMarks }, null, 2));
  console.log('clipes prontos', { bMarks, lMarks });
} finally {
  await browser?.close();
  server.kill();
}
