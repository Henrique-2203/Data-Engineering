// Teste do pacote "o que o Discord cobra": emojis e figurinhas personalizados (usáveis em qualquer
// servidor), soundboard na chamada, apelido e foto por servidor, e as permissões novas.
// Uso: npm run build && node e2e/expressions.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3137;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-expr-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

/** WAV mono 8 kHz com um tom (para o soundboard). */
function wav(seconds, freq = 440) {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), 44 + i * 2);
  return buf;
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
  const caio = await api('/auth/register', { username: 'caio', password: 'segredo123', displayName: 'Caio' });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['microphone', 'camera'] });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      // registra os sons tocados (soundboard)
      window.__played = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.src) window.__played.push(this.src);
        return play.call(this);
      };
    }, token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    await page.goto(`${BASE}/app`);
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);

  // imagens geradas no navegador
  const img = (w, h, color) =>
    pa.evaluate(
      async ({ w, h, color }) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = color;
        g.beginPath();
        g.arc(w / 2, h / 2, Math.min(w, h) / 2.2, 0, Math.PI * 2);
        g.fill();
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        return Array.from(new Uint8Array(await b.arrayBuffer()));
      },
      { w, h, color },
    );
  const tmp = mkdtempSync(path.join(tmpdir(), 'resenha-eimg-'));
  const emojiFile = path.join(tmp, 'Festa Junina!.png');
  const stickerFile = path.join(tmp, 'gato_bravo.png');
  const shortSound = path.join(tmp, 'buzina.wav');
  const longSound = path.join(tmp, 'musica longa.wav');
  const avatarFile = path.join(tmp, 'foto-servidor.png');
  writeFileSync(emojiFile, Buffer.from(await img(600, 600, '#f97316')));
  writeFileSync(stickerFile, Buffer.from(await img(900, 700, '#8b5cf6')));
  writeFileSync(avatarFile, Buffer.from(await img(400, 400, '#22c55e')));
  writeFileSync(shortSound, wav(1));
  writeFileSync(longSound, wav(9, 330));

  // ---------- configurações: emojis, figurinhas e sons ----------
  await pa.locator('.guild-name').click();
  await pa.getByRole('button', { name: 'Configurações do servidor' }).click();
  await pa.getByRole('button', { name: 'Emojis e sons' }).click();
  await pa.getByLabel('Arquivos de emoji').setInputFiles(emojiFile);
  const emojiToast = await pa.getByText(/1 emoji adicionado \(\d+ KB\)/).textContent({ timeout: 10000 });
  await pa.getByLabel('Nome do emoji festa_junina').waitFor();
  await pa.getByLabel('Arquivos de figurinha').setInputFiles(stickerFile);
  await pa.getByText(/1 figurinha adicionada/).waitFor({ timeout: 10000 });
  await pa.getByLabel('Arquivo de som').setInputFiles(shortSound);
  await pa.getByLabel('Emoji do som').fill('📯');
  await pa.getByRole('button', { name: 'Adicionar som' }).click();
  await pa.getByText(/Som adicionado/).waitFor({ timeout: 10000 });
  step(`emoji (${emojiToast}), figurinha e som adicionados; o nome do emoji vem do arquivo (:festa_junina:)`);

  // som longo: recorta 5 s a partir do ponto escolhido e regrava em Opus
  await pa.getByLabel('Arquivo de som').setInputFiles(longSound);
  await pa.getByText(/Duração: 9\.0 s/).waitFor();
  await pa.getByLabel('Nome do som', { exact: true }).fill('Musiquinha');
  await pa.getByRole('button', { name: 'Adicionar som' }).click();
  await pa.getByLabel('Nome do som Musiquinha').waitFor({ timeout: 20000 });
  const { guild: g1 } = await api(`/guilds/${guild.id}`, null, ana.token);
  const musica = g1.expressions.find((e) => e.name === 'Musiquinha');
  const head = await fetch(`${BASE}/api/images/${musica.fileId}`);
  const kb = Math.round((await head.arrayBuffer()).byteLength / 1024);
  if (!/audio\/(webm|ogg)/.test(head.headers.get('content-type'))) throw new Error(`som longo não foi regravado: ${head.headers.get('content-type')}`);
  step(`som de 9 s recortado em 5 s e regravado em Opus (WAV original tinha ${Math.round(wav(9).length / 1024)} KB, ficou ${kb} KB)`);
  await pa.screenshot({ path: `${shots}/25-emojis-e-sons.png` });

  // permissões e validação no servidor
  const raw = await fetch(`${BASE}/api/guilds/${guild.id}/expressions?kind=emoji&name=hack`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bia.token}`, 'content-type': 'image/png' },
    body: Buffer.from(await img(64, 64, '#000')),
  });
  if (raw.status !== 403) throw new Error(`membro comum conseguiu adicionar emoji (${raw.status})`);
  const badName = await fetch(`${BASE}/api/guilds/${guild.id}/expressions?kind=emoji&name=${encodeURIComponent('com espaço')}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ana.token}`, 'content-type': 'image/png' },
    body: Buffer.from(await img(64, 64, '#000')),
  });
  const notImage = await fetch(`${BASE}/api/guilds/${guild.id}/expressions?kind=sticker&name=x`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ana.token}`, 'content-type': 'image/png' },
    body: Buffer.from('<html>não é imagem</html>'),
  });
  if (badName.status !== 400 || notImage.status !== 415) throw new Error(`validação falhou: ${badName.status} ${notImage.status}`);
  step('só quem tem "Gerenciar emojis e sons" adiciona; nome e tipo de arquivo são validados');
  await pa.getByRole('button', { name: 'Fechar' }).click();

  // ---------- chat: :emoji:, reação e figurinha ----------
  await pa.getByPlaceholder('Conversar em #geral').fill('bora jogar hoje?');
  await pa.keyboard.press('Enter');
  const box = pb.getByPlaceholder('Conversar em #geral');
  await pb.getByText('bora jogar hoje?').waitFor();
  await box.fill(':fest');
  await pb.getByRole('listbox', { name: 'Emojis' }).getByText(':festa_junina:').waitFor();
  await pb.keyboard.press('Enter');
  const typed = await box.inputValue();
  if (typed.trim() !== ':festa_junina:') throw new Error(`o campo mostrou "${typed}" em vez de :festa_junina:`);
  await pb.keyboard.press('Enter');
  await pa.locator('.message .emoji-only img.custom-emoji[alt=":festa_junina:"]').waitFor({ timeout: 5000 });
  step('Bia digitou :fest, escolheu o emoji e a Ana vê o emoji grande (mensagem só com emoji)');

  await pb.locator('.message', { hasText: 'bora jogar hoje?' }).hover();
  await pb.locator('.message', { hasText: 'bora jogar hoje?' }).getByRole('button', { name: 'Reagir' }).click();
  await pb.getByRole('button', { name: 'Reagir com :festa_junina:' }).click();
  await pa.locator('.message', { hasText: 'bora jogar hoje?' }).locator('.reaction img.custom-emoji').waitFor({ timeout: 5000 });
  step('reação com emoji personalizado aparece para a Ana');

  await pb.getByRole('button', { name: 'Figurinhas' }).click();
  await pb.getByRole('button', { name: 'Enviar figurinha gato bravo' }).click();
  await pa.locator('.message img.sticker[alt="Figurinha gato bravo"]').waitFor({ timeout: 5000 });
  await pa.screenshot({ path: `${shots}/26-chat-emojis-figurinha.png` });
  step('figurinha enviada pela Bia aparece no chat da Ana');

  // ---------- emoji de outro servidor (o Discord cobra Nitro por isso) ----------
  const outro = await api('/guilds', { name: 'Só eu e o Caio' }, bia.token);
  await api(`/invites/${outro.guild.inviteCode}/join`, {}, caio.token);
  const festa = g1.expressions.find((e) => e.kind === 'emoji');
  const geral2 = outro.guild.channels.find((c) => c.type === 'text');
  const cross = await api(`/channels/${geral2.id}/messages`, { content: `olha esse <:festa_junina:${festa.id}>` }, bia.token);
  if (cross.status !== 200) throw new Error('não conseguiu usar emoji de outro servidor');
  const pubImg = await fetch(`${BASE}/api/emojis/${festa.id}`);
  if (!pubImg.ok || !pubImg.headers.get('content-type').startsWith('image/')) throw new Error('Caio não consegue ver o emoji');
  const caioSticker = await api(`/channels/${geral2.id}/messages`, { stickerId: g1.expressions.find((e) => e.kind === 'sticker').id }, caio.token);
  if (caioSticker.status !== 400) throw new Error('quem não está no servidor da figurinha conseguiu usar');
  step('Bia usa o emoji da Galera em outro servidor; o Caio vê, mas não pode usar figurinhas de onde não está');

  // ---------- apelido e foto por servidor ----------
  await pb.locator('.guild-name').first().click();
  await pb.getByRole('button', { name: 'Meu perfil neste servidor' }).click();
  const dialog = pb.getByRole('dialog', { name: 'Meu perfil neste servidor' });
  await dialog.getByLabel('Apelido neste servidor').fill('Bia Sniper');
  await dialog.locator('input[type=file]').setInputFiles(avatarFile);
  await pb.getByText(/Foto do servidor atualizada/).waitFor({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Salvar apelido' }).click();
  await pb.getByText('Perfil do servidor salvo.').waitFor();
  await pa.locator('.members .member', { hasText: 'Bia Sniper' }).locator('img.avatar-img').waitFor({ timeout: 5000 });
  await pa.locator('.message .author-name', { hasText: 'Bia Sniper' }).first().waitFor();
  const { guild: g2 } = await api(`/guilds/${outro.guild.id}`, null, bia.token);
  if (g2.members.find((m) => m.id === bia.user.id).displayName !== 'Bia') throw new Error('o apelido vazou para outro servidor');
  step('apelido "Bia Sniper" e foto valem só na Galera (no outro servidor continua "Bia")');

  // moderação de apelidos
  const byOwner = await api(`/guilds/${guild.id}/members/${bia.user.id}/nick`, { nick: 'Bia Camper' }, ana.token, 'PATCH');
  const byMember = await api(`/guilds/${guild.id}/members/${ana.user.id}/nick`, { nick: 'Ana boba' }, bia.token, 'PATCH');
  if (byOwner.status !== 200 || byMember.status !== 403) throw new Error(`apelidos: dono ${byOwner.status}, membro ${byMember.status}`);
  await pa.locator('.members .member', { hasText: 'Bia Camper' }).waitFor({ timeout: 5000 });
  step('a dona muda o apelido da Bia; a Bia não muda o da dona');

  // ---------- soundboard ----------
  for (const p of [pa, pb]) {
    await p.getByRole('button', { name: 'Sala de voz' }).click();
    await p.getByText('Voz conectada').waitFor({ timeout: 15000 });
  }
  await pb.locator('.voice-controls').getByRole('button', { name: 'Soundboard' }).click();
  await pb.getByRole('dialog', { name: 'Soundboard' }).getByRole('button', { name: 'Tocar buzina' }).click();
  await pa.locator('.tile .sound-burst', { hasText: '📯' }).waitFor({ timeout: 5000 });
  await pa.screenshot({ path: `${shots}/27-soundboard.png` });
  const played = await pa.waitForFunction(() => window.__played.find((s) => s.includes('/api/images/')), null, { timeout: 5000 });
  step(`soundboard: a Bia toca "buzina" e a Ana ouve (${(await played.jsonValue()).split('/').pop().slice(0, 8)}…) e vê 📯 no bloco dela`);

  // spam: 2º som em menos de 1,5 s é recusado
  await pb.getByRole('dialog', { name: 'Soundboard' }).getByRole('button', { name: 'Tocar Musiquinha' }).click();
  await pb.getByText(/Espere um pouquinho/).waitFor({ timeout: 5000 });
  step('proteção contra "metralhadora" de sons');

  // tirar a permissão de soundboard do @todos
  const perms = g1.everyonePermissions & ~(1 << 12);
  await api(`/guilds/${guild.id}`, { everyonePermissions: perms }, ana.token, 'PATCH');
  await pb.locator('.voice-controls').getByRole('button', { name: 'Soundboard' }).and(pb.locator('[disabled]')).waitFor({ timeout: 5000 });
  step('sem a permissão "Usar o soundboard", o botão fica desativado');

  // apagar o emoji: some das mensagens (vira :nome:) e o arquivo é apagado
  await api(`/expressions/${festa.id}`, null, ana.token, 'DELETE');
  const gone = await fetch(`${BASE}/api/emojis/${festa.id}`);
  const fileGone = await fetch(`${BASE}/api/images/${festa.fileId}`);
  if (gone.status !== 404 || fileGone.status !== 404) throw new Error('emoji apagado continua no banco');
  step('apagar um emoji apaga o arquivo do banco');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
