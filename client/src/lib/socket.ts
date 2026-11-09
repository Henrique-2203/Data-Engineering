import { onSoundboardEvent, type SoundboardEvent } from './soundboard';
import { io, type Socket } from 'socket.io-client';
import type { Activity, Channel, Guild, GuildEvent, Member, Message, PublicUser, VoiceState } from '../../../shared/types';
import { api } from './api';
import type { DmChannel, Friend } from '../../../shared/types';
import {
  addMessage,
  findChannel,
  setDms,
  setFriends,
  updateReactions,
  upsertGuild,
  deleteMessage,
  patchGuild,
  removeGuild,
  updateGuildChannels,
  updateMessage,
  updateUserEverywhere,
  useApp,
  toast,
} from '../store/app';
import { useVoice } from '../store/voice';
import { onIncomingMessage } from './notify';
import { playSound } from './sounds';

let socket: Socket | null = null;
let onVisibility: (() => void) | null = null;
const listeners = new Set<(s: Socket) => void>();

export const getSocket = () => socket;

/** Registra um callback chamado sempre que (re)conecta. */
export function onSocketReady(fn: (s: Socket) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const set = useApp.setState;

/** Conecta o tempo real (a sessão vai no cookie protegido, junto com a conexão). */
export function connectSocket() {
  disconnectSocket();
  // diz ao servidor se o Resenha está visível (quem não está com ele aberto recebe notificação no celular)
  const visible = () => document.visibilityState === 'visible';
  const s = io({ transports: ['websocket', 'polling'], auth: (cb) => cb({ visible: visible() }) });
  socket = s;
  onVisibility = () => s.emit('client:active', visible());
  document.addEventListener('visibilitychange', onVisibility);

  s.on('connect', () => set({ connected: true, updating: false }));
  s.on('server:restarting', () => set({ updating: true }));
  s.on('disconnect', () => set({ connected: false, socketId: null }));

  s.on('ready', (p: { socketId: string; online: string[]; voiceStates: VoiceState[]; maxVoicePeers: number; activities?: Record<string, Activity> }) => {
    set({
      socketId: p.socketId,
      activities: p.activities ?? {},
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
  s.on('message:new', async ({ message }: { message: Message }) => {
    // primeira mensagem de uma conversa direta nova: carrega a lista de DMs antes
    if (!findChannel(message.channelId)) await refreshDms();
    addMessage(message);
    onIncomingMessage(message);
  });
  s.on('dms:changed', () => void refreshDms());
  s.on(
    'message:reactions',
    ({ channelId, messageId, reactions }: { channelId: string; messageId: string; reactions: Message['reactions'] }) =>
      updateReactions(channelId, messageId, reactions),
  );
  s.on('friends:changed', () => void refreshFriends());
  s.on('message:update', ({ message }: { message: Message }) => updateMessage(message));
  s.on('message:delete', ({ channelId, id }: { channelId: string; id: string }) => deleteMessage(channelId, id));

  s.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => {
    set((st) => ({
      typing: { ...st.typing, [channelId]: { ...st.typing[channelId], [userId]: Date.now() + 6000 } },
    }));
  });

  // servidores, canais e membros
  s.on('guild:update', (patch: Partial<Guild> & { id: string }) => patchGuild(patch.id, patch));
  // mudanças estruturais (cargos, canais, permissões...): recarrega o servidor do jeito que EU vejo
  s.on('guild:refresh', ({ guildId }: { guildId: string }) => scheduleGuildRefresh(guildId));
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
  s.on('soundboard:play', (e: SoundboardEvent) => onSoundboardEvent(e));
  s.on('activity:update', ({ userId, activity }: { userId: string; activity: Activity | null }) =>
    set((st) => {
      const activities = { ...st.activities };
      if (activity) activities[userId] = activity;
      else delete activities[userId];
      return { activities };
    }),
  );

  // estado de voz (quem está em qual canal)
  s.on('voice:state', (v: VoiceState) => {
    const prev = useApp.getState().voiceStates[v.socketId];
    // aviso sonoro quando alguém da sua chamada começa a transmitir a tela
    if (prev && !prev.screen && v.screen && v.socketId !== s.id && v.channelId === useVoice.getState().channelId) {
      playSound('stream');
    }
    set((st) => ({ voiceStates: { ...st.voiceStates, [v.socketId]: v } }));
  });
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

  // eventos agendados
  s.on('event:update', ({ guildId, event }: { guildId: string; event: GuildEvent }) => {
    const g = useApp.getState().guilds[guildId];
    if (!g) return;
    const others = (g.events ?? []).filter((e) => e.id !== event.id);
    patchGuild(guildId, { events: [...others, event].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) });
  });
  s.on('event:delete', ({ guildId, id }: { guildId: string; id: string }) => {
    const g = useApp.getState().guilds[guildId];
    if (g) patchGuild(guildId, { events: (g.events ?? []).filter((e) => e.id !== id) });
  });
  s.on('event:start', ({ guildId, id, title }: { guildId: string; id: string; title: string }) => {
    const st = useApp.getState();
    const g = st.guilds[guildId];
    const ev = g?.events?.find((e) => e.id === id);
    // avisa quem marcou interesse
    if (g && ev && st.me && ev.interestedIds.includes(st.me.id)) {
      playSound('mention');
      toast(`📅 Começou: ${title} (${g.name})`);
    }
    if (g) patchGuild(guildId, { events: [...(g.events ?? [])] });
  });

  s.on('reports:count', ({ open }: { open: number }) => set({ openReports: open }));
  s.on('support:count', ({ open }: { open: number }) => set({ openSupport: open }));
  s.on('support:update', () => {
    set((st) => ({ supportUnread: st.supportUnread + 1 }));
    window.dispatchEvent(new Event('resenha:support-update'));
    if (useApp.getState().modal?.kind !== 'support') toast('💬 O suporte do Resenha respondeu seu chamado. Toque na boia (no pé da coluna de servidores) para ler.');
    playSound('mention');
  });

  // a sessão foi encerrada em outro aparelho (ou a senha foi trocada)
  s.on('session:ended', () => {
    toast('Você foi desconectado deste aparelho.');
    window.dispatchEvent(new Event('resenha:unauthorized'));
  });

  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') window.dispatchEvent(new Event('resenha:unauthorized'));
  });

  return s;
}

const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();

/** Junta vários avisos seguidos (ex.: arrastar canais) em um só recarregamento. */
export function scheduleGuildRefresh(guildId: string) {
  clearTimeout(pendingRefresh.get(guildId));
  pendingRefresh.set(
    guildId,
    setTimeout(() => {
      pendingRefresh.delete(guildId);
      void refreshGuild(guildId);
    }, 150),
  );
}

export async function refreshGuild(guildId: string) {
  try {
    const { guild, voiceStates } = await api<{ guild: Guild; voiceStates: VoiceState[] }>(`/guilds/${guildId}`);
    upsertGuild(guild);
    useApp.setState((st) => ({
      voiceStates: {
        ...Object.fromEntries(Object.entries(st.voiceStates).filter(([, v]) => v.guildId !== guildId)),
        ...Object.fromEntries(voiceStates.map((v) => [v.socketId, v])),
      },
    }));
    // o canal aberto sumiu (excluído ou virou privado para mim): vai para o primeiro canal de texto
    const st = useApp.getState();
    if (st.selectedGuildId === guildId && st.selectedChannelId && !guild.channels.some((c) => c.id === st.selectedChannelId)) {
      useApp.setState({ selectedChannelId: guild.channels.find((c) => c.type === 'text')?.id ?? null });
    }
  } catch (err) {
    if ((err as { status?: number }).status === 404) removeGuild(guildId);
  }
}

export async function refreshDms() {
  try {
    setDms((await api<{ dms: DmChannel[] }>('/dms')).dms);
  } catch {
    /* tenta de novo no próximo evento */
  }
}

export async function refreshFriends() {
  try {
    setFriends((await api<{ friends: Friend[] }>('/friends')).friends);
  } catch {
    /* idem */
  }
}

export function disconnectSocket() {
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
  onVisibility = null;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
