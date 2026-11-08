import type { Db } from './db.ts';
import { config } from './config.ts';
import { HttpError } from './http.ts';
import {
  Perm,
  canSeeChannel,
  has,
  memberPermissions,
  outranks,
  type PermissionContext,
  type Role,
} from '../../shared/permissions.ts';

/**
 * "Essa pessoa pode fazer isso?" — consultas de permissão usadas pelas rotas e pelo tempo real.
 * O servidor é quem decide; o site só esconde o que a pessoa não pode usar.
 */

export interface MemberAccess {
  ctx: PermissionContext;
  userId: string;
  roleIds: string[];
  perms: number;
  isOwner: boolean;
  timeoutUntil: Date | null;
}

export interface ChannelRow {
  id: string;
  guildId: string | null;
  name: string;
  type: 'text' | 'voice' | 'dm';
  position: number;
  categoryId: string | null;
  allowedRoleIds: string[] | null;
  bitrate: number;
  userLimit: number;
}

export const CHANNEL_COLUMNS = `c.id, c.guild_id as "guildId", c.name, c.type, c.position, c.category_id as "categoryId",
  c.allowed_role_ids as "allowedRoleIds", c.bitrate, c.user_limit as "userLimit"`;

export async function guildContext(db: Db, guildId: string): Promise<PermissionContext | null> {
  const [g] = await db.query<{ ownerId: string; everyonePermissions: number }>(
    'select owner_id as "ownerId", everyone_permissions as "everyonePermissions" from guilds where id = $1',
    [guildId],
  );
  if (!g) return null;
  const roles = await db.query<Role>(
    'select id, name, color, position, permissions from roles where guild_id = $1 order by position desc',
    [guildId],
  );
  return { ownerId: g.ownerId, everyonePermissions: g.everyonePermissions, roles };
}

export async function memberRoleIds(db: Db, guildId: string, userId: string): Promise<string[]> {
  const rows = await db.query<{ role_id: string }>('select role_id from member_roles where guild_id = $1 and user_id = $2', [
    guildId,
    userId,
  ]);
  return rows.map((r) => r.role_id);
}

/** Acesso de um membro ao servidor (ou null se não for membro). */
export async function memberAccess(db: Db, guildId: string, userId: string): Promise<MemberAccess | null> {
  const [m] = await db.query<{ timeoutUntil: Date | null }>(
    'select timeout_until as "timeoutUntil" from members where guild_id = $1 and user_id = $2',
    [guildId, userId],
  );
  if (!m) return null;
  const ctx = await guildContext(db, guildId);
  if (!ctx) return null;
  const roleIds = await memberRoleIds(db, guildId, userId);
  return {
    ctx,
    userId,
    roleIds,
    perms: memberPermissions(ctx, userId, roleIds),
    isOwner: ctx.ownerId === userId,
    timeoutUntil: m.timeoutUntil ? new Date(m.timeoutUntil) : null,
  };
}

export async function requireMember(db: Db, guildId: string, userId: string): Promise<MemberAccess> {
  const a = await memberAccess(db, guildId, userId);
  if (!a) throw new HttpError(404, 'Servidor não encontrado.');
  return a;
}

const PERM_NAMES: Record<number, string> = {
  [Perm.MANAGE_GUILD]: 'gerenciar o servidor',
  [Perm.MANAGE_CHANNELS]: 'gerenciar canais',
  [Perm.MANAGE_ROLES]: 'gerenciar cargos',
  [Perm.KICK]: 'expulsar membros',
  [Perm.BAN]: 'banir membros',
  [Perm.TIMEOUT]: 'castigar membros',
  [Perm.MANAGE_MESSAGES]: 'gerenciar mensagens',
  [Perm.CREATE_INVITE]: 'convidar pessoas',
};

export async function requirePerm(db: Db, guildId: string, userId: string, bit: number): Promise<MemberAccess> {
  const a = await requireMember(db, guildId, userId);
  if (!has(a.perms, bit)) throw new HttpError(403, `Você não tem permissão para ${PERM_NAMES[bit] ?? 'fazer isso'}.`);
  return a;
}

export const isTimedOut = (a: Pick<MemberAccess, 'timeoutUntil'>) => !!a.timeoutUntil && a.timeoutUntil.getTime() > Date.now();

export function requireNotTimedOut(a: MemberAccess) {
  if (isTimedOut(a)) {
    const until = a.timeoutUntil!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    throw new HttpError(403, `Você está de castigo neste servidor até ${until}.`);
  }
}

/** Pode agir sobre outro membro (cargo mais alto que o dele)? */
export async function requireOutranks(db: Db, guildId: string, actor: MemberAccess, targetId: string) {
  const targetRoles = await memberRoleIds(db, guildId, targetId);
  if (!outranks(actor.ctx, actor.userId, actor.roleIds, targetId, targetRoles)) {
    throw new HttpError(403, 'Você só pode fazer isso com quem está abaixo de você na hierarquia de cargos.');
  }
}

export function canSee(a: MemberAccess, channel: Pick<ChannelRow, 'allowedRoleIds'>) {
  return canSeeChannel(a.ctx, channel, a.userId, a.roleIds);
}

/**
 * Quem pode ver um canal de servidor: null = todos os membros; senão a lista de usuários
 * (para canais privados, eventos vão só para essas pessoas).
 */
export async function channelAudience(db: Db, channel: Pick<ChannelRow, 'guildId' | 'allowedRoleIds'>): Promise<string[] | null> {
  if (!channel.guildId || !channel.allowedRoleIds) return null; // lista vazia = privado só para dono/admins
  const ctx = await guildContext(db, channel.guildId);
  if (!ctx) return [];
  const rows = await db.query<{ user_id: string; role_ids: string[] | null }>(
    `select m.user_id, array_remove(array_agg(mr.role_id), null) as role_ids
     from members m left join member_roles mr on mr.guild_id = m.guild_id and mr.user_id = m.user_id
     where m.guild_id = $1 group by m.user_id`,
    [channel.guildId],
  );
  return rows.filter((r) => canSeeChannel(ctx, channel, r.user_id, r.role_ids ?? [])).map((r) => r.user_id);
}

export async function loadChannel(db: Db, channelId: string): Promise<ChannelRow | null> {
  const [c] = await db.query<ChannelRow>(`select ${CHANNEL_COLUMNS} from channels c where c.id = $1`, [channelId]);
  return c ?? null;
}

/** Tamanho atual do banco e se cabe mais `extraBytes` dentro do limite configurado. */
export async function storageUsage(db: Db) {
  const [row] = await db.query<{ db: string | number; files: string | number }>(
    `select pg_database_size(current_database()) as db,
       (select coalesce(sum(size), 0) from attachments) + (select coalesce(sum(size), 0) from images) as files`,
  );
  return { databaseBytes: Number(row.db), filesBytes: Number(row.files), limitBytes: config.maxStorageMb * 1024 * 1024 };
}

export async function requireStorage(db: Db, extraBytes: number) {
  const u = await storageUsage(db);
  if (u.databaseBytes + extraBytes > u.limitBytes) {
    throw new HttpError(507, 'O espaço do banco está quase cheio, então novos arquivos estão pausados. Apague imagens antigas ou fale com quem administra o Resenha.');
  }
}
