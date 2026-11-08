export interface ScreenPreset {
  id: string;
  label: string;
  width?: number;
  height?: number;
  fps: number;
  bitrate: number; // bits/s
}

export const SCREEN_PRESETS: ScreenPreset[] = [
  { id: '720p30', label: '720p · 30 FPS', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  { id: '720p60', label: '720p · 60 FPS', width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
  { id: '1080p30', label: '1080p · 30 FPS', width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 },
  { id: '1080p60', label: '1080p · 60 FPS', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  { id: '1440p60', label: '1440p · 60 FPS', width: 2560, height: 1440, fps: 60, bitrate: 14_000_000 },
  { id: '2160p60', label: '4K · 60 FPS', width: 3840, height: 2160, fps: 60, bitrate: 25_000_000 },
  { id: 'source60', label: 'Resolução nativa · 60 FPS', fps: 60, bitrate: 16_000_000 },
];

export type ContentType = 'motion' | 'detail';
export type CodecChoice = 'h264' | 'vp9' | 'av1' | 'vp8';

export const CODECS: { id: CodecChoice; label: string; mime: string }[] = [
  { id: 'h264', label: 'H.264 (recomendado: usa a placa de vídeo)', mime: 'video/H264' },
  { id: 'vp9', label: 'VP9 (mais qualidade, usa mais CPU)', mime: 'video/VP9' },
  { id: 'av1', label: 'AV1 (melhor qualidade, exige PC forte)', mime: 'video/AV1' },
  { id: 'vp8', label: 'VP8 (compatibilidade máxima)', mime: 'video/VP8' },
];

export interface VoiceSettings {
  screenPreset: string;
  contentType: ContentType;
  codec: CodecChoice;
  screenAudio: boolean;
  /** Bitrate escolhido manualmente (Mbps). null = padrão do preset. */
  bitrateMbps: number | null;
  micDeviceId: string | null;
  noiseSuppression: boolean;
  volumes: Record<string, number>; // userId -> 0..1
  /** Reduz a qualidade enviada para quem está conectado via TURN (economiza a cota grátis). */
  turnSaver: boolean;
}

const KEY = 'resenha.voiceSettings';

export const DEFAULT_SETTINGS: VoiceSettings = {
  screenPreset: '1080p60',
  contentType: 'motion',
  codec: 'h264',
  screenAudio: true,
  bitrateMbps: null,
  micDeviceId: null,
  noiseSuppression: true,
  volumes: {},
  turnSaver: true,
};

export function loadSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignora */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: VoiceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignora */
  }
}

export function presetById(id: string): ScreenPreset {
  return SCREEN_PRESETS.find((p) => p.id === id) ?? SCREEN_PRESETS[3];
}

export function effectiveBitrate(s: VoiceSettings): number {
  return s.bitrateMbps ? s.bitrateMbps * 1_000_000 : presetById(s.screenPreset).bitrate;
}

export const canShareScreen = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
