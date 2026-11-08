import { create } from 'zustand';
import { mentionsUser } from '../lib/mentions';
import type { Activity, Channel, DmChannel, Friend, Guild, Member, Message, PublicUser, VoiceState } from '../../../shared/types';

interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
}

export type MobilePanel = 'nav' | 'main' | 'members';

export interface AppState {
  me: PublicUser | null;
  guilds: Record<string, Guild>;
  guildOrder: string[];
  /** conversas diretas, por id do canal */
  dms: Record<string, DmChannel>;
  /** ids das DMs, da conversa mais recente para a mais antiga */
  dmOrder: string[];
  friends: Friend[];
  messages: Record<string, ChannelMessages>;
  online: Record<string, true>;
  /** "Jogando agora" de cada pessoa online */
  activities: Record<string, Activity>;
  voiceStates: Record<string, VoiceState>; // por socketId
  typing: Record<string, Record<string, number>>; // channelId -> userId -> expira em
  unread: Record<string, true>;
  /** menções a você ainda não vistas, por canal */
  mentions: Record<string, number>;
  /** ligação de DM chegando para você */
  incomingCall: { channelId: string; from: PublicUser } | null;
  /** você ligou numa DM e está esperando a pessoa atender (canal) */
  outgoingRing: string | null;
  connected: boolean;
  socketId: string | null;
  maxVoicePeers: number;

  selectedGuildId: string | null;
  selectedChannelId: string | null;
  lastChannelByGuild: Record<string, string>;
  mobilePanel: MobilePanel;
  showMembers: boolean;
  modal: ModalState | null;
  toast: string | null;
}

export type ModalState =
  | { kind: 'createGuild' }
  | { kind: 'joinGuild'; code?: string }
  | { kind: 'invite'; guildId: string }
  | { kind: 'createChannel'; guildId: string; type: 'text' | 'voice'; categoryId?: string | null }
  | { kind: 'guildSettings'; guildId: string; tab?: 'overview' | 'roles' | 'members' | 'bans' | 'expressions' }
  | { kind: 'channelSettings'; channelId: string }
  | { kind: 'createCategory'; guildId: string }
  | { kind: 'categorySettings'; guildId: string; categoryId: string }
  | { kind: 'userSettings' }
  | { kind: 'screenShare' }
  | { kind: 'image'; src: string; name: string }
  | { kind: 'profile'; userId: string; guildId?: string | null }
  | { kind: 'status' }
  | { kind: 'guildProfile'; guildId: string };

export const useApp = create<AppState>(() => ({
  me: null,
  guilds: {},
  guildOrder: [],
  dms: {},
  dmOrder: [],
  friends: [],
  messages: {},
  online: {},
  activities: {},
  voiceStates: {},
  typing: {},
  unread: {},
  mentions: {},
  incomingCall: null,
  outgoingRing: null,
  connected: false,
  socketId: null,
  maxVoicePeers: 10,
  selectedGuildId: null,
  selectedChannelId: null,
  lastChannelByGuild: {},
  mobilePanel: 'nav',
  showMembers: true,
  modal: null,
  toast: null,
}));

const set = useApp.setState;
const get = useApp.getState;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  clearTimeout(toastTimer);
  set({ toast: message });
  toastTimer = setTimeout(() => set({ toast: null }), 3500);
}

export const openModal = (modal: ModalState) => set({ modal });
export const closeModal = () => set({ modal: null });

export function findChannel(channelId: string | null): Channel | undefined {
  if (!channelId) return undefined;
  const dm = get().dms[channelId];
  if (dm) return dm;
  for (const g of Object.values(get().guilds)) {
    const c = g.channels.find((c) => c.id === channelId);
    if (c) return c;
  }
}

