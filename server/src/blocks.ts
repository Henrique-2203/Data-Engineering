import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { USER_COLUMNS } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import type { PublicUser } from '../../shared/types.ts';

/**
 * Bloqueio de pessoas (DM-01). Quem bloqueia (A) e quem foi bloqueado (B):
 *  - viram "não amigos" (a amizade e os pedidos somem);
 *  - nenhum dos dois manda mensagem privada, pedido de amizade ou liga para o outro;
 *  - um não vê a presença nem o "jogando agora" do outro;
 *  - A é avisado ao entrar numa call onde B está (e quando B entra numa call em que A está), pelo @usuário, porque B pode trocar nome e foto;
 *  - nos servidores em comum as mensagens de B ficam recolhidas para A (no app).
 * B nunca recebe aviso de que foi bloqueado.
 */
export const MAX_BLOCKS = 500;

/** quem eu bloqueei */
export async function blockedByMe(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>('select blocked_id as id from user_blocks where blocker_id = $1', [userId]);
  return rows.map((r) => r.id);
}

/** pessoas com bloqueio entre nós, nos dois sentidos (para esconder presença) */
export async function blockedEitherWay(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select blocked_id as id from user_blocks where blocker_id = $1 union select blocker_id from user_blocks where blocked_id = $1`,
    [userId],
  );
  return rows.map((r) => r.id);
}

export async function blockState(db: Db, me: string, other: string) {
  const rows = await db.query<{ blocker_id: string }>(
    `select blocker_id from user_blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
    [me, other],
  );
  return { byMe: rows.some((r) => r.blocker_id === me), byThem: rows.some((r) => r.blocker_id === other) };
}

/** Barra o contato (DM, pedido, ligação) quando há bloqueio. Quem foi bloqueado recebe uma mensagem neutra. */
export async function assertNotBlocked(db: Db, me: string, other: string, what: 'message' | 'friend' | 'call' | 'dm') {
  const s = await blockState(db, me, other);
  if (s.byMe) throw new HttpError(403, 'Você bloqueou essa pessoa. Desbloqueie em Configurações → Bloqueados (ou no perfil dela) para voltar a falar.');
  if (s.byThem) {
    const msg = { message: 'Não foi possível enviar a mensagem para essa pessoa.', friend: 'Não foi possível enviar o pedido para essa pessoa.', call: 'Não foi possível ligar para essa pessoa.', dm: 'Não foi possível abrir conversa com essa pessoa.' }[what];
    throw new HttpError(403, msg);
  }
}

/** o outro participante de uma conversa direta, ou null */
export async function dmOther(db: Db, channelId: string, me: string): Promise<string | null> {
  const [row] = await db.query<{ user_id: string }>('select user_id from dm_members where channel_id = $1 and user_id <> $2 limit 1', [channelId, me]);
  return row?.user_id ?? null;
}

export function registerBlockRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof import('./auth.ts').requireAuth>) {
  const list = async (me: string) =>
    db.query<PublicUser & { blockedAt: string }>(
      `select ${USER_COLUMNS}, b.created_at as "blockedAt" from user_blocks b join users u on u.id = b.blocked_id where b.blocker_id = $1 order by b.created_at desc`,
      [me],
    );

  r.get('/blocks', auth, wrap(async (req) => ({ blocks: await list(req.user!.id) })));

  r.post(
    '/blocks',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      limit(`block:${me}`, 30, 60_000, 'Muitos bloqueios seguidos. Espere um minuto.');
      const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), req.body);
      if (userId === me) throw new HttpError(400, 'Você não pode bloquear a si mesmo.');
      const [target] = await db.query('select 1 from users where id = $1', [userId]);
      if (!target) throw new HttpError(404, 'Pessoa não encontrada.');
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from user_blocks where blocker_id = $1', [me]);
      if (n >= MAX_BLOCKS) throw new HttpError(400, `Você chegou ao limite de ${MAX_BLOCKS} pessoas bloqueadas.`);
      await db.query('insert into user_blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [me, userId]);
      // deixam de ser amigos (e pedidos pendentes somem)
      await db.query(`delete from friendships where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`, [me, userId]);
      rt.emitUser(me, 'friends:changed', {});
      rt.emitUser(userId, 'friends:changed', {});
      rt.emitUser(me, 'blocks:changed', {});
      await rt.hidePresence(me, userId);
      return { blocks: await list(me) };
    }),
  );

  r.delete(
    '/blocks/:userId',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      const other = String(req.params.userId);
      await db.query('delete from user_blocks where blocker_id = $1 and blocked_id = $2', [me, other]);
      rt.emitUser(me, 'blocks:changed', {});
      await rt.showPresence(me, other);
      return { blocks: await list(me) };
    }),
  );
}
