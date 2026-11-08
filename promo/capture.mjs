// Captura telas REAIS do Resenha (servidor local com dados de exemplo) para o vídeo de divulgação.
// Uso: npm run build && node promo/capture.mjs   (gera promo/out/shots/*.png e shots.json com as posições)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const PORT = 3150;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/shots');
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-promo-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => (/erro|error/i.test(String(d)) ? process.stderr.write(`[server] ${d}`) : null));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const boxes = {};
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function upload(p, bytes, type, token) {
  const res = await fetch(`${BASE}/api${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': type }, body: Buffer.from(bytes) });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
  return res.json();
}

let browser;
const sockets = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }

  browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  // ---------- arte gerada no navegador (avatares, emojis e figurinhas originais) ----------
  const art = await browser.newPage();
  await art.setContent('<body style="margin:0"></body>');
  const draw = (spec) =>
    art.evaluate(async (spec) => {
      const c = document.createElement('canvas');
      c.width = spec.w;
      c.height = spec.h;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, spec.w, spec.h);
      if (spec.bg) {
        grd.addColorStop(0, spec.bg[0]);
        grd.addColorStop(1, spec.bg[1]);
        g.fillStyle = grd;
        if (spec.circle) {
          g.beginPath();
          g.arc(spec.w / 2, spec.h / 2, spec.w / 2 - 2, 0, Math.PI * 2);
          g.fill();
        } else g.fillRect(0, 0, spec.w, spec.h);
      }
      if (spec.pattern) {
        g.globalAlpha = 0.18;
        g.fillStyle = '#fff';
        for (let i = 0; i < 40; i++) {
          g.beginPath();
          g.arc((i * 137) % spec.w, (i * 71) % spec.h, 6 + (i % 5) * 6, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (spec.emoji) {
        g.font = `${spec.emojiSize}px "Noto Color Emoji"`;
        if (spec.outline) {
          g.shadowColor = '#fff';
          for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-4, -4], [4, 4], [-4, 4], [4, -4]]) g.fillText(spec.emoji, spec.w / 2 + dx, spec.emojiY + dy);
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = '#fff';
          g.fillRect(0, 0, spec.w, spec.h);
          g.globalCompositeOperation = 'source-over';
        }
        g.fillText(spec.emoji, spec.w / 2, spec.emojiY);
      }
      if (spec.text) {
        g.font = `900 ${spec.textSize}px Inter`;
        g.lineWidth = spec.textSize / 5;
        g.strokeStyle = spec.stroke ?? '#111';
        g.lineJoin = 'round';
        g.strokeText(spec.text, spec.w / 2, spec.textY);
        g.fillStyle = spec.textColor ?? '#fff';
        g.fillText(spec.text, spec.w / 2, spec.textY);
      }
      const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    }, spec);

  const avatar = (emoji, a, b) => draw({ w: 256, h: 256, bg: [a, b], emoji, emojiSize: 150, emojiY: 140 });
  const people = [
    { username: 'henrique', displayName: 'Henrique', av: ['🦁', '#f97316', '#ef4444'] },
    { username: 'lucas', displayName: 'Lucas', av: ['🐺', '#3b82f6', '#1e3a8a'] },
    { username: 'bia', displayName: 'Bia', av: ['🦊', '#ec4899', '#8b5cf6'] },
    { username: 'pedro', displayName: 'Pedrão', av: ['🐸', '#22c55e', '#065f46'] },
    { username: 'duda', displayName: 'Duda', av: ['🐼', '#eab308', '#c2410c'] },
  ];
  const users = {};
  for (const p of people) {
    const r = await api('/auth/register', { username: p.username, password: 'segredo123', displayName: p.displayName });
    users[p.username] = r;
    await upload('/me/avatar', await avatar(...p.av), 'image/png', r.token);
  }
  const H = users.henrique.token;
  await upload('/me/banner', await draw({ w: 960, h: 340, bg: ['#f97316', '#7c3aed'], pattern: true }), 'image/png', H);
  await api('/me', { bio: 'Cansei de pagar Nitro, então fiz o meu. 🦁', pronouns: 'ele/dele', links: [{ type: 'twitch', url: 'https://twitch.tv/henrique' }, { type: 'steam', url: 'https://steamcommunity.com/id/henrique' }] }, H, 'PATCH');
  await api('/me', { bio: 'Main duelista. Se eu morri foi lag. 🐺', pronouns: 'ele/dele', links: [{ type: 'twitch', url: 'https://twitch.tv/lucas' }] }, users.lucas.token, 'PATCH');
  await upload('/me/banner', await draw({ w: 960, h: 340, bg: ['#1e3a8a', '#06b6d4'], pattern: true }), 'image/png', users.lucas.token);
  await api('/me', { status: { text: 'rankeando até 23h', emoji: '🎧', expiresInMinutes: null } }, users.pedro.token, 'PATCH');

  const { guild } = await api('/guilds', { name: 'Resenha dos Crias' }, H);
  for (const u of ['lucas', 'bia', 'pedro', 'duda']) await api(`/invites/${guild.inviteCode}/join`, {}, users[u].token);
  await upload(`/guilds/${guild.id}/icon`, await draw({ w: 256, h: 256, bg: ['#22c55e', '#0ea5e9'], emoji: '🎮', emojiSize: 150, emojiY: 140 }), 'image/png', H);
  await api(`/guilds/${guild.id}`, { description: 'A call de todo dia 🔥' }, H, 'PATCH');
  const text = guild.channels.find((c) => c.type === 'text');
  const voiceCh = guild.channels.find((c) => c.type === 'voice');
  await api(`/channels/${voiceCh.id}`, { name: 'Jogatina' }, H, 'PATCH');
  await api(`/guilds/${guild.id}/channels`, { name: 'prints', type: 'text' }, H);
  await api(`/guilds/${guild.id}/channels`, { name: 'memes', type: 'text' }, H);
  await api(`/guilds/${guild.id}/channels`, { name: 'Valorant 5v5', type: 'voice' }, H);
  const mod = await api(`/guilds/${guild.id}/roles`, { name: 'Mod', color: '#ef4444', permissions: 0 }, H).catch(() => null);
  const crias = await api(`/guilds/${guild.id}/roles`, { name: 'Crias', color: '#22c55e', permissions: 0 }, H).catch(() => null);
  const roleId = (r) => r?.role?.id ?? r?.id;
  if (mod) await api(`/guilds/${guild.id}/members/${users.lucas.user.id}/roles`, { roleIds: [roleId(mod)] }, H, 'PUT').catch((e) => console.warn(e.message));
  if (crias) for (const u of ['bia', 'pedro', 'duda']) await api(`/guilds/${guild.id}/members/${users[u].user.id}/roles`, { roleIds: [roleId(crias)] }, H, 'PUT').catch((e) => console.warn(e.message));

  // emojis e figurinhas (arte original)
  const em = {};
  const emojiArt = {
    pog: { emoji: '😲', bg: ['#a855f7', '#6d28d9'] },
    kkkk: { emoji: '🤣', bg: ['#facc15', '#f97316'] },
    hype: { emoji: '🔥', text: 'HYPE', bg: ['#ef4444', '#7f1d1d'] },
    gg: { text: 'GG', bg: ['#22c55e', '#15803d'] },
    sus: { emoji: '🤨', bg: ['#38bdf8', '#1d4ed8'] },
  };
  for (const [name, a] of Object.entries(emojiArt)) {
    const bytes = await draw({ w: 128, h: 128, bg: a.bg, circle: true, emoji: a.emoji, emojiSize: a.text ? 60 : 84, emojiY: a.text ? 50 : 70, text: a.text, textSize: a.emoji ? 30 : 56, textY: a.emoji ? 98 : 68 });
    em[name] = (await upload(`/guilds/${guild.id}/expressions?kind=emoji&name=${name}`, bytes, 'image/png', H)).expression;
  }
  const stickerArt = [
    { name: 'GG EZ', emoji: '🏆', text: 'GG EZ' },
    { name: 'bora jogar', emoji: '🎮', text: 'BORA?' },
    { name: 'foi lag', emoji: '📡', text: 'FOI LAG' },
  ];
  const stickers = [];
  for (const s of stickerArt) {
    const bytes = await draw({ w: 320, h: 320, emoji: s.emoji, emojiSize: 170, emojiY: 135, outline: true, text: s.text, textSize: 62, textY: 268, textColor: '#fde047' });
    stickers.push((await upload(`/guilds/${guild.id}/expressions?kind=sticker&name=${encodeURIComponent(s.name)}`, bytes, 'image/png', H)).expression);
  }
  // sons (tons curtos gerados aqui)
  const wav = (freqs) => {
    const rate = 8000, n = rate;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freqs[Math.floor((i / n) * freqs.length)] * i) / rate) * 9000), 44 + i * 2);
    return buf;
  };
  for (const [name, emoji, f] of [['Buzina', '📯', [440, 440, 330]], ['Risada', '😂', [600, 500, 600, 500]], ['Vitória', '🏆', [523, 659, 784]], ['Bruh', '💀', [180]], ['Tambor', '🥁', [120, 240]], ['Aplausos', '👏', [900, 700]]]) {
    await upload(`/guilds/${guild.id}/expressions?kind=sound&name=${encodeURIComponent(name)}&emoji=${encodeURIComponent(emoji)}`, wav(f), 'audio/wav', H);
  }
  await api(`/guilds/${guild.id}/members/${users.duda.user.id}/nick`, { nick: 'Duda 🐼' }, users.duda.token, 'PATCH');

  // conversa
  const say = (u, body) => api(`/channels/${text.id}/messages`, typeof body === 'string' ? { content: body } : body, users[u].token);
  const react = (u, id, emoji) => api(`/messages/${id}/reactions`, { emoji }, users[u].token);
  const tok = (e) => `<:${e.name}:${e.id}>`;
  await say('pedro', 'alguém on pra ranked hoje?');
  await say('bia', 'bora!! 22h? 🎮');
  await say('lucas', `${tok(em.pog)}${tok(em.pog)}`);
  const m1 = (await say('henrique', '@todos hoje tem resenha às 22h 🔥 já liguei o soundboard')).message;
  for (const u of ['lucas', 'bia', 'pedro', 'duda']) await react(u, m1.id, '🔥');
  for (const u of ['bia', 'duda', 'lucas']) await react(u, m1.id, tok(em.hype));
  await react('pedro', m1.id, tok(em.kkkk));
  await say('duda', { content: '', stickerId: stickers[1].id });
  const m2 = (await say('pedro', `perdi de novo ${tok(em.kkkk)} ${tok(em.kkkk)}`)).message;
  await react('lucas', m2.id, tok(em.sus));
  await say('lucas', { content: '', stickerId: stickers[2].id });
  await say('bia', `${tok(em.gg)} ${tok(em.hype)} amanhã tem revanche`);

  // "Jogando agora" (o app de desktop faria isso sozinho)
  for (const [u, game] of [['lucas', 'Valorant'], ['bia', 'Minecraft'], ['henrique', 'Valorant']]) {
    const s = io(BASE, { auth: { token: users[u].token }, transports: ['websocket'] });
    sockets.push(s);
    await new Promise((r) => s.on('ready', r));
    s.emit('activity:set', { name: game });
  }

  // ---------- telas ----------
  const open = async (u, opts) => {
    const ctx = await browser.newContext({ permissions: ['microphone', 'camera'], ...opts });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.voiceSettings', JSON.stringify({ sounds: false, screenPreset: '1080p60' }));
    }, users[u].token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(BASE);
    await page.getByText('Resenha dos Crias').first().waitFor({ timeout: 15000 }).catch(() => {});
    return page;
  };
  const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  const phone = { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

  const hd = await open('henrique', desk);
  await hd.getByRole('button', { name: 'Resenha dos Crias' }).first().click().catch(() => {});
  await hd.getByText('amanhã tem revanche').waitFor({ timeout: 10000 });
  await sleep(800);
  await hd.screenshot({ path: `${OUT}/desk-chat.png` });
  const rect = async (page, sel) => {
    const b = await page.locator(sel).first().boundingBox();
    return b && { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  boxes.deskChat = {
    rail: await rect(hd, '.server-rail, .rail'),
    sidebar: await rect(hd, '.sidebar'),
    chat: await rect(hd, '.chat, .chat-view, main'),
    members: await rect(hd, '.members'),
    w: 1440,
    h: 900,
  };

  // celular: chat com emojis e figurinhas
  const bp = await open('bia', phone);
  await bp.getByRole('button', { name: 'Resenha dos Crias' }).first().click().catch(() => {});
  await bp.getByText('geral').first().click().catch(() => {});
  await bp.getByText('amanhã tem revanche').waitFor({ timeout: 10000 });
  await sleep(800);
  await bp.screenshot({ path: `${OUT}/phone-chat.png` });

  // celular: perfil do Lucas (Jogando Valorant)
  await bp.locator('.message', { hasText: 'FOI LAG' }).getByRole('button').first().click().catch(() => {});
  await bp.locator('.message .author-name', { hasText: 'Lucas' }).first().click();
  await bp.locator('.profile-modal').getByText('Jogando Valorant').waitFor({ timeout: 8000 });
  await sleep(800);
  await bp.screenshot({ path: `${OUT}/phone-profile.png` });
  boxes.phoneProfile = await rect(bp, '.profile-modal');
  await bp.keyboard.press('Escape');
  await bp.getByRole('button', { name: 'Fechar' }).first().click().catch(() => {});

  // chamada: todos entram na Jogatina
  const pages = { henrique: hd, bia: bp };
  pages.lucas = await open('lucas', desk);
  for (const u of ['pedro', 'duda']) pages[u] = await open(u, { viewport: { width: 900, height: 700 } });
  for (const u of ['henrique', 'lucas', 'pedro', 'duda']) {
    await pages[u].getByRole('button', { name: 'Jogatina' }).first().click();
    await pages[u].getByText('Voz conectada').waitFor({ timeout: 20000 });
  }
  // Henrique transmite a tela
  await hd.getByRole('button', { name: 'Transmitir tela' }).click();
  await hd.getByRole('button', { name: 'Escolher tela e transmitir' }).click();
  await hd.getByText('Sua tela').waitFor({ timeout: 20000 });
  await hd.keyboard.press('Escape');
  // Bia (celular) entra e assiste
  await bp.getByRole('button', { name: 'Abrir menu' }).click().catch(() => {});
  await bp.getByRole('button', { name: 'Jogatina' }).first().click();
  await bp.getByText('Voz conectada').first().waitFor({ timeout: 20000 });
  // Lucas (PC) assiste a tela: é a visão de quem está do outro lado
  const lu = pages.lucas;
  await lu.getByRole('button', { name: 'Assistir transmissão' }).click();
  await lu.locator('.tile.screen video').waitFor({ timeout: 20000 });
  await sleep(3000);
  await lu.screenshot({ path: `${OUT}/desk-call.png` });
  boxes.deskCall = { screenTile: await rect(lu, '.tile.screen'), video: await rect(lu, '.tile.screen video'), stage: await rect(lu, '.voice-stage, .stage'), w: 1440, h: 900 };

  // soundboard no celular: Bia abre o painel e toca
  await bp.locator('.voice-controls').getByRole('button', { name: 'Soundboard' }).click();
  await bp.getByRole('dialog', { name: 'Soundboard' }).waitFor();
  await sleep(500);
  await bp.screenshot({ path: `${OUT}/phone-soundboard.png` });
  boxes.phoneSoundboard = { panel: await rect(bp, '.soundboard-panel'), buzina: await rect(bp, '.sound-btn:has-text("Buzina")') };
  await bp.getByRole('button', { name: 'Tocar Buzina' }).click();
  await bp.keyboard.press('Escape');
  await sleep(350);
  await bp.screenshot({ path: `${OUT}/phone-call-burst.png` });
  boxes.phoneCall = { tiles: await bp.locator('.tile.user').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, name: e.textContent }; })) };

  boxes.scale = { desk: 2, phone: 2.625 };
  writeFileSync(path.resolve('promo/out/shots.json'), JSON.stringify(boxes, null, 1));
  console.log('telas capturadas em promo/out/shots');
} catch (err) {
  console.error('✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.disconnect());
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
