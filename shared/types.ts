// Tipos compartilhados entre servidor e cliente.
import type { Role } from './permissions';
export type { Role } from './permissions';

export interface UserStatus {
  text: string;
  emoji: string | null;
  /** quando o status some sozinho (null = até a pessoa trocar) */
  expiresAt: string | null;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /** foto de perfil (imagem em /api/images/:id) */
  avatarId?: string | null;
  status?: UserStatus | null;
  /** banner da call: 'preset:<tema>' ou 'image:<id>' (null = sem banner) */
  callBanner?: string | null;
  /** posição vertical da imagem do banner no quadro (0 = topo, 100 = base) */
  callBannerPos?: number;
}

/** "Jogando agora" (detectado pelo app de desktop; só existe enquanto a pessoa está online) */
export interface Activity {
  /** jogo, ou nome da música */
  name: string;
  startedAt: string;
  /** 'music': "Ouvindo agora" (Spotify do PC); sem kind = jogo */
  kind?: 'game' | 'music';
  /** música: o artista */
  details?: string | null;
}

export type ProfileLinkType = 'steam' | 'twitch' | 'youtube' | 'instagram' | 'tiktok' | 'x' | 'spotify' | 'site';

export interface ProfileLink {
  type: ProfileLinkType;
  url: string;
}

export interface Profile {
  user: PublicUser;
  bannerId: string | null;
  bio: string;
  pronouns: string;
  links: ProfileLink[];
  createdAt: string;
  mutualGuilds: { id: string; name: string; iconId: string | null }[];
  mutualFriends: PublicUser[];
  /** selo "Apoiador Fundador" (apoiou o Resenha na campanha de fundadores e não escondeu o selo) */
  supporter?: boolean;
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
  /** modo lento: segundos entre mensagens de cada pessoa (0 = desligado) */
  slowmode?: number;
  /** canal de avisos: todos leem, só a equipe do servidor (gerenciar servidor ou mensagens) publica */
  announce?: boolean;
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
  /** apelido só neste servidor (displayName já vem com ele aplicado) */
  nick: string | null;
  /** foto só neste servidor (avatarId já vem com ela aplicada) */
  guildAvatarId: string | null;
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
  /** emojis, figurinhas e sons do servidor */
  expressions: Expression[];
  /** eventos agendados que ainda não acabaram */
  events?: GuildEvent[];
  /** regras do servidor (texto) e se é preciso aceitar para participar */
  rules?: string;
  rulesRequired?: boolean;
  /** eu ainda não aceitei as regras (só leio até aceitar) */
  rulesPending?: boolean;
  /** o servidor oficial do Resenha */
  official?: boolean;
  /** público: aparece em Explorar (se cumprir os requisitos) e qualquer pessoa entra sem convite */
  public?: boolean;
  category?: string;
  /** a equipe do Resenha tirou o servidor da lista do Explorar */
  unlisted?: boolean;
}

/** Cartão de um servidor no Explorar. */
export interface ExploreGuild {
  id: string;
  name: string;
  description: string;
  iconId: string | null;
  bannerId: string | null;
  category: string;
  members: number;
  official: boolean;
  isMember: boolean;
}

/** Evento agendado do servidor (jogatina, call marcada...). */
export interface GuildEvent {
  id: string;
  guildId: string;
  /** canal de voz onde vai acontecer (opcional) */
  channelId: string | null;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  creator: PublicUser | null;
  /** quem marcou "Tenho interesse" */
  interestedIds: string[];
}

export type SupportCategory = 'bug' | 'call' | 'account' | 'question' | 'idea' | 'other';

/** Chamado de suporte (quem abriu e a equipe do Resenha conversam nele). */
export interface SupportTicket {
  id: string;
  category: SupportCategory;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  /** a equipe respondeu e a pessoa ainda não leu */
  unread: boolean;
  createdAt: string;
  updatedAt: string;
  user: PublicUser;
  messages: { id: string; fromTeam: boolean; body: string; createdAt: string }[];
  /** "Relatar problema da call": números da call no momento (ver client/src/voice/diagnostics.ts) */
  diagnostics?: unknown;
}

/** "Assistir juntos": o vídeo do YouTube que toca para todo mundo da call (estado no servidor). */
export interface TogetherState {
  videoId: string;
  title: string | null;
  playing: boolean;
  /** posição (segundos) no instante `at` (relógio do servidor, ms) */
  position: number;
  at: number;
  /** quem colocou o vídeo atual */
  by: string;
  queue: { videoId: string; title: string | null; by: string }[];
}

/**
 * Mensagem do chat privado da call: só quem está na call vê, fica só na memória do servidor
 * e some quando a call acaba (não vai para o banco).
 */
export interface CallChatMessage {
  id: string;
  userId: string;
  content: string;
  at: number;
  /** 'together': aviso automático do "Assistir juntos" (content = título do vídeo) */
  kind?: 'text' | 'together';
}

/** Enquete dentro de uma mensagem. */
export interface Poll {
  question: string;
  options: { text: string; userIds: string[] }[];
  /** pode escolher mais de uma opção */
  multi: boolean;
  endsAt: string;
}

/** Moderação automática de um servidor (só quem gerencia o servidor vê). */
export interface AutomodSettings {
  /** palavras proibidas (termine com * para pegar o começo da palavra: "idiot*") */
  words: string[];
  blockLinks: boolean;
  blockInvites: boolean;
  antiSpam: boolean;
  /** cargos que a moderação automática ignora */
  exemptRoleIds: string[];
}

