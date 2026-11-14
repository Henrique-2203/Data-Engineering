import { Phone, Users } from 'lucide-react';
import { goHome, useApp } from '../store/app';
import { Avatar } from './Avatar';

/** Barra lateral do Início: atalho para Amigos e a lista de conversas diretas. */
export function HomeSidebar() {
  const selected = useApp((s) => s.selectedChannelId);
  const dmOrder = useApp((s) => s.dmOrder);
  const dms = useApp((s) => s.dms);
  const online = useApp((s) => s.online);
  const unread = useApp((s) => s.unread);
  const voiceStates = useApp((s) => s.voiceStates);
  const inCall = new Set(Object.values(voiceStates).filter((v) => !v.guildId).map((v) => v.channelId));
  const incoming = useApp((s) => s.friends.filter((f) => f.status === 'incoming').length);

  return (
    <>
      <div className={`channel home-item${selected === null ? ' active' : ''}`}>
        <button className="channel-main" onClick={() => goHome(null)}>
          <Users size={20} className="channel-icon" />
          <span className="ellipsis">Amigos</span>
          {incoming > 0 && <span className="count-badge">{incoming}</span>}
        </button>
      </div>

      <div className="section-title">
        <span>Mensagens diretas</span>
      </div>
      {dmOrder.length === 0 && <p className="muted small dm-empty">Suas conversas aparecem aqui.</p>}
      {dmOrder.map((id) => {
        const dm = dms[id];
        if (!dm) return null;
        return (
          <div key={id} className={`channel dm-item${selected === id ? ' active' : ''}${unread[id] ? ' unread' : ''}`}>
            <button className="channel-main" onClick={() => goHome(id)}>
              <Avatar user={dm.recipient} size={30} online={!!online[dm.recipient.id]} />
              <span className="ellipsis">{dm.recipient.displayName}</span>
              {inCall.has(id) && (
                <span className="dm-call" title="Chamada em andamento" aria-label="Chamada em andamento">
                  <Phone size={14} />
                </span>
              )}
              {unread[id] && <span className="unread-dot" aria-label="mensagens não lidas" />}
            </button>
          </div>
        );
      })}
    </>
  );
}
