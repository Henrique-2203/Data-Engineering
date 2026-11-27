import { useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { getSocket } from '../lib/socket';
import { playSound } from '../lib/sounds';
import { goHome, useApp } from '../store/app';
import { voice } from '../voice/engine';
import { Avatar } from './Avatar';

/**
 * Ligações de DM: janela de "chamada recebida" com toque, e tom de "chamando…"
 * para quem ligou enquanto a pessoa não atende.
 */
export function CallOverlay() {
  const incoming = useApp((s) => s.incomingCall);
  const outgoing = useApp((s) => s.outgoingRing);

  // toque repetido enquanto a chamada estiver tocando
  useEffect(() => {
    if (!incoming) return;
    playSound('ring', true);
    const t = setInterval(() => playSound('ring', true), 2000);
    return () => clearInterval(t);
  }, [incoming]);

  useEffect(() => {
    if (!outgoing) return;
    playSound('ringback', true);
    const t = setInterval(() => playSound('ringback', true), 2500);
    return () => clearInterval(t);
  }, [outgoing]);

  if (!incoming) return null;

  const answer = () => {
    useApp.setState({ incomingCall: null });
    goHome(incoming.channelId);
    void voice.join(incoming.channelId);
  };
  const decline = () => {
    useApp.setState({ incomingCall: null });
    getSocket()?.emit('call:decline', { channelId: incoming.channelId });
  };

  return (
    <div className="incoming-call" role="alertdialog" aria-label={`Chamada de ${incoming.from.displayName}`}>
      <div className="incoming-avatar">
        <Avatar user={incoming.from} size={84} />
      </div>
      <strong className="incoming-name">{incoming.from.displayName}</strong>
      <span className="muted">está te ligando…</span>
      <div className="incoming-actions">
        <button className="round-btn danger" aria-label="Recusar" title="Recusar" onClick={decline}>
          <PhoneOff />
        </button>
        <button className="round-btn accept" aria-label="Atender" title="Atender" onClick={answer}>
          <Phone />
        </button>
      </div>
    </div>
  );
}
