import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { USER_COLUMNS } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import type { DmChannel, Friend, PublicUser } from '../../shared/types.ts';

/**
 * Amigos e mensagens diretas.
 * Amizade: uma linha por par (quem pediu -> quem recebeu), 'pending' até ser aceita.
 * DM: um canal do tipo 'dm' sem servidor, com os dois participantes em dm_members.
 */
export function registerSocialRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof import('./auth.ts').requireAuth>) {
  async function listFriends(userId: string): Promise<Friend[]> {
    const rows = await db.query<PublicUser & { requesterId: string; status: string }>(
      `select f.requester_id as "requesterId", f.status, ${USER_COLUMNS}
       from friendships f
       join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
       where f.requester_id = $1 or f.addressee_id = $1
       order by u.display_name`,
      [userId],
    );
    return rows.map(({ requesterId, status, ...user }) => ({
      user,
      status: status === 'accepted' ? 'friend' : requesterId === userId ? 'outgoing' : 'incoming',
    }));
  }

  async function listDms(userId: string): Promise<DmChannel[]> {
    const rows = await db.query<PublicUser & { channelId: string; lastMessageAt: string | null }>(
      `select c.id as "channelId", ${USER_COLUMNS},
         (select max(created_at) from messages where channel_id = c.id) as "lastMessageAt"
       from dm_members me
       join channels c on c.id = me.channel_id
       join dm_members other on other.channel_id = c.id and other.user_id <> me.user_id
       join users u on u.id = other.user_id
       where me.user_id = $1
       order by "lastMessageAt" desc nulls last`,
      [userId],
    );
    return rows.map(({ channelId, lastMessageAt, ...user }) => ({
      id: channelId,
      guildId: '',
      name: user.displayName,
      type: 'dm',
      position: 0,
      recipient: user,
      lastMessageAt,
    }));
  }

  const notifyFriends = (...userIds: string[]) => {
    for (const id of userIds) rt.emitUser(id, 'friends:changed', {});
  };

  r.get('/friends', auth, wrap(async (req) => ({ friends: await listFriends(req.user!.id) })));
  r.get('/dms', auth, wrap(async (req) => ({ dms: await listDms(req.user!.id) })));

  // Enviar pedido de amizade pelo nome de usuário (ou aceitar, se a pessoa já tinha pedido).
  r.post(
    '/friends',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      const { username } = parse(z.object({ username: z.string().trim().toLowerCase().min(1, 'Informe o usuário.') }), req.body);
      const [target] = await db.query<{ id: string }>('select id from users where username = $1', [username.replace(/^@/, '')]);
      if (!target) throw new HttpError(404, 'Não encontramos ninguém com esse usuário. Confira a grafia.');
      if (target.id === me.id) throw new HttpError(400, 'Você não pode adicionar a si mesmo.');
      const [existing] = await db.query<{ requester_id: string; status: string }>(
        `select requester_id, status from friendships
         where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
        [me.id, target.id],
      );
      if (existing?.status === 'accepted') throw new HttpError(409, 'Vocês já são amigos.');
      if (existing && existing.requester_id === me.id) throw new HttpError(409, 'Pedido já enviado. Aguarde a resposta.');
      if (existing) {
        await db.query(`update friendships set status = 'accepted' where requester_id = $1 and addressee_id = $2`, [target.id, me.id]);
      } else {
        await db.query(`insert into friendships (requester_id, addressee_id) values ($1, $2)`, [me.id, target.id]);
      }
      notifyFriends(me.id, target.id);
      return { friends: await listFriends(me.id), accepted: !!existing };
    }),
  );

  r.post(
    '/friends/:userId/accept',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const other = String(req.params.userId);
      const updated = await db.query(
        `update friendships set status = 'accepted'
         where requester_id = $1 and addressee_id = $2 and status = 'pending' returning 1`,
        [other, me],
      );
      if (!updated.length) throw new HttpError(404, 'Pedido de amizade não encontrado.');
      notifyFriends(me, other);
      return { friends: await listFriends(me) };
    }),
  );

  // Remover amigo, recusar ou cancelar pedido.
  r.delete(
    '/friends/:userId',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const other = String(req.params.userId);
      await db.query(
        `delete from friendships
         where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
        [me, other],
      );
      notifyFriends(me, other);
      return { friends: await listFriends(me) };
    }),
  );

  // Abre (ou cria) a conversa direta com alguém: precisa ser amigo ou estar num servidor em comum.
  r.post(
    '/dms',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const { userId } = parse(z.object({ userId: z.string().min(1) }), req.body);
      if (userId === me) throw new HttpError(400, 'Você não pode mandar mensagem para si mesmo.');
      const [allowed] = await db.query(
        `select 1 where exists (
           select 1 from friendships
           where status = 'accepted' and ((requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1))
         ) or exists (
           select 1 from members a join members b on a.guild_id = b.guild_id where a.user_id = $1 and b.user_id = $2
         )`,
        [me, userId],
      );
      if (!allowed) throw new HttpError(403, 'Você só pode mandar mensagem para amigos ou membros dos seus servidores.');

      const [existing] = await db.query<{ id: string }>(
        `select a.channel_id as id from dm_members a
         join dm_members b on b.channel_id = a.channel_id
         where a.user_id = $1 and b.user_id = $2`,
        [me, userId],
      );
      let id = existing?.id;
      if (!id) {
        id = randomUUID();
        await db.query(`insert into channels (id, guild_id, name, type, position) values ($1, null, '', 'dm', 0)`, [id]);
        await db.query('insert into dm_members (channel_id, user_id) values ($1, $2), ($1, $3)', [id, me, userId]);
        rt.emitUser(userId, 'dms:changed', {});
      }
      const dm = (await listDms(me)).find((d) => d.id === id);
      return { dm };
    }),
  );
}

/** Ids dos participantes de uma conversa direta (para entregar eventos só a eles). */
export async function dmMemberIds(db: Db, channelId: string): Promise<string[]> {
  const rows = await db.query<{ user_id: string }>('select user_id from dm_members where channel_id = $1', [channelId]);
  return rows.map((r) => r.user_id);
}
