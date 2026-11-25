import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';

/**
 * Suspensão no Resenha inteiro (não só num servidor): a pessoa é desconectada na hora, não entra mais em
 * nenhum aparelho e não recupera a senha enquanto durar. Com prazo, acaba sozinha; sem prazo, só a equipe
 * reativa. Só a equipe do Resenha (PLATFORM_ADMINS) suspende.
 */
export const SUSPENSION_DAYS = [1, 3, 7, 30] as const;

/** a conta está suspensa AGORA (o prazo, se houver, ainda não acabou) — para usar no SQL, tabela `u`/`users` */
export const suspendedNow = (t = 'u') => `(${t}.suspended_at is not null and (${t}.suspended_until is null or ${t}.suspended_until > now()))`;

export async function suspendUser(db: Db, rt: Realtime, userId: string, reason: string, days: number | null, byUserId: string) {
  await db.query(
    `update users set suspended_at = now(), suspended_reason = $2, suspended_by = $4,
       suspended_until = case when $3::int is null then null else now() + make_interval(days => $3::int) end
     where id = $1`,
    [userId, reason || 'Violação dos Termos de uso', days, byUserId],
  );
  const ended = await db.query<{ token_hash: string }>('delete from sessions where user_id = $1 returning token_hash', [userId]);
  rt.endSessions(ended.map((s) => s.token_hash));
  rt.endUser(userId);
}

export async function unsuspendUser(db: Db, where: { id?: string; username?: string }) {
  const rows = await db.query(
    `update users set suspended_at = null, suspended_reason = null, suspended_until = null, suspended_by = null
     where ${where.id ? 'id = $1' : 'username = $1'} returning 1`,
    [where.id ?? where.username],
  );
  return rows.length > 0;
}

/** texto que a pessoa vê ao tentar entrar */
export function suspensionMessage(reason: string | null, until: string | Date | null, contact: string) {
  const fim = until
    ? ` até ${new Date(until).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '';
  return `Esta conta está suspensa${fim} por violar os Termos de uso${reason ? ` (${reason})` : ''}. Se acha que foi um engano, escreva para ${contact}.`;
}

/** limpa as suspensões que já acabaram (a conta volta ao normal sozinha) */
export function startSuspensionCleanup(db: Db) {
  const run = () =>
    db
      .query('update users set suspended_at = null, suspended_reason = null, suspended_until = null, suspended_by = null where suspended_until is not null and suspended_until <= now()')
      .catch(() => {});
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60_000).unref();
}
