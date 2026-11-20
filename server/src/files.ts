import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { Db } from './db.ts';
import { requireStorage } from './access.ts';
import { cleanImage } from './sanitize.ts';
import { fileStore, readStored } from './storage.ts';

/**
 * Imagens pequenas e públicas (foto e banner de perfil, ícone e banner de servidor, emojis,
 * figurinhas e sons do soundboard). Ficam na tabela `images`; o conteúdo vai para o R2 (ou para o banco).
 * Fotos passam pela limpeza de metadados (GPS etc.) antes de serem guardadas.
 */
export async function saveImage(db: Db, o: { userId: string; mime: string; data: Buffer }): Promise<string> {
  let { data } = o;
  if (o.mime.startsWith('image/')) data = (await cleanImage(data, o.mime)).data;
  await requireStorage(db, data.length);
  const id = randomUUID();
  const key = `img/${id}`;
  await fileStore(db).put(key, data, o.mime);
  await db.query('insert into images (id, uploader_id, mime, size, storage_key) values ($1, $2, $3, $4, $5)', [id, o.userId, o.mime, data.length, key]);
  return id;
}

// cache em memória das imagens mais vistas (fotos de perfil aparecem o tempo todo): menos idas ao R2
const CACHE_MAX = 32 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;
function remember(key: string, buf: Buffer) {
  if (buf.length > 2 * 1024 * 1024) return;
  cache.set(key, buf);
  cacheBytes += buf.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_MAX) break;
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

/** Entrega uma imagem guardada (id imutável: o navegador pode guardar para sempre). */
export async function sendStoredImage(
  db: Db,
  res: Response,
  row: { id: string; mime: string; data?: Uint8Array | null; storage_key?: string | null },
  cacheControl = 'public, max-age=31536000, immutable',
) {
  let buf = cache.get(row.id);
  if (buf) {
    cache.delete(row.id); // reinsere no fim: as mais usadas ficam
    cache.set(row.id, buf);
  } else {
    buf = (await readStored(db, row)) ?? undefined;
    if (!buf) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }
    remember(row.id, buf);
  }
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(buf);
}

export const IMAGE_ROW = 'i.id, i.mime, i.data, i.storage_key';
