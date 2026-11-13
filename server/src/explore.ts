import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { USER_COLUMNS, type requireAuth } from './auth.ts';
import { isPlatformAdmin } from './reports.ts';
import { audit, userLabel } from './audit.ts';
import { loadGuild } from './guilds.ts';
import { LISTED_SQL, isListed, officialGuildId } from './listing.ts';
import { limit } from './security.ts';
import { GUILD_CATEGORIES } from '../../shared/explore.ts';
import type { ExploreGuild, Member } from '../../shared/types.ts';

/**
 * Explorar servidores: servidores públicos que qualquer pessoa pode achar e entrar sem convite.
 * Para aparecer na lista: público, com descrição, ícone, categoria e regras com "Aceito", e não ter
 * sido tirado da lista pela equipe. O servidor oficial aparece sempre, em primeiro.
 */
export function registerExploreRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };

  r.get(
    '/explore',
    auth,
    wrap(async (req) => {
      const q = parse(
        z.object({ q: z.string().trim().max(50).default(''), category: z.enum(GUILD_CATEGORIES).or(z.literal('')).default('') }),
        req.query,
      );
      const official = await officialGuildId(db);
      const rows = await db.query<ExploreGuild & { official: boolean }>(
        `select g.id, g.name, g.description, g.icon_id as "iconId", g.banner_id as "bannerId", g.category,
           (select count(*)::int from members m where m.guild_id = g.id) as members,
           (g.id = $1) as official,
           exists (select 1 from members m where m.guild_id = g.id and m.user_id = $2) as "isMember"
         from guilds g
         where (g.id = $1 or (${LISTED_SQL}))
           and ($3 = '' or g.name ilike '%' || $3 || '%' or g.description ilike '%' || $3 || '%')
           and ($4 = '' or g.category = $4 or g.id = $1)
         order by (g.id = $1) desc, members desc, g.created_at
         limit 60`,
        [official ?? '', req.user!.id, q.q, q.category],
      );
      return { guilds: rows };
    }),
  );

  /** Entrar num servidor público sem convite. */
  r.post(
    '/explore/:id/join',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const id = String(req.params.id);
      limit(`explore-join:${me}`, 20, 60 * 60_000, 'Você entrou em muitos servidores seguidos. Espere um pouco.');
      if (!(await isListed(db, id))) throw new HttpError(404, 'Servidor não encontrado.');
      const [banned] = await db.query('select 1 from bans where guild_id = $1 and user_id = $2', [id, me]);
      if (banned) throw new HttpError(403, 'Você foi banido deste servidor.');
      const inserted = await db.query('insert into members (guild_id, user_id) values ($1, $2) on conflict do nothing returning joined_at', [id, me]);
      if (inserted.length) {
        await audit(db, id, me, 'member_join', { type: 'user', id: me, label: await userLabel(db, me) });
        rt.userJoinedGuild(me, id);
        const [member] = await db.query<Member>(
          `select m.joined_at as "joinedAt", m.timeout_until as "timeoutUntil", m.nick, ${USER_COLUMNS}, '{}'::text[] as "roleIds"
           from members m join users u on u.id = m.user_id where m.guild_id = $1 and m.user_id = $2`,
          [id, me],
        );
        if (member) rt.emitGuild(id, 'member:join', { guildId: id, member });
      }
      const guild = await loadGuild(db, me, id);
      return { guild, voiceStates: rt.voiceStatesFor(id, me) };
    }),
  );

  // ---------- equipe ----------
  r.get(
    '/admin/public-guilds',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      return {
        guilds: await db.query(
          `select g.id, g.name, g.description, g.icon_id as "iconId", g.category, g.unlisted, (${LISTED_SQL}) as listed,
             (select count(*)::int from members m where m.guild_id = g.id) as members,
             (select count(*)::int from reports r where r.guild_id = g.id and r.status = 'open') as "openReports",
             (select username from users u where u.id = g.owner_id) as owner
           from guilds g where g.public order by "openReports" desc, members desc limit 200`,
        ),
      };
    }),
  );

  /** Tirar da lista do Explorar (ou devolver). O servidor continua existindo. */
  r.post(
    '/admin/public-guilds/:id',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const { unlisted } = parse(z.object({ unlisted: z.boolean() }), req.body);
      const [g] = await db.query<{ id: string }>('update guilds set unlisted = $2 where id = $1 returning id', [String(req.params.id), unlisted]);
      if (!g) throw new HttpError(404, 'Servidor não encontrado.');
      rt.guildChanged(g.id);
      return { ok: true };
    }),
  );

  /**
   * Contexto de uma denúncia de mensagem: algumas mensagens antes e depois, só para a equipe entender a
   * situação, sem entrar no servidor. Cada acesso fica registrado (quem viu e quando).
   */
  r.get(
    '/admin/reports/:id/context',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const [rep] = await db.query<{ id: string; target_type: string; target_id: string; snapshot: { channelId?: string; sentAt?: string } }>(
        'select id, target_type, target_id, snapshot from reports where id = $1',
        [String(req.params.id)],
      );
      if (!rep) throw new HttpError(404, 'Denúncia não encontrada.');
      if (rep.target_type !== 'message' || !rep.snapshot.channelId || !rep.snapshot.sentAt) throw new HttpError(400, 'Só denúncias de mensagem têm conversa em volta.');
      const cols = `m.id, m.content, m.created_at as "createdAt", (select count(*)::int from attachments a where a.message_id = m.id) as attachments,
        u.username, u.display_name as "displayName"`;
      const before = await db.query(
        `select ${cols} from messages m join users u on u.id = m.author_id where m.channel_id = $1 and m.created_at < $2 order by m.created_at desc limit 8`,
        [rep.snapshot.channelId, rep.snapshot.sentAt],
      );
      const after = await db.query(
        `select ${cols} from messages m join users u on u.id = m.author_id where m.channel_id = $1 and m.created_at >= $2 order by m.created_at limit 9`,
        [rep.snapshot.channelId, rep.snapshot.sentAt],
      );
      await db.query('insert into admin_access_log (id, admin_id, report_id, kind) values ($1, $2, $3, $4)', [randomUUID(), req.user!.id, rep.id, 'context']);
      const views = await db.query<{ username: string; at: string }>(
        `select u.username, l.created_at as at from admin_access_log l left join users u on u.id = l.admin_id
         where l.report_id = $1 order by l.created_at desc limit 10`,
        [rep.id],
      );
      return { messages: [...before.reverse(), ...after], targetId: rep.target_id, views };
    }),
  );
}
