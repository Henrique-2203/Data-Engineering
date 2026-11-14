import type { DmChannel, Friend } from '../../../shared/types';
import { api } from './api';
import { selectChannel, setFriends, toast, upsertDm } from '../store/app';

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
