import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { Router } from 'express';
import { config } from './config.ts';
import type { Db } from './db.ts';
import { HttpError, wrap } from './http.ts';
import { storageUsage } from './access.ts';
import { fileStore, r2Configured } from './storage.ts';
import { isPlatformAdmin } from './reports.ts';
import { emailEnabled, emailStatus, sendEmail } from './email.ts';
import { limit } from './security.ts';
import type { requireAuth } from './auth.ts';

/**
 * Backup automático do banco inteiro, uma vez por dia.
 *
 * - Lê tudo numa "foto" consistente do banco, compacta (gzip) e CRIPTOGRAFA com AES-256-GCM.
 *   A chave sai do BACKUP_KEY, que só existe nas configurações do servidor (e numa cópia sua,
 *   guardada fora do Render). Sem a chave, o arquivo é inútil para quem o encontrar.
 * - Guarda no Cloudflare R2 (pasta backups/). Sem R2, guarda numa pasta local.
 * - Depois de guardar, BAIXA DE VOLTA e confere: abre com a chave, descompacta e conta as linhas.
 *   Backup que não foi testado não conta como backup.
 * - Mantém os últimos BACKUP_KEEP_DAYS dias. Restaurar: server/scripts/restore-backup.ts.
 *
 * Formato (depois de abrir): uma linha JSON por registro. Cabeçalho, depois cada tabela
 * ({"t": nome, "cols": [...], "types": [...]}) seguida das linhas como listas de valores.
 */

const MAGIC = Buffer.from('RSNBK1');
const HEADER = MAGIC.length + 16 + 12; // marca + sal + iv
const TAG = 16;
const SKIP_TABLES = new Set(['storage_trash']);

const deriveKey = (secret: string, salt: Buffer) => scryptSync(secret, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export const backupDir = () => path.resolve(config.dataDir, '..', 'backups');

interface TableInfo {
  name: string;
  cols: string[];
  types: string[];
}

/** Tabelas em ordem de dependência (quem é referenciado vem antes), para restaurar sem quebrar chaves. */
async function tablesInOrder(q: Db['query']): Promise<TableInfo[]> {
  const tables = (
    await q<{ name: string }>(
      `select table_name as name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name`,
    )
  )
    .map((t) => t.name)
    .filter((t) => !SKIP_TABLES.has(t));
  const fks = await q<{ child: string; parent: string }>(
    `select cl.relname as child, pl.relname as parent from pg_constraint c
       join pg_class cl on cl.oid = c.conrelid join pg_class pl on pl.oid = c.confrelid
       join pg_namespace n on n.oid = cl.relnamespace
     where c.contype = 'f' and n.nspname = current_schema()`,
  );
  const cols = await q<{ table_name: string; column_name: string; data_type: string }>(
    `select table_name, column_name, data_type from information_schema.columns where table_schema = current_schema() order by table_name, ordinal_position`,
  );
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const f of fks) if (f.child === t && f.parent !== t) visit(f.parent, stack);
    stack.delete(t);
    seen.add(t);
    order.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return order
    .filter((t) => tables.includes(t))
    .map((name) => {
      const mine = cols.filter((c) => c.table_name === name);
      return { name, cols: mine.map((c) => c.column_name), types: mine.map((c) => c.data_type) };
    });
}

const encodeValue = (v: unknown) => {
  if (v instanceof Uint8Array) return { $b: Buffer.from(v).toString('base64') };
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v;
};

