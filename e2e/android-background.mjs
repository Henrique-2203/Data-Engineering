// Android: ao sair do navegador o Chrome desacelera os timers e o celular corta CPU. Antes, a ativação
// por voz abria e fechava o microfone aos pedaços e o filtro de IA atrasava (voz bugada/muda). Agora,
// em segundo plano: microfone aberto (se não silenciado), direto com o filtro do navegador, sem a IA;
// ao voltar, tudo é restaurado e o microfone é reaberto se o sistema o encerrou.
// Uso: npm run build && node e2e/android-background.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3192;
const BASE = `http://localhost:${PORT}`;
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-android-') },
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

  const open = async (token, android) => {
    const ctx = await browser.newContext({ ...(android ? { userAgent: devices['Pixel 7'].userAgent } : {}), viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'gtcrn', inputMode: 'voice', vadThresholdDb: -5 }));
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
  await sleep(2500);
  const state = () =>
    pa.evaluate(() => {
      const v = window.__resenhaVoice;
      return {
        sendsRaw: v.micTrack === v.rawMic,
        sendsAi: !!v.denoiser && v.micTrack === v.denoiser.track,
        open: !!v.micTrack?.enabled,
        rawEnabled: !!v.rawMic?.enabled,
        ns: v.rawMic?.getConstraints().noiseSuppression,
        rawId: v.rawMic?.id,
      };
    });
  const heard = () =>
    pb.evaluate(async () => {
      let max = 0;
      for (let i = 0; i < 15; i++) {
        const l = await window.__resenhaVoice.inboundAudioLevels();
        max = Math.max(max, ...Object.values(l), 0);
        await new Promise((r) => setTimeout(r, 200));
      }
      return max;
    });
  let s = await state();
  assert(s.sendsAi && !s.open, `na tela: manda o microfone com a IA, e a ativação por voz (sensibilidade alta) está fechada (${JSON.stringify(s)})`);

  // sai do navegador
  await pa.evaluate(() => window.__setVisible(false));
  await sleep(800);
  s = await state();
  assert(s.sendsRaw && s.open && s.ns === true, `em segundo plano: microfone direto, aberto, com o filtro do navegador (${JSON.stringify(s)})`);
  const lvl = await heard();
  assert(lvl > 0.001, `a voz chega para a Bia com o app em segundo plano (nível ${lvl})`);
  step(`Android em segundo plano: microfone aberto direto (sem a IA, com o filtro do navegador) e a voz continua chegando (nível ${lvl.toFixed(3)})`);

  // volta
  await pa.evaluate(() => window.__setVisible(true));
  await sleep(800);
  s = await state();
  assert(s.sendsAi && !s.open && s.rawEnabled && s.ns === false, `ao voltar: IA de novo e ativação por voz normal (${JSON.stringify(s)})`);
  step('ao voltar: volta a IA e a ativação por voz normal');

  // o sistema encerrou o microfone enquanto estava fora
  await pa.evaluate(() => window.__setVisible(false));
  await sleep(500);
  const before = await pa.evaluate(() => {
    window.__resenhaVoice.rawMic.stop();
    return window.__resenhaVoice.rawMic.id;
  });
  await pa.evaluate(() => window.__setVisible(true));
  for (let i = 0; i < 30; i++) {
    s = await state();
    if (s.rawId && s.rawId !== before && s.sendsAi) break;
    await sleep(200);
  }
  assert(s.rawId !== before && s.sendsAi, `microfone reaberto ao voltar (${JSON.stringify(s)})`);
  const sent = await pa.evaluate(() => {
    const v = window.__resenhaVoice;
    const ids = [...v.peers.values()].flatMap((p) => p.pc.getSenders().map((x) => x.track?.id));
    return ids.includes(v.micTrack.id) && v.rawMic.readyState === 'live';
  });
  assert(sent, 'o microfone novo é o que vai para a Bia');
  step('se o Android encerrou o microfone, ele é reaberto ao voltar e é o novo que vai para os outros');

  // silenciado continua silenciado em segundo plano
  await pa.getByRole('button', { name: 'Silenciar microfone' }).first().click();
  await pa.evaluate(() => window.__setVisible(false));
  await sleep(600);
  s = await state();
  assert(!s.open, `silenciado continua silenciado em segundo plano (${JSON.stringify(s)})`);
  await pa.evaluate(() => window.__setVisible(true));
  await sleep(600);
  s = await state();
  assert(!s.open && s.rawEnabled, 'e continua silenciado ao voltar');
  step('quem está silenciado continua silenciado em segundo plano e ao voltar');
  console.log('\nTUDO CERTO (Android em segundo plano)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
