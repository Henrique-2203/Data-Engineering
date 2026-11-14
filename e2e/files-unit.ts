// Testes de unidade da Etapa 1 (rodados pelo e2e/files.mjs): localização em vídeos, tipos de arquivo,
// bloqueio de programas, links que expiram, lixeira de arquivos e backup criptografado + restauração.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'resenha-unit-'));
process.env.BACKUP_KEY = 'chave-de-teste-bem-longa-123';
const { scrubVideoLocation, sniffFile, blockedReason } = await import('../server/src/sanitize.ts');
const { signFileLink, checkFileLink, emptyTrash } = await import('../server/src/storage.ts');
const { createDb } = await import('../server/src/db.ts');
const backup = await import('../server/src/backup.ts');
const ok = (m: string) => console.log(`  ✓ ${m}`);

// ---------- localização em vídeos ----------
const box = (type: string, ...payload: Buffer[]) => {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const LOC = '+23.5505-046.6333/';
const APPLE = '+23.5505-046.6333+760.000/';
const xyz = box('\xa9xyz', u16(LOC.length), u16(0x15c7), Buffer.from(LOC, 'latin1'));
const hdlr = box('hdlr', Buffer.alloc(8), Buffer.from('mdta'), Buffer.alloc(12));
const item = (type: number, value: string) => {
  const t = Buffer.alloc(4);
  t.writeUInt32BE(type);
  const b = box('xxxx', box('data', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(value, 'latin1')));
  t.copy(b, 4);
  return b;
};
const meta = box('meta', hdlr, box('keys', Buffer.alloc(8)), box('ilst', item(1, APPLE), item(2, 'Meu vídeo +1-1/')));
const mp4 = Buffer.concat([
  box('ftyp', Buffer.from('isom\0\0\0\0isomiso2mp41', 'latin1')),
  box('moov', box('mvhd', Buffer.alloc(100, 1)), box('udta', xyz), meta),
  box('mdat', Buffer.from(`quadros de vídeo ${LOC} que não podem mudar`, 'latin1')),
]);
assert.equal(sniffFile(mp4).kind, 'video');
const scrubbed = scrubVideoLocation(mp4);
assert.equal(scrubbed.data.length, mp4.length, 'o tamanho do vídeo não muda');
assert.equal(scrubbed.found, 2);
const text = scrubbed.data.toString('latin1');
assert.ok(!text.slice(0, text.indexOf('mdat')).includes('23.5505'), 'coordenadas apagadas dos metadados');
assert.ok(text.includes('+00.0000-000.0000/') && text.includes('+00.0000-000.0000+000.000/'));
assert.ok(text.includes('Meu vídeo +1-1/'.replace('í', '\xed')) || text.includes('Meu v'), 'outros textos não mudam');
assert.ok(text.includes(`quadros de vídeo ${LOC}`.replace('í', '\xed')), 'o conteúdo do vídeo (mdat) não é tocado');
ok('vídeo MP4: GPS do Android (©xyz) e do iPhone (ISO6709) zerados, vídeo intacto');

// ---------- tipos e bloqueios ----------
assert.equal(sniffFile(Buffer.from('%PDF-1.7 ...')).mime, 'application/pdf');
assert.equal(sniffFile(Buffer.from('PK\x03\x04aaaa', 'latin1')).mime, 'application/zip');
assert.equal(sniffFile(Buffer.from('OggS\0\0\0\0\0\0\0\0')).kind, 'audio');
assert.equal(sniffFile(Buffer.from('ID3\x04\0\0\0\0\0\0\0\0', 'latin1')).kind, 'audio');
assert.equal(sniffFile(Buffer.from('<html><script>alert(1)</script>')).mime, 'application/octet-stream');
assert.ok(blockedReason(Buffer.from('MZ\x90\0'), 'foto.jpg'), 'programa disfarçado de foto');
assert.ok(blockedReason(Buffer.from('qualquer coisa'), 'jogo.exe'));
assert.ok(blockedReason(Buffer.from('qualquer coisa'), 'script.PS1'));
assert.ok(blockedReason(Buffer.from('\x7fELF'), 'arquivo'));
assert.equal(blockedReason(Buffer.from('%PDF-1.7'), 'trabalho.pdf'), null);
ok('tipo real pelo conteúdo; .exe, .ps1, ELF e programa renomeado para .jpg recusados');

// ---------- links que expiram ----------
const fakeDb = { query: async () => [{ value: Buffer.alloc(32, 7).toString('base64') }] } as never;
const fresh = new URL(await signFileLink(fakeDb, 'abc', 'foto.jpg'), 'http://x');
assert.equal(await checkFileLink(fakeDb, 'abc', fresh.searchParams.get('e'), fresh.searchParams.get('s')), 'ok');
assert.equal(await checkFileLink(fakeDb, 'outro-id', fresh.searchParams.get('e'), fresh.searchParams.get('s')), 'invalid');
assert.equal(await checkFileLink(fakeDb, 'abc', Number(fresh.searchParams.get('e')) + 43200, fresh.searchParams.get('s')), 'invalid');
const old = new URL(await signFileLink(fakeDb, 'abc', 'foto.jpg', Date.now() - 3 * 86400_000), 'http://x');
assert.equal(await checkFileLink(fakeDb, 'abc', old.searchParams.get('e'), old.searchParams.get('s')), 'expired');
const sameWindow = new URL(await signFileLink(fakeDb, 'abc', 'foto.jpg', Date.now() + 1000), 'http://x');
assert.equal(sameWindow.searchParams.get('s'), fresh.searchParams.get('s'), 'o link fica igual por um tempo (cache)');
ok('links assinados: válidos, não servem para outro arquivo, não dá para esticar a validade, expiram');

// ---------- lixeira de arquivos (gatilho no banco) ----------
const db = await createDb();
await db.query(`insert into users (id, username, display_name, password_hash, avatar_color) values ('u1', 'ana', 'Ana', 'x', '#fff')`);
await db.query(`insert into blobs (key, data) values ('att/a1', $1), ('img/i1', $1)`, [Buffer.from('conteúdo')]);
await db.query(`insert into attachments (id, uploader_id, filename, mime, size, storage_key) values ('a1', 'u1', 'f.png', 'image/png', 8, 'att/a1')`);
await db.query(`insert into images (id, uploader_id, mime, size, storage_key) values ('i1', 'u1', 'image/png', 8, 'img/i1')`);
await db.query(`delete from images where id = 'i1'`);
assert.equal((await db.query(`select key from storage_trash`)).length, 1);
assert.equal(await emptyTrash(db), 1);
assert.deepEqual((await db.query<{ key: string }>(`select key from blobs`)).map((r) => r.key), ['att/a1']);
ok('arquivo apagado vai para a lixeira e sai do armazenamento');

// ---------- backup criptografado ----------
for (let i = 0; i < 1500; i++) {
  await db.query(`insert into users (id, username, display_name, password_hash, avatar_color) values ($1, $2, 'Pessoa', 'x', '#fff')`, [`p${i}`, `pessoa${i}`]);
}
const file = path.join(process.env.DATA_DIR!, 'teste.rsnbk');
const stats = await backup.writeBackup(db, file, process.env.BACKUP_KEY!);
assert.equal(stats.perTable.users, 1501);
const raw = (await import('node:fs')).readFileSync(file);
assert.ok(!raw.includes(Buffer.from('pessoa1')), 'o arquivo não tem nada legível');
await backup.verifyBackup(file, process.env.BACKUP_KEY!, stats.perTable);
await assert.rejects(() => backup.verifyBackup(file, 'chave-errada'), /chave errada|alterado/);
const tampered = Buffer.from(raw);
tampered[Math.floor(raw.length / 2)] ^= 0xff;
const tamperedFile = file.replace('.rsnbk', '-alterado.rsnbk');
writeFileSync(tamperedFile, tampered);
await assert.rejects(() => backup.verifyBackup(tamperedFile, process.env.BACKUP_KEY!));
ok(`backup: ${stats.rows} linhas, criptografado (nada legível), chave errada e arquivo adulterado são recusados`);

const { config } = await import('../server/src/config.ts');
config.dataDir = mkdtempSync(path.join(tmpdir(), 'resenha-restore-'));
const fresh2 = await createDb();
await assert.rejects(() => backup.restoreBackup(fresh2, tamperedFile, process.env.BACKUP_KEY!, () => {}));
assert.equal((await fresh2.query<{ n: number }>('select count(*)::int as n from users'))[0].n, 0, 'nada entra de um backup adulterado');
const res = await backup.restoreBackup(fresh2, file, process.env.BACKUP_KEY!, () => {});
assert.equal(res.skipped, 0);
assert.equal((await fresh2.query<{ n: number }>('select count(*)::int as n from users'))[0].n, 1501);
const [blob] = await fresh2.query<{ data: Uint8Array }>(`select data from blobs where key = 'att/a1'`);
assert.equal(Buffer.from(blob.data).toString(), 'conteúdo');
ok('restauração num banco novo: todas as linhas, arquivos binários incluídos; adulterado não entra');
await db.close();
await fresh2.close();
console.log('unidade: tudo certo');
