// Qualidade da voz com cada filtro de ruído: uma voz de verdade (e2e/fixtures/voz.wav) entra como microfone
// e medimos o volume e os agudos antes e depois do filtro, e o atraso do filtro. O Forte (GTCRN) é um
// modelo de 16 kHz e deixava a voz ABAFADA (sem nada acima de 8 kHz); agora os agudos voltam enquanto há voz.
// Uso: npm run build && node e2e/voice-quality.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { tempDir } from './_tmp.mjs';
const PORT = 3262, BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-voz-') }, stdio: 'ignore' });
const api = async (p, body, token) => (await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(400); }
  const ana = await api('/auth/register', { username: 'ana', password: 'Cor-Forte-Xis-42', displayName: 'Ana', acceptTerms: true });
  await api('/guilds', { name: 'Teste' }, ana.token);
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve('e2e/fixtures/voz.wav')}`, '--autoplay-policy=no-user-gesture-required'] });
  const res = {};
  for (const mode of ['off', 'rnnoise', 'gtcrn']) {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    await ctx.addInitScript(([t, m]) => { localStorage.setItem('resenha.token', t); localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: m, inputMode: 'voice', vadThresholdDb: -90 })); }, [ana.token, mode]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 3000 }).catch(() => {});
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    const b = page.getByRole('button', { name: 'Entrar na chamada' }); if (await b.isVisible().catch(() => false)) await b.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    await sleep(1500);
    const r = await page.evaluate(async () => {
      const v = window.__resenhaVoice;
      const ac = new AudioContext({ sampleRate: 48000 });
      const mk = (track) => { const a = ac.createAnalyser(); a.fftSize = 4096; a.smoothingTimeConstant = 0; ac.createMediaStreamSource(new MediaStream([track])).connect(a); return a; };
      const A = { raw: mk(v.rawMic), sent: mk(v.micTrack) };
      const acc = { raw: new Float64Array(2048), sent: new Float64Array(2048) }, rms = { raw: [], sent: [] };
      const buf = new Float32Array(2048), td = new Float32Array(4096);
      for (let i = 0; i < 120; i++) {
        for (const k of ['raw', 'sent']) {
          A[k].getFloatFrequencyData(buf); for (let j = 0; j < 2048; j++) acc[k][j] += Math.pow(10, buf[j] / 10);
          A[k].getFloatTimeDomainData(td); let s = 0; for (const x of td) s += x * x; rms[k].push(Math.sqrt(s / td.length));
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const hz = 24000 / 2048, band = (k, lo, hi) => { let s = 0; for (let j = Math.floor(lo / hz); j < Math.floor(hi / hz); j++) s += acc[k][j]; return s; };
      const out = {};
      for (const k of ['raw', 'sent']) {
        const act = rms[k].filter((x) => x > 0.003); // só os trechos com fala
        const tot = band(k, 80, 20000);
        out[k] = { db: +(20 * Math.log10(act.reduce((a, b) => a + b, 0) / Math.max(1, act.length))).toFixed(1), agudos4k: +(100 * band(k, 4000, 20000) / tot).toFixed(2), agudos8k: +(100 * band(k, 8000, 20000) / tot).toFixed(3) };
      }
      // atraso do filtro: grava os dois sinais e acha o deslocamento de maior correlação
      if (v.denoiser?.debug) {
        // atraso de verdade: o microfone e a saída do filtro gravados juntos, no mesmo AudioContext
        const { ctx: dc, source, node } = v.denoiser.debug;
        const m = dc.createChannelMerger(2); source.connect(m, 0, 0); node.connect(m, 0, 1);
        const got = await new Promise((res) => {
          const sp = dc.createScriptProcessor(4096, 2, 2); const a = [], b = [];
          sp.onaudioprocess = (e) => { a.push(new Float32Array(e.inputBuffer.getChannelData(0))); b.push(new Float32Array(e.inputBuffer.getChannelData(1))); if (a.length > 30) { sp.disconnect(); m.disconnect(); res([a, b]); } };
          const z = dc.createGain(); z.gain.value = 0; m.connect(sp); sp.connect(z); z.connect(dc.destination);
        });
        const fl = (ch) => { const o = new Float32Array(ch.length * 4096); ch.forEach((c, i) => o.set(c, i * 4096)); return o; };
        const xr = fl(got[0]), xs = fl(got[1]);
        let best = -1, lagB = 0;
        for (let lag = 0; lag < 4800; lag++) { let s = 0; for (let i = 20000; i < 100000; i += 3) s += xr[i] * xs[i + lag]; if (s > best) { best = s; lagB = lag; } }
        out.atrasoFiltroMs = +(lagB / 48).toFixed(2);
      }
      const rec = (track) => new Promise((res) => {
        const sp = ac.createScriptProcessor(4096, 1, 1); const chunks = [];
        sp.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); if (chunks.length > 24) { sp.disconnect(); res(chunks); } };
        ac.createMediaStreamSource(new MediaStream([track])).connect(sp); sp.connect(ac.destination);
      });
      const [cr, cs] = await Promise.all([rec(v.rawMic), rec(v.micTrack)]);
      const flat = (ch) => { const o = new Float32Array(ch.length * 4096); ch.forEach((c, i) => o.set(c, i * 4096)); return o; };
      const xr = flat(cr), xs = flat(cs);
      let best = 0, bestLag = 0;
      for (let lag = 0; lag < 9600; lag += 8) { let s = 0; for (let i = 20000; i < 80000; i += 2) s += xr[i] * xs[i + lag]; if (s > best) { best = s; bestLag = lag; } }
      let b2 = 0, fine = bestLag; for (let lag = Math.max(0, bestLag - 8); lag <= bestLag + 8; lag++) { let s = 0; for (let i = 20000; i < 80000; i++) s += xr[i] * xs[i + lag]; if (s > b2) { b2 = s; fine = lag; } }
      out.atrasoMs = +(fine / 48).toFixed(2);
      return out;
    });
    res[mode] = r;
    console.log(`  ${mode.padEnd(8)} microfone ${r.raw.db} dB, agudos>8k ${r.raw.agudos8k}% → enviado ${r.sent.db} dB, agudos>8k ${r.sent.agudos8k}%${r.atrasoFiltroMs != null ? `, atraso do filtro ${r.atrasoFiltroMs} ms` : ''}`);
    await ctx.close();
  }
  const g = res.gtcrn;
  const ok = (c, m) => { if (!c) throw new Error(`FALHOU: ${m}`); };
  ok(g.sent.agudos8k >= 0.6 * g.raw.agudos8k, `Forte: os agudos voltam (${g.sent.agudos8k}% de ${g.raw.agudos8k}%)`);
  ok(g.sent.agudos8k <= 1.6 * g.raw.agudos8k, `Forte: sem agudos demais (${g.sent.agudos8k}% de ${g.raw.agudos8k}%)`);
  ok(g.sent.db >= g.raw.db - 1, `Forte: a voz não fica mais baixa (${g.sent.db} dB de ${g.raw.db} dB)`);
  ok(Math.abs(g.atrasoFiltroMs - 32) < 8, `o atraso dos agudos (32 ms) bate com o do filtro (${g.atrasoFiltroMs} ms)`);
  ok(res.rnnoise.sent.db >= res.rnnoise.raw.db - 1, 'Leve: a voz não fica mais baixa');
  console.log('✓ Forte sem voz abafada: agudos de volta, mesmo volume e alinhados com a voz filtrada');
  console.log('\nTUDO CERTO (qualidade da voz)');
} catch (e) { console.error(e); process.exitCode = 1; } finally { await browser?.close(); server.kill(); }
