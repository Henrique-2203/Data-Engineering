// Etapa 1 (fundação): envio de arquivos, GPS removido, links protegidos que expiram, cotas, "Meus arquivos",
// painel Sistema e backup criptografado conferido.
// Uso: npm run build && node e2e/files.mjs            (arquivos no banco)
//      node e2e/files.mjs --r2                        (arquivos num S3 local, simulando o Cloudflare R2; precisa do moto_server)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const R2 = process.argv.includes('--r2');
const PORT = R2 ? 3152 : 3151;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'resenha-files-'));
const step = (msg) => console.log(`✓ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
};

// ---------- S3 local (simula o R2) ----------
let moto;
const S3_PORT = 5055;
const r2env = {};
if (R2) {
  const bin = process.env.MOTO_SERVER ?? 'moto_server';
  moto = spawn(bin, ['-p', String(S3_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://localhost:${S3_PORT}/`);
      break;
    } catch {
      await sleep(500);
    }
  }
  const { AwsClient } = require('aws4fetch');
  const aws = new AwsClient({ accessKeyId: 'teste', secretAccessKey: 'teste', service: 's3', region: 'us-east-1' });
  const res = await aws.fetch(`http://localhost:${S3_PORT}/resenha`, { method: 'PUT' });
  assert(res.ok, `criar bucket: ${res.status}`);
  Object.assign(r2env, {
    R2_ENDPOINT: `http://localhost:${S3_PORT}`,
    R2_BUCKET: 'resenha',
    R2_ACCESS_KEY_ID: 'teste',
    R2_SECRET_ACCESS_KEY: 'teste',
    R2_REGION: 'us-east-1',
  });
}

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    ...r2env,
    PORT: String(PORT),
    DATA_DIR,
    PLATFORM_ADMINS: 'ana',
    BACKUP_KEY: 'chave-secreta-de-teste-0123456789',
    USER_QUOTA_MB: '3',
    GUILD_QUOTA_MB: '40',
    MAX_FILE_MB: '25',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
