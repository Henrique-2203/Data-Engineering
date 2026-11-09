import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { config } from './config.ts';
import type { Db } from './db.ts';
import { HttpError, wrap } from './http.ts';
import { fmtMb, requireQuota, userUsage } from './access.ts';
import { limit } from './security.ts';
import { blockedReason, cleanImage, scrubVideoLocation, sniffFile, type FileKind } from './sanitize.ts';
import { checkFileLink, fileStore, r2Configured, readStored, signFileLink } from './storage.ts';
import { isPlatformAdmin } from './reports.ts';
import type { Attachment } from '../../shared/types.ts';
import type { requireAuth } from './auth.ts';

export { sniffImage } from './sanitize.ts';

/**
 * Arquivos das mensagens (fotos, vídeos, áudios, PDFs, zips...), em DMs e canais de servidor.
 *
 * Segurança:
 * - o tipo é descoberto pelo conteúdo; programas e scripts são recusados;
 * - fotos e vídeos perdem a localização (GPS) e outros metadados antes de serem guardados;
 * - cada arquivo só abre por um LINK ASSINADO que expira (12 a 24 h). Quem tem acesso à conversa
 *   recebe links novos; quem não tem (ou recebeu um link antigo repassado) não consegue abrir;
 * - o que não é imagem/vídeo/áudio é sempre baixado, nunca aberto como página do site;
 * - cotas por pessoa, por servidor e por dia, além da trava geral do armazenamento.
 *
 * Fluxo: o navegador envia o arquivo (POST /attachments?channelId=...) e recebe um id; depois
 * manda a mensagem com attachmentIds. Envios nunca usados são apagados depois de um dia.
 */

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/heic': 'heic',
};

/** O navegador toca/mostra estes direto na conversa; o resto vira "baixar arquivo". */
const INLINE = new Set(['image', 'video', 'audio']);

const MB = 1024 * 1024;
/** sem R2 os arquivos vão para o banco, então o limite é o mesmo das imagens */
export const maxFileBytes = () => (r2Configured() ? config.maxFileMb : Math.min(config.maxFileMb, config.maxUploadMb)) * MB;

type AttRow = {
  id: string;
  filename: string;
  mime: string;
  kind: FileKind;
  size: number;
  data: Uint8Array | null;
  storage_key: string | null;
  message_id: string | null;
  uploader_id: string;
};

/** Põe os links assinados nos anexos das mensagens (sempre que uma mensagem sai do servidor). */
export async function withFileLinks<T extends { attachments: Attachment[] }>(db: Db, messages: T[]): Promise<T[]> {
  for (const m of messages) {
    for (const a of m.attachments) a.url = await signFileLink(db, a.id, a.name);
  }
  return messages;
}

function cleanName(raw: unknown, mime: string, kind: FileKind) {
  let name = 'arquivo';
  try {
    name = decodeURIComponent(String(raw ?? 'arquivo'));
  } catch {
    /* nome inválido: usa o padrão */
  }
  name = name.normalize('NFC').replace(/[^\p{L}\p{N}._ ()+-]+/gu, '_').replace(/^[.\s]+/, '').slice(0, 100).trim();
  const ext = name.match(/\.([\p{L}\p{N}]{1,10})$/u)?.[1]?.toLowerCase();
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name) || (kind === 'image' ? 'imagem' : 'arquivo');
  // imagens, vídeos e áudios ganham a extensão do tipo REAL (nada de "foto.jpg" que é outra coisa)
  if (kind !== 'file' || !ext) return `${base}.${EXT[mime] ?? ext ?? 'bin'}`;
  return `${base}.${ext}`;
}

