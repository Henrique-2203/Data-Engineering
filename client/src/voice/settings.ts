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
export type InputMode = 'voice' | 'ptt';
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
  /** volume da transmissão de cada pessoa (som do jogo/vídeo), separado da voz: userId -> 0..1 */
  streamVolumes: Record<string, number>;
  /** Reduz a qualidade enviada para quem está conectado via TURN (economiza a cota grátis). */
  turnSaver: boolean;
  /** 'voice' = ativação por voz (com sensibilidade); 'ptt' = aperte para falar */
  inputMode: InputMode;
  /** tecla/botão do push-to-talk: KeyboardEvent.code ou 'Mouse3'/'Mouse4' (botões laterais) */
  pttKey: string;
  /** sensibilidade da ativação por voz, em dBFS (-100 = sempre transmite, -20 = só voz alta) */
  vadThresholdDb: number;
  sounds: boolean;
  notifications: boolean;
  /** mostrar o "Jogando agora" (app de desktop) */
  shareActivity: boolean;
  /** volume dos sons do soundboard (0..1) */
  soundboardVolume: number;
  /** modo destaque: quanto da área da chamada a transmissão em destaque ocupa (só na sua tela), em % */
  stageMainPct: number;
  /** modo destaque: pessoas embaixo da transmissão ou ao lado (só na sua tela) */
  stageLayout: 'bottom' | 'side';
  /** largura da transmissão quando as pessoas ficam ao lado, em % */
  stageSidePct: number;
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
  streamVolumes: {},
  turnSaver: true,
  inputMode: 'voice',
  pttKey: 'Backquote',
  vadThresholdDb: -55,
  sounds: true,
  notifications: false,
  shareActivity: true,
  soundboardVolume: 0.7,
  stageMainPct: 78,
  stageLayout: 'bottom',
  stageSidePct: 80,
};

/** Nome legível da tecla de push-to-talk. */
export function keyLabel(code: string): string {
  if (code === 'Mouse3') return 'Botão lateral do mouse (voltar)';
  if (code === 'Mouse4') return 'Botão lateral do mouse (avançar)';
  if (code === 'Mouse1') return 'Botão do meio do mouse';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Backquote: "' (ao lado do 1)",
    Space: 'Espaço',
    CapsLock: 'Caps Lock',
    ShiftLeft: 'Shift esquerdo',
    ShiftRight: 'Shift direito',
    ControlLeft: 'Ctrl esquerdo',
    ControlRight: 'Ctrl direito',
    AltLeft: 'Alt',
    AltRight: 'Alt Gr',
    Tab: 'Tab',
    IntlBackslash: '\\ (ao lado do Shift)',
  };
  return names[code] ?? code;
}

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
