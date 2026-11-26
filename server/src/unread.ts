import type { Router } from 'express';
import type { Db } from './db.ts';
import { wrap } from './http.ts';
import type { requireAuth } from './auth.ts';

/**
 * Mensagens não lidas por canal (até 100 por canal: o app mostra "99+"). Conta o que outras pessoas
 * mandaram depois da última leitura; sem leitura registrada, desde que a pessoa entrou no servidor (e
 * nunca antes de o contador existir, para ninguém abrir o app com tudo "não lido").
 */
export async function unreadCounts(db: Db, userId: string, channelIds: string[]): Promise<Record<string, number>> {
  if (!channelIds.length) return {};
  const rows = await db.query<{ id: string; n: number }>(
    `with since as (select coalesce((select (value #>> '{}')::timestamptz from app_settings where name = 'unread_since'), now()) as t)
     select c.id,
       (select count(*)::int from (
          select 1 from messages m
          where m.channel_id = c.id and m.author_id <> $1
            and m.created_at > greatest(
              coalesce(r.last_read_at, mem.joined_at, (select t from since)),
              (select t from since))
          limit 100) x) as n
     from channels c
     left join channel_reads r on r.channel_id = c.id and r.user_id = $1
     left join members mem on mem.guild_id = c.guild_id and mem.user_id = $1
     where c.id = any($2) and c.type <> 'voice'`,
    [userId, channelIds],
  );
  return Object.fromEntries(rows.filter((r) => r.n > 0).map((r) => [r.id, r.n]));
}

export function registerUnreadRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>, channelForMember: (channelId: string, userId: string) => Promise<unknown>) {
  /** "Li até aqui" (ao abrir o canal ou quando chega mensagem com ele aberto). */
  r.post(
    '/channels/:id/read',
    auth,
    wrap(async (req) => {
      // só em canal que a pessoa enxerga (senão qualquer conta gravaria marcas em canais alheios)
      await channelForMember(String(req.params.id), req.user!.id);
      await db.query(
        `insert into channel_reads (user_id, channel_id, last_read_at)
         select $1, c.id, now() from channels c where c.id = $2
         on conflict (user_id, channel_id) do update set last_read_at = now()`,
        [req.user!.id, String(req.params.id)],
      );
      return { ok: true };
    }),
  );
}
