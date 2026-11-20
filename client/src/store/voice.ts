import { create } from 'zustand';
import { loadSettings, saveSettings, type NoiseMode, type VoiceSettings } from '../voice/settings';
import type { SoundBurst } from '../lib/soundboard';
import type { TogetherState, CallChatMessage, StreamQuality } from '../../../shared/types';
import type { TurboRecvInfo } from '../voice/turbo';

export type MediaKind = 'mic' | 'camera' | 'screen';

export interface RemoteMedia {
  userId: string;
  mic?: MediaStream;
  camera?: MediaStream;
  screen?: MediaStream;
  /** vídeo da transmissão turbo (decodificado aqui); o som continua em `screen` */
  screenTurbo?: MediaStream;
  connection: RTCPeerConnectionState;
  /** a conexão com esta pessoa passa pelo servidor TURN */
  relayed?: boolean;
  /** incrementa quando faixas mudam dentro de um mesmo MediaStream */
  v: number;
}

export interface VoiceStore {
  status: 'idle' | 'connecting' | 'connected';
  guildId: string | null;
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
  /** desliguei o áudio da minha transmissão (a imagem continua) */
  screenAudioOff: boolean;
  /** modo desempenho deixou minha transmissão mais leve (720p · 30 FPS) */
  screenLight: boolean;
  /** "Assistir juntos": vídeo do YouTube tocando para a call (null = nenhum) */
  together: TogetherState | null;
  /** qualidade que escolhi para assistir cada transmissão (socketId -> qualidade; padrão 'auto') */
  streamQuality: Record<string, StreamQuality>;
  /** o que quem transmite contou sobre a versão que estou recebendo (turbo) */
  streamInfo: Record<string, TurboRecvInfo>;
  /** sugestão de baixar a qualidade (minha internet não está dando conta): socketId -> altura sugerida */
  streamHint: Record<string, number>;
  /** transmissões que NÃO posso assistir (quem transmite escolheu outras pessoas): socketId -> true */
  screenBlocked: Record<string, true>;
  /** fechei o "Assistir juntos" só para mim (continua para os outros) */
  togetherHidden: boolean;
  /** chat privado da call (só quem está nela; não fica salvo) */
  callChat: CallChatMessage[];
  /** filtro de ruído que está de fato ligado no microfone agora (null = fora da chamada) */
  noiseActive: NoiseMode | null;
  noMic: boolean;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  remotes: Record<string, RemoteMedia>; // socketId -> mídia
  speaking: Record<string, boolean>; // 'me' | socketId
  watching: Record<string, true>; // socketIds cujas telas estou assistindo
  focus: string | null; // id do bloco em destaque
  /** blocos que você ampliou na grade (ocupam o dobro): só na sua tela */
  bigTiles: Record<string, true>;
  audioBlocked: boolean;
  /** o servidor tem TURN configurado (necessário para 4G/5G) */
  hasTurn: boolean;
  /** tecla de push-to-talk pressionada */
  pttActive: boolean;
  /** nível do microfone em dBFS (para o medidor nas configurações) */
  micLevelDb: number;
  settings: VoiceSettings;
  /** soundboard: som tocando agora por socketId (aparece em cima do bloco) */
  soundBursts: Record<string, SoundBurst>;
}

export const useVoice = create<VoiceStore>(() => ({
  status: 'idle',
  guildId: null,
  channelId: null,
  muted: false,
  deafened: false,
  camera: false,
  screen: false,
  screenAudioOff: false,
  screenLight: false,
  noiseActive: null,
  together: null,
  streamQuality: {},
  streamInfo: {},
  streamHint: {},
  screenBlocked: {},
  togetherHidden: false,
  callChat: [],
  noMic: false,
  localCamera: null,
  localScreen: null,
  remotes: {},
  speaking: {},
  watching: {},
  focus: null,
  bigTiles: {},
  audioBlocked: false,
  hasTurn: true,
  pttActive: false,
  micLevelDb: -100,
  settings: loadSettings(),
  soundBursts: {},
}));

export function updateSettings(patch: Partial<VoiceSettings>) {
  const settings = { ...useVoice.getState().settings, ...patch };
  saveSettings(settings);
  useVoice.setState({ settings });
}

/** Volume da transmissão de alguém (só na sua tela). */
export function setStreamVolume(userId: string, volume: number) {
  const streamVolumes = { ...useVoice.getState().settings.streamVolumes, [userId]: volume };
  updateSettings({ streamVolumes });
}

export function setUserVolume(userId: string, volume: number) {
  const s = useVoice.getState().settings;
  updateSettings({ volumes: { ...s.volumes, [userId]: volume } });
}
