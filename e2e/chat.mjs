// Teste do chat completo: responder, @menções (autocompletar, destaque e contador),
// reações, envio de imagens (arrastar/soltar, com redução de tamanho) e visualizador.
// Uso: npm run build && node e2e/chat.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3129;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-chat-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana' });
  const bia = await api('/auth/register', { username: 'bia', password: 'segredo123', displayName: 'Bia' });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/guilds/${guild.id}/channels`, { name: 'memes', type: 'text' }, ana.token);

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(BASE);
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  const geralA = pa.getByPlaceholder('Conversar em #geral');
  const geralB = pb.getByPlaceholder('Conversar em #geral');

  // ---- responder + @menção com autocompletar ----
  await geralA.fill('Alguém aí pra jogar?');
  await geralA.press('Enter');
  const original = pb.locator('.message', { hasText: 'Alguém aí pra jogar?' });
  await original.hover();
  await original.getByRole('button', { name: 'Responder' }).click();
  await pb.getByText('Respondendo a').waitFor();
  await geralB.pressSequentially('@an');
  await pb.getByRole('option', { name: /Ana/ }).waitFor();
  await geralB.press('Enter');
  await geralB.pressSequentially('tô dentro!');
  if ((await geralB.inputValue()) !== '@ana tô dentro!') throw new Error(`autocompletar errado: ${await geralB.inputValue()}`);
  await geralB.press('Enter');
  const reply = pa.locator('.message', { hasText: 'tô dentro!' });
  await reply.locator('.reply-line', { hasText: 'Alguém aí pra jogar?' }).waitFor({ timeout: 5000 });
  await reply.locator('.mention.me', { hasText: '@Ana' }).waitFor();
  if (!(await reply.evaluate((el) => el.classList.contains('mentioned')))) throw new Error('mensagem não ficou destacada');
  step('Bia respondeu a Ana com @menção (autocompletar com Enter); Ana vê a citação e o destaque');

  // ---- contador de menções fora do canal ----
  await pa.getByRole('button', { name: 'memes' }).click();
  await geralB.fill('@ana olha o #geral');
  await geralB.press('Enter');
  await pa.locator('.channel', { hasText: 'geral' }).locator('.count-badge', { hasText: '1' }).waitFor({ timeout: 5000 });
  await pa.screenshot({ path: `${shots}/12-mencao-contador.png` });
  await pa.getByRole('button', { name: 'geral', exact: false }).first().click();
  await pa.locator('.channel', { hasText: 'geral' }).locator('.count-badge').waitFor({ state: 'detached' });
  step('menção em outro canal mostra contador, que some ao abrir o canal');

  // ---- reações ----
  const replyB = pb.locator('.message', { hasText: 'tô dentro!' });
  await reply.hover();
  await reply.getByRole('button', { name: 'Reagir' }).click();
  await pa.getByRole('button', { name: 'Reagir com 🔥' }).click();
  await replyB.getByRole('button', { name: /🔥 1/ }).waitFor({ timeout: 5000 });
  await replyB.getByRole('button', { name: /🔥 1/ }).click();
  await reply.getByRole('button', { name: /🔥 2, você reagiu/ }).waitFor({ timeout: 5000 });
  await reply.getByRole('button', { name: /🔥 2/ }).click();
  await replyB.getByRole('button', { name: /🔥 1, você reagiu/ }).waitFor({ timeout: 5000 });
  step('reações chegam em tempo real; clicar soma e clicar de novo tira');

  // ---- imagem grande arrastada para o chat (deve ser reduzida) ----
  const originalBytes = await pb.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 2250;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) % 255;
      img.data[i + 1] = (i * 13) % 255;
      img.data[i + 2] = Math.random() * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.97));
    const file = new File([blob], 'print do jogo.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const chat = document.querySelector('.chat');
    chat.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    chat.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return blob.size;
  });
  await pb.locator('.pending.done').waitFor({ timeout: 20000 });
  await geralB.fill('olha esse print');
  await geralB.press('Enter');
  const imgMsg = pa.locator('.message', { hasText: 'olha esse print' });
  await imgMsg.locator('.attachment img').waitFor({ timeout: 10000 });
  await pa.waitForFunction(() => {
    const img = [...document.querySelectorAll('.attachment img')].pop();
    return img && img.complete && img.naturalWidth > 0;
  });
  const info = await imgMsg.locator('.attachment img').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight, src: img.src }));
  const sentBytes = Number((await (await fetch(info.src)).arrayBuffer()).byteLength);
  if (info.w > 2560) throw new Error(`imagem não foi reduzida: ${info.w}px`);
  step(
    `imagem 4000×2250 (${(originalBytes / 1e6).toFixed(1)} MB) arrastada: chegou ${info.w}×${info.h} com ${(sentBytes / 1e6).toFixed(2)} MB`,
  );

  await imgMsg.locator('.attachment').click();
  await pa.locator('.lightbox img').waitFor();
  await pa.screenshot({ path: `${shots}/13-lightbox.png` });
  await pa.keyboard.press('Escape');
  await pa.locator('.lightbox').waitFor({ state: 'detached' });
  step('clicar na imagem amplia; Esc fecha');

  // ---- apagar a original: a resposta mostra "apagada" ----
  const origA = pa.locator('.message', { hasText: 'Alguém aí pra jogar?' }).first();
  await origA.hover();
  pa.once('dialog', (d) => d.accept());
  await origA.getByRole('button', { name: 'Excluir' }).click();
  await pb.locator('.reply-line', { hasText: 'Mensagem original apagada' }).waitFor({ timeout: 5000 });
  await pb.reload();
  await pb.locator('.reply-line', { hasText: 'Mensagem original apagada' }).waitFor({ timeout: 10000 });
  step('original apagada: a resposta mostra "Mensagem original apagada" (inclusive depois de recarregar)');

  await pa.screenshot({ path: `${shots}/14-chat-completo.png` });
  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
