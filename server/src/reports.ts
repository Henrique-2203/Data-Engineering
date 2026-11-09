import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { config } from './config.ts';
import { HttpError, parse, wrap } from './http.ts';
import { canSee, loadChannel, memberAccess } from './access.ts';
import { deleteFiles, guildFileIds } from './expressions.ts';
import { limit } from './security.ts';
import { signFileLink } from './storage.ts';
import type { requireAuth } from './auth.ts';

/**
 * Denúncias: qualquer pessoa denuncia mensagem, perfil ou servidor; a denúncia vai para a fila da
 * equipe do Resenha (PLATFORM_ADMINS), que pode apagar a mensagem, suspender a conta ou excluir o
 * servidor. Quem foi denunciado não sabe quem denunciou. Uma cópia do conteúdo fica guardada na
 * denúncia (se o autor apagar a mensagem, a prova não some).
 */

export const REPORT_REASONS = ['minors', 'harassment', 'hate', 'sexual', 'violence', 'selfharm', 'spam', 'impersonation', 'illegal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** ordem da fila: o mais grave primeiro */
const PRIORITY: Record<ReportReason, number> = { minors: 0, selfharm: 1, violence: 2, sexual: 3, harassment: 4, hate: 4, illegal: 5, impersonation: 6, spam: 7, other: 8 };

export const isPlatformAdmin = (username: string | undefined) => !!username && config.platformAdmins.includes(username.toLowerCase());

/** Os dois têm algo em comum (servidor, amizade/pedido, conversa)? Mesma regra do cartão de perfil. */
async function related(db: Db, a: string, b: string) {
  const [r] = await db.query(
    `select 1 where
       exists (select 1 from members x join members y on x.guild_id = y.guild_id where x.user_id = $1 and y.user_id = $2)
       or exists (select 1 from friendships where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1))
       or exists (select 1 from dm_members x join dm_members y on x.channel_id = y.channel_id where x.user_id = $1 and y.user_id = $2)`,
    [a, b],
  );
  return !!r;
}

export function registerReportRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };
  const notifyAdmins = async () => {
    if (!config.platformAdmins.length) return;
    const admins = await db.query<{ id: string }>('select id from users where username = any($1)', [config.platformAdmins]);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from reports where status = 'open'");
    for (const a of admins) rt.emitUser(a.id, 'reports:count', { open: n });
  };

  // ---------- denunciar ----------
  r.post(
    '/reports',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      limit(`report:${me.id}`, 10, 60 * 60_000, 'Você já enviou muitas denúncias em pouco tempo. Tente de novo mais tarde.');
      const body = parse(
        z.object({
          type: z.enum(['message', 'user', 'guild']),
          id: z.string().min(1).max(64),
          reason: z.enum(REPORT_REASONS, { message: 'Escolha o motivo da denúncia.' }),
          details: z.string().trim().max(1000, 'Detalhes muito longos (máx. 1000 caracteres).').default(''),
        }),
        req.body,
      );

      // confere se a pessoa pode ver o que está denunciando e tira uma "foto" do conteúdo
      let snapshot: Record<string, unknown>;
      let targetUserId: string | null = null;
      let guildId: string | null = null;
      if (body.type === 'message') {
        const [m] = await db.query<{ id: string; channel_id: string; author_id: string; content: string; created_at: string; sticker_id: string | null; username: string; display_name: string }>(
          `select m.id, m.channel_id, m.author_id, m.content, m.created_at, m.sticker_id, u.username, u.display_name
           from messages m join users u on u.id = m.author_id where m.id = $1`,
          [body.id],
        );
        if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
        const c = await loadChannel(db, m.channel_id);
        if (!c) throw new HttpError(404, 'Mensagem não encontrada.');
        if (c.guildId) {
          const a = await memberAccess(db, c.guildId, me.id);
          if (!a || !canSee(a, c)) throw new HttpError(404, 'Mensagem não encontrada.');
        } else {
          const [dm] = await db.query('select 1 from dm_members where channel_id = $1 and user_id = $2', [c.id, me.id]);
          if (!dm) throw new HttpError(404, 'Mensagem não encontrada.');
        }
        if (m.author_id === me.id) throw new HttpError(400, 'Você não pode denunciar a própria mensagem.');
        const attachments = await db.query<{ id: string; filename: string }>('select id, filename from attachments where message_id = $1', [m.id]);
        const [g] = c.guildId ? await db.query<{ name: string }>('select name from guilds where id = $1', [c.guildId]) : [];
        targetUserId = m.author_id;
        guildId = c.guildId;
        snapshot = {
          content: m.content,
          sentAt: m.created_at,
          author: { id: m.author_id, username: m.username, displayName: m.display_name },
          where: c.type === 'dm' ? 'Mensagem direta' : `${g?.name ?? ''} #${c.name}`,
          channelId: c.id,
          attachments: attachments.map((a) => ({ id: a.id, name: a.filename })),
          sticker: !!m.sticker_id,
        };
      } else if (body.type === 'user') {
        if (body.id === me.id) throw new HttpError(400, 'Você não pode denunciar a si mesmo.');
        const [u] = await db.query<{ id: string; username: string; display_name: string; bio: string; avatar_id: string | null; status_text: string | null }>(
          'select id, username, display_name, bio, avatar_id, status_text from users where id = $1',
          [body.id],
        );
        if (!u || !(await related(db, me.id, u.id))) throw new HttpError(404, 'Usuário não encontrado.');
        targetUserId = u.id;
        snapshot = { username: u.username, displayName: u.display_name, bio: u.bio, status: u.status_text, avatarId: u.avatar_id };
      } else {
        const [g] = await db.query<{ id: string; name: string; description: string; owner_id: string; icon_id: string | null }>(
          'select id, name, description, owner_id, icon_id from guilds where id = $1',
          [body.id],
        );
        if (!g || !(await memberAccess(db, g.id, me.id))) throw new HttpError(404, 'Servidor não encontrado.');
        if (g.owner_id === me.id) throw new HttpError(400, 'Você é o dono deste servidor.');
        const [owner] = await db.query<{ username: string }>('select username from users where id = $1', [g.owner_id]);
        guildId = g.id;
        targetUserId = g.owner_id;
        snapshot = { name: g.name, description: g.description, owner: owner?.username, iconId: g.icon_id };
      }

      // a mesma pessoa não abre duas denúncias iguais enquanto a primeira está aberta
      const [dup] = await db.query("select 1 from reports where reporter_id = $1 and target_type = $2 and target_id = $3 and status = 'open'", [me.id, body.type, body.id]);
      if (dup) throw new HttpError(409, 'Você já denunciou isso. A equipe vai analisar.');
      await db.query(
        `insert into reports (id, reporter_id, target_type, target_id, target_user_id, guild_id, reason, details, snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [randomUUID(), me.id, body.type, body.id, targetUserId, guildId, body.reason, body.details, JSON.stringify(snapshot)],
      );
      await notifyAdmins();
      return { ok: true };
    }),
  );

  // ---------- fila da equipe ----------
  r.get(
    '/admin/reports',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const status = req.query.status === 'closed' ? 'closed' : 'open';
      const rows = await db.query<{ reason: ReportReason } & Record<string, unknown>>(
        `select r.id, r.target_type as "type", r.target_id as "targetId", r.reason, r.details, r.snapshot, r.status,
           r.resolution, r.created_at as "createdAt", r.handled_at as "handledAt",
           rep.username as "reporter", h.username as "handledBy",
           tu.username as "targetUsername", tu.suspended_at is not null as "targetSuspended",
           (select count(*)::int from reports o where o.target_type = r.target_type and o.target_id = r.target_id) as "sameTarget",
           (select count(*)::int from reports o where o.target_user_id = r.target_user_id and r.target_user_id is not null) as "againstUser",
           case r.target_type
             when 'message' then exists (select 1 from messages m where m.id = r.target_id)
             when 'guild' then exists (select 1 from guilds g where g.id = r.target_id)
             else exists (select 1 from users u where u.id = r.target_id) end as "targetExists"
         from reports r
         left join users rep on rep.id = r.reporter_id
         left join users h on h.id = r.handled_by
         left join users tu on tu.id = r.target_user_id
         where ${status === 'open' ? "r.status = 'open'" : "r.status <> 'open'"}
         order by r.created_at desc limit 200`,
      );
      if (status === 'open') rows.sort((a, b) => PRIORITY[a.reason] - PRIORITY[b.reason]);
      // links assinados (que expiram) para a equipe ver os anexos guardados como prova
      for (const row of rows) {
        const snap = row.snapshot as { attachments?: { id: string; name: string; url?: string }[] } | null;
        for (const a of snap?.attachments ?? []) a.url = await signFileLink(db, a.id, a.name);
      }
      return { reports: rows };
    }),
  );

  r.get(
    '/admin/reports/count',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from reports where status = 'open'");
      return { open: n };
    }),
  );

  /** Ação da equipe sobre uma denúncia (todas ficam registradas na própria denúncia). */
  r.post(
    '/admin/reports/:id/action',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const body = parse(
        z.object({
          action: z.enum(['delete_message', 'suspend_user', 'delete_guild', 'resolve', 'dismiss']),
          note: z.string().trim().max(500).default(''),
        }),
        req.body,
      );
      const [rep] = await db.query<{ id: string; target_type: string; target_id: string; target_user_id: string | null; guild_id: string | null }>(
        'select id, target_type, target_id, target_user_id, guild_id from reports where id = $1',
        [String(req.params.id)],
      );
      if (!rep) throw new HttpError(404, 'Denúncia não encontrada.');
      const label: Record<typeof body.action, string> = {
        delete_message: 'Mensagem apagada',
        suspend_user: 'Conta suspensa',
        delete_guild: 'Servidor excluído',
        resolve: 'Resolvida',
        dismiss: 'Descartada (não viola os termos)',
      };

      if (body.action === 'delete_message') {
        if (rep.target_type !== 'message') throw new HttpError(400, 'Essa denúncia não é de mensagem.');
        const [m] = await db.query<{ channel_id: string }>('delete from messages where id = $1 returning channel_id', [rep.target_id]);
        if (m) {
          const c = await loadChannel(db, m.channel_id);
          const payload = { channelId: m.channel_id, id: rep.target_id };
          if (c?.guildId) rt.emitGuild(c.guildId, 'message:delete', { guildId: c.guildId, ...payload });
          else {
            const members = await db.query<{ user_id: string }>('select user_id from dm_members where channel_id = $1', [m.channel_id]);
            for (const u of members) rt.emitUser(u.user_id, 'message:delete', { guildId: null, ...payload });
          }
        }
      } else if (body.action === 'suspend_user') {
        if (!rep.target_user_id) throw new HttpError(400, 'Não há conta para suspender nessa denúncia.');
        const [u] = await db.query<{ username: string }>('select username from users where id = $1', [rep.target_user_id]);
        if (!u) throw new HttpError(404, 'A conta já foi excluída.');
        if (isPlatformAdmin(u.username)) throw new HttpError(400, 'Não dá para suspender alguém da equipe.');
        await db.query('update users set suspended_at = now(), suspended_reason = $2 where id = $1', [rep.target_user_id, body.note || 'Violação dos Termos de uso']);
        const ended = await db.query<{ token_hash: string }>('delete from sessions where user_id = $1 returning token_hash', [rep.target_user_id]);
        rt.endSessions(ended.map((s) => s.token_hash));
        rt.endUser(rep.target_user_id);
      } else if (body.action === 'delete_guild') {
        if (!rep.guild_id || rep.target_type !== 'guild') throw new HttpError(400, 'Essa denúncia não é de servidor.');
        const [g] = await db.query<{ icon_id: string | null; banner_id: string | null }>('select icon_id, banner_id from guilds where id = $1', [rep.guild_id]);
        if (g) {
          const files = await guildFileIds(db, rep.guild_id);
          rt.emitGuild(rep.guild_id, 'guild:delete', { id: rep.guild_id });
          rt.guildDeleted(rep.guild_id);
          await db.query('delete from guilds where id = $1', [rep.guild_id]);
          await deleteFiles(db, [g.icon_id, g.banner_id, ...files]);
        }
      }

      // apagar/suspender/excluir também encerra todas as denúncias abertas sobre o mesmo alvo
      const status = body.action === 'dismiss' ? 'dismissed' : 'resolved';
      const resolution = body.note ? `${label[body.action]}: ${body.note}` : label[body.action];
      if (body.action === 'resolve' || body.action === 'dismiss') {
        await db.query(`update reports set status = $2, resolution = $3, handled_by = $4, handled_at = now() where id = $1 and status = 'open'`, [
          rep.id,
          status,
          resolution,
          req.user!.id,
        ]);
      } else if (body.action === 'suspend_user') {
        // conta suspensa: encerra todas as denúncias abertas contra essa pessoa (mensagens, perfil, servidores)
        await db.query(
          `update reports set status = $2, resolution = $3, handled_by = $4, handled_at = now()
           where status = 'open' and (id = $1 or target_user_id = $5)`,
          [rep.id, status, resolution, req.user!.id, rep.target_user_id],
        );
      } else {
        await db.query(
          `update reports set status = $2, resolution = $3, handled_by = $4, handled_at = now()
           where status = 'open' and (id = $1 or (target_type = $5 and target_id = $6))`,
          [rep.id, status, resolution, req.user!.id, rep.target_type, rep.target_id],
        );
      }
      await notifyAdmins();
    }),
  );

  // reativar conta suspensa (engano ou fim da punição)
  r.post(
    '/admin/users/:username/unsuspend',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const rows = await db.query('update users set suspended_at = null, suspended_reason = null where username = $1 returning 1', [String(req.params.username).toLowerCase()]);
      if (!rows.length) throw new HttpError(404, 'Usuário não encontrado.');
    }),
  );

  // denúncias encerradas há mais de 6 meses são apagadas (minimização de dados, LGPD)
  const cleanup = () => db.query("delete from reports where status <> 'open' and handled_at < now() - interval '180 days'").catch(() => {});
  setTimeout(cleanup, 90_000);
  setInterval(cleanup, 24 * 3600_000).unref();
}
