// Testes de ABUSO de upload, mídia e embeds (checklist UPL-01..10, SSRF-01/02, TST-05, TST-07).
// Uso: node e2e/upload-abuse.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const PORT = 3300;
const HONEY = 3301;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
// "isca": um servidor que conta quantas vezes o Resenha foi chamado (nunca deve ser chamado por link de outro lugar)
let honeyHits = [];
const honey = http.createServer((req, res) => {
  honeyHits.push(req.url);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ title: 'T', author_name: 'A' }));
});
await new Promise((r) => honey.listen(HONEY, r));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-uploadabuse-'), PLATFORM_ADMINS: 'equipe', MAX_UPLOAD_MB: '1', EMBED_YOUTUBE_OEMBED: `http://localhost:${HONEY}/oembed` },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let n = 1;
const hdr = (token) => ({ 'x-forwarded-for': `10.50.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) });
const call = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', ...hdr(token) }, body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}' });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const upload = async (token, channelId, data, name, contentType = 'application/octet-stream') => {
  const res = await fetch(`${BASE}/api/attachments?channelId=${channelId}`, { method: 'POST', headers: { 'content-type': contentType, 'x-filename': encodeURIComponent(name), ...hdr(token) }, body: data });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const fetchFile = async (url) => {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe'), ana = await reg('ana'), bia = await reg('bia'), caio = await reg('caio');
  const { guild } = await call('POST', '/guilds', ana.token, { name: 'Galera' });
  await call('POST', `/invites/${guild.inviteCode}/join`, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text').id;
  const PAYLOAD = Buffer.from('<script>alert("xss")</script><?php system($_GET["c"]); ?>MZ-EVIL');

  // ---- UPL-03: imagem com carga escondida no fim (polyglot) volta limpa ----
  const base = { create: { width: 64, height: 64, channels: 3, background: '#3ddc97' } };
  const png = await sharp(base).png().toBuffer();
  const jpg = await sharp(base).jpeg().toBuffer();
  const gif = await sharp(base).gif().toBuffer();
  for (const [nome, buf, mime] of [['png', png, 'image/png'], ['jpg', jpg, 'image/jpeg'], ['gif', gif, 'image/gif']]) {
    const up = await upload(ana.token, geral, Buffer.concat([buf, PAYLOAD]), `foto.${nome}`, mime);
    check(up.status === 200, `UPL-03: upload de ${nome} com carga no fim falhou (${up.status} ${up.error})`);
    if (up.status !== 200) continue;
    const got = await fetchFile(up.attachment.url);
    check(!got.buf.includes('<script>') && !got.buf.includes('system($_GET') && !got.buf.includes('MZ-EVIL'), `UPL-03: ${nome} voltou COM a carga escondida (polyglot não foi limpo)`);
    check(got.headers.get('content-type') === mime, `UPL: ${nome} servido como ${got.headers.get('content-type')}`);
    check(got.headers.get('x-content-type-options') === 'nosniff', `UPL-09: ${nome} sem nosniff`);
    check(/sandbox/.test(got.headers.get('content-security-policy') ?? ''), `UPL: ${nome} sem CSP sandbox`);
    check((await sharp(got.buf).metadata()).width === 64, `UPL-03: ${nome} limpo deixou de ser uma imagem válida`);
  }
  step('UPL-03: PNG, JPEG e GIF com HTML/script/programa colado no final voltam reescritos e limpos (e continuam imagens válidas)');

  // ---- UPL-01/05/06: o que parece imagem mas não é, nunca é servido inline ----
  const html = Buffer.from('<!doctype html><script>fetch("/api/me/security")</script>');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const cases = [['página HTML disfarçada de PNG', html, 'foto.png', 'image/png'], ['SVG com script', svg, 'logo.svg', 'image/svg+xml'], ['SVG disfarçado de PNG', svg, 'logo.png', 'image/png'], ['HTML .html', html, 'pagina.html', 'text/html']];
  for (const [nome, buf, fname, mime] of cases) {
    const up = await upload(ana.token, geral, buf, fname, mime);
    if (up.status !== 200) {
      check(up.status === 415, `UPL-01: ${nome}: recusa com status inesperado ${up.status}`);
      continue;
    }
    const got = await fetchFile(up.attachment.url);
    const ct = got.headers.get('content-type') ?? '';
    check(up.attachment.kind === 'file', `UPL-01: ${nome} virou "${up.attachment.kind}" (devia ser arquivo para baixar)`);
    check(!/html|svg|xml|javascript/i.test(ct), `UPL-05: ${nome} servido como ${ct}`);
    check(/^attachment/.test(got.headers.get('content-disposition') ?? ''), `UPL-06: ${nome} servido inline (sem Content-Disposition: attachment)`);
    check(got.headers.get('x-content-type-options') === 'nosniff', `UPL-09: ${nome} sem nosniff`);
  }
  step('UPL-01/05/06: HTML ou SVG com script (mesmo renomeados para .png) viram arquivo para BAIXAR, nunca são exibidos pelo navegador');

  // ---- programas e tipos mentirosos ----
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
  for (const [nome, buf, fname, mime] of [['.exe', exe, 'virus.exe', 'application/octet-stream'], ['PE disfarçado de .jpg', exe, 'foto.jpg', 'image/jpeg'], ['script .js', Buffer.from('alert(1)'), 'a.js', 'text/javascript'], ['ELF', Buffer.concat([Buffer.from('\x7fELF'), Buffer.alloc(100)]), 'x.png', 'image/png'], ['.bat', Buffer.from('del *'), 'x.bat', 'text/plain']]) {
    const up = await upload(ana.token, geral, buf, fname, mime);
    check(up.status === 415, `UPL-01: ${nome} não foi recusado (status ${up.status})`);
  }
  step('UPL-01: programas (.exe, .js, .bat, executável Linux, "foto.jpg" que é programa) são recusados');

  // ---- UPL-04: nome do arquivo ----
  const nomes = ['../../etc/passwd', 'a\u202egnp.exe', 'foto\u0000.png', 'x'.repeat(400) + '.png', '/etc/shadow', 'C:\\Windows\\sys.png', '..\\..\\boot.png', '<img src=x onerror=alert(1)>.png'];
  for (const nome of nomes) {
    const up = await upload(ana.token, geral, png, nome, 'image/png');
    if (up.status !== 200) continue;
    const nm = up.attachment.name;
    check(!/[\/\\\u202a-\u202e\u2066-\u2069\u0000<>]|\.\./.test(nm) && nm.length <= 110, `UPL-04: nome "${nome.slice(0, 30)}" virou "${nm}"`);
  }
  step('UPL-04: nomes com ../, barras, caracteres invertidos (U+202E), byte nulo, HTML ou 400 letras são limpos pelo servidor');

  // ---- UPL-02: tamanho e "bomba" de pixels ----
  const big = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
  check((await upload(ana.token, geral, big, 'grande.png', 'image/png')).status === 413, 'UPL-02: imagem de 2 MB passou do limite de 1 MB');
  const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
  const bombUp = await upload(ana.token, geral, bomb, 'bomba.png', 'image/png');
  check(bombUp.status === 413 || bombUp.status === 415, `UPL-02: PNG 7000×7000 (49 megapixels) aceito (${bombUp.status}, ${bomb.length} bytes)`);
  step('UPL-02: arquivo acima do limite e PNG minúsculo que vira 49 megapixels são recusados');

  // ---- UPL-10: acesso aos anexos de conversas privadas ----
  const dm = await call('POST', '/dms', ana.token, { userId: bia.user.id });
  const dmId = dm.dm?.id ?? dm.dm?.channelId;
  const dmUp = await upload(ana.token, dmId, png, 'segredo.png', 'image/png');
  const dmMsg = await call('POST', `/channels/${dmId}/messages`, ana.token, { content: 'olha', attachmentIds: [dmUp.attachment?.id] });
  check(dmMsg.status === 200, `setup: mensagem com anexo na DM falhou (${dmMsg.status} ${dmMsg.error})`);
  for (const [quem, u] of [['de fora', caio], ['equipe da plataforma', equipe]]) {
    check((await call('POST', `/attachments/${dmUp.attachment.id}/link`, u.token)).status === 404, `UPL-10: ${quem} conseguiu link novo de anexo de DM alheia`);
  }
  check((await call('POST', `/attachments/${dmUp.attachment.id}/link`, bia.token)).status === 200, 'UPL-10: participante da DM não consegue o link');
  const goodUrl = new URL(BASE + dmUp.attachment.url);
  check((await fetchFile(goodUrl.toString())).status === 200, 'link assinado válido deixou de funcionar');
  const tampered = new URL(goodUrl);
  tampered.searchParams.set('s', 'a'.repeat(tampered.searchParams.get('s').length));
  check((await fetchFile(tampered.toString())).status === 403, 'UPL: link com assinatura adulterada foi aceito');
  const stretched = new URL(goodUrl);
  stretched.searchParams.set('e', String(Number(stretched.searchParams.get('e')) + 86400 * 365));
  check((await fetchFile(stretched.toString())).status === 403, 'UPL: validade esticada no link foi aceita');
  const other = new URL(goodUrl);
  other.pathname = other.pathname.replace(dmUp.attachment.id, '00000000-0000-0000-0000-000000000000');
  check([403, 404].includes((await fetchFile(other.toString())).status), 'UPL: assinatura de um anexo valeu para outro');
  // banido perde os anexos do servidor
  const gUp = await upload(ana.token, geral, png, 'servidor.png', 'image/png');
  await call('POST', `/channels/${geral}/messages`, ana.token, { content: 'foto', attachmentIds: [gUp.attachment.id] });
  check((await call('POST', `/attachments/${gUp.attachment.id}/link`, bia.token)).status === 200, 'membro não consegue link de anexo do servidor');
  await call('POST', `/guilds/${guild.id}/bans`, ana.token, { userId: bia.user.id });
  check((await call('POST', `/attachments/${gUp.attachment.id}/link`, bia.token)).status === 404, 'UPL-10: banida, a bia ainda gera link novo de anexo do servidor');
  step('UPL-10: link de anexo só para quem enxerga a conversa (nem a equipe, nem quem foi banido); assinatura e validade não se falsificam');

  // ---- SSRF-01/02: prévia de links só fala com YouTube/Spotify ----
  honeyHits = [];
  const ruins = [
    `http://127.0.0.1:${HONEY}/watch?v=aaaaaaaaaaa`, `https://www.youtube.com.evil.example/watch?v=aaaaaaaaaaa`, `https://evil.example/?u=youtube.com/watch?v=aaaaaaaaaaa`,
    `https://youtu.be.evil.example/aaaaaaaaaaa`, `http://169.254.169.254/latest/meta-data/`, `https://user:pass@youtube.com@evil.example/watch?v=aaaaaaaaaaa`,
    `http://localhost:${HONEY}/`, `https://open.spotify.com.evil.example/track/aaaaaaaaaaaa`, `file:///etc/passwd`, `javascript:alert(1)`, `https://youtube.com/watch?v=../../etc/passwd`,
  ];
  for (const u of ruins) {
    const r = await call('GET', `/embed?url=${encodeURIComponent(u)}`, ana.token);
    check(r.status === 404, `SSRF-01: "${u.slice(0, 50)}" não foi recusado (status ${r.status})`);
  }
  check(honeyHits.length === 0, `SSRF-01: o servidor chamou ${honeyHits.length} endereço(s) escolhido(s) pelo usuário: ${honeyHits.join(' ')}`);
  for (const q of ['yt=../../etc/passwd', 'yt=aaaaaaaaaa', 'sp=evil.example/x.jpg', 'sp=localhost:1/x', 'sp=169.254.169.254/x', 'yt=aaaaaaaaaaa%2F..%2Fx']) {
    const r = await fetch(`${BASE}/api/embed/thumb?${q}`, { headers: hdr(ana.token) });
    check(r.status === 404, `SSRF-01: miniatura "${q}" respondeu ${r.status}`);
  }
  check(honeyHits.length === 0, 'SSRF-01: a miniatura chamou um endereço de fora');
  const ok = await call('GET', `/embed?url=${encodeURIComponent('https://youtu.be/aaaaaaaaaaa')}`, ana.token);
  check(ok.status === 200 && honeyHits.length === 1 && honeyHits[0].startsWith('/oembed?'), `SSRF: link legítimo do YouTube deixou de funcionar (${ok.status}, hits ${honeyHits.length})`);
  step('SSRF-01/02: a prévia de links só consulta endereços fixos do YouTube/Spotify; endereços internos, enganosos ou file:// são recusados sem nenhuma chamada');

  if (fails.length) {
    console.error(`\n✗ ${fails.length} falha(s):\n- ${fails.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('\nTudo certo com os testes de abuso de upload.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (fails.length) process.exitCode = 1;
  honey.close();
  server.kill();
}
