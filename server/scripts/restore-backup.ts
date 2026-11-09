// Restaura um backup do Resenha num banco NOVO (nunca por cima do banco que está no ar).
//
// 1. Baixe o arquivo .rsnbk: Cloudflare → R2 → seu bucket → pasta backups/ → Download
// 2. Crie um banco vazio (ex.: um "branch" novo no Neon) e pegue a connection string dele
// 3. Rode, na raiz do projeto:
//      BACKUP_KEY='sua chave' DATABASE_URL='postgres://...banco-novo...' npx tsx server/scripts/restore-backup.ts caminho/do/arquivo.rsnbk
//    (sem DATABASE_URL, restaura no banco local de teste em DATA_DIR)
// 4. Confira o resultado e troque o DATABASE_URL do Render para o banco novo.
//
// Só conferir se um backup abre (sem restaurar nada):  ... restore-backup.ts arquivo.rsnbk --check
import { createDb } from '../src/db.ts';
import { restoreBackup, verifyBackup } from '../src/backup.ts';

const [file, flag] = process.argv.slice(2);
const key = process.env.BACKUP_KEY;
if (!file || !key) {
  console.error('Uso: BACKUP_KEY=... [DATABASE_URL=...] npx tsx server/scripts/restore-backup.ts <arquivo.rsnbk> [--check|--force]');
  process.exit(1);
}
if (flag === '--check') {
  const counts = await verifyBackup(file, key);
  console.log('Backup íntegro. Linhas por tabela:');
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(22)} ${n}`);
  process.exit(0);
}
const db = await createDb();
const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from users');
if (n > 0 && flag !== '--force') {
  console.error(`Este banco já tem ${n} conta(s). Restaure num banco vazio (ou use --force se tiver certeza).`);
  process.exit(1);
}
const res = await restoreBackup(db, file, key);
console.log(`Pronto: ${res.restored} linhas restauradas${res.skipped ? `, ${res.skipped} ignoradas` : ''}.`);
await db.close();