/** Gera as linhas do backup (texto), tabela por tabela, em páginas (pouca memória). */
async function* dumpLines(q: Db['query'], stats: { tables: number; rows: number; perTable: Record<string, number> }) {
  const tables = await tablesInOrder(q);
  yield JSON.stringify({ format: 'resenha-backup', version: 1, createdAt: new Date().toISOString(), tables: tables.map((t) => t.name) }) + '\n';
  for (const t of tables) {
    yield JSON.stringify({ t: t.name, cols: t.cols, types: t.types }) + '\n';
    const heavy = t.types.includes('bytea');
    const page = heavy ? 20 : 1000;
    let n = 0;
    for (let off = 0; ; off += page) {
      const rows = await q(`select * from "${t.name}" order by ctid limit ${page} offset ${off}`);
      let chunk = '';
      for (const r of rows) chunk += JSON.stringify(t.cols.map((c) => encodeValue((r as Record<string, unknown>)[c]))) + '\n';
      if (chunk) yield chunk;
      n += rows.length;
      if (rows.length < page) break;
    }
    stats.tables++;
    stats.rows += n;
    stats.perTable[t.name] = n;
  }
  yield JSON.stringify({ end: true, rows: stats.rows }) + '\n';
}

/** Escreve o backup criptografado num arquivo. */
export async function writeBackup(db: Db, file: string, secret: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const stats = { tables: 0, rows: 0, perTable: {} as Record<string, number> };
  const out = createWriteStream(file);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await db.snapshot((q) => pipeline(Readable.from(dumpLines(q, stats)), createGzip({ level: 6 }), cipher, out, { end: false }));
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
  return stats;
}

