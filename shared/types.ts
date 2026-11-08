// Tipos compartilhados entre servidor e cliente.

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
}

export interface Guild {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  channels: Channel[];
  members: Member[];
}

export interface Message {
  id: string;
  channelId: string;
  author: PublicUser;
  content: string;
  createdAt: string;
  editedAt: string | null;
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