/** Envia parte de um arquivo (vídeos e áudios pulam para o meio pedindo "Range"). */
function sendBuffer(req: Request, res: Response, buf: Buffer) {
  res.setHeader('Accept-Ranges', 'bytes');
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : buf.length - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : buf.length - 1;
    start = Math.max(0, start);
    end = Math.min(buf.length - 1, end);
    if (start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${buf.length}`);
      res.end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
    res.setHeader('Content-Length', String(end - start + 1));
    res.end(buf.subarray(start, end + 1));
    return;
  }
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}

const disposition = (kind: FileKind, name: string) =>
  `${INLINE.has(kind) ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export function registerAttachmentRoutes(
  r: Router,
  db: Db,
  auth: ReturnType<typeof requireAuth>,
  hooks: {
    /** confere se a pessoa vê o canal (servidor ou DM); devolve o servidor do canal (ou null em DM) */
    channelGuild: (channelId: string, userId: string) => Promise<string | null>;
    /** um anexo foi apagado: atualiza (ou apaga, se ficou vazia) a mensagem para todo mundo */
    messageChanged: (messageId: string) => Promise<void>;
  },
) {
  const bodyLimit = Math.max(config.maxUploadMb, config.maxFileMb) * MB;

  r.post(
    '/attachments',
    auth,
    express.raw({ type: () => true, limit: bodyLimit }),
    wrap(async (req) => {
      const me = req.user!.id;
      limit(`upload:${me}`, 40, 10 * 60_000, 'Muitos arquivos em pouco tempo. Espere alguns minutos.');
      let data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, 'Arquivo vazio.');
      const rawName = req.headers['x-filename'];
      const blocked = blockedReason(data, (() => {
        try {
          return decodeURIComponent(String(rawName ?? ''));
        } catch {
          return String(rawName ?? '');
        }
      })());
      if (blocked) throw new HttpError(415, blocked);

      const { kind, mime } = sniffFile(data);
      const max = kind === 'image' ? config.maxUploadMb * MB : maxFileBytes();
      if (data.length > max) {
        throw new HttpError(413, `${kind === 'image' ? 'Imagem' : 'Arquivo'} grande demais (máx. ${fmtMb(max)}).`);
      }

      const guildId = typeof req.query.channelId === 'string' && req.query.channelId ? await hooks.channelGuild(req.query.channelId, me) : null;

      const dim = (h: unknown) => {
        const n = Number(h);
        return Number.isInteger(n) && n > 0 && n < 20000 ? n : null;
      };
      let width = dim(req.headers['x-width']);
      let height = dim(req.headers['x-height']);
      if (kind === 'image') {
        // tira GPS e outros metadados e lê as medidas reais da imagem
        const clean = await cleanImage(data, mime);
        data = clean.data;
        width = clean.width || null;
        height = clean.height || null;
      } else if (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'audio/mp4') {
        data = scrubVideoLocation(data).data;
      }
      await requireQuota(db, { userId: me, guildId, bytes: data.length });

      const att: Attachment = {
        id: randomUUID(),
        name: cleanName(rawName, mime, kind),
        mime,
        kind,
        size: data.length,
        width: INLINE.has(kind) && kind !== 'audio' ? width : null,
        height: INLINE.has(kind) && kind !== 'audio' ? height : null,
      };
      const key = `att/${att.id}`;
      await fileStore(db).put(key, data, mime);
      await db.query(
        `insert into attachments (id, uploader_id, filename, mime, kind, size, width, height, storage_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [att.id, me, att.name, att.mime, att.kind, att.size, att.width, att.height, key],
      );
      att.url = await signFileLink(db, att.id, att.name);
      return { attachment: att };
    }),
  );

  /** Link novo para um anexo (o antigo expirou), só para quem ainda tem acesso à conversa. */
  r.post(
    '/attachments/:id/link',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      limit(`att-link:${me.id}`, 300, 60_000);
      const [a] = await db.query<{ filename: string; uploader_id: string; channel_id: string | null }>(
        `select a.filename, a.uploader_id, m.channel_id from attachments a left join messages m on m.id = a.message_id where a.id = $1`,
        [String(req.params.id)],
      );
      if (!a) throw new HttpError(404, 'Arquivo não encontrado.');
      const allowed = a.channel_id
        ? isPlatformAdmin(me.username) || (await hooks.channelGuild(a.channel_id, me.id).then(() => true, () => false))
        : a.uploader_id === me.id;
      if (!allowed) throw new HttpError(404, 'Arquivo não encontrado.');
      return { url: await signFileLink(db, String(req.params.id), a.filename) };
    }),
  );

  r.get(
    '/attachments/:id/:name',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      const check = await checkFileLink(db, id, req.query.e, req.query.s);
      if (check !== 'ok') {
        res.setHeader('Cache-Control', 'no-store');
        res.status(check === 'expired' ? 410 : 403).json({ error: check === 'expired' ? 'Este link expirou.' : 'Link inválido.' });
        return;
      }
      const [row] = await db.query<AttRow>(
        'select id, filename, mime, kind, size, data, storage_key, message_id, uploader_id from attachments where id = $1',
        [id],
      );
      if (!row) throw new HttpError(404, 'Arquivo não encontrado.');
      const contentType = INLINE.has(row.kind) ? row.mime : row.kind === 'file' && row.mime === 'application/pdf' ? 'application/pdf' : 'application/octet-stream';
      const store = fileStore(db);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (store.kind === 'r2' && row.storage_key && !row.data && store.presign) {
        // o navegador baixa direto do R2, por um link que também expira (sem gastar a internet do servidor)
        const left = Math.max(3600, Number(req.query.e) - Math.floor(Date.now() / 1000));
        const url = await store.presign(row.storage_key, { expiresSec: Math.min(left, 6 * 3600), mime: contentType, disposition: disposition(row.kind, row.filename) });
        res.setHeader('Cache-Control', 'private, max-age=1800');
        res.redirect(302, url);
        return;
      }
      const buf = await readStored(db, row);
      if (!buf) throw new HttpError(404, 'Arquivo não encontrado.');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', disposition(row.kind, row.filename));
      res.setHeader('Cache-Control', 'private, max-age=43200');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      sendBuffer(req, res, buf);
    }),
  );

  // ---------- meus arquivos (ver o espaço e apagar) ----------

  r.get(
    '/me/files',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      const rows = await db.query<{
        id: string;
        name: string;
        mime: string;
        kind: FileKind;
        size: number;
        createdAt: string;
        messageId: string | null;
        channelId: string | null;
        channelName: string | null;
        guildName: string | null;
      }>(
        `select a.id, a.filename as name, a.mime, a.kind, a.size, a.created_at as "createdAt", a.message_id as "messageId",
           m.channel_id as "channelId", c.name as "channelName", g.name as "guildName"
         from attachments a
         left join messages m on m.id = a.message_id
         left join channels c on c.id = m.channel_id
         left join guilds g on g.id = c.guild_id
         where a.uploader_id = $1 and a.message_id is not null
           ${before ? 'and a.created_at < (select created_at from attachments where id = $2)' : ''}
         order by a.created_at desc limit 50`,
        before ? [me, before] : [me],
      );
      const files = await Promise.all(rows.map(async (f) => ({ ...f, url: await signFileLink(db, f.id, f.name) })));
      return { files, hasMore: rows.length === 50, usage: await userUsage(db, me) };
    }),
  );

  r.delete(
    '/me/files/:id',
    auth,
    wrap(async (req) => {
      const [a] = await db.query<{ message_id: string | null }>(
        'delete from attachments where id = $1 and uploader_id = $2 returning message_id',
        [String(req.params.id), req.user!.id],
      );
      if (!a) throw new HttpError(404, 'Arquivo não encontrado.');
      if (a.message_id) await hooks.messageChanged(a.message_id);
      return { usage: await userUsage(db, req.user!.id) };
    }),
  );

  // limpeza de arquivos enviados mas nunca usados em mensagem (a lixeira apaga o conteúdo depois)
  const cleanup = () =>
    db
      .query(`delete from attachments where message_id is null and created_at < now() - interval '1 day'`)
      .catch((err) => console.warn('[attachments] limpeza falhou', err));
  setTimeout(cleanup, 30_000).unref();
  setInterval(cleanup, 3600_000).unref();
}
