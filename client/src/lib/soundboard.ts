import { fileUrl } from './expressions';
import { getSocket } from './socket';
import { toast } from '../store/app';
import { useVoice } from '../store/voice';

export interface SoundboardEvent {
  socketId: string;
  userId: string;
  soundId: string;
  fileId: string;
  name: string;
  emoji: string | null;
}

/** som tocando agora por pessoa (aparece em cima do bloco dela na chamada) */
export interface SoundBurst {
  key: number;
  emoji: string;
  name: string;
}

let burstSeq = 0;
const MAX_PLAY_MS = 6000; // nenhum som passa disso, mesmo que o arquivo seja mais longo

/** Toca um arquivo de som (prévia nas configurações e soundboard). */
export function playSoundFile(fileId: string, volume: number) {
  const audio = new Audio(fileUrl(fileId));
  audio.volume = Math.max(0, Math.min(1, volume));
  void audio.play().catch(() => {});
  setTimeout(() => audio.pause(), MAX_PLAY_MS);
  return audio;
}

/** Chegou um som do soundboard de alguém da chamada. */
export function onSoundboardEvent(e: SoundboardEvent) {
  const v = useVoice.getState();
  const key = ++burstSeq;
  useVoice.setState((s) => ({ soundBursts: { ...s.soundBursts, [e.socketId]: { key, emoji: e.emoji ?? '🔊', name: e.name } } }));
  setTimeout(() => {
    useVoice.setState((s) => {
      if (s.soundBursts[e.socketId]?.key !== key) return {};
      const next = { ...s.soundBursts };
      delete next[e.socketId];
      return { soundBursts: next };
    });
  }, 2500);
  if (v.deafened) return;
  // volume do soundboard × volume que você deu para essa pessoa (silenciou alguém = silencia os sons dela)
  const volume = v.settings.soundboardVolume * (v.settings.volumes[e.userId] ?? 1);
  if (volume > 0) playSoundFile(e.fileId, volume);
}

/** Pede ao servidor para tocar um som para todos da chamada. */
export function playOnSoundboard(soundId: string) {
  const s = getSocket();
  if (!s) return;
  s.emit('soundboard:play', { soundId }, (res: { ok: boolean; error?: string }) => {
    if (!res?.ok) toast(res?.error ?? 'Não foi possível tocar o som.');
  });
}
