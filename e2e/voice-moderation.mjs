// Moderação de voz (como os ADMs do Discord): mover para outro canal (menu e arrastando), tirar da
// call, silenciar e ensurdecer. Só com permissão do cargo e só com quem está abaixo na hierarquia.
// Call de verdade com 3 pessoas (microfone falso do Chromium = bipe), conferindo o áudio que chega.
// Uso: npm run build && node e2e/voice-moderation.mjs
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-vmod-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
const emit = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));

let browser;
const sockets = [];
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
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  for (const u of [bia, caio]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  // Caio é moderador (mover e silenciar, sem ensurdecer); Sala 2 com limite de 1 pessoa
  await api(`/guilds/${guild.id}/roles`, { name: 'Mod', color: '#3ddc97', permissions: (1 << 17) | (1 << 18) }, ana.token);
  let g = (await api(`/guilds/${guild.id}`, null, ana.token)).guild;
  const mod = g.roles.find((r) => r.name === 'Mod');
  await api(`/guilds/${guild.id}/members/${caio.user.id}/roles`, { roleIds: [mod.id] }, ana.token, 'PUT');
  await api(`/guilds/${guild.id}/channels`, { name: 'Sala 2', type: 'voice', userLimit: 1 }, ana.token);
  g = (await api(`/guilds/${guild.id}`, null, ana.token)).guild;
  const sala1 = g.channels.find((c) => c.type === 'voice' && c.name !== 'Sala 2');
  const sala2 = g.channels.find((c) => c.name === 'Sala 2');
  assert(g.members.find((m) => m.id === caio.user.id)?.roleIds.includes(mod.id), 'Caio virou moderador');

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'browser', vadThresholdDb: -100 }));
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: sala1.name, exact: true }).first().click();
    const enter = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await enter.isVisible().catch(() => false)) await enter.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  const pc = await open(caio.token);
  await sleep(2500);
  const states = async () => (await api(`/guilds/${guild.id}`, null, ana.token)).voiceStates;
  const sidOf = async (uid) => (await states()).find((v) => v.userId === uid)?.socketId;
  const biaSid = await sidOf(bia.user.id);
  const anaSid = await sidOf(ana.user.id);
  const row = (page, name) => page.locator('.voice-participant').filter({ hasText: name }).first();
  const openMenu = async (page, name) => {
    await row(page, name).hover();
    await page.getByRole('button', { name: `Moderar ${name} na call` }).click();
    return page.getByRole('menu', { name: `Moderar ${name} na call` });
  };
  /** nível do áudio da Bia chegando no Caio, e se o <audio> dela está mudo para ele */
  const biaAtCaio = async () => {
    let level = 0;
    for (let i = 0; i < 8; i++) {
      const l = await pc.evaluate(async (sid) => (await window.__resenhaVoice.inboundAudioLevels())[sid] ?? 0, biaSid);
      level = Math.max(level, l);
      await sleep(200);
    }
    const muted = await pc.evaluate((sid) => document.querySelector(`audio[data-kind="mic"][data-socket="${sid}"]`)?.muted, biaSid);
    return { level, muted };
  };

  // quem não tem permissão não vê o menu; o moderador não vê no dono (acima dele)
  assert((await pb.getByRole('button', { name: /^Moderar / }).count()) === 0, 'sem permissão: sem botão de moderar');
  await row(pc, 'Bia').hover();
  assert((await pc.getByRole('button', { name: 'Moderar Bia na call' }).count()) === 1, 'moderador vê o menu em quem está abaixo');
  assert((await pc.getByRole('button', { name: 'Moderar Ana na call' }).count()) === 0, 'moderador não vê o menu no dono');
  // e o servidor confere de verdade (mesmo pedindo direto, sem o app)
  const sb = await connect(bia.token);
  const sc = await connect(caio.token);
  sockets.push(sb, sc);
  let r = await emit(sb, 'voice:mod', { action: 'mute', socketId: anaSid });
  assert(!r.ok && /permissão/.test(r.error), `sem permissão recusado (${r.error})`);
  r = await emit(sc, 'voice:mod', { action: 'mute', socketId: anaSid });
  assert(!r.ok && /abaixo/.test(r.error), `moderador não silencia o dono (${r.error})`);
  r = await emit(sc, 'voice:mod', { action: 'deafen', socketId: biaSid });
  assert(!r.ok && /permissão/.test(r.error), 'cargo sem "Ensurdecer" não ensurdece');
  step('só quem tem a permissão do cargo vê e consegue moderar, e só quem está abaixo (o servidor confere)');

  // silenciar: ninguém ouve mais a Bia
  const before = await biaAtCaio();
  assert(before.level > 0.001 && !before.muted, `antes, o Caio ouve a Bia (nível ${before.level})`);
  const m1 = await openMenu(pa, 'Bia');
  await pa.screenshot({ path: path.join(shots, 'moderacao-voz-menu.png'), clip: { x: 0, y: 0, width: 640, height: 480 } });
  await m1.getByRole('menuitem', { name: /Silenciar na call/ }).click();
  await pb.getByText('Ana silenciou você nesta call').waitFor({ timeout: 5000 });
  await pa.locator('.voice-participant').filter({ hasText: 'Bia' }).getByLabel('Silenciado por um moderador').waitFor();
  await sleep(1500);
  const muted = await biaAtCaio();
  assert(muted.muted && muted.level < 0.001, `silenciada: o Caio não ouve mais a Bia (nível ${muted.level}, mudo=${muted.muted})`);
  await pa.screenshot({ path: path.join(shots, 'moderacao-voz-silenciada.png') });
  // a própria Bia tenta tirar: continua silenciada
  await pb.getByRole('button', { name: 'Silenciar microfone' }).first().click();
  await pb.getByRole('button', { name: /Ativar microfone|Silenciar microfone/ }).first().click();
  await pb.getByText('Um moderador silenciou você nesta call').waitFor({ timeout: 5000 });
  assert((await biaAtCaio()).muted, 'a Bia não consegue tirar o silêncio sozinha');
  await (await openMenu(pa, 'Bia')).getByRole('menuitem', { name: /Tirar o silêncio/ }).click();
  await pb.getByText('Ana tirou o seu silêncio').waitFor({ timeout: 5000 });
  await sleep(1500);
  const back = await biaAtCaio();
  assert(!back.muted && back.level > 0.001, `sem silêncio: o Caio ouve a Bia de novo (nível ${back.level})`);
  step(`silenciar na call: ninguém ouve (nível ${before.level.toFixed(3)} → ${muted.level.toFixed(3)}), a pessoa não tira sozinha, e volta ao tirar`);

  // ensurdecer: a Bia não ouve ninguém e ninguém ouve a Bia
  await (await openMenu(pa, 'Bia')).getByRole('menuitem', { name: /Ensurdecer na call/ }).click();
  await pb.getByText('Ana ensurdeceu você').waitFor({ timeout: 5000 });
  await sleep(800);
  const biaHears = await pb.evaluate(() => [...document.querySelectorAll('audio[data-kind="mic"]')].map((a) => a.muted));
  assert(biaHears.length >= 2 && biaHears.every(Boolean), `ensurdecida: a Bia não ouve ninguém (${biaHears})`);
  assert((await biaAtCaio()).muted, 'ensurdecida: ninguém ouve a Bia');
  await (await openMenu(pa, 'Bia')).getByRole('menuitem', { name: /Tirar o ensurdecimento/ }).click();
  await pb.getByText('Ana tirou o seu ensurdecimento').waitFor({ timeout: 5000 });
  await sleep(800);
  assert((await pb.evaluate(() => [...document.querySelectorAll('audio[data-kind="mic"]')].every((a) => !a.muted))), 'volta a ouvir');
  step('ensurdecer na call: a pessoa não ouve nem é ouvida, até tirarem');

  // mover arrastando para a Sala 2
  await row(pa, 'Bia').dragTo(pa.getByRole('button', { name: /^Sala 2/ }));
  await pb.getByText('Ana moveu você para 🔊 Sala 2').waitFor({ timeout: 5000 });
  for (let i = 0; i < 30 && (await states()).find((v) => v.userId === bia.user.id)?.channelId !== sala2.id; i++) await sleep(200);
  assert((await states()).find((v) => v.userId === bia.user.id)?.channelId === sala2.id, 'Bia está na Sala 2');
  await pb.getByText('Voz conectada').waitFor();
  step('mover arrastando a pessoa para outro canal de voz');

  // mover pelo menu, mesmo com a Sala 2 no limite (1 pessoa): moderador passa por cima do limite
  await (await openMenu(pa, 'Caio')).getByRole('menuitem', { name: /Mover para outro canal/ }).click();
  await pa.getByRole('menu', { name: 'Moderar Caio na call' }).getByRole('menuitem', { name: 'Sala 2' }).click();
  await pc.getByText('Ana moveu você para 🔊 Sala 2').waitFor({ timeout: 5000 });
  for (let i = 0; i < 30 && (await states()).find((v) => v.userId === caio.user.id)?.channelId !== sala2.id; i++) await sleep(200);
  assert((await states()).find((v) => v.userId === caio.user.id)?.channelId === sala2.id, 'Caio foi para a Sala 2 mesmo com o limite');
  step('mover pelo menu (passa por cima do limite de pessoas do canal, como no Discord)');

  // o moderador Caio tira a Bia da call
  await (await openMenu(pc, 'Bia')).getByRole('menuitem', { name: /Tirar da call/ }).click();
  await pb.getByText('Caio tirou você da call').waitFor({ timeout: 5000 });
  await pb.getByText('Voz conectada').waitFor({ state: 'detached', timeout: 5000 });
  assert(!(await states()).some((v) => v.userId === bia.user.id), 'Bia saiu da call');
  step('tirar da call (o moderador Caio tirou a Bia)');

  // registro de auditoria
  const log = await api(`/guilds/${guild.id}/audit`, null, ana.token);
  const actions = (log.entries ?? log.items ?? []).map((e) => e.action);
  for (const a of ['voice_mute', 'voice_unmute', 'voice_deafen', 'voice_undeafen', 'voice_move', 'voice_disconnect']) assert(actions.includes(a), `auditoria registra ${a} (${actions.join(',')})`);
  step('tudo fica no registro de auditoria do servidor');
  console.log('\nTUDO CERTO (moderação de voz)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.close());
  await browser?.close();
  server.kill();
}
