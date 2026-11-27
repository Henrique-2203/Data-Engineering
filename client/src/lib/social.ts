import type { DmChannel, Friend, PublicUser } from '../../../shared/types';
import { api } from './api';
import { selectChannel, setBlocks, setFriends, toast, upsertDm } from '../store/app';
import { askConfirm } from './ask';

/** Abre (criando se preciso) a conversa direta com alguém e vai para ela. */
export async function openDm(userId: string) {
  try {
    const { dm } = await api<{ dm: DmChannel }>('/dms', { body: { userId } });
    upsertDm(dm);
    selectChannel(dm.id);
  } catch (err) {
    toast((err as Error).message);
  }
}

export async function sendFriendRequest(username: string) {
  const res = await api<{ friends: Friend[]; accepted: boolean }>('/friends', { body: { username } });
  setFriends(res.friends);
  return res.accepted;
}

export async function acceptFriend(userId: string) {
  try {
    setFriends((await api<{ friends: Friend[] }>(`/friends/${userId}/accept`, { method: 'POST' })).friends);
  } catch (err) {
    toast((err as Error).message);
  }
}

export async function removeFriend(userId: string) {
  try {
    setFriends((await api<{ friends: Friend[] }>(`/friends/${userId}`, { method: 'DELETE' })).friends);
  } catch (err) {
    toast((err as Error).message);
  }
}

/** Bloqueia alguém (pede confirmação). A pessoa não é avisada. */
export async function blockUser(user: { id: string; username: string; displayName: string }) {
  const ok = (await askConfirm(
    `Bloquear @${user.username} (${user.displayName})?\n\n• Vocês deixam de ser amigos.\n• Nenhum dos dois manda mensagem privada, pedido de amizade nem liga para o outro.\n• As mensagens dela nos servidores em comum ficam recolhidas para você.\n• Você é avisado se ela estiver numa call antes de entrar.\n\nA pessoa não recebe aviso de que foi bloqueada.`,
  ));
  if (!ok) return false;
  try {
    setBlocks((await api<{ blocks: PublicUser[] }>('/blocks', { body: { userId: user.id } })).blocks);
    await refreshFriendsSoon();
    toast(`@${user.username} bloqueado.`);
    return true;
  } catch (err) {
    toast((err as Error).message);
    return false;
  }
}

export async function unblockUser(user: { id: string; username: string }) {
  try {
    setBlocks((await api<{ blocks: PublicUser[] }>(`/blocks/${user.id}`, { method: 'DELETE' })).blocks);
    toast(`@${user.username} desbloqueado.`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function refreshFriendsSoon() {
  try {
    setFriends((await api<{ friends: Friend[] }>('/friends')).friends);
  } catch {
    /* o evento friends:changed atualiza depois */
  }
}
