import { useVoice } from '../store/voice';

/**
 * Efeitos sonoros sintetizados com Web Audio (sem arquivos para baixar).
 * Cada som é uma sequência curta de notas com envelope suave.
 */
export type SoundName = 'join' | 'leave' | 'peerJoin' | 'peerLeave' | 'mute' | 'unmute' | 'message' | 'mention' | 'stream' | 'ring' | 'ringback';

type Note = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };

const SOUNDS: Record<SoundName, Note[]> = {
  join: [
    { freq: 523.25, at: 0, dur: 0.12 },
    { freq: 783.99, at: 0.09, dur: 0.18 },
  ],
  leave: [
    { freq: 783.99, at: 0, dur: 0.12 },
    { freq: 523.25, at: 0.09, dur: 0.18 },
  ],
  peerJoin: [
    { freq: 659.25, at: 0, dur: 0.1, gain: 0.7 },
    { freq: 880, at: 0.08, dur: 0.14, gain: 0.7 },
  ],
  peerLeave: [
    { freq: 880, at: 0, dur: 0.1, gain: 0.7 },
    { freq: 659.25, at: 0.08, dur: 0.14, gain: 0.7 },
  ],
  mute: [{ freq: 330, at: 0, dur: 0.09, type: 'triangle' }],
  unmute: [{ freq: 660, at: 0, dur: 0.09, type: 'triangle' }],
  message: [
    { freq: 1046.5, at: 0, dur: 0.08, gain: 0.5 },
    { freq: 1318.5, at: 0.07, dur: 0.16, gain: 0.5 },
  ],
  mention: [
    { freq: 880, at: 0, dur: 0.09, type: 'triangle' },
    { freq: 1174.7, at: 0.08, dur: 0.09, type: 'triangle' },
    { freq: 1760, at: 0.16, dur: 0.2, type: 'triangle', gain: 0.8 },
  ],
  // toque de quem recebe a ligação (repetido a cada 2 s)
  ring: [
    { freq: 784, at: 0, dur: 0.14, gain: 0.9 },
    { freq: 988, at: 0.15, dur: 0.14, gain: 0.9 },
    { freq: 784, at: 0.3, dur: 0.14, gain: 0.9 },
    { freq: 988, at: 0.45, dur: 0.22, gain: 0.9 },
  ],
  // "chamando..." para quem ligou
  ringback: [
    { freq: 440, at: 0, dur: 0.45, gain: 0.45 },
    { freq: 480, at: 0, dur: 0.45, gain: 0.35 },
  ],
  stream: [
    { freq: 523.25, at: 0, dur: 0.1 },
    { freq: 659.25, at: 0.08, dur: 0.1 },
    { freq: 783.99, at: 0.16, dur: 0.2 },
  ],
};

let ctx: AudioContext | null = null;
const lastPlayed = new Map<SoundName, number>();

/** `force`: toca mesmo com os sons desligados (ex.: toque de ligação). */
export function playSound(name: SoundName, force = false) {
  if (!force && !useVoice.getState().settings.sounds) return;
  // evita "metralhadora" de sons iguais (ex.: várias mensagens seguidas)
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < 700) return;
  lastPlayed.set(name, now);
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const n of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.value = n.freq;
      const peak = 0.12 * (n.gain ?? 1);
      gain.gain.setValueAtTime(0, t0 + n.at);
      gain.gain.linearRampToValueAtTime(peak, t0 + n.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  } catch {
    /* navegador sem Web Audio ou bloqueado: ignora */
  }
}
