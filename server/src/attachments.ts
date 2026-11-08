import { randomUUID } from 'node:crypto';
import express, { type Router } from 'express';
import { config } from './config.ts';
import type { Db } from './db.ts';
import { HttpError, wrap } from './http.ts';
import { requireStorage } from './access.ts';
import type { Attachment } from '../../shared/types.ts';
import type { requireAuth } from './auth.ts';

/**
 * Imagens das mensagens, guardadas no próprio Postgres (cabe no plano grátis do Neon
 * porque o navegador reduz fotos grandes antes de enviar).
 *
 * Fluxo: o navegador envia a imagem (POST /attachments) e recebe um id; depois manda a
 * mensagem com attachmentIds. Envios nunca usados são apagados depois de um dia.
 * A imagem é servida por um link com id aleatório (impossível de adivinhar), porque
 * <img src> não consegue mandar o token de login.
 */

/** Descobre o tipo real pelos primeiros bytes (não confia no que o navegador diz). */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 12) === 'ftypavif') return 'image/avif';
  return null;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export function registerAttachmentRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>) {
  const maxBytes = config.maxUploadMb * 1024 * 1024;

  r.post(
    '/attachments',
    auth,
    express.raw({ type: () => true, limit: maxBytes }),
    wrap(async (req) => {
      const data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, 'Arquivo vazio.');
      const mime = sniffImage(data);
      if (!mime) throw new HttpError(415, 'Só dá para enviar imagens (PNG, JPG, GIF, WebP ou AVIF).');
      await requireStorage(db, data.length);

      const dim = (h: unknown) => {
        const n = Number(h);
        return Number.isInteger(n) && n > 0 && n < 20000 ? n : null;
      };
      let name = 'imagem';
      try {
        name = decodeURIComponent(String(req.headers['x-filename'] ?? 'imagem'));
      } catch {
        /* nome inválido: usa o padrão */
      }
      name = name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 80).replace(/\.[^.]*$/, '') || 'imagem';
      const att: Attachment = {
        id: randomUUID(),
        name: `${name}.${EXT[mime]}`,
        mime,
        size: data.length,
        width: dim(req.headers['x-width']),
        height: dim(req.headers['x-height']),
      };
      await db.query(
        `insert into attachments (id, uploader_id, filename, mime, size, width, height, data)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [att.id, req.user!.id, att.name, att.mime, att.size, att.width, att.height, data],
      );
      return { attachment: att };
    }),
  );

  r.get(
    '/attachments/:id/:name',
    wrap(async (req, res) => {
      const [row] = await db.query<{ mime: string; data: Uint8Array }>(
        'select mime, data from attachments where id = $1',
        [String(req.params.id)],
      );
      if (!row) throw new HttpError(404, 'Imagem não encontrada.');
      res.setHeader('Content-Type', row.mime);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
      res.end(Buffer.from(row.data));
    }),
  );

  // limpeza de imagens enviadas mas nunca usadas em mensagem
  const cleanup = () =>
    db
      .query(`delete from attachments where message_id is null and created_at < now() - interval '1 day'`)
      .catch((err) => console.warn('[attachments] limpeza falhou', err));
  setTimeout(cleanup, 30_000);
  setInterval(cleanup, 3600_000).unref();
}
