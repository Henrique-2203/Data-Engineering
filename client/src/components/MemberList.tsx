import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Crown } from 'lucide-react';
import type { Member } from '../../../shared/types';
import { useApp } from '../store/app';
import { Avatar } from './Avatar';
import { ProfileCard } from './ProfileCard';
import { presenceLine } from '../lib/presence';
import { memberColor } from '../lib/perms';

export function MemberList({ guildId }: { guildId: string }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const online = useApp((s) => s.online);
  const activities = useApp((s) => s.activities);
  const [open, setOpen] = useState<{ id: string; top: number } | null>(null);
  const openId = open?.id ?? null;
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
                <div key={m.id} className="member-wrap">
                  <button
                    className={`member${group.isOn ? '' : ' offline'}`}
                    onClick={(e) => {
                      // o cartão fica "fixo" na tela: a lista tem rolagem própria e o cortaria
                      const top = Math.min(e.currentTarget.getBoundingClientRect().top, window.innerHeight - 200);
                      setOpen(openId === m.id ? null : { id: m.id, top });
                    }}
                    aria-expanded={openId === m.id}
                  >
                    <Avatar user={m} size={32} online={group.isOn} />
                    <span className="member-text">
                      <span className="ellipsis" style={{ color: memberColor(guild, m.id, 'inherit') }}>
                        {m.displayName}
                      </span>
                      {presenceLine(m, activities[m.id]) && <span className="member-sub ellipsis">{presenceLine(m, activities[m.id])}</span>}
                    </span>
                    {m.id === guild.ownerId && (
                      <span title="Dono do servidor">
                        <Crown size={14} className="owner-icon" />
                      </span>
                    )}
                  </button>
                  {openId === m.id && <MemberCard guildId={guildId} member={m} top={open!.top} onClose={() => setOpen(null)} />}
                </div>
              ))}
            </div>
          ),
      )}
    </aside>
  );
}

/** Mini perfil com ações: mandar mensagem e adicionar amigo. */
function MemberCard({ guildId, member, top, onClose }: { guildId: string; member: Member; top: number; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [onClose]);
  return (
    <div className="member-card" ref={ref} style={{ '--card-top': `${Math.max(8, Math.min(top, window.innerHeight - 460))}px` } as CSSProperties}>
      <ProfileCard userId={member.id} guildId={guildId} onAction={onClose} />
    </div>
  );
}
