import type { TogetherState } from '../../../shared/types';
import { getSocket, onSocketReady } from '../lib/socket';
import { toast } from '../store/app';
import { useVoice } from '../store/voice';

/**
 * "Assistir juntos": um vídeo do YouTube tocando para todo mundo da call, sincronizado. O servidor
 * guarda o estado (vídeo, tocando/pausado, posição num instante e a fila); cada um toca o player
 * oficial do YouTube no próprio aparelho e corrige a posição quando sai de sincronia.
 * O som vai direto do YouTube para cada um: não pesa na internet de ninguém da call.
 */
type Action =
  | { action: 'play'; videoId: string; title?: string | null; position?: number }
  | { action: 'enqueue'; videoId: string; title?: string | null }
  | { action: 'pause' | 'resume' | 'seek'; position: number }
  | { action: 'next' | 'stop' }
  | { action: 'ended'; videoId: string; position?: number; duration?: number }
  | { action: 'remove'; index: number };

/** diferença entre o relógio do servidor e o daqui (ms) */
let offset = 0;
const setOffset = (serverNow: number) => {
  const sample = serverNow - Date.now();
  offset = offset === 0 ? sample : offset * 0.7 + sample * 0.3;
};

function apply(state: TogetherState | null) {
  const prev = useVoice.getState().together;
  useVoice.setState((s) => ({
    together: state,
    // acabou: quem tinha fechado só para si volta a ver o próximo "Assistir juntos"
    togetherHidden: state ? s.togetherHidden : false,
    // começou um vídeo: ele vai para o destaque (menos para quem fechou só para si)
    focus: state && !prev && !s.togetherHidden ? 'together' : !state && s.focus === 'together' ? null : s.focus,
  }));
}

function send(a: Action) {
  getSocket()?.emit('together:action', a, (r: { ok: boolean; error?: string }) => r && !r.ok && r.error && toast(r.error));
}

export const together = {
  play: (videoId: string, title: string | null, position = 0) => send({ action: 'play', videoId, title, position }),
  enqueue: (videoId: string, title: string | null) => send({ action: 'enqueue', videoId, title }),
  pause: (position: number) => send({ action: 'pause', position }),
  resume: (position: number) => send({ action: 'resume', position }),
  seek: (position: number) => send({ action: 'seek', position }),
  next: () => send({ action: 'next' }),
  ended: (videoId: string, position: number, duration: number) => send({ action: 'ended', videoId, position, duration }),
  /** fecha só para mim (o vídeo continua para os outros) */
  hide: () => useVoice.setState((s) => ({ togetherHidden: true, focus: s.focus === 'together' ? null : s.focus })),
  show: () => useVoice.setState({ togetherHidden: false, focus: 'together' }),
  remove: (index: number) => send({ action: 'remove', index }),
  stop: () => send({ action: 'stop' }),
  /** onde o vídeo deveria estar agora (segundos) */
  expected(state: TogetherState) {
    return state.playing ? state.position + Math.max(0, Date.now() + offset - state.at) / 1000 : state.position;
  },
  /** ao entrar na call: pega o que está tocando */
  sync() {
    getSocket()?.emit('together:get', {}, (r: { state: TogetherState | null; now: number }) => {
      if (!r) return;
      setOffset(r.now);
      apply(r.state);
    });
  },
  clear: () => {
    apply(null);
    useVoice.setState({ togetherHidden: false });
  },
};

const bound = new WeakSet<object>();
onSocketReady((s) => {
  if (bound.has(s)) return;
  bound.add(s);
  s.on('together:state', ({ channelId, state, now }: { channelId: string; state: TogetherState | null; now: number }) => {
    if (useVoice.getState().channelId !== channelId) return;
    setOffset(now);
    apply(state);
  });
});
