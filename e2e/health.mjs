// Saúde das calls: números anônimos somados por dia, painel da equipe e a opção de desligar.
// Uso: npm run build && node e2e/health.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3191;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-health-'), PLATFORM_ADMINS: 'equipe' },
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
  const caio = await reg('caio', 'Caio');
  const equipe = await reg('equipe', 'Equipe');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);

  // ---------- API: só quem é da equipe lê; o envio só aceita os números conhecidos ----------
  assert((await api('/admin/call-health', null, ana.token)).status === 404, 'só a equipe vê o painel');
  assert((await api('/telemetry/call-health', { metrics: { quem_sou_eu: { sum: 1, count: 1 } } }, ana.token)).status === 400, 'número desconhecido é recusado');
  step('API: painel só para a equipe; só números conhecidos são aceitos');

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token, { streamer = false, optOut = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, off]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.healthEveryMs', '3000');
        if (off) localStorage.setItem('resenha.healthOff', '1');
      },
      [token, optOut],
    );
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
          }, 1000 / 60);
          return c.captureStream(60);
        };
      });
    }
    const page = await ctx.newPage();
    const telemetry = [];
    page.on('request', (r) => r.url().includes('/api/telemetry/') && telemetry.push(r.postData()));
    page.on('pageerror', (e) => !/Falha de teste/.test(String(e)) && console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return { page, telemetry };
  };
  const a = await open(ana.token);
  const b = await open(bia.token, { streamer: true });
  const c = await open(caio.token, { optOut: true });
  for (const { page } of [a, b, c]) {
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  await b.page.getByRole('button', { name: 'Transmitir tela' }).click();
  await b.page.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await a.page.getByRole('button', { name: 'Assistir transmissão' }).click();
  await a.page.locator('.tile.screen video').waitFor({ timeout: 15000 });
  // um erro do site com dados pessoais no texto (tem que chegar limpo)
  await a.page.evaluate(() => setTimeout(() => {
    throw new Error('Falha de teste ana@exemplo.com pedido 123456789');
  }));
  await sleep(14000);

  const h = await api('/admin/call-health?days=7', null, equipe.token);
  const t = h.totals;
  assert((t.conn_ok?.count ?? 0) >= 4 && !(t.conn_fail?.count ?? 0), `conexões contadas (${JSON.stringify(t.conn_ok)} / falhas ${JSON.stringify(t.conn_fail)})`);
  assert((t.voice_samples?.count ?? 0) >= 2 && (t.voice_rtt?.count ?? 0) >= 2, `amostras de voz (${JSON.stringify(t.voice_samples)})`);
  assert((t.stream_samples?.count ?? 0) >= 1 && (t.stream_turbo?.count ?? 0) >= 1, `amostras da transmissão (${JSON.stringify(t.stream_samples)})`);
  assert((t.watch_samples?.count ?? 0) >= 1 && t.watch_fps.sum / t.watch_fps.count > 20, `amostras de quem assiste (${JSON.stringify(t.watch_fps)})`);
  assert(h.live.inVoice === 3 && h.live.calls === 1 && h.live.streaming === 1, `agora (${JSON.stringify(h.live)})`);
  const err = h.errors.find((e) => /Falha de teste/.test(e.message));
  assert(err && /\[email\]/.test(err.message) && /\[n\]/.test(err.message), `erro registrado e limpo (${JSON.stringify(h.errors)})`);
  const everything = JSON.stringify(h);
  assert(!/ana@exemplo|123456789|"ana"|"bia"|"caio"/.test(everything), 'nada que identifique alguém no que foi guardado');
  assert(c.telemetry.length === 0, `quem desligou não manda nada (${c.telemetry.length})`);
  assert(a.telemetry.length > 0 && b.telemetry.length > 0, 'quem não desligou manda');
  step('call real: conexões, voz, transmissão e quem assiste somados por dia; erro chega limpo; "agora" certo; quem desligou não manda nada');

  // ---------- painel ----------
  const e = await open(equipe.token);
  await e.page.getByRole('button', { name: /^Denúncias/ }).click();
  await e.page.getByRole('tab', { name: 'Saúde' }).click();
  await e.page.locator('.health-tile', { hasText: 'Conexões que deram certo' }).getByText('100%').waitFor();
  await e.page.locator('.health-live').getByText('transmitindo').waitFor();
  await e.page.getByText('Falha de teste').waitFor();
  await e.page.screenshot({ path: path.join(shots, 'saude-das-calls.png'), fullPage: true });
  step('painel da equipe → Saúde: agora, conexões, voz, transmissões, TURN e erros');

  // ---------- limites do plano (Sistema) ----------
  const cap = await api('/admin/capacity', null, equipe.token);
  assert(cap.cpu && cap.cpu.limitPct === 10 && cap.memory.usedMb > 0 && cap.memory.limitMb === 512 && Array.isArray(cap.warnings), `capacidade (${JSON.stringify(cap)})`);
  assert((await api('/admin/capacity', null, ana.token)).status === 404, 'limites só para a equipe');
  await e.page.getByRole('tab', { name: 'Sistema' }).click();
  await e.page.getByText('Limites do plano (agora)').waitFor();
  await e.page.locator('.capacity-tiles .stat-tile', { hasText: 'Processador do servidor' }).waitFor();
  await e.page.screenshot({ path: path.join(shots, 'limites-do-plano.png') });
  step('Sistema → Limites do plano: processador, memória, TURN e conectados (só para a equipe)');

  // ---------- opção em Privacidade e dados ----------
  await c.page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await c.page.getByRole('button', { name: 'Privacidade e dados' }).click();
  const box = c.page.getByLabel('Ajudar a melhorar as calls com números anônimos de qualidade');
  assert(!(await box.isChecked()), 'mostra desligado para quem desligou');
  await box.check();
  assert((await c.page.evaluate(() => localStorage.getItem('resenha.healthOff'))) === null, 'religar funciona');
  step('Privacidade e dados: liga e desliga o envio');
  console.log('\nTUDO CERTO (saúde das calls)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
