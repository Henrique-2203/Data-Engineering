import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Crown, MessageCircle, UserCheck, UserPlus } from 'lucide-react';
import type { Member } from '../../../shared/types';
import { openDm, sendFriendRequest } from '../lib/social';
import { toast, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { MemberModeration } from './GuildSettings';
import { memberColor } from '../lib/perms';

export function MemberList({ guildId }: { guildId: string }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const online = useApp((s) => s.online);
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
                    <span className="ellipsis" style={{ color: memberColor(guild, m.id, 'inherit') }}>
                      {m.displayName}
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
  const guild = useApp((s) => s.guilds[guildId]);
  const meId = useApp((s) => s.me?.id);
  const status = useApp((s) => s.friends.find((f) => f.user.id === member.id)?.status);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [onClose]);

  const isMe = member.id === meId;
  return (
    <div className="member-card" ref={ref} style={{ '--card-top': `${Math.max(8, top)}px` } as CSSProperties}>
      <div className="member-card-head">
        <Avatar user={member} size={48} />
        <div>
          <strong>{member.displayName}</strong>
          <div className="muted small">@{member.username}</div>
        </div>
      </div>
      {guild && <MemberModeration guild={guild} member={guild.members.find((m) => m.id === member.id) ?? member} compact />}
      {isMe ? (
        <p className="muted small">Esse é você!</p>
      ) : (
        <div className="member-card-actions">
          <button
            className="btn primary small"
            onClick={() => {
              onClose();
              void openDm(member.id);
            }}
          >
            <MessageCircle size={15} /> Enviar mensagem
          </button>
          {status === 'friend' ? (
            <span className="muted small row friend-ok">
              <UserCheck size={15} /> Amigos
            </span>
          ) : status === 'outgoing' ? (
            <span className="muted small">Pedido enviado</span>
          ) : (
            <button
              className="btn small"
              onClick={async () => {
                try {
                  const accepted = await sendFriendRequest(member.username);
                  toast(accepted ? 'Vocês agora são amigos!' : 'Pedido de amizade enviado.');
                } catch (err) {
                  toast((err as Error).message);
                }
              }}
            >
              <UserPlus size={15} /> {status === 'incoming' ? 'Aceitar amizade' : 'Adicionar amigo'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
