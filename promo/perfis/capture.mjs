// Telas reais do app para o vídeo "um perfil em cada servidor": o mesmo Henrique é ele mesmo no
// servidor da faculdade, "Sir Kael, o Paladino" na mesa de RPG e "Zéfiro, o Mago" na outra mesa.
// Dados de mentira (Henrique, Lari, Theo, Júlia); avatares e banner desenhados aqui (arte nossa).
// Uso: npm run build && node promo/perfis/capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from '../../e2e/_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3241;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/perfis/shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = readFileSync(path.resolve('promo/game.mjs'), 'utf8').replace(/^export /gm, '');

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-perfis-') },
  stdio: 'ignore',
});
const api = async (p, body, token, method) =>
  (await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => ({}));
const upload = async (p, png, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: 'POST', headers: { 'content-type': 'image/png', authorization: `Bearer ${token}` }, body: png });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
};

// ---------- arte nossa (SVG simples) ----------
const AVATARS = {
  // o Henrique "de sempre": rapaz de fone de ouvido
  henrique: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ddc97"/><stop offset="1" stop-color="#5a4bd6"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/><path d="M96 512c10-96 76-150 160-150s150 54 160 150z" fill="#1f2b44"/>
    <circle cx="256" cy="230" r="104" fill="#e9b48c"/><path d="M150 214c0-74 50-120 106-120s108 40 108 116c-24-36-66-50-106-48-40 2-80 14-108 52z" fill="#2b1d16"/>
    <circle cx="218" cy="240" r="11" fill="#2b1d16"/><circle cx="296" cy="240" r="11" fill="#2b1d16"/><path d="M222 286q34 26 68 0" stroke="#2b1d16" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M136 236a120 120 0 0 1 240 0" stroke="#111" stroke-width="22" fill="none"/><rect x="118" y="222" width="40" height="74" rx="18" fill="#3ddc97"/><rect x="354" y="222" width="40" height="74" rx="18" fill="#3ddc97"/></svg>`,
  // Sir Kael, o Paladino: elmo com pluma e escudo
  paladino: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#3b5bdb"/><stop offset="1" stop-color="#0f1a4a"/></radialGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/><path d="M256 70c40 10 70 30 84 70-30-20-56-26-84-26z" fill="#e03131"/>
    <path d="M150 190c0-70 46-110 106-110s106 40 106 110v120c0 40-40 70-106 80-66-10-106-40-106-80z" fill="#adb5bd" stroke="#f1c232" stroke-width="10"/>
    <rect x="168" y="236" width="176" height="22" rx="8" fill="#212529"/><rect x="246" y="258" width="20" height="96" rx="6" fill="#212529"/>
    <path d="M256 92v120" stroke="#f1c232" stroke-width="12"/>
    <path d="M330 330l90-30v80c0 50-40 80-90 96-50-16-90-46-90-96v-80z" fill="#1c3faa" stroke="#f1c232" stroke-width="10" transform="translate(40 10) scale(.8)"/>
    <path d="M330 340v120M280 395h100" stroke="#f1c232" stroke-width="12" transform="translate(40 10) scale(.8)"/></svg>`,
  // Zéfiro, o Mago: chapéu de estrelas e barba
  mago: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b0d4f"/><stop offset="1" stop-color="#6b2fb3"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/><g fill="#ffe066"><circle cx="70" cy="80" r="5"/><circle cx="440" cy="120" r="6"/><circle cx="400" cy="40" r="4"/><circle cx="110" cy="200" r="4"/></g>
    <circle cx="256" cy="282" r="86" fill="#f0c9a5"/><path d="M168 300c10 120 60 170 88 170s78-50 88-170c-30 30-60 40-88 40s-58-10-88-40z" fill="#f1f3f5"/>
    <circle cx="226" cy="276" r="10" fill="#222"/><circle cx="288" cy="276" r="10" fill="#222"/>
    <path d="M120 236h272c-20-20-50-30-70-34L262 40c-6-10-14-10-20 0l-50 162c-30 4-56 14-72 34z" fill="#1b2a8a"/>
    <g fill="#ffe066"><path d="M250 120l8 16 18 2-13 12 3 18-16-9-16 9 3-18-13-12 18-2z"/><circle cx="210" cy="190" r="7"/><circle cx="300" cy="200" r="6"/></g></svg>`,
};

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(400);
  }
  browser = await chromium.launch();
  // desenha as artes em PNG
  const art = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const png = {};
  for (const [k, svg] of Object.entries(AVATARS)) {
    await art.setContent(`<body style="margin:0">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body>`);
    png[k] = await art.locator('svg').screenshot();
  }
  await art.setViewportSize({ width: 960, height: 340 });
  await art.setContent(`<body style="margin:0"><canvas id=c width=960 height=340></canvas><script>${GAME}; drawGame(document.getElementById('c'), 7.5, { boost: 0.4 });</script></body>`);
  png.banner = await art.locator('canvas').screenshot();
  await art.close();

  const reg = (u, d) => api('/auth/register', { username: u, password: 'Pao-de-Queijo-77', displayName: d, acceptTerms: true });
  const hen = await reg('henrique', 'Henrique');
  const lari = await reg('lari', 'Lari');
  const theo = await reg('theo', 'Theo');
  const ju = await reg('julia', 'Júlia');
  await upload('/me/avatar', png.henrique, hen.token);
  await upload('/me/banner', png.banner, hen.token);
  await api('/me', { bio: 'Engenharia 🎓 · mesa de RPG às sextas 🎲', pronouns: 'ele/dele', links: [{ type: 'steam', url: 'https://steamcommunity.com/id/henrique' }] }, hen.token, 'PATCH');
  for (const [u, b] of [[hen, 'cidade-neon'], [lari, 'espaco'], [theo, 'corrida'], [ju, 'fliperama']]) await api('/me', { callBanner: `preset:${b}` }, u.token, 'PATCH');

  // três servidores, três "Henriques"
  const mk = async (owner, name, members) => {
    const { guild } = await api('/guilds', { name }, owner.token);
    for (const u of members) await api(`/invites/${guild.inviteCode}/join`, {}, u.token);
    return guild;
  };
  const fac = await mk(lari, 'Faculdade · Engenharia', [hen, theo, ju]);
  const rpg = await mk(theo, 'Mesa de RPG 🐉', [hen, lari, ju]);
  const mas = await mk(ju, 'Masmorra das Quintas 🕯️', [hen, theo]);
  const nick = (g, u, n) => api(`/guilds/${g.id}/members/@me/nick`, { nick: n }, u.token, 'PATCH');
  await nick(rpg, hen, 'Sir Kael, o Paladino');
  await nick(rpg, theo, 'Mestre 🎲');
  await nick(rpg, lari, 'Lyra, a Arqueira');
  await nick(rpg, ju, 'Brum, o Anão');
  await upload(`/guilds/${rpg.id}/members/@me/avatar`, png.paladino, hen.token);
  await nick(mas, hen, 'Zéfiro, o Mago');
  await nick(mas, ju, 'Mestra 🕯️');
  await nick(mas, theo, 'Grok, o Bárbaro');
  await upload(`/guilds/${mas.id}/members/@me/avatar`, png.mago, hen.token);

  const say = async (g, u, content) => api(`/channels/${g.channels.find((c) => c.type === 'text').id}/messages`, { content }, u.token);
  await say(fac, lari, 'alguém já fez a lista de cálculo? 😭');
  await say(fac, theo, 'faltam 3 questões, bora fazer junto na call hoje?');
  await say(fac, hen, 'bora! 19h na sala de estudo 📚');
  await say(fac, ju, 'levo o resumo de física 👍');
  await say(rpg, theo, 'Vocês chegam na porta da masmorra. Ela está trancada. O que vocês fazem?');
  await say(rpg, hen, 'Ergo o escudo e vou na frente 🛡️');
  await say(rpg, lari, 'Fico atrás com o arco pronto 🏹');
  await say(rpg, ju, 'Eu derrubo a porta no machado. 🪓');
  await say(rpg, theo, 'Rolem iniciativa! 🎲');
  await say(mas, ju, 'Um dragão acorda no fundo da caverna... 🐉');
  await say(mas, hen, 'Zéfiro conjura uma bola de fogo! 🔥');
  await say(mas, theo, 'Grok corre gritando 🪓😤');

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), hen.token);
  const ph = await ctx.newPage();
  ph.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await ph.goto(`${BASE}/app`);
  await ph.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
  const shot = async (name) => {
    await sleep(700);
    await ph.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  };
  const open = async (g, lastMsg) => {
    await ph.getByRole('button', { name: g.name, exact: true }).first().click();
    await ph.getByRole('button', { name: 'geral' }).first().click();
    await ph.getByText(lastMsg).waitFor();
  };
  await open(fac, 'levo o resumo de física');
  await shot('fac-chat');
  // cartão do perfil (o de sempre)
  await ph.locator('.members').getByText('Henrique').first().click();
  await sleep(600);
  await shot('fac-perfil');
  await ph.keyboard.press('Escape');

  await open(rpg, 'Rolem iniciativa!');
  await shot('rpg-chat');
  await ph.locator('.members').getByText('Sir Kael, o Paladino').first().click();
  await sleep(600);
  await shot('rpg-perfil');
  await ph.keyboard.press('Escape');
  // "Meu perfil neste servidor"
  await ph.locator('.guild-name').click();
  await ph.getByRole('button', { name: 'Meu perfil neste servidor' }).click();
  await ph.getByRole('dialog', { name: 'Meu perfil neste servidor' }).waitFor();
  await shot('rpg-meu-perfil');
  await ph.keyboard.press('Escape');

  await open(mas, 'Grok corre gritando');
  await shot('mas-chat');
  console.log('\nTelas em promo/out/perfis/shots');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
