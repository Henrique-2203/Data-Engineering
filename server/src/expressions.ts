import { randomUUID } from 'node:crypto';
import express, { type Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import type { requireAuth } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import { sniffImage } from './attachments.ts';
import { requireMember, requireOutranks, requirePerm, requireStorage } from './access.ts';
import { Perm, has } from '../../shared/permissions.ts';
import type { Expression, ExpressionKind } from '../../shared/types.ts';

/**
 * O que o Discord cobra (ou limita por "boost"), aqui de graça:
 * emojis e figurinhas personalizados, soundboard e apelido/foto por servidor.
 * Os arquivos chegam já reduzidos pelo navegador e ficam na tabela de imagens.
 */

export const LIMITS: Record<ExpressionKind, { max: number; bytes: number }> = {
  emoji: { max: 200, bytes: 256 * 1024 },
  sticker: { max: 100, bytes: 512 * 1024 },
  sound: { max: 100, bytes: 400 * 1024 },
};
const GUILD_AVATAR_BYTES = 1.5 * 1024 * 1024;

export const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;
/** Emoji personalizado dentro do texto: <:nome:id> */
export const CUSTOM_EMOJI_RE = /<:([a-z0-9_]{2,32}):([0-9a-f-]{36})>/g;

export function sniffAudio(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

export const EXPRESSION_COLUMNS = `e.id, e.guild_id as "guildId", e.kind, e.name, e.file_id as "fileId", e.emoji`;

export async function loadExpressions(db: Db, guildId: string): Promise<Expression[]> {
  return db.query<Expression>(`select ${EXPRESSION_COLUMNS} from expressions e where e.guild_id = $1 order by e.created_at`, [guildId]);
}

/** Expressão de um servidor do qual a pessoa é membro (dá para usar emojis de todos os seus servidores). */
export async function usableExpression(db: Db, id: string, userId: string, kind: ExpressionKind): Promise<Expression | null> {
  const [e] = await db.query<Expression>(
    `select ${EXPRESSION_COLUMNS} from expressions e
     where e.id = $1 and e.kind = $2 and exists (select 1 from members m where m.guild_id = e.guild_id and m.user_id = $3)`,
    [id, kind, userId],
  );
  return e ?? null;
}

async function saveFile(db: Db, userId: string, mime: string, data: Buffer) {
  await requireStorage(db, data.length);
  const id = randomUUID();
  await db.query('insert into images (id, uploader_id, mime, size, data) values ($1, $2, $3, $4, $5)', [id, userId, mime, data.length, data]);
  return id;
}

const deleteFiles = (db: Db, ids: (string | null | undefined)[]) => {
  const list = ids.filter(Boolean);
  return list.length ? db.query('delete from images where id = any($1)', [list]) : Promise.resolve([]);
};

/** Apaga arquivos de um servidor que vai ser excluído (emojis, figurinhas, sons e fotos de membro). */
export async function guildFileIds(db: Db, guildId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select file_id as id from expressions where guild_id = $1
     union all select avatar_id from members where guild_id = $1 and avatar_id is not null`,
    [guildId],
  );
  return rows.map((r) => r.id);
}
export { deleteFiles };

const nameFor = (kind: ExpressionKind) =>
  kind === 'emoji'
    ? z.string().trim().toLowerCase().regex(EMOJI_NAME_RE, 'Nome do emoji: 2 a 32 letras minúsculas, números ou _ (sem espaço nem acento).')
    : z.string().trim().min(1, 'Dê um nome.').max(30, 'Nome muito longo (máx. 30).');

const soundEmoji = z
  .string()
  .max(16)
  .refine((e) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e), 'Emoji inválido.')
  .nullable()
  .optional();

export function registerExpressionRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const kindSchema = z.enum(['emoji', 'sticker', 'sound']);

  // ---------- emojis, figurinhas e sons ----------

  // arquivo pelo id do emoji/figurinha (público, como as imagens: quem recebe a mensagem pode não estar no servidor)
  r.get(
    '/emojis/:id',
    wrap(async (req, res) => {
      const [f] = await db.query<{ mime: string; data: Uint8Array }>(
        `select i.mime, i.data from expressions e join images i on i.id = e.file_id where e.id = $1 and e.kind <> 'sound'`,
        [String(req.params.id)],
      );
      if (!f) throw new HttpError(404, 'Emoji não encontrado.');
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(f.data));
    }),
  );

  r.post(
    '/guilds/:id/expressions',
    auth,
    express.raw({ type: () => true, limit: 600 * 1024 }),
    wrap(async (req) => {
      const guildId = String(req.params.id);
      const me = req.user!.id;
      await requirePerm(db, guildId, me, Perm.MANAGE_EXPRESSIONS);
      const kind = parse(kindSchema, req.query.kind);
      const name = parse(nameFor(kind), String(req.query.name ?? ''));
      const emoji = kind === 'sound' ? (parse(soundEmoji, req.query.emoji ? String(req.query.emoji) : null) ?? null) : null;
      const data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Arquivo vazio.');
      const limit = LIMITS[kind];
      if (data.length > limit.bytes) throw new HttpError(413, `Arquivo grande demais (máx. ${Math.round(limit.bytes / 1024)} KB).`);
      const mime = kind === 'sound' ? sniffAudio(data) : sniffImage(data);
      if (!mime || mime === 'image/avif') {
        throw new HttpError(415, kind === 'sound' ? 'Envie um som MP3, OGG, WAV ou WebM.' : 'Envie uma imagem PNG, JPG, WebP ou GIF.');
      }
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from expressions where guild_id = $1 and kind = $2', [guildId, kind]);
      if (n >= limit.max) throw new HttpError(400, `Este servidor já tem o máximo de ${limit.max}.`);
      if (kind === 'emoji') {
        const [dup] = await db.query("select 1 from expressions where guild_id = $1 and kind = 'emoji' and name = $2", [guildId, name]);
        if (dup) throw new HttpError(409, `Já existe um emoji :${name}: neste servidor.`);
      }
      const fileId = await saveFile(db, me, mime, data);
      const id = randomUUID();
      await db.query('insert into expressions (id, guild_id, kind, name, file_id, emoji, created_by) values ($1, $2, $3, $4, $5, $6, $7)', [
        id,
        guildId,
        kind,
        name,
        fileId,
        emoji,
        me,
      ]);
      rt.guildChanged(guildId);
      const expression: Expression = { id, guildId, kind, name, fileId, emoji };
      return { expression };
    }),
  );

  async function expressionForManage(id: string, userId: string) {
    const [e] = await db.query<Expression>(`select ${EXPRESSION_COLUMNS} from expressions e where e.id = $1`, [id]);
    if (!e) throw new HttpError(404, 'Não encontrado.');
    await requirePerm(db, e.guildId, userId, Perm.MANAGE_EXPRESSIONS);
    return e;
  }

  r.patch(
    '/expressions/:id',
    auth,
    wrap(async (req) => {
      const e = await expressionForManage(String(req.params.id), req.user!.id);
      const body = parse(z.object({ name: nameFor(e.kind).optional(), emoji: soundEmoji }), req.body);
      if (body.name && e.kind === 'emoji' && body.name !== e.name) {
        const [dup] = await db.query("select 1 from expressions where guild_id = $1 and kind = 'emoji' and name = $2", [e.guildId, body.name]);
        if (dup) throw new HttpError(409, `Já existe um emoji :${body.name}: neste servidor.`);
      }
      await db.query('update expressions set name = coalesce($2, name), emoji = case when $4 then $3 else emoji end where id = $1', [
        e.id,
        body.name ?? null,
        body.emoji ?? null,
        e.kind === 'sound' && body.emoji !== undefined,
      ]);
      rt.guildChanged(e.guildId);
    }),
  );

  r.delete(
    '/expressions/:id',
    auth,
    wrap(async (req) => {
      const e = await expressionForManage(String(req.params.id), req.user!.id);
      await db.query('delete from expressions where id = $1', [e.id]);
      await deleteFiles(db, [e.fileId]);
      rt.guildChanged(e.guildId);
    }),
  );

  // ---------- perfil por servidor (apelido e foto) ----------

  r.patch(
    '/guilds/:id/members/:userId/nick',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      const me = req.user!.id;
      const target = req.params.userId === '@me' ? me : String(req.params.userId);
      const a = await requireMember(db, guildId, me);
      if (target === me) {
        if (!has(a.perms, Perm.CHANGE_NICKNAME) && !has(a.perms, Perm.MANAGE_NICKNAMES)) {
          throw new HttpError(403, 'Seu cargo não pode mudar o apelido neste servidor.');
        }
      } else {
        await requirePerm(db, guildId, me, Perm.MANAGE_NICKNAMES);
        await requireOutranks(db, guildId, a, target);
      }
      const { nick } = parse(z.object({ nick: z.string().trim().max(32, 'Apelido muito longo (máx. 32).').nullable() }), req.body);
      const updated = await db.query('update members set nick = $3 where guild_id = $1 and user_id = $2 returning 1', [guildId, target, nick || null]);
      if (!updated.length) throw new HttpError(404, 'Membro não encontrado.');
      rt.guildChanged(guildId);
    }),
  );

  r.post(
    '/guilds/:id/members/@me/avatar',
    auth,
    express.raw({ type: () => true, limit: GUILD_AVATAR_BYTES }),
    wrap(async (req) => {
      const guildId = String(req.params.id);
      const me = req.user!.id;
      const a = await requireMember(db, guildId, me);
      if (!has(a.perms, Perm.CHANGE_NICKNAME)) throw new HttpError(403, 'Seu cargo não pode mudar a foto neste servidor.');
      const data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Arquivo vazio.');
      const mime = sniffImage(data);
      if (!mime || mime === 'image/avif') throw new HttpError(415, 'Envie uma imagem PNG, JPG, WebP ou GIF.');
      const fileId = await saveFile(db, me, mime, data);
      const [old] = await db.query<{ avatar_id: string | null }>('select avatar_id from members where guild_id = $1 and user_id = $2', [guildId, me]);
      await db.query('update members set avatar_id = $3 where guild_id = $1 and user_id = $2', [guildId, me, fileId]);
      await deleteFiles(db, [old?.avatar_id]);
      rt.guildChanged(guildId);
      return { imageId: fileId };
    }),
  );

  // tirar a foto de servidor: a própria pessoa, ou quem gerencia apelidos (para fotos impróprias)
  r.delete(
    '/guilds/:id/members/:userId/avatar',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      const me = req.user!.id;
      const target = req.params.userId === '@me' ? me : String(req.params.userId);
      const a = await requireMember(db, guildId, me);
      if (target !== me) {
        await requirePerm(db, guildId, me, Perm.MANAGE_NICKNAMES);
        await requireOutranks(db, guildId, a, target);
      }
      const [old] = await db.query<{ avatar_id: string | null }>('select avatar_id from members where guild_id = $1 and user_id = $2', [
        guildId,
        target,
      ]);
      if (!old) throw new HttpError(404, 'Membro não encontrado.');
      await db.query('update members set avatar_id = null where guild_id = $1 and user_id = $2', [guildId, target]);
      await deleteFiles(db, [old.avatar_id]);
      rt.guildChanged(guildId);
    }),
  );
}
