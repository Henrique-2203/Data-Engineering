import { useEffect, useRef } from 'react';
import { useVoice } from '../store/voice';

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
          {r.mic && <RemoteAudio stream={r.mic} userId={r.userId} version={r.v} />}
          {r.screen && watching[sid] && <RemoteAudio stream={r.screen} userId={r.userId} version={r.v} kind="screen" />}
        </span>
      ))}
    </div>
  );
}

function RemoteAudio({ stream, userId, version, kind = 'mic' }: { stream: MediaStream; userId: string; version: number; kind?: 'mic' | 'screen' }) {
  const ref = useRef<HTMLAudioElement>(null);
  const deafened = useVoice((s) => s.deafened);
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

  useEffect(() => {
    if (ref.current) ref.current.muted = deafened;
  }, [deafened]);

  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  return <audio ref={ref} autoPlay playsInline />;
}
