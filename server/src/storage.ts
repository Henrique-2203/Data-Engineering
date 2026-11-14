import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { config } from './config.ts';
import type { Db } from './db.ts';

/**
 * Onde os arquivos (imagens, vídeos, PDFs...) ficam guardados.
 *
 * - Com o Cloudflare R2 configurado: no R2 (10 GB grátis, sem custo de download). O banco guarda só a "chave".
 * - Sem R2: na tabela `blobs` do próprio banco (bom para testar e para quem roda o Resenha em casa).
 *
 * Arquivos antigos (coluna `data` de attachments/images, do tempo em que tudo ia para o banco)
 * continuam funcionando e são levados para o R2 aos poucos, sozinhos.
 */
export interface FileStore {
  kind: 'db' | 'r2';
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(keys: string[]): Promise<void>;
  /** link direto e temporário para o arquivo (só no R2); o navegador baixa de lá, sem passar pelo servidor */
  presign?(key: string, o: { expiresSec: number; mime: string; disposition: string }): Promise<string>;
  /** endereço do R2 (entra na política de segurança de conteúdo do site) */
  origin?: string;
}

export const r2Configured = () => !!(config.r2.endpoint && config.r2.bucket && config.r2.accessKeyId && config.r2.secretAccessKey);

function dbStore(db: Db): FileStore {
  return {
    kind: 'db',
    async put(key, data) {
      await db.query('insert into blobs (key, data) values ($1, $2) on conflict (key) do update set data = excluded.data', [key, data]);
    },
    async get(key) {
      const [row] = await db.query<{ data: Uint8Array }>('select data from blobs where key = $1', [key]);
      return row ? Buffer.from(row.data) : null;
    },
    async remove(keys) {
      if (keys.length) await db.query('delete from blobs where key = any($1)', [keys]);
    },
  };
}

