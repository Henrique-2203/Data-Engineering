import { randomUUID } from 'node:crypto';
import express, { type Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { USER_COLUMNS, type requireAuth } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import { sniffImage } from './sanitize.ts';
import { IMAGE_ROW, saveImage, sendStoredImage } from './files.ts';
import type { Profile, ProfileLink, PublicUser } from '../../shared/types.ts';

/**
 * Perfil social: foto (inclusive GIF), banner, bio, pronome, links e status com prazo.
 * Foto e status vão em todo lugar (são pequenos); o resto só carrega ao abrir o cartão de perfil.
 */

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024; // GIF animado de perfil
const MAX_BANNER_BYTES = 1024 * 1024; // banner já chega comprimido (~30-90 KB)

const LINK_TYPES = ['steam', 'twitch', 'youtube', 'instagram', 'tiktok', 'x', 'spotify', 'site'] as const;

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Informe um nome.').max(32, 'Nome muito longo.').optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bio: z.string().trim().max(190, 'A bio pode ter até 190 caracteres.').optional(),
  pronouns: z.string().trim().max(40, 'Pronomes muito longos.').optional(),
  links: z
    .array(
      z.object({
        type: z.enum(LINK_TYPES),
        url: z
          .string()
          .trim()
          .max(200)
          .refine((u) => /^https:\/\/[^\s]+\.[^\s]+$/i.test(u), 'Os links precisam começar com https://'),
      }),
    )
    .max(6, 'No máximo 6 links.')
    .optional(),
  status: z
    .object({
      text: z.string().trim().max(80, 'Status muito longo.').default(''),
      emoji: z.string().max(16).nullable().default(null),
      /** minutos até sumir (null = até trocar) */
      expiresInMinutes: z.number().int().min(1).max(7 * 24 * 60).nullable().default(null),
    })
    .nullable()
    .optional(),
});

async function loadPublicUser(db: Db, userId: string): Promise<PublicUser> {
  const [u] = await db.query<PublicUser>(`select ${USER_COLUMNS} from users u where u.id = $1`, [userId]);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  return u;
}

export function registerProfileRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  /** Avisa todo mundo (foto, nome e status aparecem em toda parte). */
  const broadcast = async (userId: string) => {
    const user = await loadPublicUser(db, userId);
    rt.io.emit('user:update', user);
    return user;
  };

  r.patch(
    '/me',
    auth,
    wrap(async (req) => {
      const body = parse(profileSchema, req.body);
      const me = req.user!.id;
      const sets: string[] = [];
      const params: unknown[] = [me];
      const set = (col: string, value: unknown) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (body.displayName !== undefined) set('display_name', body.displayName);
      if (body.avatarColor !== undefined) set('avatar_color', body.avatarColor);
      if (body.bio !== undefined) set('bio', body.bio);
      if (body.pronouns !== undefined) set('pronouns', body.pronouns);
      if (body.links !== undefined) set('links', JSON.stringify(body.links));
      if (body.status !== undefined) {
        const st = body.status;
        const empty = !st || (!st.text && !st.emoji);
        set('status_text', empty ? null : st!.text);
        set('status_emoji', empty ? null : st!.emoji);
        set(
          'status_expires_at',
          empty || !st!.expiresInMinutes ? null : new Date(Date.now() + st!.expiresInMinutes * 60_000).toISOString(),
        );
      }
      if (sets.length) await db.query(`update users set ${sets.join(', ')} where id = $1`, params);
      return { user: await broadcast(me) };
    }),
  );

  for (const kind of ['avatar', 'banner'] as const) {
    const column = kind === 'avatar' ? 'avatar_id' : 'banner_id';
    const max = kind === 'avatar' ? MAX_AVATAR_BYTES : MAX_BANNER_BYTES;
    r.post(
      `/me/${kind}`,
      auth,
      express.raw({ type: () => true, limit: max }),
      wrap(async (req) => {
        const me = req.user!.id;
        const data = req.body as Buffer;
        if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Arquivo vazio.');
        const mime = sniffImage(data);
        if (!mime) throw new HttpError(415, 'Envie uma imagem PNG, JPG, WebP ou GIF.');
        if (mime === 'image/gif' && kind === 'banner') throw new HttpError(415, 'O banner não pode ser GIF.');
        const imageId = await saveImage(db, { userId: me, mime, data });
        // troca e apaga a anterior: o espaço não acumula
        const [old] = await db.query<{ old: string | null }>(`select ${column} as old from users where id = $1`, [me]);
        await db.query(`update users set ${column} = $2 where id = $1`, [me, imageId]);
        if (old?.old) await db.query('delete from images where id = $1', [old.old]);
        await broadcast(me);
        return { imageId };
      }),
    );
    r.delete(
      `/me/${kind}`,
      auth,
      wrap(async (req) => {
        const me = req.user!.id;
        const [old] = await db.query<{ old: string | null }>(`select ${column} as old from users where id = $1`, [me]);
        await db.query(`update users set ${column} = null where id = $1`, [me]);
        if (old?.old) await db.query('delete from images where id = $1', [old.old]);
        await broadcast(me);
      }),
    );
  }

  /** Cartão de perfil: só de quem divide servidor, é amigo ou tem conversa com você. */
  r.get(
    '/users/:id/profile',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const id = String(req.params.id);
      if (id !== me) {
        const [related] = await db.query(
          `select 1 where
             exists (select 1 from members a join members b on a.guild_id = b.guild_id where a.user_id = $1 and b.user_id = $2)
             or exists (select 1 from friendships where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1))
             or exists (select 1 from dm_members a join dm_members b on a.channel_id = b.channel_id where a.user_id = $1 and b.user_id = $2)`,
          [me, id],
        );
        if (!related) throw new HttpError(404, 'Usuário não encontrado.');
      }
      const user = await loadPublicUser(db, id);
      const [extra] = await db.query<{ bannerId: string | null; bio: string; pronouns: string; links: ProfileLink[]; createdAt: string }>(
        'select banner_id as "bannerId", bio, pronouns, links, created_at as "createdAt" from users where id = $1',
        [id],
      );
      const mutualGuilds =
        id === me
          ? []
          : await db.query<{ id: string; name: string; iconId: string | null }>(
              `select g.id, g.name, g.icon_id as "iconId" from guilds g
               join members a on a.guild_id = g.id and a.user_id = $1
               join members b on b.guild_id = g.id and b.user_id = $2
               order by g.name`,
              [me, id],
            );
      const mutualFriends =
        id === me
          ? []
          : await db.query<PublicUser>(
              `select ${USER_COLUMNS} from users u where u.id in (
                 select case when f.requester_id = $1 then f.addressee_id else f.requester_id end
                 from friendships f where f.status = 'accepted' and (f.requester_id = $1 or f.addressee_id = $1)
               ) and u.id in (
                 select case when f.requester_id = $2 then f.addressee_id else f.requester_id end
                 from friendships f where f.status = 'accepted' and (f.requester_id = $2 or f.addressee_id = $2)
               ) order by u.display_name`,
              [me, id],
            );
      const profile: Profile = { user, ...extra, links: extra.links ?? [], mutualGuilds, mutualFriends };
      return { profile };
    }),
  );
}
