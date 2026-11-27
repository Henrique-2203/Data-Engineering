import { useEffect, useRef } from 'react';
import { useVoice } from '../store/voice';
import { useApp } from '../store/app';

/**
 * Elementos <audio> invisíveis que tocam a voz dos participantes e o áudio das
 * transmissões assistidas. Ficam montados enquanto você navega pelos canais de texto.
 */
export function VoiceAudio() {
  const remotes = useVoice((s) => s.remotes);
  const watching = useVoice((s) => s.watching);
  return (
    <div hidden>
      {Object.entries(remotes).map(([sid, r]) => (
        <span key={sid}>
          {r.mic && <RemoteAudio stream={r.mic} userId={r.userId} version={r.v} socketId={sid} />}
          {r.screen && watching[sid] && <RemoteAudio stream={r.screen} userId={r.userId} version={r.v} kind="screen" socketId={sid} />}
        </span>
      ))}
    </div>
  );
}

/**
 * Volume acima de 100%: o <audio> do navegador não passa de 1.0, e em alguns computadores a voz dos outros chega baixa
 * mesmo no máximo (ex.: o Windows abaixa os outros sons durante chamadas, ou o microfone/placa de quem fala é baixo).
 * Acima de 100% o som passa por um amplificador do Web Audio (até 200%) com um limitador suave para não estourar.
 */
let boostCtx: AudioContext | null = null;
const boostContext = () => {
  boostCtx ??= new AudioContext();
  void boostCtx.resume().catch(() => {});
  return boostCtx;
};

function RemoteAudio({ stream, userId, version, kind = 'mic', socketId }: { stream: MediaStream; userId: string; version: number; kind?: 'mic' | 'screen'; socketId: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const selfDeaf = useVoice((s) => s.deafened);
  // moderação: quem foi silenciado pelo servidor não é ouvido (mesmo que o app dele não obedeça);
  // e se fui eu o ensurdecido, não ouço ninguém
  const modMuted = useApp((s) => kind === 'mic' && !!(s.voiceStates[socketId]?.serverMuted || s.voiceStates[socketId]?.serverDeafened));
  const meDeaf = useApp((s) => !!(s.socketId && s.voiceStates[s.socketId]?.serverDeafened));
  const deafened = selfDeaf || modMuted || meDeaf;
  // a transmissão tem o próprio volume (som do jogo/vídeo), independente da voz da pessoa
  const volume = useVoice((s) => (kind === 'screen' ? (s.settings.streamVolumes?.[userId] ?? 1) : (s.settings.volumes[userId] ?? 1)));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    const tryPlay = () =>
      el
        .play()
        .then(() => useVoice.setState({ audioBlocked: false }))
        .catch((err) => {
          if (err?.name === 'NotAllowedError') useVoice.setState({ audioBlocked: true });
        });
    void tryPlay();
    window.addEventListener('resenha:unlock-audio', tryPlay);
    return () => window.removeEventListener('resenha:unlock-audio', tryPlay);
  }, [stream, version]);

  // acima de 100% (só voz): o <audio> fica mudo (continua ligado ao stream, o Chrome exige isso para entregar o som)
  // e quem toca é o amplificador
  const boost = kind === 'mic' && volume > 1;
  const amp = useRef<{ stream: MediaStream; src: MediaStreamAudioSourceNode; gain: GainNode; comp: DynamicsCompressorNode } | null>(null);
  const dropAmp = () => {
    const a = amp.current;
    if (!a) return;
    try {
      a.src.disconnect();
      a.gain.disconnect();
      a.comp.disconnect();
    } catch {
      /* já desligado */
    }
    amp.current = null;
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!boost) {
      dropAmp();
      el.muted = deafened;
      el.volume = Math.max(0, Math.min(1, volume));
      return;
    }
    el.muted = true;
    el.volume = 1;
    try {
      const ctx = boostContext();
      if (!amp.current || amp.current.stream !== stream) {
        dropAmp();
        const src = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -8;
        comp.knee.value = 10;
        comp.ratio.value = 10;
        src.connect(gain);
        gain.connect(comp);
        comp.connect(ctx.destination);
        amp.current = { stream, src, gain, comp };
      }
      amp.current.gain.gain.value = deafened ? 0 : Math.min(2, volume);
    } catch {
      // sem Web Audio: cai para o máximo normal do navegador
      el.muted = deafened;
      el.volume = 1;
    }
  }, [boost, volume, deafened, stream, version]);
  useEffect(() => dropAmp, []);
  useEffect(() => {
    const resume = () => void boostCtx?.resume().catch(() => {});
    window.addEventListener('resenha:unlock-audio', resume);
    return () => window.removeEventListener('resenha:unlock-audio', resume);
  }, []);

  return <audio ref={ref} autoPlay playsInline data-kind={kind} data-socket={socketId} />;
}
