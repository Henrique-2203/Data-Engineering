// Cargos e permissões: as mesmas regras valem no servidor (que é quem decide) e no site
// (que só mostra o que a pessoa pode fazer).

export const Perm = {
  ADMIN: 1 << 0,
  MANAGE_GUILD: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  KICK: 1 << 4,
  BAN: 1 << 5,
  TIMEOUT: 1 << 6,
  MANAGE_MESSAGES: 1 << 7,
  MENTION_EVERYONE: 1 << 8,
  CREATE_INVITE: 1 << 9,
  STREAM: 1 << 10,
} as const;

export type PermKey = keyof typeof Perm;

export const ALL_PERMISSIONS = Object.values(Perm).reduce((a, b) => a | b, 0);

/** O que todo membro pode fazer por padrão (o "cargo" @todos). */
export const DEFAULT_EVERYONE_PERMISSIONS = Perm.CREATE_INVITE | Perm.STREAM | Perm.MENTION_EVERYONE;

export const PERMISSION_INFO: { key: PermKey; label: string; description: string }[] = [
  { key: 'ADMIN', label: 'Administrador', description: 'Pode tudo e vê todos os canais, inclusive os privados. Cuidado ao dar.' },
  { key: 'MANAGE_GUILD', label: 'Gerenciar servidor', description: 'Mudar nome, descrição, ícone, banner e gerar novo link de convite.' },
  { key: 'MANAGE_CHANNELS', label: 'Gerenciar canais', description: 'Criar, editar, organizar e excluir canais e categorias.' },
  { key: 'MANAGE_ROLES', label: 'Gerenciar cargos', description: 'Criar e editar cargos abaixo do seu e dar ou tirar esses cargos.' },
  { key: 'KICK', label: 'Expulsar membros', description: 'Remover membros (eles podem voltar com um convite).' },
  { key: 'BAN', label: 'Banir membros', description: 'Remover e impedir de voltar.' },
  { key: 'TIMEOUT', label: 'Castigar membros', description: 'Impedir por um tempo de escrever, reagir e entrar em voz.' },
  { key: 'MANAGE_MESSAGES', label: 'Gerenciar mensagens', description: 'Apagar mensagens de outras pessoas.' },
  { key: 'MENTION_EVERYONE', label: 'Usar @todos', description: 'Notificar o servidor inteiro.' },
  { key: 'CREATE_INVITE', label: 'Convidar pessoas', description: 'Ver e compartilhar o link de convite.' },
  { key: 'STREAM', label: 'Transmitir tela', description: 'Transmitir a tela nos canais de voz.' },
];

export interface Role {
  id: string;
  name: string;
  color: string;
  /** maior = mais alto na hierarquia */
  position: number;
  permissions: number;
}

export interface PermissionContext {
  ownerId: string;
  everyonePermissions: number;
  roles: Role[];
}

export const has = (perms: number, bit: number) => (perms & bit) === bit;

/** Permissões efetivas de alguém: dono e administradores podem tudo. */
export function memberPermissions(ctx: PermissionContext, userId: string, roleIds: string[]): number {
  if (userId === ctx.ownerId) return ALL_PERMISSIONS;
  let p = ctx.everyonePermissions;
  for (const r of ctx.roles) if (roleIds.includes(r.id)) p |= r.permissions;
  return has(p, Perm.ADMIN) ? ALL_PERMISSIONS : p;
}

/** Posição do cargo mais alto (dono = infinito, sem cargo = -1). Ninguém mexe em quem está acima. */
export function topRolePosition(ctx: PermissionContext, userId: string, roleIds: string[]): number {
  if (userId === ctx.ownerId) return Number.POSITIVE_INFINITY;
  let top = -1;
  for (const r of ctx.roles) if (roleIds.includes(r.id) && r.position > top) top = r.position;
  return top;
}

/** Cargo mais alto com cor (para colorir o nome). */
export function displayRole(ctx: Pick<PermissionContext, 'roles'>, roleIds: string[]): Role | undefined {
  let best: Role | undefined;
  for (const r of ctx.roles) if (roleIds.includes(r.id) && (!best || r.position > best.position)) best = r;
  return best;
}

/**
 * Canal privado = só quem tem um dos cargos permitidos (ou é dono/administrador).
 * null = público; lista vazia = privado só para dono e administradores.
 */
export function canSeeChannel(
  ctx: PermissionContext,
  channel: { allowedRoleIds: string[] | null },
  userId: string,
  roleIds: string[],
): boolean {
  if (!channel.allowedRoleIds) return true;
  if (has(memberPermissions(ctx, userId, roleIds), Perm.ADMIN)) return true;
  return roleIds.some((r) => channel.allowedRoleIds!.includes(r));
}

/** Pode mexer em alguém (expulsar, castigar, mudar cargos)? Só em quem está abaixo na hierarquia. */
export function outranks(ctx: PermissionContext, actorId: string, actorRoles: string[], targetId: string, targetRoles: string[]) {
  if (targetId === ctx.ownerId) return false;
  if (actorId === ctx.ownerId) return true;
  return topRolePosition(ctx, actorId, actorRoles) > topRolePosition(ctx, targetId, targetRoles);
}