export function findMember(guildId: string | null | undefined, userId: string): Member | PublicUser | undefined {
  const s = get();
  // dentro de um servidor vale o apelido/foto de lá (inclusive o seu)
  if (guildId) {
    const m = s.guilds[guildId]?.members.find((m) => m.id === userId);
    if (m) return m;
  }
  if (s.me?.id === userId) return s.me;
  for (const g of Object.values(s.guilds)) {
    const m = g.members.find((m) => m.id === userId);
    if (m) return m;
  }
  for (const dm of Object.values(s.dms)) if (dm.recipient.id === userId) return dm.recipient;
  return s.friends.find((f) => f.user.id === userId)?.user;
}

// ---------- início (amigos e mensagens diretas) ----------

/** Vai para o Início: abre a última conversa direta, ou a lista de amigos. */
export function goHome(channelId: string | null = null) {
  set({ selectedGuildId: null, selectedChannelId: channelId, mobilePanel: 'main' });
  if (channelId) markRead(channelId);
}

export function setDms(dms: DmChannel[]) {
  set({ dms: Object.fromEntries(dms.map((d) => [d.id, d])), dmOrder: dms.map((d) => d.id) });
}

export function upsertDm(dm: DmChannel) {
  set((s) => ({
    dms: { ...s.dms, [dm.id]: dm },
    dmOrder: s.dmOrder.includes(dm.id) ? s.dmOrder : [dm.id, ...s.dmOrder],
  }));
}

export const setFriends = (friends: Friend[]) => set({ friends });

// ---------- seleção ----------

export function selectGuild(guildId: string) {
  const s = get();
  const g = s.guilds[guildId];
  if (!g) return;
  const remembered = s.lastChannelByGuild[guildId];
  const channel =
    g.channels.find((c) => c.id === remembered && c.type === 'text') ?? g.channels.find((c) => c.type === 'text');
  set({ selectedGuildId: guildId, selectedChannelId: channel?.id ?? null });
  if (channel) markRead(channel.id);
}

export function selectChannel(channelId: string) {
  const c = findChannel(channelId);
  if (!c) return;
  set((s) => ({
    selectedGuildId: c.type === 'dm' ? null : c.guildId,
    selectedChannelId: c.id,
    lastChannelByGuild: c.type === 'text' ? { ...s.lastChannelByGuild, [c.guildId]: c.id } : s.lastChannelByGuild,
    mobilePanel: 'main',
  }));
  markRead(c.id);
}

export function markRead(channelId: string) {
  if (!get().unread[channelId] && !get().mentions[channelId]) return;
  set((s) => {
    const unread = { ...s.unread };
    delete unread[channelId];
    const mentions = { ...s.mentions };
    delete mentions[channelId];
    return { unread, mentions };
  });
}

// ---------- servidores ----------

export function setGuilds(guilds: Guild[]) {
  const map: Record<string, Guild> = {};
  for (const g of guilds) map[g.id] = g;
  set({ guilds: map, guildOrder: guilds.map((g) => g.id) });
}

export function upsertGuild(guild: Guild) {
  set((s) => ({
    guilds: { ...s.guilds, [guild.id]: guild },
    guildOrder: s.guildOrder.includes(guild.id) ? s.guildOrder : [...s.guildOrder, guild.id],
  }));
}

export function patchGuild(id: string, patch: Partial<Guild>) {
  set((s) => (s.guilds[id] ? { guilds: { ...s.guilds, [id]: { ...s.guilds[id], ...patch } } } : {}));
}

export function removeGuild(id: string) {
  set((s) => {
    if (!s.guilds[id]) return {};
    const guilds = { ...s.guilds };
    delete guilds[id];
    const guildOrder = s.guildOrder.filter((g) => g !== id);
    const voiceStates = Object.fromEntries(Object.entries(s.voiceStates).filter(([, v]) => v.guildId !== id));
    const wasSelected = s.selectedGuildId === id;
    return {
      guilds,
      guildOrder,
      voiceStates,
      ...(wasSelected ? { selectedGuildId: null, selectedChannelId: null } : {}),
    };
  });
}

export function updateGuildChannels(guildId: string, fn: (channels: Channel[]) => Channel[]) {
  const g = get().guilds[guildId];
  if (!g) return;
  patchGuild(guildId, { channels: fn(g.channels).sort((a, b) => a.position - b.position) });
}

