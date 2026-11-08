// Tipos compartilhados entre servidor e cliente.
import type { Role } from './permissions';
export type { Role } from './permissions';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

export type ChannelType = 'text' | 'voice' | 'dm';

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  type: ChannelType;
  position: number;
  /** categoria (null = sem categoria) */
  categoryId?: string | null;
  /** canal privado: só estes cargos veem (null = todos) */
  allowedRoleIds?: string[] | null;
  /** voz: qualidade do áudio em kbps */
  bitrate?: number;
  /** voz: máximo de pessoas (0 = sem limite) */
  userLimit?: number;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface Ban {
  user: PublicUser;
  reason: string;
  createdAt: string;
}

/** Conversa direta entre duas pessoas (canal sem servidor; guildId vazio). */
export interface DmChannel extends Channel {
  type: 'dm';
  recipient: PublicUser;
  lastMessageAt: string | null;
}

export type FriendStatus = 'friend' | 'incoming' | 'outgoing';

export interface Friend {
  user: PublicUser;
  status: FriendStatus;
}

export interface Member extends PublicUser {
  joinedAt: string;
  roleIds: string[];
  /** castigo: não pode escrever/reagir/entrar em voz até esta hora */
  timeoutUntil: string | null;
}

export interface Guild {
  id: string;
  name: string;
  ownerId: string;
  /** vazio se você não tem permissão de convidar */
  inviteCode: string;
  description: string;
  iconId: string | null;
  bannerId: string | null;
  everyonePermissions: number;
  roles: Role[];
  categories: Category[];
  /** só os canais que você pode ver */
  channels: Channel[];
  members: Member[];
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface Reaction {
  emoji: string;
  /** quem reagiu, na ordem em que reagiu */
  userIds: string[];
}

/** Trecho da mensagem respondida (ou só o id, se ela foi apagada). */
export type ReplyPreview =
  | { id: string; deleted: true }
  | { id: string; deleted?: false; author: PublicUser; content: string; hasAttachments: boolean };

export interface Message {
  id: string;
  channelId: string;
  author: PublicUser;
  content: string;
  createdAt: string;
  editedAt: string | null;
  replyTo: ReplyPreview | null;
  /** usou @todos com permissão para isso */
  mentionEveryone: boolean;
  reactions: Reaction[];
  attachments: Attachment[];
}

export interface VoiceState {
  socketId: string;
  userId: string;
  guildId: string;
  channelId: string;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
}

export type VoiceStatePatch = Partial<Pick<VoiceState, 'muted' | 'deafened' | 'camera' | 'screen'>>;

export interface InvitePreview {
  code: string;
  guildId: string;
  guildName: string;
  memberCount: number;
}

/** Mensagens trocadas entre pares WebRTC, retransmitidas pelo servidor. */
export type RtcSignal =
  | { type: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { type: 'candidate'; candidate: unknown }
  | { type: 'meta'; streams: Record<string, 'mic' | 'camera' | 'screen'> }
  | { type: 'watch'; on: boolean };