export type ExpressionKind = 'emoji' | 'sticker' | 'sound';

export interface Expression {
  id: string;
  guildId: string;
  kind: ExpressionKind;
  /** emoji: só letras minúsculas, números e _ (vira :nome:) */
  name: string;
  /** arquivo em /api/images/:fileId */
  fileId: string;
  /** som: emoji que aparece no botão */
  emoji: string | null;
}

/** Figurinha enviada (fileId null = foi apagada do servidor) */
export interface StickerRef {
  id: string;
  name: string;
  fileId: string | null;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  /** imagem, vídeo e áudio aparecem na conversa; "file" vira um cartão para baixar */
  kind: AttachmentKind;
  size: number;
  width: number | null;
  height: number | null;
  /** link assinado que expira (12 a 24 h); o site pede um novo quando expira */
  url?: string;
}

export interface Reaction {
  emoji: string;
  /** quem reagiu, na ordem em que reagiu */
  userIds: string[];
}

/** Trecho da mensagem respondida (ou só o id, se ela foi apagada). */
export type ReplyPreview =
  | { id: string; deleted: true }
  | { id: string; deleted?: false; author: PublicUser; content: string; hasAttachments: boolean; hasSticker?: boolean };

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
  sticker: StickerRef | null;
  /** fixada no canal (quando), ou null */
  pinnedAt?: string | null;
  poll?: Poll | null;
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
  /** quem transmite desligou o áudio da transmissão (a imagem continua) */
  screenAudioOff?: boolean;
  /**
   * como o som da transmissão é capturado (para o diagnóstico de quem assiste):
   * clean = som do PC SEM o Resenha (app 0.3.9+, ou navegador que separa); system = o PC inteiro,
   * com a voz da call junto; tab = só uma aba do navegador; none = sem som. Sem o campo: app antigo.
   */
  screenAudioMode?: ScreenAudioMode;
  /** silenciado por um moderador do servidor (ninguém ouve o microfone até tirarem) */
  serverMuted?: boolean;
  /** ensurdecido por um moderador do servidor (não ouve nem fala até tirarem) */
  serverDeafened?: boolean;
}
export type ScreenAudioMode = 'clean' | 'system' | 'tab' | 'none';

export type VoiceStatePatch = Partial<Pick<VoiceState, 'muted' | 'deafened' | 'camera' | 'screen' | 'screenAudioOff' | 'screenAudioMode'>>;

export interface InvitePreview {
  code: string;
  guildId: string;
  guildName: string;
  memberCount: number;
}

/** Mensagens trocadas entre pares WebRTC, retransmitidas pelo servidor. */
/**
 * Qualidade que cada pessoa escolhe para assistir uma transmissão. 'auto' (padrão): o Resenha desce
 * para 720p/480p quando a internet dela não dá conta e sobe de novo quando melhora.
 */
export type StreamQuality = 'auto' | 'source' | '720' | '480';
export const STREAM_QUALITIES: StreamQuality[] = ['auto', 'source', '720', '480'];

/**
 * Quem pode assistir a minha transmissão: todos da call, só amigos, só quem eu escolher ou todos
 * menos quem eu escolher. Quem não pode vê "🔒 transmitindo para outras pessoas". A voz continua
 * para todos da call (é a mesma call); só a imagem (e o som) da transmissão fica restrita.
 */
export type ScreenAudienceMode = 'all' | 'friends' | 'only' | 'except';
export interface ScreenAudience {
  mode: ScreenAudienceMode;
  /** 'only': quem pode; 'except': quem não pode */
  userIds: string[];
}

export type RtcSignal =
  | { type: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { type: 'candidate'; candidate: unknown }
  | { type: 'meta'; streams: Record<string, 'mic' | 'camera' | 'screen'> }
  /** `decoders`: quem assiste aceita a transmissão turbo (codecs que consegue decodificar) */
  | { type: 'watch'; on: boolean; decoders?: string[]; quality?: StreamQuality }
  /** quem assiste trocou a qualidade */
  | { type: 'quality'; q: StreamQuality };

/** Ações que entram no registro de auditoria do servidor. */
export type AuditAction =
  | 'guild_update'
  | 'guild_icon'
  | 'guild_banner'
  | 'guild_everyone_perms'
  | 'guild_invite_reset'
  | 'role_create'
  | 'role_update'
  | 'role_delete'
  | 'role_move'
  | 'member_join'
  | 'member_leave'
  | 'member_kick'
  | 'member_ban'
  | 'member_unban'
  | 'member_timeout'
  | 'member_timeout_clear'
  | 'member_roles'
  | 'member_nick'
  | 'member_avatar_remove'
  | 'category_create'
  | 'category_update'
  | 'category_delete'
  | 'channel_create'
  | 'channel_update'
  | 'channel_delete'
  | 'channel_layout'
  | 'message_delete'
  | 'message_pin'
  | 'message_unpin'
  | 'automod_update'
  | 'automod_block'
  | 'event_create'
  | 'event_update'
  | 'event_delete'
  | 'expression_create'
  | 'expression_update'
  | 'expression_delete'
  | 'voice_move'
  | 'voice_disconnect'
  | 'voice_mute'
  | 'voice_unmute'
  | 'voice_deafen'
  | 'voice_undeafen';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actor: PublicUser | null;
  targetType: string | null;
  targetId: string | null;
  /** nome do alvo na época (a pessoa pode ter saído ou mudado de nome) */
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