async function upload(token, channelId, name, data) {
  const res = await fetch(`${BASE}/api/attachments?channelId=${channelId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
    body: data,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const get = (url, opts) => fetch(url.startsWith('http') ? url : `${BASE}${url}`, opts);

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  if (R2) assert(serverLog.includes('Cloudflare R2'), 'servidor usando o R2');

  const reg = (u, d) => api('/auth/register', { username: u, password: 'segredo123', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');

  // ---------- foto com GPS ----------
  const gpsJpg = readFileSync('e2e/fixtures/foto-gps.jpg');
  const before = await sharp(gpsJpg).metadata();
  assert(before.exif && before.orientation === 6, 'a foto de teste tem GPS e está girada');
  const foto = await upload(ana.token, geral.id, 'férias na praia.jpg', gpsJpg);
  assert(foto.status === 200 && foto.attachment.kind === 'image', `envio da foto: ${JSON.stringify(foto)}`);
  assert(foto.attachment.url.includes('?e=') && foto.attachment.url.includes('&s='), 'link assinado');
  const fotoRes = await get(foto.attachment.url);
  assert(fotoRes.ok, `abrir a foto: ${fotoRes.status}`);
  const stored = Buffer.from(await fotoRes.arrayBuffer());
  const after = await sharp(stored).metadata();
  assert(!after.exif && !after.xmp && !after.iptc, 'sem EXIF/XMP/IPTC depois do envio');
  assert(!stored.includes(Buffer.from('Galaxy S99')) && !stored.includes(Buffer.from('Samsung')), 'sem modelo do celular');
  assert(after.width === 20 && after.height === 40, `foto aplicou a rotação antes de tirar os metadados (${after.width}x${after.height})`);
  assert(foto.attachment.width === 20 && foto.attachment.height === 40, 'medidas reais lidas pelo servidor');
  step('foto: GPS, modelo do celular e outros metadados removidos no servidor; rotação mantida; medidas reais');

  const png = readFileSync('e2e/fixtures/limpa.png');
  const limpa = await upload(ana.token, geral.id, 'limpa.png', png);
  const pngBack = Buffer.from(await (await get(limpa.attachment.url)).arrayBuffer());
  assert(pngBack.equals(png), 'imagem sem metadados vai como está (sem perder qualidade)');
  step('imagem sem metadados não é recomprimida');

  // ---------- outros arquivos ----------
  const pdf = await upload(ana.token, geral.id, 'trabalho final.pdf', Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'));
  assert(pdf.status === 200 && pdf.attachment.kind === 'file' && pdf.attachment.name === 'trabalho final.pdf', `pdf: ${JSON.stringify(pdf)}`);
  const pdfRes = await get(pdf.attachment.url, { redirect: R2 ? 'manual' : 'follow' });
  if (R2) {
    assert(pdfRes.status === 302, `R2: redireciona para link temporário (${pdfRes.status})`);
    const loc = pdfRes.headers.get('location');
    assert(loc.startsWith(`http://localhost:${S3_PORT}/resenha/att/`) && loc.includes('X-Amz-Signature') && loc.includes('X-Amz-Expires'), 'link do R2 assinado');
    assert(decodeURIComponent(loc).includes('attachment;'), 'R2: PDF baixa, não abre');
    const direct = await get(loc);
    assert(direct.ok && Buffer.from(await direct.arrayBuffer()).toString().startsWith('%PDF'), 'R2: baixa o arquivo pelo link temporário');
    // (o simulador local não confere assinaturas; o R2 de verdade recusa link adulterado ou vencido)
    step('R2: arquivo baixado direto do armazenamento por link temporário assinado (SigV4, com validade)');
  } else {
    assert(pdfRes.headers.get('content-disposition').startsWith('attachment;'), 'PDF sempre baixa');
    assert(pdfRes.headers.get('content-security-policy').includes('sandbox'), 'arquivo nunca roda como página do site');
  }
  const html = await upload(ana.token, geral.id, 'golpe.html', Buffer.from('<html><script>fetch("/api/me")</script></html>'));
  assert(html.attachment.kind === 'file', 'HTML vira arquivo comum');
  const htmlRes = await get(html.attachment.url, { redirect: 'follow' });
  assert(!/text\/html/.test(htmlRes.headers.get('content-type') ?? ''), 'HTML nunca é servido como página');
  step('PDF e outros arquivos sempre baixam; HTML enviado nunca vira página do site');

  // vídeo MP4 com GPS
  const box = (type, ...payload) => {
    const body = Buffer.concat(payload);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const LOC = '+23.5505-046.6333/';
  const xyz = box('\xa9xyz', Buffer.from([0, LOC.length, 0x15, 0xc7]), Buffer.from(LOC, 'latin1'));
  const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isomiso2mp41', 'latin1')), box('moov', box('udta', xyz)), box('mdat', Buffer.alloc(64, 7))]);
  const video = await upload(ana.token, geral.id, 'rolê.mp4', mp4);
  assert(video.attachment.kind === 'video', 'vídeo vira player');
  const videoBack = Buffer.from(await (await get(video.attachment.url)).arrayBuffer());
  assert(!videoBack.includes(Buffer.from('23.5505')) && videoBack.length === mp4.length, 'GPS do vídeo zerado, tamanho igual');
  if (!R2) {
    const part = await get(video.attachment.url, { headers: { range: 'bytes=0-15' } });
    assert(part.status === 206 && (await part.arrayBuffer()).byteLength === 16, 'vídeo pula para o meio (Range)');
  }
  step('vídeo: localização apagada e player com avanço (Range)');

  // programas
  for (const [name, data] of [
    ['jogo.exe', Buffer.from('MZ\x90\x00\x03', 'latin1')],
    ['foto-inocente.jpg', Buffer.from('MZ\x90\x00\x03', 'latin1')],
    ['instalar.bat', Buffer.from('@echo off')],
    ['app.apk', Buffer.from('PK\x03\x04', 'latin1')],
  ]) {
    const r = await upload(ana.token, geral.id, name, data);
    assert(r.status === 415, `${name} recusado (${r.status})`);
  }
  step('programas e scripts recusados, inclusive .exe renomeado para .jpg');

  // ---------- mensagem e acesso ----------
  const sent = await api(`/channels/${geral.id}/messages`, { content: 'olha as fotos', attachmentIds: [foto.attachment.id, pdf.attachment.id, video.attachment.id] }, ana.token);
  assert(sent.message?.attachments.length === 3 && sent.message.attachments.every((a) => a.url), 'mensagem com 3 anexos e links');
  const asBia = await api(`/channels/${geral.id}/messages`, null, bia.token);
  const biaFoto = asBia.messages.at(-1).attachments.find((a) => a.kind === 'image');
  assert((await get(biaFoto.url)).ok, 'membro do servidor abre');
  const caioLink = await api(`/attachments/${foto.attachment.id}/link`, {}, caio.token);
  assert(caioLink.status === 404, 'quem não está no servidor não consegue link novo');
  const biaLink = await api(`/attachments/${foto.attachment.id}/link`, {}, bia.token);
  assert(biaLink.url, 'membro consegue link novo (renovação)');
  const bare = await get(`/api/attachments/${foto.attachment.id}/foto.jpg`);
  assert(bare.status === 403, `link sem assinatura não abre (${bare.status})`);
  const forged = foto.attachment.url.replace(/s=[^&]+/, 's=' + 'A'.repeat(32));
  assert((await get(forged)).status === 403, 'assinatura falsa não abre');
  const stretched = foto.attachment.url.replace(/e=(\d+)/, (_, e) => `e=${Number(e) + 86400 * 365}`);
  assert((await get(stretched)).status === 403, 'não dá para esticar a validade');
  const other = foto.attachment.url.replace(foto.attachment.id, pdf.attachment.id);
  assert((await get(other)).status === 403, 'o link de um arquivo não abre outro');
  step('links protegidos: só quem está na conversa recebe; sem assinatura, falsificado, esticado ou trocado não abre');

  // DM
  const dm = await api('/dms', { userId: bia.user.id }, ana.token);
  assert(dm.dm, `abrir DM: ${JSON.stringify(dm)}`);
  dm.channel = dm.dm;
  {
    const dmFile = await upload(ana.token, dm.channel.id, 'só pra bia.txt', Buffer.from('segredo entre amigas'));
    await api(`/channels/${dm.channel.id}/messages`, { content: '', attachmentIds: [dmFile.attachment.id] }, ana.token);
    assert((await api(`/attachments/${dmFile.attachment.id}/link`, {}, bia.token)).url, 'na DM, a outra pessoa abre');
    assert((await api(`/attachments/${dmFile.attachment.id}/link`, {}, caio.token)).status === 404, 'na DM, ninguém de fora abre');
    step('arquivos em DM: só as duas pessoas da conversa');
  }

  // ---------- cotas ----------
  const big = await upload(bia.token, geral.id, 'grande.bin', Buffer.alloc(2 * 1024 * 1024, 1));
  assert(big.status === 200, `primeiro arquivo grande cabe (${big.status} ${big.error ?? ''})`);
  const over = await upload(bia.token, geral.id, 'outro.bin', Buffer.alloc(1.5 * 1024 * 1024, 2));
  assert(over.status === 413 && /espaço de arquivos está cheio/.test(over.error), `cota da pessoa (${over.status} ${over.error})`);
  step(`cota por pessoa: "${over.error}"`);
  const strangerUpload = await upload(caio.token, geral.id, 'x.txt', Buffer.from('oi'));
  assert(strangerUpload.status === 404, 'não dá para enviar arquivo para canal de servidor alheio');

  // ---------- meus arquivos ----------
  const mine = await api('/me/files', null, ana.token);
  assert(mine.files.length === 4 && mine.usage.usedBytes > 0, `meus arquivos lista o que foi enviado (${mine.files?.length})`);
  const del = await api(`/me/files/${pdf.attachment.id}`, null, ana.token, 'DELETE');
  assert(del.usage.files < mine.usage.files || del.usage.usedBytes < mine.usage.usedBytes, 'apagar libera espaço');
  const after2 = await api(`/channels/${geral.id}/messages`, null, bia.token);
  assert(after2.messages.at(-1).attachments.length === 2, 'o arquivo some da mensagem para todos');
  step('Meus arquivos: lista, apaga e o arquivo some da conversa');

  // ---------- painel Sistema e backup ----------
  assert((await api('/admin/system', null, bia.token)).status === 404, 'só a equipe vê o painel Sistema');
  const run = await api('/admin/backups/run', {}, ana.token);
  assert(run.ok, `backup manual: ${JSON.stringify(run)}`);
  const sys = await api('/admin/system', null, ana.token);
  assert(sys.backups[0].ok && sys.backups[0].verified, 'backup feito e conferido');
  assert(sys.storage.where === (R2 ? 'r2' : 'db'), 'mostra onde os arquivos estão');
  if (!R2) {
    const dir = path.join(path.dirname(DATA_DIR), 'backups');
    const files = readdirSync(dir).filter((f) => f.endsWith('.rsnbk'));
    assert(files.length >= 1, 'arquivo de backup salvo');
    const file = path.join(dir, files[0]);
    assert(!readFileSync(file).includes(Buffer.from('segredo123')) && !readFileSync(file).includes(Buffer.from('Galera')), 'backup ilegível sem a chave');
    const check = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/restore-backup.ts', file, '--check'], {
      env: { ...process.env, BACKUP_KEY: 'chave-secreta-de-teste-0123456789' },
      encoding: 'utf8',
    });
    assert(check.status === 0 && /Backup íntegro/.test(check.stdout), `script confere o backup: ${check.stderr}`);
    const restoreDir = mkdtempSync(path.join(tmpdir(), 'resenha-restored-'));
    const restore = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/restore-backup.ts', file], {
      env: { ...process.env, BACKUP_KEY: 'chave-secreta-de-teste-0123456789', DATA_DIR: restoreDir, DATABASE_URL: '' },
      encoding: 'utf8',
    });
    assert(restore.status === 0 && /Pronto/.test(restore.stdout), `restauração: ${restore.stdout} ${restore.stderr}`);
    const wrong = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/restore-backup.ts', file, '--check'], {
      env: { ...process.env, BACKUP_KEY: 'chave-errada' },
      encoding: 'utf8',
    });
    assert(wrong.status !== 0, 'chave errada não abre o backup');
    step('backup criptografado, conferido, restaurado num banco novo pelo script; chave errada não abre');
  } else {
    step('backup criptografado enviado ao R2, baixado de volta e conferido');
  }

  // ---------- no navegador ----------
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), bia.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e));
  page.on('dialog', (d) => void d.accept());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Galera' }).first().click().catch(() => {});
  await page.locator('.message-content', { hasText: 'olha as fotos' }).waitFor({ timeout: 15000 });
  const img = page.locator('.attachments img').first();
  await img.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.attachments img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  assert(await page.locator('.att-video video').count() >= 1, 'player de vídeo na conversa');
  await page.screenshot({ path: path.join(shots, `arquivos-conversa${R2 ? '-r2' : ''}.png`) });

  // enviar um arquivo pelo site
  await page.locator('input[type=file]').first().setInputFiles({ name: 'notas da aula.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 notas') });
  await page.locator('.pending.file.done').waitFor({ timeout: 15000 });
  await page.locator('.composer textarea').fill('notas de hoje');
  await page.keyboard.press('Enter');
  await page.locator('.att-file', { hasText: 'notas da aula.pdf' }).waitFor({ timeout: 15000 });
  // agora um arquivo que estoura a cota (3 MB): o site avisa e marca como falho
  await page.locator('input[type=file]').first().setInputFiles({ name: 'video-grande.zip', mimeType: 'application/zip', buffer: Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(1.5 * 1024 * 1024)]) });
  await page.locator('.pending.error').waitFor({ timeout: 15000 });
  await page.getByText(/espaço de arquivos está cheio/).first().waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(shots, `arquivos-envio${R2 ? '-r2' : ''}.png`) });
  await page.locator('.pending-remove').click();
  step('site: foto, vídeo e arquivo aparecem; envio com cota cheia avisa');

  // Configurações → Meus arquivos
  await page.getByRole('button', { name: /Configurações/ }).first().click();
  await page.getByRole('heading', { name: 'Meus arquivos' }).waitFor();
  await page.getByText(/de 3 MB usados/).waitFor();
  await page.getByRole('heading', { name: 'Meus arquivos' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'meus-arquivos.png') });
  step('Configurações mostram "Meus arquivos" com a cota da pessoa');

  // dono do servidor: espaço do servidor (não mais o banco inteiro)
  const ctxAna = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctxAna.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const pa = await ctxAna.newPage();
  await pa.goto(BASE);
  await pa.getByRole('button', { name: 'Galera' }).first().click().catch(() => {});
  await pa.getByRole('button', { name: /Configurações do servidor|Galera/ }).first().click().catch(() => {});
  const guildSettings = pa.getByRole('menuitem', { name: /Configurações do servidor/ }).or(pa.getByRole('button', { name: /Configurações do servidor/ }));
  if (await guildSettings.count()) await guildSettings.first().click();
  const hasGuildQuota = await pa.getByText('Espaço de arquivos do servidor').isVisible().catch(() => false);
  const hasOld = await pa.getByText(/usados por todo o Resenha/).count();
  assert(hasOld === 0, 'o limite do banco inteiro não aparece mais');
  if (hasGuildQuota) step('configurações do servidor mostram só o espaço do próprio servidor');

  console.log(`\nTUDO CERTO (${R2 ? 'R2' : 'banco'})`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  moto?.kill();
}
