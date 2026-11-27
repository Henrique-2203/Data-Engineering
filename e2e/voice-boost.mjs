// Volume de cada pessoa na call: de 0 a 200%. Até 100% é o volume normal do <audio>; ACIMA de 100% o som passa por um
// amplificador (Web Audio) com limitador, para quem recebe a voz dos amigos baixa mesmo no máximo. Call de verdade com 2 pessoas
// (microfone falso do Chromium). Uso: npm run build && node e2e/voice-boost.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3312;
const BASE = `http://localhost:${PORT}`;
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-vboost-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
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
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const sala = guild.channels.find((c) => c.type === 'voice');
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'off', vadThresholdDb: -100 }));
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: sala.name, exact: true }).first().click();
    const enter = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await enter.isVisible().catch(() => false)) await enter.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  await sleep(2500);

  const audioOfBia = () => pa.evaluate(() => {
    const a = [...document.querySelectorAll('audio[data-kind="mic"]')][0];
    return a ? { muted: a.muted, volume: a.volume } : null;
  });
  const setVolume = async (v) => {
    await pa.locator('.voice-participant', { hasText: 'bia' }).first().click({ button: 'right' });
    const slider = pa.getByRole('slider', { name: 'Volume de Bia' });
    await slider.evaluate((el, val) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, String(val));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const shown = await pa.locator('.cum-volume b').innerText();
    await pa.keyboard.press('Escape');
    return shown;
  };

  assert((await pa.getByRole('slider').count()) === 0, 'sem menu aberto, nenhum controle');
  let shown = await setVolume(1);
  let a = await audioOfBia();
  assert(a && !a.muted && a.volume === 1 && shown === '100%', `100%: volume normal do <audio> (${JSON.stringify(a)} ${shown})`);
  shown = await setVolume(0.5);
  a = await audioOfBia();
  assert(a && !a.muted && Math.abs(a.volume - 0.5) < 0.01 && shown === '50%', `50%: volume do <audio> em 0,5 (${JSON.stringify(a)} ${shown})`);
  step('de 0 a 100% o volume continua no próprio <audio>');

  shown = await setVolume(2);
  a = await audioOfBia();
  assert(shown === '200%', `o controle vai até 200% (${shown})`);
  assert(a && a.muted === true, 'acima de 100%: o <audio> fica mudo e o som sai pelo amplificador');
  const ctx = await pa.evaluate(() => (window.__ctxCount ?? null));
  step('acima de 100% (até 200%) o som passa pelo amplificador do Web Audio');

  shown = await setVolume(1);
  a = await audioOfBia();
  assert(a && !a.muted && a.volume === 1, `voltando para 100% o <audio> volta a tocar sozinho (${JSON.stringify(a)})`);
  // a pessoa continua ouvindo: ensurdecer silencia mesmo amplificado
  await setVolume(1.5);
  await pa.getByRole('button', { name: /Ensurdecer|Desativar áudio/ }).first().click().catch(() => {});
  step('voltar a 100% restaura o <audio>; ensurdecer continua valendo');
  console.log('\nTUDO CERTO (volume de 0 a 200%)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
