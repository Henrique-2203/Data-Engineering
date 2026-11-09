import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import type { Db } from './db.ts';
import { wrap } from './http.ts';
import { requirePerm } from './access.ts';
import { userJson, type requireAuth } from './auth.ts';
import { Perm } from '../../shared/permissions.ts';
import type { AuditAction, AuditEntry } from '../../shared/types.ts';

/**
 * Registro de auditoria do servidor: quem fez o quê (banir, expulsar, castigar, mexer em cargos,
 * canais, emojis, apagar mensagem de outra pessoa...). Fica 90 dias e só quem tem "Ver o registro
 * de auditoria" (ou é administrador) consegue ler. O conteúdo das mensagens apagadas NÃO é guardado.
 */
export async function audit(
  db: Db,
  guildId: string,
  actorId: string,
  action: AuditAction,
  target?: { type: 'user' | 'role' | 'channel' | 'category' | 'expression' | 'guild' | 'message'; id: string; label: string } | null,
  details?: Record<string, unknown>,
) {
  await db
    .query(
      `insert into audit_log (id, guild_id, actor_id, action, target_type, target_id, target_label, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        guildId,
        actorId,
        action,
        target?.type ?? null,
        target?.id ?? null,
        target?.label?.slice(0, 100) ?? null,
        JSON.stringify(details ?? {}),
      ],
    )
    .catch((err) => console.warn('[audit] falha ao registrar', err));
}

/** Nome de alguém na época (o registro continua legível mesmo se a pessoa sair ou mudar de nome). */
export async function userLabel(db: Db, userId: string) {
  const [u] = await db.query<{ label: string }>(`select display_name || ' (@' || username || ')' as label from users where id = $1`, [userId]);
  return u?.label ?? 'conta excluída';
}

export function registerAuditRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>) {
  r.get(
    '/guilds/:id/audit',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await requirePerm(db, guildId, req.user!.id, Perm.VIEW_AUDIT_LOG);
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      const prefix = typeof req.query.action === 'string' && /^[a-z_]{3,40}$/.test(req.query.action) ? req.query.action : null;
      const params: unknown[] = [guildId];
      let where = 'a.guild_id = $1';
      if (before) {
        params.push(before);
        where += ` and a.created_at < (select created_at from audit_log where id = $${params.length})`;
      }
      if (prefix) {
        params.push(`${prefix}%`);
        where += ` and a.action like $${params.length}`;
      }
      const entries = await db.query<AuditEntry>(
        `select a.id, a.action, a.target_type as "targetType", a.target_id as "targetId", a.target_label as "targetLabel",
           a.details, a.created_at as "createdAt", case when u.id is null then null else ${userJson('u')} end as actor
         from audit_log a left join users u on u.id = a.actor_id
         where ${where} order by a.created_at desc limit 50`,
        params,
      );
      return { entries, hasMore: entries.length === 50 };
    }),
  );

  const cleanup = () => db.query(`delete from audit_log where created_at < now() - interval '90 days'`).catch(() => {});
  setTimeout(cleanup, 120_000).unref();
  setInterval(cleanup, 12 * 3600_000).unref();
}
