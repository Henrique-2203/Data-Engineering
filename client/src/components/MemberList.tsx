import { Crown } from 'lucide-react';
import { useApp } from '../store/app';
import { Avatar } from './Avatar';

export function MemberList({ guildId }: { guildId: string }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const online = useApp((s) => s.online);
  if (!guild) return null;
  const sorted = [...guild.members].sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  const on = sorted.filter((m) => online[m.id]);
  const off = sorted.filter((m) => !online[m.id]);

  return (
    <aside className="members" aria-label="Membros">
      {[
        { title: `Online — ${on.length}`, list: on, isOn: true },
        { title: `Offline — ${off.length}`, list: off, isOn: false },
      ].map(
        (group) =>
          group.list.length > 0 && (
            <div key={group.title}>
              <div className="section-title">
                <span>{group.title}</span>
              </div>
              {group.list.map((m) => (
                <div key={m.id} className={`member${group.isOn ? '' : ' offline'}`}>
                  <Avatar user={m} size={32} online={group.isOn} />
                  <span className="ellipsis">{m.displayName}</span>
                  {m.id === guild.ownerId && (
                    <span title="Dono do servidor">
                      <Crown size={14} className="owner-icon" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ),
      )}
    </aside>
  );
}
