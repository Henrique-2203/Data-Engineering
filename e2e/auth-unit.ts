// Testes de unidade de autenticação (checklist AUTH-01, SES-02, AUTH-04): rodado no CI.
//   node --import tsx e2e/auth-unit.ts
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'resenha-authunit-'));
const { hashPassword, verifyPassword, needsRehash, fakeVerify, sessionFromToken } = await import('../server/src/auth.ts');
const { createDb } = await import('../server/src/db.ts');
const ok = (m: string) => console.log(`  ✓ ${m}`);

// ---------- AUTH-01: parâmetros do scrypt ----------
const h = await hashPassword('Cor-Forte-Xis-42');
const [algo, N, r, p] = h.split('$');
assert.equal(algo, 'scrypt');
assert.ok(Number(N) >= 65536 && Number(r) >= 8 && Number(p) >= 1, `parâmetros fracos: N=${N} r=${r} p=${p}`);
assert.ok(await verifyPassword('Cor-Forte-Xis-42', h));
assert.ok(!(await verifyPassword('cor-forte-xis-42', h)));
assert.ok(!needsRehash(h));
ok(`senha nova usa scrypt N=${N} r=${r} p=${p} (parâmetros recomendados pela OWASP) e dois hashes da mesma senha são diferentes`);
assert.notEqual(h, await hashPassword('Cor-Forte-Xis-42'));

// conta antiga (formato antigo, N=2^14) continua entrando e é marcada para regravar
const salt = randomBytes(16);
const legacy = `scrypt$${salt.toString('base64')}$${scryptSync('senha-antiga-123', salt, 64).toString('base64')}`;
assert.ok(await verifyPassword('senha-antiga-123', legacy), 'conta antiga não consegue mais entrar');
assert.ok(!(await verifyPassword('outra', legacy)));
assert.ok(needsRehash(legacy), 'formato antigo deveria ser regravado');
ok('contas antigas continuam entrando e são marcadas para migrar no próximo login certo');

// parâmetros absurdos no hash guardado não podem travar o servidor (nem aceitar lixo)
for (const bad of ['scrypt$99999999999$8$1$QQ==$QQ==', 'scrypt$65536$8$1$QQ==', 'bcrypt$x$y', '', 'scrypt$1$1$1$QQ==$QQ==']) assert.ok(!(await verifyPassword('x', bad)), `aceitou hash inválido: ${bad}`);
ok('hash guardado com parâmetros absurdos ou formato desconhecido é recusado sem travar');

// ---------- AUTH-04: usuário inexistente gasta o mesmo tempo ----------
const time = async (fn: () => Promise<unknown>) => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};
await fakeVerify('aquecer');
const real: number[] = [];
const fake: number[] = [];
for (let i = 0; i < 5; i++) {
  real.push(await time(() => verifyPassword('errada', h)));
  fake.push(await time(() => fakeVerify('errada')));
}
const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
assert.ok(med(fake) >= med(real) * 0.6, `conta inexistente responde rápido demais: ${med(fake).toFixed(0)}ms vs ${med(real).toFixed(0)}ms`);
ok(`tempo de "usuário inexistente" (${med(fake).toFixed(0)} ms) ≈ "senha errada" (${med(real).toFixed(0)} ms): não dá para descobrir quem tem conta pelo tempo`);

// ---------- SES-02: sessão tem prazo absoluto ----------
const db = await createDb();
await db.query(`insert into users (id, username, display_name, password_hash, avatar_color) values ('u1', 'ana', 'Ana', 'x', '#3ddc97')`);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
await db.query(`insert into sessions (token_hash, user_id, created_at) values ($1, 'u1', now() - interval '10 days'), ($2, 'u1', now() - interval '200 days')`, [sha('nova'), sha('velha')]);
await db.query(`update sessions set last_seen_at = now()`);
assert.ok(await sessionFromToken(db, 'nova'), 'sessão recente deveria valer');
assert.equal(await sessionFromToken(db, 'velha'), null, 'sessão com mais de 180 dias de vida valeu mesmo sendo usada hoje');
assert.equal(await sessionFromToken(db, 'x'.repeat(300)), null);
assert.equal(await sessionFromToken(db, undefined), null);
ok('sessão tem prazo máximo de 180 dias de vida, mesmo usada todo dia; token inexistente ou gigante é recusado');

// ---------- DB-07: segredos criptografados no banco ----------
process.env.SECRETS_KEY = 'chave-de-teste-bem-longa-0123456789';
const { sealSecret, openSecret, vaultEnabled } = await import('../server/src/vault.ts');
assert.ok(vaultEnabled());
const sealed = sealSecret('JBSWY3DPEHPK3PXP');
assert.ok(sealed.startsWith('enc:v1:') && !sealed.includes('JBSWY3DPEHPK3PXP'), 'o segredo ficou legível no valor guardado');
assert.equal(openSecret(sealed), 'JBSWY3DPEHPK3PXP');
assert.notEqual(sealSecret('JBSWY3DPEHPK3PXP'), sealed, 'a mesma entrada precisa gerar saídas diferentes (IV aleatório)');
assert.equal(openSecret('JBSWY3DPEHPK3PXP'), 'JBSWY3DPEHPK3PXP', 'valor antigo sem criptografia deveria continuar funcionando');
const tampered = sealed.slice(0, -3) + (sealed.endsWith('AAA') ? 'BBB' : 'AAA');
assert.equal(openSecret(tampered), null, 'valor adulterado foi aceito');
process.env.SECRETS_KEY = 'outra-chave-completamente-diferente-99';
assert.equal(openSecret(sealed), null, 'chave errada abriu o segredo');
delete process.env.SECRETS_KEY;
assert.equal(openSecret(sealed), null, 'sem chave não pode abrir');
assert.equal(sealSecret('x'), 'x', 'sem SECRETS_KEY o comportamento antigo continua');
ok('segredo de 2FA e de bots: AES-256-GCM com chave fora do banco (IV aleatório, adulteração e chave errada falham, valores antigos continuam abrindo)');

await db.close();
console.log('\nTudo certo com a autenticação (unidade).');
