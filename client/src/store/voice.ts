import { create } from 'zustand';
import { loadSettings, saveSettings, type VoiceSettings } from '../voice/settings';

export type MediaKind = 'mic' | 'camera' | 'screen';

export interface RemoteMedia {
  userId: string;
  mic?: MediaStream;
  camera?: MediaStream;
  screen?: MediaStream;
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
  noMic: boolean;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  remotes: Record<string, RemoteMedia>; // socketId -> mídia
  speaking: Record<string, boolean>; // 'me' | socketId
  watching: Record<string, true>; // socketIds cujas telas estou assistindo
  focus: string | null; // id do bloco em destaque
  audioBlocked: boolean;
  /** o servidor tem TURN configurado (necessário para 4G/5G) */
  hasTurn: boolean;
  /** tecla de push-to-talk pressionada */
  pttActive: boolean;
  /** nível do microfone em dBFS (para o medidor nas configurações) */
  micLevelDb: number;
  settings: VoiceSettings;
}

export const useVoice = create<VoiceStore>(() => ({
  status: 'idle',
  guildId: null,
  channelId: null,
  muted: false,
  deafened: false,
  camera: false,
  screen: false,
  noMic: false,
  localCamera: null,
  localScreen: null,
  remotes: {},
  speaking: {},
  watching: {},
  focus: null,
  audioBlocked: false,
  hasTurn: true,
  pttActive: false,
  micLevelDb: -100,
  settings: loadSettings(),
}));

export function updateSettings(patch: Partial<VoiceSettings>) {
  const settings = { ...useVoice.getState().settings, ...patch };
  saveSettings(settings);
  useVoice.setState({ settings });
}

export function setUserVolume(userId: string, volume: number) {
  const s = useVoice.getState().settings;
  updateSettings({ volumes: { ...s.volumes, [userId]: volume } });
}
