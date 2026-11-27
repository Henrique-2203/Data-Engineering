// Acesso ao banco. Em producao usa PostgreSQL de verdade (DATABASE_URL); nos testes, um PostgreSQL embutido (PGlite).
import pg from 'pg';

export const SCHEMA = 'playlink';

// Banco real: cada consulta roda numa transacao curta com o search_path certo
// (funciona tambem com o "connection pooler" do Supabase, que nao guarda configuracoes da sessao).
export function conectar(url) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  const comClient = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL search_path = ${SCHEMA}, public`);
      const r = await fn((s, p) => c.query(s, p));
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  };
  return {
    query: (s, p) => comClient((q) => q(s, p)),
    tx: (fn) => comClient((q) => fn({ query: q })),
    close: () => pool.end(),
  };
}

// Banco de teste (PGlite): o mesmo SQL, sem precisar instalar nada.
export async function conectarTeste(arquivosSql) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  const db = new PGlite();
  for (const f of arquivosSql) await db.exec(await readFile(f, 'utf8'));
  await db.exec(`SET search_path = ${SCHEMA}, public`);
  return {
    query: (s, p) => db.query(s, p),
    tx: (fn) => db.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
    close: () => db.close(),
  };
}
