// Supressão de ruído do microfone: com som de teclado no microfone (arquivo gerado), compara o nível
// medido pela ativação por voz sem filtro, com o filtro do navegador e com as duas IAs.
// Uso: npm run build && node e2e/noise.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3183;
const BASE = `http://localhost:${PORT}`;
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const tmp = mkdtempSync(path.join(tmpdir(), 'resenha-noise-'));
const wav = path.join(tmp, 'teclado.wav');
execFileSync('python3', [path.resolve('e2e/make-keyboard-wav.py'), wav]);
mkdirSync(path.resolve('e2e/screenshots'), { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, 'db') },
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
  const ana = await api('/auth/register', { username: 'ana', password: 'Cor-Forte-Xis-42', displayName: 'Ana', acceptTerms: true });
  await api('/guilds', { name: 'Galera' }, ana.token);
  // microfones falsos: teclado, voz (sintetizada com espeak-ng, se tiver) e voz com teclado por baixo
  const files = { teclado: wav };
  try {
    // NOISE_VOICE_WAV: testar com uma gravação de voz de verdade no lugar da voz sintetizada
    if (process.env.NOISE_VOICE_WAV) execFileSync('cp', [process.env.NOISE_VOICE_WAV, path.join(tmp, 'voz-src.wav')]);
    else execFileSync('espeak-ng', ['-v', 'pt-br', '-s', '155', '-w', path.join(tmp, 'voz-src.wav'), 'Bora jogar mais uma partida? Eu vou pelo meio, você cobre a esquerda. Cuidado que tem dois no bomb A. Boa, ganhamos o round!']);
    for (const k of ['voz', 'ambos']) {
      files[k] = path.join(tmp, `${k}.wav`);
      execFileSync('python3', [path.resolve('e2e/make-keyboard-wav.py'), files[k], k, path.join(tmp, 'voz-src.wav')]);
    }
  } catch {
    console.log('  (sem espeak-ng: testando só o teclado)');
  }

  /** nível (0-100 = -100..0 dBFS) que a ativação por voz enxerga: amostras durante 5 s */
  async function measure(file, noiseMode) {
    const b = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'],
    });
    try {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone'] });
      await ctx.addInitScript(
        ([t, mode]) => {
          localStorage.setItem('resenha.token', t);
          localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: mode, vadThresholdDb: -100 }));
        },
        [ana.token, noiseMode],
      );
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`${BASE}/app`);
      await page.getByRole('button', { name: 'Sala de voz' }).first().click();
      await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Configurações', exact: true }).click();
      await page.getByRole('button', { name: 'Voz e vídeo' }).click();
      const status = await page.locator('.noise-status strong').textContent({ timeout: 10000 });
      await sleep(1500); // o filtro de IA "aprende" o ruído no começo
      const levels = [];
      for (let i = 0; i < 60; i++) {
        levels.push(await page.locator('.vad-level').evaluate((el) => parseFloat(el.style.width) || 0));
        await sleep(100);
      }
      if (noiseMode === 'gtcrn' && file === files.ambos) await page.screenshot({ path: path.resolve('e2e/screenshots/supressao-de-ruido.png') });
      assert(!errors.some((e) => /wasm|worklet|Content Security/i.test(e)), `sem erro de carregamento (${errors.join(' | ')})`);
      levels.sort((x, y) => x - y);
      const pick = (q) => levels[Math.floor(levels.length * q)];
      return { status, p90: pick(0.9), p50: pick(0.5) };
    } finally {
      await b.close();
    }
  }

  const modes = ['off', 'browser', 'rnnoise', 'gtcrn'];
  const res = {};
  for (const [k, f] of Object.entries(files)) {
    res[k] = {};
    for (const m of modes) res[k][m] = await measure(f, m);
    console.log(`  ${k.padEnd(7)} (pico/mediana, 0-100): ` + modes.map((m) => `${m} ${res[k][m].p90}/${res[k][m].p50}`).join(' · '));
  }
  const t = res.teclado;
  assert(t.off.status === 'Desligada' && t.rnnoise.status === 'Leve (IA)' && t.gtcrn.status === 'Forte (IA)', 'filtro certo ligado');
  assert(t.off.p90 > 30, 'o teclado aparece forte sem filtro');
  // a escala é linear em dB: 20 pontos = 20 dB a menos (10x menos amplitude)
  assert(t.gtcrn.p90 < t.off.p90 - 20, `GTCRN abaixa o teclado em mais de 20 dB (${t.off.p90} → ${t.gtcrn.p90})`);
  if (res.voz) {
    // a voz continua: pico no máximo 10 dB abaixo do sem filtro (a medição varia uns 2-3 dB entre execuções)
    assert(res.voz.gtcrn.p90 > res.voz.off.p90 - 10, `GTCRN mantém a voz (${res.voz.off.p90} → ${res.voz.gtcrn.p90})`);
    assert(res.voz.rnnoise.p90 > res.voz.off.p90 - 10, `RNNoise mantém a voz (${res.voz.off.p90} → ${res.voz.rnnoise.p90})`);
  }
  step('supressão de ruído: o teclado some e a voz continua');
  console.log('\nTUDO CERTO (supressão de ruído)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
