// Etapa 3 (laboratório 'sfu'): transmissão pelo servidor de mídia, com um SFU de mentira (e2e/mock-sfu.mjs)
// que fala a mesma API da Cloudflare.
//  - a Ana (laboratório ligado) publica a tela UMA vez; Bia e Caio assistem puxando do servidor de mídia
//  - nada da tela sai direto do PC da Ana para eles (nem turbo); a imagem chega e anda
//  - a chave da Cloudflare só vai do servidor do Resenha para a Cloudflare
//  - regras: quem está fora de "quem pode assistir" não puxa; ninguém mexe na sessão de outra pessoa
//  - trocar a qualidade pede outra camada; se o servidor de mídia falhar, quem assiste volta para o direto
// Uso: npm run build && node e2e/stream-sfu.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';
import { startMockSfu } from './mock-sfu.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3216;
const SFU_PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const APP = 'testapp';
const TOKEN = 'segredo-do-servidor';
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: tempDir('resenha-sfu-'),
    CLOUDFLARE_SFU_APP_ID: APP,
    CLOUDFLARE_SFU_APP_TOKEN: TOKEN,
    CLOUDFLARE_SFU_BASE_URL: `http://localhost:${SFU_PORT}/v1`,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

let browser;
let mock;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const users = [await reg('ana', 'Ana'), await reg('bia', 'Bia'), await reg('caio', 'Caio'), await reg('duda', 'Duda')];
  const [ana, bia, caio, duda] = users;
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  for (const u of users.slice(1)) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  mock = await startMockSfu(browser, { port: SFU_PORT, appId: APP, token: TOKEN });

  async function open(u, streamer) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
    await ctx.addInitScript(
      ([t, isStreamer]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.voiceSettings', JSON.stringify({ turbo: true, noiseMode: 'browser', screenPreset: '720p60', performanceMode: false, codec: 'vp8' }));
        if (isStreamer) localStorage.setItem('resenha.lab', JSON.stringify(['sfu']));
      },
      [u.token, streamer],
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
            g.fillStyle = `hsl(${(n * 3) % 360} 70% 40%)`;
            g.fillRect(0, 0, 1280, 720);
            g.fillStyle = '#fff';
            g.font = 'bold 120px sans-serif';
            g.fillText(String(n), 100 + ((n * 7) % 900), 380);
          }, 1000 / 60);
          return c.captureStream(60);
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera' }).first().click();
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  }
  /** quadros novos na tela de quem assiste, em 4 s */
  const fps = (page) =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const v = document.querySelector('.tile.screen video');
          if (!v?.requestVideoFrameCallback) return resolve(0);
          let n = 0;
          const t0 = performance.now();
          const tick = (now) => {
            n++;
            if (now - t0 < 4000) v.requestVideoFrameCallback(tick);
          };
          v.requestVideoFrameCallback(tick);
          setTimeout(() => resolve(Math.round(n / 4)), 4500);
        }),
    );
  const dbg = (page) => page.evaluate(() => (window.__resenhaVoice.debugLog ?? []).filter((l) => /sfu/.test(String(l))).slice(-6));

  const pa = await open(ana, true);
  const pb = await open(bia, false);
  const pc = await open(caio, false);
  await pa.getByRole('button', { name: 'Transmitir tela' }).click();
  await pa.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await pa.getByText('Sua tela').waitFor({ timeout: 15000 });
  await pa.waitForFunction(() => (window.__resenhaVoice.debugLog ?? []).some((l) => /sfu: publicando/.test(String(l))), null, { timeout: 15000 });
  const push = mock.state.requests.find((r) => r.body?.tracks?.[0]?.location === 'local');
  assert(push, 'a Ana publicou no servidor de mídia');
  assert(/a=simulcast:send a;b;c/.test(push.body.sessionDescription.sdp) || /a=rid:a send/.test(push.body.sessionDescription.sdp), 'a tela vai em 3 qualidades (simulcast a, b, c)');
  assert(mock.state.requests.every((r) => r.auth === `Bearer ${TOKEN}`), 'só o servidor do Resenha fala com a Cloudflare (com a chave)');
  step('quem transmite (laboratório ligado) publica a tela UMA vez no servidor de mídia, em 3 qualidades');

  for (const v of [pb, pc]) {
    await v.getByRole('button', { name: 'Assistir transmissão' }).click();
    await v.locator('.tile.screen video').waitFor({ timeout: 15000 });
  }
  await pb.waitForFunction(() => (window.__resenhaVoice.debugLog ?? []).some((l) => /sfu: assistindo/.test(String(l))), null, { timeout: 15000 }).catch(async () => {
    throw new Error(`a Bia não assistiu pelo servidor de mídia: ${JSON.stringify(await dbg(pb))}`);
  });
  await sleep(2500);
  const [fb, fc] = await Promise.all([fps(pb), fps(pc)]);
  assert(fb >= 15 && fc >= 15, `a imagem chega e anda (Bia ${fb} FPS, Caio ${fc} FPS)`);
  const pulls = mock.state.requests.filter((r) => r.body?.tracks?.[0]?.location === 'remote');
  assert(pulls.length >= 2, `os dois puxaram do servidor de mídia (${pulls.length})`);
  const vid = pulls[0].body.tracks.find((t) => t.simulcast);
  assert(vid?.simulcast.preferredRid === 'a' && vid.simulcast.priorityOrdering === 'asciibetical', `no Auto pede a melhor e deixa a Cloudflare baixar se a internet apertar (${JSON.stringify(vid?.simulcast)})`);
  const sent = await pa.evaluate(() => window.__resenhaVoice.turboSendStats?.viewers?.length ?? 0);
  assert(sent === 0, `nada da tela sai direto do PC da Ana pelo turbo (${sent} pelo turbo)`);
  await pb.screenshot({ path: path.join(shots, 'sfu-assistindo.png') });
  step(`Bia e Caio assistem pelo servidor de mídia (${fb} e ${fc} FPS na tela), sem nada direto do PC da Ana`);

  // qualidade: 480p pede a camada c (fixa)
  // o id da transmissão que a Bia assiste pelo servidor de mídia
  const streamerSid = await pb.evaluate(() => [...window.__resenhaVoice.sfuViews.keys()][0] ?? null);
  assert(streamerSid, 'a Bia tem a transmissão da Ana pelo servidor de mídia');
  if (streamerSid) {
    await pb.evaluate((sid) => window.__resenhaVoice.setStreamQuality(sid, '480'), streamerSid);
    await sleep(800);
    const upd = mock.state.requests.find((r) => r.path.endsWith('/tracks/update'));
    assert(upd?.body.tracks[0].simulcast.preferredRid === 'c' && upd.body.tracks[0].simulcast.priorityOrdering === 'none', `480p pede a camada c, fixa (${JSON.stringify(upd?.body)})`);
    step('trocar para 480p pede a qualidade c ao servidor de mídia');
  }

  // segurança: a Duda está fora de quem pode assistir; ninguém mexe na sessão dos outros
  const pd = await open(duda, false);
  const dudaId = duda.user.id;
  await pa.evaluate((id) => window.__resenhaVoice.setScreenAudience({ mode: 'except', userIds: [id] }), dudaId);
  await sleep(500);
  const anaSession = push.path.match(/sessions\/([^/]+)\//)[1];
  const ds = await api('/sfu/sessions', {}, duda.token);
  assert(ds.sessionId, 'a Duda (na call) abre a própria sessão');
  const tracks = pulls[0].body.tracks.map((t) => t.trackName);
  const steal = await api(`/sfu/sessions/${ds.sessionId}/pull`, { remoteSessionId: anaSession, tracks }, duda.token);
  assert(steal.status === 403, `quem está fora de "quem pode assistir" não puxa a tela (${steal.status} ${steal.error ?? ''})`);
  const hijack = await api(`/sfu/sessions/${anaSession}/renegotiate`, { sessionDescription: { type: 'offer', sdp: 'v=0 fake sdp' } }, duda.token, 'PUT');
  assert(hijack.status === 404, `ninguém mexe na sessão de outra pessoa (${hijack.status})`);
  const outside = await api('/sfu/sessions', {}, (await reg('eva', 'Eva')).token);
  assert(outside.status === 403, `quem não está numa call não abre sessão (${outside.status})`);
  step('quem está fora de "quem pode assistir" não puxa; ninguém mexe na sessão dos outros; fora de call não abre sessão');

  // falha: o servidor de mídia quebra e a Duda (agora liberada) assiste pelo direto
  await pa.evaluate(() => window.__resenhaVoice.setScreenAudience({ mode: 'all', userIds: [] }));
  mock.state.fail = true;
  await pd.getByRole('button', { name: 'Assistir transmissão' }).click();
  await pd.locator('.tile.screen video').waitFor({ timeout: 15000 });
  await pd.waitForFunction(() => (window.__resenhaVoice.debugLog ?? []).some((l) => /sfu: não deu para assistir/.test(String(l))), null, { timeout: 15000 });
  await sleep(3500);
  const fd = await fps(pd);
  assert(fd >= 10, `com o servidor de mídia fora, a Duda assiste pelo direto (${fd} FPS)`);
  mock.state.fail = false;
  step(`servidor de mídia fora do ar: quem assiste volta sozinho para o direto (${fd} FPS)`);

  // parar de transmitir fecha a sessão no servidor de mídia
  await pa.getByRole('button', { name: /Parar de transmitir|Parar transmissão/ }).first().click();
  await sleep(1000);
  assert(mock.state.requests.some((r) => r.path === `/v1/apps/${APP}/sessions/${anaSession}/tracks/close`), 'parar de transmitir fecha a sessão no servidor de mídia');
  step('parar de transmitir fecha a sessão no servidor de mídia');
  console.log('\nTUDO CERTO (servidor de mídia, etapa 3)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await mock?.close().catch(() => {});
  await browser?.close();
  server.kill();
}