/** Abre um backup e entrega as linhas já decodificadas (para conferir ou restaurar). Falha se a chave estiver errada. */
export async function* readBackup(file: string, secret: string): AsyncGenerator<Record<string, unknown> | unknown[]> {
  const size = statSync(file).size;
  if (size < HEADER + TAG) throw new Error('Arquivo de backup incompleto.');
  const fh = await open(file, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  await fh.read(head, 0, HEADER, 0);
  await fh.read(tag, 0, TAG, size - TAG);
  await fh.close();
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Isto não é um backup do Resenha.');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16, HEADER);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  const gunzip = createGunzip();
  const source = createReadStream(file, { start: HEADER, end: size - TAG - 1 });
  // erros de chave/arquivo adulterado aparecem no fim do fluxo
  let failure: Error | null = null;
  const done = pipeline(source, decipher, gunzip).catch((e) => {
    failure = e;
  });
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
  const fail = () => new Error('Não foi possível abrir o backup: chave errada ou arquivo alterado.');
  try {
    for await (const line of lines) {
      if (line) yield JSON.parse(line);
    }
  } catch {
    throw fail();
  }
  await done;
  if (failure) throw fail();
}

/** Confere um backup inteiro: abre, conta as linhas de cada tabela e compara com o que foi gravado. */
export async function verifyBackup(file: string, secret: string, expected?: Record<string, number>) {
  const counts: Record<string, number> = {};
  let current = '';
  let ended = false;
  for await (const rec of readBackup(file, secret)) {
    if (Array.isArray(rec)) counts[current] = (counts[current] ?? 0) + 1;
    else if (typeof rec.t === 'string') {
      current = rec.t;
      counts[current] = 0;
    } else if (rec.end) ended = true;
  }
  if (!ended) throw new Error('Backup cortado no meio.');
  if (expected) for (const [t, n] of Object.entries(expected)) if (counts[t] !== n) throw new Error(`Tabela ${t}: ${counts[t]} linhas, esperado ${n}.`);
  return counts;
}

/** Restaura um backup num banco (vazio, de preferência). Linhas repetidas são ignoradas. */
export async function restoreBackup(db: Db, file: string, secret: string, log = console.log) {
  // primeiro confere o arquivo inteiro (a criptografia só detecta alteração no fim): nada entra se estiver adulterado
  await verifyBackup(file, secret);
  let table: { t: string; cols: string[]; types: string[] } | null = null;
  let batch: unknown[][] = [];
  let restored = 0;
  let skipped = 0;
  const decode = (v: unknown, type: string) => {
    if (v && typeof v === 'object' && '$b' in (v as object)) return Buffer.from((v as { $b: string }).$b, 'base64');
    if ((type === 'json' || type === 'jsonb') && v !== null) return JSON.stringify(v);
    return v;
  };
  const flush = async () => {
    if (!table || !batch.length) return;
    const t = table;
    const cols = t.cols.map((c) => `"${c}"`).join(', ');
    const insert = async (rows: unknown[][]) => {
      const params: unknown[] = [];
      const values = rows.map((r) => `(${r.map((v, i) => (params.push(decode(v, t.types[i])), `$${params.length}`)).join(', ')})`).join(', ');
      await db.query(`insert into "${t.t}" (${cols}) values ${values} on conflict do nothing`, params);
    };
    try {
      await insert(batch);
      restored += batch.length;
    } catch {
      // uma linha com problema não derruba o resto: tenta uma por uma
      for (const row of batch) {
        try {
          await insert([row]);
          restored++;
        } catch (err) {
          skipped++;
          if (skipped <= 5) log(`[restore] linha ignorada em ${t.t}: ${(err as Error).message}`);
        }
      }
    }
    batch = [];
  };
  for await (const rec of readBackup(file, secret)) {
    if (Array.isArray(rec)) {
      batch.push(rec);
      if (batch.length >= (table?.types.includes('bytea') ? 10 : 200)) await flush();
    } else if (typeof rec.t === 'string') {
      await flush();
      table = rec as { t: string; cols: string[]; types: string[] };
      log(`[restore] ${table.t}…`);
    }
  }
  await flush();
  return { restored, skipped };
}

// ---------- rotina diária ----------

let running: Promise<unknown> | null = null;

export async function runBackup(db: Db) {
  if (!config.backupKey) throw new Error('BACKUP_KEY não configurada: backups desligados.');
  if (running) return running;
  const id = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z') + '.rsnbk';
  const tmp = path.join(tmpdir(), `resenha-${randomUUID()}.rsnbk`);
  const job = (async () => {
    await db.query('insert into backups (id) values ($1)', [id]);
    try {
      const stats = await writeBackup(db, tmp, config.backupKey);
      const size = statSync(tmp).size;
      const check = path.join(tmpdir(), `resenha-check-${randomUUID()}.rsnbk`);
      if (r2Configured()) {
        if (size > 400 * 1024 * 1024) throw new Error('Backup grande demais para enviar de uma vez.');
        const store = fileStore(db);
        await store.put(`backups/${id}`, readFileSync(tmp), 'application/octet-stream');
        // confere o que REALMENTE ficou guardado, baixando de volta
        const back = await store.get(`backups/${id}`);
        if (!back) throw new Error('O backup não foi encontrado depois de enviado.');
        writeFileSync(check, back);
      } else {
        mkdirSync(backupDir(), { recursive: true });
        writeFileSync(path.join(backupDir(), id), readFileSync(tmp));
        writeFileSync(check, readFileSync(path.join(backupDir(), id)));
      }
      await verifyBackup(check, config.backupKey, stats.perTable);
      rmSync(check, { force: true });
      await db.query('update backups set finished_at = now(), ok = true, verified = true, size = $2, tables = $3, rows = $4 where id = $1', [
        id,
        size,
        stats.tables,
        stats.rows,
      ]);
      console.log(`[backup] ok: ${id} (${(size / 1024 / 1024).toFixed(1)} MB, ${stats.rows} linhas, conferido)`);
      await pruneBackups(db);
    } catch (err) {
      console.error('[backup] falhou', err);
      await db.query('update backups set finished_at = now(), ok = false, error = $2 where id = $1', [id, String((err as Error).message).slice(0, 500)]);
      throw err;
    } finally {
      rmSync(tmp, { force: true });
    }
  })();
  running = job.finally(() => (running = null));
  return job;
}

async function pruneBackups(db: Db) {
  const old = await db.query<{ id: string }>(
    `select id from backups where started_at < now() - make_interval(days => $1) order by started_at`,
    [config.backupKeepDays],
  );
  // nunca apaga os 3 últimos que deram certo, mesmo antigos
  const keep = new Set((await db.query<{ id: string }>('select id from backups where ok order by started_at desc limit 3')).map((r) => r.id));
  for (const b of old) {
    if (keep.has(b.id)) continue;
    if (r2Configured()) await fileStore(db).remove([`backups/${b.id}`]);
    else
      try {
        unlinkSync(path.join(backupDir(), b.id));
      } catch {
        /* já não existia */
      }
    await db.query('delete from backups where id = $1', [b.id]);
  }
}

export function startBackups(db: Db) {
  if (!config.backupKey) {
    console.warn('[backup] BACKUP_KEY não configurada: backups automáticos DESLIGADOS.');
    return;
  }
  const tick = async () => {
    const [last] = await db.query<{ ok: boolean }>(`select 1 as ok from backups where ok and started_at > now() - interval '23 hours' limit 1`);
    const [recentFail] = await db.query(`select 1 from backups where ok is false and started_at > now() - interval '1 hour' limit 1`);
    if (!last && !recentFail) await runBackup(db).catch(() => {});
  };
  setTimeout(() => void tick().catch(() => {}), 2 * 60_000).unref();
  setInterval(() => void tick().catch(() => {}), 30 * 60_000).unref();
}

// ---------- painel da equipe ----------

export function registerSystemRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>) {
  const requireTeam = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };
  r.get(
    '/admin/system',
    auth,
    wrap(async (req) => {
      requireTeam(req.user!.username);
      const backups = await db.query(
        `select id, started_at as "startedAt", finished_at as "finishedAt", ok, verified, size::float as size, tables, rows::float as rows, error
         from backups order by started_at desc limit 10`,
      );
      const [trash] = await db.query<{ n: number }>('select count(*)::int as n from storage_trash');
      const [legacy] = await db.query<{ n: number }>(
        'select (select count(*) from attachments where data is not null) + (select count(*) from images where data is not null) + (select count(*) from blobs) as n',
      );
      return {
        storage: await storageUsage(db),
        backupsEnabled: !!config.backupKey,
        backupTarget: r2Configured() ? 'r2' : 'local',
        backups,
        pendingDeletes: trash.n,
        filesStillInDatabase: Number(legacy.n),
        quotas: { userMb: config.userQuotaMb, guildMb: config.guildQuotaMb, dailyMb: config.userDailyMb, fileMb: config.maxFileMb },
        email: emailStatus(),
      };
    }),
  );
  // manda um e-mail de teste e mostra exatamente o que o provedor respondeu
  r.post(
    '/admin/email/test',
    auth,
    wrap(async (req) => {
      requireTeam(req.user!.username);
      limit(`email-test:${req.user!.id}`, 10, 60 * 60_000, 'Testes demais nesta hora.');
      if (!emailEnabled()) throw new HttpError(400, 'Configure EMAIL_PROVIDER, EMAIL_API_KEY e EMAIL_FROM no Render.');
      const to = typeof req.body?.to === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(req.body.to) ? req.body.to.trim() : null;
      const [me] = await db.query<{ email: string | null }>('select email from users where id = $1', [req.user!.id]);
      const target = to ?? me?.email ?? config.email.from;
      const ok = await sendEmail({ to: target, subject: 'Teste de e-mail do Resenha', lines: ['Se você recebeu esta mensagem, os e-mails do Resenha estão funcionando. ✅'] });
      return { ok, to: target, status: emailStatus() };
    }),
  );

  r.post(
    '/admin/backups/run',
    auth,
    wrap(async (req) => {
      requireTeam(req.user!.username);
      limit(`backup-now:${req.user!.id}`, 3, 60 * 60_000, 'Já foram feitos backups manuais demais nesta hora.');
      if (!config.backupKey) throw new HttpError(400, 'Configure a BACKUP_KEY no Render para ligar os backups.');
      await runBackup(db).catch((err) => {
        throw new HttpError(500, `O backup falhou: ${(err as Error).message}`);
      });
      return { ok: true };
    }),
  );
}
