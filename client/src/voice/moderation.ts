import type { Guild, VoiceState } from '../../../shared/types';
import { Perm, has, memberPermissions, topRolePosition } from '../../../shared/permissions';
import { getSocket } from '../lib/socket';
import { toast } from '../store/app';

/**
 * Moderação de voz (como os ADMs fazem no Discord): mover para outro canal, tirar da call, silenciar
 * e ensurdecer. O servidor confere a permissão e a hierarquia; aqui é só para mostrar as opções.
 */
export type VoiceModAction = 'move' | 'disconnect' | 'mute' | 'unmute' | 'deafen' | 'undeafen';

export function voiceMod(action: VoiceModAction, socketId: string, channelId?: string): Promise<boolean> {
  const socket = getSocket();
  if (!socket) return Promise.resolve(false);
  return new Promise((resolve) =>
    socket.timeout(8000).emit('voice:mod', { action, socketId, channelId }, (err: unknown, r: { ok: boolean; error?: string }) => {
      if (err || !r?.ok) toast(r?.error ?? 'O servidor não respondeu. Tente de novo.');
      resolve(!err && !!r?.ok);
    }),
  );
}

/** O que eu posso fazer com essa pessoa na call (permissão do cargo + só com quem está abaixo). */
export function voiceModRights(guild: Guild | undefined, meId: string | undefined, target: VoiceState) {
  const none = { move: false, mute: false, deafen: false, any: false };
  if (!guild || !meId) return none;
  const me = guild.members.find((m) => m.id === meId);
  const them = guild.members.find((m) => m.id === target.userId);
  const perms = memberPermissions(guild, meId, me?.roleIds ?? []);
  const above = target.userId === meId || topRolePosition(guild, meId, me?.roleIds ?? []) > topRolePosition(guild, target.userId, them?.roleIds ?? []);
  if (!above) return none;
  const r = { move: has(perms, Perm.MOVE_MEMBERS), mute: has(perms, Perm.MUTE_MEMBERS), deafen: has(perms, Perm.DEAFEN_MEMBERS) };
  return { ...r, any: r.move || r.mute || r.deafen };
}

export const MOVE_DRAG_TYPE = 'application/x-resenha-voice-move';