function r2Store(db: Db): FileStore {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region } = config.r2;
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
  const url = (key: string) => `${endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const fallback = dbStore(db);
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`[r2] ${what} falhou: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  };
  return {
    kind: 'r2',
    origin: new URL(endpoint).origin,
    async put(key, data, mime) {
      const res = await aws.fetch(url(key), {
        method: 'PUT',
        body: new Blob([new Uint8Array(data)]),
        headers: { 'Content-Type': mime, 'Content-Length': String(data.length) },
      });
      await check(res, `envio de ${key}`);
    },
    async get(key) {
      const res = await aws.fetch(url(key));
      if (res.status === 404) return fallback.get(key); // ainda não migrado da tabela blobs
      await check(res, `leitura de ${key}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 8) {
        await Promise.all(
          keys.slice(i, i + 8).map(async (k) => {
            const res = await aws.fetch(url(k), { method: 'DELETE' });
            if (!res.ok && res.status !== 404) await check(res, `remoção de ${k}`);
          }),
        );
      }
      await fallback.remove(keys);
    },
    async presign(key, o) {
      // data "arredondada" para a hora: o link fica igual por um tempo e o navegador aproveita o cache
      const now = new Date(Math.floor(Date.now() / 3600_000) * 3600_000);
      const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const u = new URL(url(key));
      u.searchParams.set('X-Amz-Expires', String(o.expiresSec + 3600));
      u.searchParams.set('response-content-type', o.mime);
      u.searchParams.set('response-content-disposition', o.disposition);
      u.searchParams.set('response-cache-control', 'private, max-age=3600');
      const signed = await aws.sign(u.toString(), { method: 'GET', aws: { signQuery: true, datetime } });
      return signed.url;
    },
  };
}

let store: FileStore | null = null;
export function fileStore(db: Db): FileStore {
  store ??= r2Configured() ? r2Store(db) : dbStore(db);
  return store;
}

/** Lê o arquivo de uma linha de attachments/images (antiga, com `data`, ou nova, com `storage_key`). */
export async function readStored(db: Db, row: { data?: Uint8Array | null; storage_key?: string | null }): Promise<Buffer | null> {
  if (row.data) return Buffer.from(row.data);
  if (!row.storage_key) return null;
  return fileStore(db).get(row.storage_key);
}

// ---------- segredo do servidor (assina os links dos anexos) ----------

const secrets = new Map<string, Buffer>();
/** Segredo aleatório gerado uma vez e guardado no banco (sobrevive a reinícios, nunca sai do servidor). */
export async function serverSecret(db: Db, name: string): Promise<Buffer> {
  const cached = secrets.get(name);
  if (cached) return cached;
  await db.query('insert into server_secrets (name, value) values ($1, $2) on conflict (name) do nothing', [name, randomBytes(32).toString('base64')]);
  const [row] = await db.query<{ value: string }>('select value from server_secrets where name = $1', [name]);
  const buf = Buffer.from(row.value, 'base64');
  secrets.set(name, buf);
  return buf;
}

// ---------- links protegidos ----------

/** Cada link vale de 12 a 24 h: fica igual por 12 h (cache do navegador) e depois expira. */
const WINDOW = 12 * 3600;
export async function signFileLink(db: Db, id: string, name: string, now = Date.now()): Promise<string> {
  const exp = (Math.floor(now / 1000 / WINDOW) + 2) * WINDOW;
  const sig = createHmac('sha256', await serverSecret(db, 'file-links')).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
  return `/api/attachments/${id}/${encodeURIComponent(name)}?e=${exp}&s=${sig}`;
}

export async function checkFileLink(db: Db, id: string, exp: unknown, sig: unknown): Promise<'ok' | 'expired' | 'invalid'> {
  const e = Number(exp);
  if (!Number.isInteger(e) || typeof sig !== 'string' || sig.length !== 32) return 'invalid';
  const want = createHmac('sha256', await serverSecret(db, 'file-links')).update(`${id}.${e}`).digest('base64url').slice(0, 32);
  if (!timingSafeEqual(Buffer.from(want), Buffer.from(sig.padEnd(32).slice(0, 32)))) return 'invalid';
  return e * 1000 < Date.now() ? 'expired' : 'ok';
}

// ---------- faxina e migração (rodam sozinhas) ----------

/** Apaga do armazenamento os arquivos cujas linhas sumiram (a lixeira é preenchida por gatilho no banco). */
export async function emptyTrash(db: Db) {
  const rows = await db.query<{ key: string }>('select key from storage_trash order by deleted_at limit 500');
  if (!rows.length) return 0;
  const keys = rows.map((r) => r.key);
  await fileStore(db).remove(keys);
  await db.query('delete from storage_trash where key = any($1)', [keys]);
  return keys.length;
}

/** Com o R2 ligado, leva para lá os arquivos que ainda estão no banco (poucos por vez, sem travar nada). */
export async function migrateToR2(db: Db) {
  const s = fileStore(db);
  if (s.kind !== 'r2') return 0;
  let moved = 0;
  for (const table of ['attachments', 'images'] as const) {
    const prefix = table === 'attachments' ? 'att' : 'img';
    const rows = await db.query<{ id: string; mime: string; data: Uint8Array }>(
      `select id, mime, data from ${table} where data is not null limit 10`,
    );
    for (const r of rows) {
      const key = `${prefix}/${r.id}`;
      await s.put(key, Buffer.from(r.data), r.mime);
      await db.query(`update ${table} set storage_key = $2, data = null where id = $1`, [r.id, key]);
      moved++;
    }
  }
  // arquivos que foram para a tabela blobs antes do R2 ser configurado
  const blobs = await db.query<{ key: string; data: Uint8Array }>('select key, data from blobs limit 10');
  for (const b of blobs) {
    await s.put(b.key, Buffer.from(b.data), 'application/octet-stream');
    await db.query('delete from blobs where key = $1', [b.key]);
    moved++;
  }
  return moved;
}

export function startStorageJobs(db: Db) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await emptyTrash(db);
      // migração em rajadas curtas até acabar
      for (let i = 0; i < 20; i++) if ((await migrateToR2(db)) === 0) break;
    } catch (err) {
      console.warn('[storage] tarefa de manutenção falhou', err);
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 5 * 60_000).unref();
  console.log(`[storage] arquivos em: ${r2Configured() ? `Cloudflare R2 (${config.r2.bucket})` : 'banco de dados (configure o R2 para crescer)'}`);
}
