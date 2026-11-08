import { io, type Socket } from 'socket.io-client';
import type { Channel, Guild, Member, Message, PublicUser, VoiceState } from '../../../shared/types';
import {
  addMessage,
  deleteMessage,
  patchGuild,
  removeGuild,
  updateGuildChannels,
  updateMessage,
  updateUserEverywhere,
  useApp,
} from '../store/app';

let socket: Socket | null = null;
const listeners = new Set<(s: Socket) => void>();

export const getSocket = () => socket;

/** Registra um callback chamado sempre que (re)conecta. */
export function onSocketReady(fn: (s: Socket) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const set = useApp.setState;

export function connectSocket(token: string) {
  disconnectSocket();
  const s = io({ auth: { token }, transports: ['websocket', 'polling'] });
  socket = s;

  s.on('connect', () => set({ connected: true }));
  s.on('disconnect', () => set({ connected: false, socketId: null }));

  s.on('ready', (p: { socketId: string; online: string[]; voiceStates: VoiceState[]; maxVoicePeers: number }) => {
    set({
      socketId: p.socketId,
      online: Object.fromEntries(p.online.map((id) => [id, true as const])),
      voiceStates: Object.fromEntries(p.voiceStates.map((v) => [v.socketId, v])),
      maxVoicePeers: p.maxVoicePeers,
    });
    for (const fn of listeners) fn(s);
  });

  // presença
  s.on('presence:update', ({ userId, online }: { userId: string; online: boolean }) => {
    set((st) => {
      const next = { ...st.online };
      if (online) next[userId] = true;
      else delete next[userId];
      return { online: next };
    });
  });
  s.on('presence:bulk', ({ online }: { online: string[] }) => {
    set((st) => ({ online: { ...st.online, ...Object.fromEntries(online.map((id) => [id, true as const])) } }));
  });

  // mensagens
  s.on('message:new', ({ message }: { message: Message }) => addMessage(message));
  s.on('message:update', ({ message }: { message: Message }) => updateMessage(message));
  s.on('message:delete', ({ channelId, id }: { channelId: string; id: string }) => deleteMessage(channelId, id));

  s.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => {
    set((st) => ({
      typing: { ...st.typing, [channelId]: { ...st.typing[channelId], [userId]: Date.now() + 6000 } },
    }));
  });

  // servidores, canais e membros
  s.on('guild:update', (patch: Partial<Guild> & { id: string }) => patchGuild(patch.id, patch));
  s.on('guild:delete', ({ id }: { id: string }) => removeGuild(id));
  s.on('channel:create', (c: Channel) =>
    updateGuildChannels(c.guildId, (list) => (list.some((x) => x.id === c.id) ? list : [...list, c])),
  );
  s.on('channel:update', (c: Channel) =>
    updateGuildChannels(c.guildId, (list) => list.map((x) => (x.id === c.id ? { ...x, name: c.name } : x))),
  );
  s.on('channel:delete', ({ id, guildId }: { id: string; guildId: string }) => {
    updateGuildChannels(guildId, (list) => list.filter((x) => x.id !== id));
    const st = useApp.getState();
    if (st.selectedChannelId === id) {
      const first = st.guilds[guildId]?.channels.find((c) => c.type === 'text');
      set({ selectedChannelId: first?.id ?? null });
    }
  });
  s.on('member:join', ({ guildId, member }: { guildId: string; member: Member }) => {
    const g = useApp.getState().guilds[guildId];
    if (g && !g.members.some((m) => m.id === member.id)) patchGuild(guildId, { members: [...g.members, member] });
  });
  s.on('member:leave', ({ guildId, userId }: { guildId: string; userId: string }) => {
    const g = useApp.getState().guilds[guildId];
    if (g) patchGuild(guildId, { members: g.members.filter((m) => m.id !== userId) });
  });
  s.on('user:update', (user: PublicUser) => updateUserEverywhere(user));

  // estado de voz (quem está em qual canal)
  s.on('voice:state', (v: VoiceState) => set((st) => ({ voiceStates: { ...st.voiceStates, [v.socketId]: v } })));
  s.on('voice:state-remove', ({ socketId }: { socketId: string }) =>
    set((st) => {
      const next = { ...st.voiceStates };
      delete next[socketId];
      return { voiceStates: next };
    }),
  );
  s.on('voice:states', ({ guildId, states }: { guildId: string; states: VoiceState[] }) =>
    set((st) => ({
      voiceStates: {
        ...Object.fromEntries(Object.entries(st.voiceStates).filter(([, v]) => v.guildId !== guildId)),
        ...Object.fromEntries(states.map((v) => [v.socketId, v])),
      },
    })),
  );

  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') window.dispatchEvent(new Event('resenha:unauthorized'));
  });

  return s;
}

export function disconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
