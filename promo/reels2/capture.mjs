// Telas reais do app para o Reels 2 (supressão de ruído, ouvindo/jogando agora, configurações novas
// e "e mais": enquete com quem votou, banners da call, eventos, relatar problema).
// Dados de mentira (Henrique, Lari, Theo, Júlia); música, artista e jogo também inventados.
// Uso: npm run build && node promo/reels2/capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3221;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/reels2/shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-reels2-') },
  stdio: 'ignore',
});
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

let browser;
const sockets = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Pao-de-Queijo-77', displayName: d, acceptTerms: true });
  const hen = await reg('henrique', 'Henrique');
  const lari = await reg('lari', 'Lari');
  const theo = await reg('theo', 'Theo');
  const ju = await reg('julia', 'Júlia');
  const { guild } = await api('/guilds', { name: 'Resenha dos Crias' }, hen.token);
  for (const u of [lari, theo, ju]) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
  for (const [name, u] of [['lari', lari], ['theo', theo]]) {
    await api('/friends', { username: name }, hen.token);
    await api(`/friends/${hen.user.id}/accept`, {}, u.token);
  }
  // banners da call (temas nossos)
  for (const [u, b] of [[hen, 'cidade-neon'], [lari, 'espaco'], [theo, 'corrida'], [ju, 'fliperama']]) await api('/me', { callBanner: `preset:${b}` }, u.token, 'PATCH');
  const geral = guild.channels.find((c) => c.type === 'text').id;
  const say = (t, content, extra = {}) => api(`/channels/${geral}/messages`, { content, ...extra }, t.token);
  await say(lari, 'quem topa campeonato sábado? 🏆');
  await say(theo, 'eu! já marquei no Eventos');
  const poll = await say(lari, '', { poll: { question: 'Que horas começa o campeonato?', options: ['19h', '20h', '21h'], hours: 24 } });
  const pid = poll.message?.id;
  for (const [u, o] of [[lari, 1], [theo, 2], [ju, 2], [hen, 2]]) {
    const r = await api(`/messages/${pid}/poll`, { options: [o] }, u.token, 'POST');
    if (r.status >= 400) await api(`/messages/${pid}/poll`, { options: [o] }, u.token, 'PUT');
  }
  const sat = new Date(Date.now() + 3 * 86_400_000);
  sat.setHours(21, 0, 0, 0);
  await api(`/guilds/${guild.id}/events`, { title: 'Campeonato da Resenha 🏆', description: 'Corrida Neon, 4 jogadores. Quem ganhar escolhe o próximo jogo.', startsAt: sat.toISOString() }, hen.token);

  // "Ouvindo agora" (Lari) e "Jogando agora" (Theo): é o que o app de Windows manda sozinho
  const connect = (token) =>
    new Promise((resolve, reject) => {
      const s = io(BASE, { auth: { token }, transports: ['websocket'] });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  const sl = await connect(lari.token);
  const st = await connect(theo.token);
  sockets.push(sl, st);
  sl.emit('activity:set', { name: 'Noite de Call', kind: 'music', details: 'Os Crias do Beat' });
  st.emit('activity:set', { name: 'Corrida Neon', kind: 'game' });
  await sleep(500);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ['microphone'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ noiseMode: 'gtcrn' }));
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
    return page;
  };
  const shot = async (page, name) => {
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  };

  const ph = await open(hen.token);
  await ph.getByRole('button', { name: 'geral' }).first().click();
  await ph.getByText('Que horas começa o campeonato?').waitFor();
  await shot(ph, 'membros-atividades');
  // perfil da Lari, com a música
  await ph.locator('.members').getByText('Lari').first().click();
  await ph.getByText('Ouvindo no Spotify').waitFor({ timeout: 8000 });
  await shot(ph, 'perfil-ouvindo');
  await ph.keyboard.press('Escape');
  await ph.locator('.members').getByText('Theo').first().click();
  await ph.getByText(/Jogando Corrida Neon/).first().waitFor({ timeout: 8000 });
  await shot(ph, 'perfil-jogando');
  await ph.keyboard.press('Escape');
  // enquete: quem votou
  await ph.getByRole('button', { name: 'Ver quem votou' }).click().catch(() => {});
  await shot(ph, 'enquete-votos');
  // eventos
  await ph.getByRole('button', { name: /Eventos/ }).first().click();
  await ph.getByText('Campeonato da Resenha').first().waitFor();
  await shot(ph, 'eventos');
  await ph.keyboard.press('Escape');

  // configurações: uma tela por categoria
  await ph.getByRole('button', { name: 'Configurações', exact: true }).click();
  for (const [label, name] of [
    ['Minha conta', 'cfg-conta'],
    ['Perfil', 'cfg-perfil'],
    ['Aparência', 'cfg-aparencia'],
    ['Segurança', 'cfg-seguranca'],
    ['Privacidade e dados', 'cfg-privacidade'],
    ['Voz e vídeo', 'cfg-voz'],
    ['Notificações e sons', 'cfg-notificacoes'],
    ['Atalhos e app', 'cfg-atalhos'],
  ]) {
    await ph.locator('.settings-nav, nav').getByRole('button', { name: label, exact: true }).first().click();
    await shot(ph, name);
  }
  // supressão de ruído: "Forte (IA)"
  await ph.getByRole('button', { name: 'Voz e vídeo', exact: true }).first().click();
  const forte = ph.getByText('Forte (IA) · recomendada').first();
  await forte.scrollIntoViewIfNeeded().catch(() => {});
  await shot(ph, 'cfg-ruido');
  await ph.keyboard.press('Escape');

  // call com banners + relatar problema
  const join = async (page) => {
    await page.getByRole('button', { name: 'Sala de voz' }).first().click();
    const b = page.getByRole('button', { name: 'Entrar na chamada' });
    if (await b.isVisible().catch(() => false)) await b.click();
    await page.getByText('Voz conectada').waitFor({ timeout: 15000 });
  };
  const pl = await open(lari.token);
  const pt = await open(theo.token);
  const pj = await open(ju.token);
  for (const p of [ph, pl, pt, pj]) await join(p);
  await sleep(2500);
  await shot(ph, 'call-banners');
  await ph.getByRole('button', { name: 'Relatar problema da call' }).click();
  await ph.getByText(/O que encontramos/).waitFor({ timeout: 20000 });
  await shot(ph, 'relatar-problema');
  console.log('\nTelas em promo/out/reels2/shots');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.close());
  await browser?.close();
  server.kill();
}
