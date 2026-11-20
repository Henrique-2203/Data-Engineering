import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { USER_COLUMNS } from './auth.ts';
import { audit, userLabel } from './audit.ts';
import type { Member, Message } from '../../shared/types.ts';
import { randomUUID } from 'node:crypto';
import { withFileLinks } from './attachments.ts';
import { loadChannel } from './access.ts';

/**
 * Alguém entrou num servidor (convite, Explorar ou servidor oficial): registra, avisa quem já está lá e,
 * se o servidor escolheu um canal de boas-vindas, posta o aviso "fulano chegou 👋" nele.
 * A explicação do servidor (texto de boas-vindas) aparece numa janela só para quem chegou (no app).
 */
type Deps = {
  messageSelect: string;
  emitToChannel(c: { id: string; guildId: string | null; allowedRoleIds: string[] | null }, event: string, payload: object): Promise<void>;
};
let deps: Deps | null = null;
export function configureWelcome(d: Deps) {
  deps = d;
}

export async function memberJoined(db: Db, rt: Realtime, guildId: string, userId: string) {
  await audit(db, guildId, userId, 'member_join', { type: 'user', id: userId, label: await userLabel(db, userId) });
  rt.userJoinedGuild(userId, guildId);
  // aviso leve para quem já está lá (sem fazer todo mundo recarregar o servidor inteiro)
  const [member] = await db.query<Member>(
    `select m.joined_at as "joinedAt", m.timeout_until as "timeoutUntil", m.nick, ${USER_COLUMNS}, '{}'::text[] as "roleIds"
     from members m join users u on u.id = m.user_id where m.guild_id = $1 and m.user_id = $2`,
    [guildId, userId],
  );
  if (member) rt.emitGuild(guildId, 'member:join', { guildId, member });
  await postJoinMessage(db, guildId, userId).catch((err) => console.warn('[boas-vindas]', err));
}

async function postJoinMessage(db: Db, guildId: string, userId: string) {
  if (!deps) return;
  const [g] = await db.query<{ channelId: string | null }>('select welcome_channel_id as "channelId" from guilds where id = $1', [guildId]);
  if (!g?.channelId) return;
  const c = await loadChannel(db, g.channelId);
  if (!c || c.guildId !== guildId || c.type !== 'text') return;
  // não repete se a pessoa sai e entra várias vezes seguidas
  const [recent] = await db.query(
    `select 1 from messages where channel_id = $1 and author_id = $2 and system = 'join' and created_at > now() - interval '1 day'`,
    [c.id, userId],
  );
  if (recent) return;
  const id = randomUUID();
  await db.query(`insert into messages (id, channel_id, author_id, content, system) values ($1, $2, $3, '', 'join')`, [id, c.id, userId]);
  const [message] = await withFileLinks(db, await db.query<Message>(`${deps.messageSelect} where msg.id = $1`, [id]));
  if (message) await deps.emitToChannel(c, 'message:new', { message });
}
