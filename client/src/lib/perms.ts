import type { Guild } from '../../../shared/types';
import { Perm, displayRole, has, memberPermissions, topRolePosition } from '../../../shared/permissions';
import { useApp } from '../store/app';

export { Perm, has };

/** Minhas permissões efetivas num servidor (o servidor é quem decide; aqui é só para a interface). */
export function myPermissions(guild: Guild | undefined, meId: string | undefined): number {
  if (!guild || !meId) return 0;
  const me = guild.members.find((m) => m.id === meId);
  return memberPermissions(guild, meId, me?.roleIds ?? []);
}

export function usePerms(guildId: string | null | undefined): number {
  return useApp((s) => myPermissions(guildId ? s.guilds[guildId] : undefined, s.me?.id));
}

export function useCan(guildId: string | null | undefined, bit: number): boolean {
  return has(usePerms(guildId), bit);
}

/** Cor do nome: a do cargo mais alto (ou a cor do avatar, para quem não tem cargo). */
export function memberColor(guild: Guild | undefined, userId: string, fallback: string): string {
  const m = guild?.members.find((x) => x.id === userId);
  return (m && guild && displayRole(guild, m.roleIds)?.color) || fallback;
}

export function myTopPosition(guild: Guild, meId: string): number {
  const me = guild.members.find((m) => m.id === meId);
  return topRolePosition(guild, meId, me?.roleIds ?? []);
}

/** Castigo ativo (até quando), ou null. */
export function timeoutUntil(guild: Guild | undefined, userId: string | undefined): Date | null {
  const m = userId ? guild?.members.find((x) => x.id === userId) : undefined;
  if (!m?.timeoutUntil) return null;
  const d = new Date(m.timeoutUntil);
  return d.getTime() > Date.now() ? d : null;
}

export const imageUrl = (id: string | null | undefined) => (id ? `/api/images/${id}` : null);
