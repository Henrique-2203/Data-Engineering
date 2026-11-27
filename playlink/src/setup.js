// Cria as tabelas e os dados de exemplo no banco apontado por DATABASE_URL:
//   DATABASE_URL="postgresql://..." npm run db:setup
// (ou cole os arquivos de sql/ no editor SQL do seu provedor de banco)
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL;
if (!url) { console.error('Defina DATABASE_URL.'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await c.connect();
for (const f of ['01_schema.sql', '02_dados_exemplo.sql']) {
  await c.query(await readFile(new URL(`../sql/${f}`, import.meta.url), 'utf8'));
  console.log('ok:', f);
}
await c.end();