export function updateUserEverywhere(user: PublicUser) {
  set((s) => {
    const guilds: Record<string, Guild> = {};
    for (const [id, g] of Object.entries(s.guilds)) {
      // apelido e foto do servidor continuam valendo por cima do perfil
      guilds[id] = {
        ...g,
        members: g.members.map((m) =>
          m.id === user.id ? { ...m, ...user, displayName: m.nick ?? user.displayName, avatarId: m.guildAvatarId ?? user.avatarId } : m,
        ),
      };
    }
    // foto/nome/status também nas conversas diretas e na lista de amigos
    const dms = Object.fromEntries(
      Object.entries(s.dms).map(([id, d]) => [id, d.recipient.id === user.id ? { ...d, name: user.displayName, recipient: { ...d.recipient, ...user } } : d]),
    );
    const friends = s.friends.map((f) => (f.user.id === user.id ? { ...f, user: { ...f.user, ...user } } : f));
    return { guilds, dms, friends, me: s.me?.id === user.id ? { ...s.me, ...user } : s.me };
  });
}

// ---------- mensagens ----------

export function channelMessages(channelId: string): ChannelMessages {
  return get().messages[channelId] ?? { items: [], hasMore: true, loaded: false, loading: false };
}

export function patchMessages(channelId: string, patch: Partial<ChannelMessages>) {
  set((s) => ({ messages: { ...s.messages, [channelId]: { ...channelMessages(channelId), ...patch } } }));
}

export function addMessage(message: Message) {
  const cm = get().messages[message.channelId];
  if (cm) {
    if (cm.items.some((m) => m.id === message.id)) return;
    patchMessages(message.channelId, { items: [...cm.items, message] });
  }
  set((s) => {
    const typing = s.typing[message.channelId];
    if (!typing?.[message.author.id]) return {};
    const t = { ...typing };
    delete t[message.author.id];
    return { typing: { ...s.typing, [message.channelId]: t } };
  });
  // conversa direta com mensagem nova sobe para o topo da lista
  const dm = get().dms[message.channelId];
  if (dm) {
    set((s) => ({
      dms: { ...s.dms, [dm.id]: { ...dm, lastMessageAt: message.createdAt } },
      dmOrder: [dm.id, ...s.dmOrder.filter((id) => id !== dm.id)],
    }));
  }
  const s = get();
  const visible = s.selectedChannelId === message.channelId && document.visibilityState === 'visible';
  if (!visible && message.author.id !== s.me?.id) {
    const channel = findChannel(message.channelId);
    const mentioned = !!s.me && channel?.type !== 'dm' && mentionsUser(message.content, s.me.username, message.mentionEveryone);
    set({
      unread: { ...s.unread, [message.channelId]: true },
      ...(mentioned ? { mentions: { ...s.mentions, [message.channelId]: (s.mentions[message.channelId] ?? 0) + 1 } } : {}),
    });
  }
}

export function updateReactions(channelId: string, messageId: string, reactions: Message['reactions']) {
  const cm = get().messages[channelId];
  if (cm) patchMessages(channelId, { items: cm.items.map((m) => (m.id === messageId ? { ...m, reactions } : m)) });
}

export function updateMessage(message: Message) {
  const cm = get().messages[message.channelId];
  if (!cm) return;
  patchMessages(message.channelId, {
    items: cm.items.map((m) => {
      if (m.id === message.id) return message;
      // respostas a esta mensagem mostram o texto editado
      if (m.replyTo?.id === message.id && !m.replyTo.deleted) {
        return { ...m, replyTo: { ...m.replyTo, content: message.content.slice(0, 200) } };
      }
      return m;
    }),
  });
}

export function deleteMessage(channelId: string, id: string) {
  const cm = get().messages[channelId];
  if (!cm) return;
  patchMessages(channelId, {
    items: cm.items
      .filter((m) => m.id !== id)
      .map((m) => (m.replyTo?.id === id ? { ...m, replyTo: { id, deleted: true as const } } : m)),
  });
}
