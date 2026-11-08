import { Link2, Plus } from 'lucide-react';
import { openModal, selectGuild, useApp } from '../store/app';
import { useVoice } from '../store/voice';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function ServerRail() {
  const guildOrder = useApp((s) => s.guildOrder);
  const guilds = useApp((s) => s.guilds);
  const selected = useApp((s) => s.selectedGuildId);
  const unread = useApp((s) => s.unread);
  const voiceGuild = useVoice((s) => s.guildId);

  return (
    <div className="rail">
      {guildOrder.map((id) => {
        const g = guilds[id];
        if (!g) return null;
        const hasUnread = g.channels.some((c) => unread[c.id]);
        return (
          <button
            key={id}
            className={`rail-item${selected === id ? ' active' : ''}`}
            title={g.name}
            aria-label={g.name}
            onClick={() => selectGuild(id)}
          >
            {hasUnread && selected !== id && <span className="rail-pill" />}
            <span className="rail-icon">{initials(g.name)}</span>
            {voiceGuild === id && <span className="rail-voice" title="Você está em uma chamada aqui" />}
          </button>
        );
      })}
      <div className="rail-sep" />
      <button className="rail-item action" title="Criar servidor" aria-label="Criar servidor" onClick={() => openModal({ kind: 'createGuild' })}>
        <span className="rail-icon">
          <Plus size={22} />
        </span>
      </button>
      <button className="rail-item action" title="Entrar com convite" aria-label="Entrar com convite" onClick={() => openModal({ kind: 'joinGuild' })}>
        <span className="rail-icon">
          <Link2 size={20} />
        </span>
      </button>
    </div>
  );
}
