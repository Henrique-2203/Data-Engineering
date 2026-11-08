import { useEffect, useState } from 'react';
import { MessageCircle, Pencil, UserCheck, UserPlus } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { api } from '../lib/api';
import { imageUrl, memberColor } from '../lib/perms';
import { LINK_INFO, activeStatus, playingFor } from '../lib/presence';
import { openDm, sendFriendRequest } from '../lib/social';
import { closeModal, findMember, openModal, toast, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { MemberModeration } from './GuildSettings';

const sinceFmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

/**
 * Cartão de perfil de alguém. Os dados "vivos" (foto, nome, status, jogo, online) vêm do estado
 * do app; banner, bio, links e o que vocês têm em comum são buscados ao abrir.
 */
export function ProfileCard({ userId, guildId, onAction }: { userId: string; guildId?: string | null; onAction?: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useApp(() => findMember(guildId ?? null, userId));
  const meId = useApp((s) => s.me?.id);
  const online = useApp((s) => !!s.online[userId]);
  const activity = useApp((s) => s.activities[userId]);
  const friendStatus = useApp((s) => s.friends.find((f) => f.user.id === userId)?.status);
  const guild = useApp((s) => (guildId ? s.guilds[guildId] : undefined));
  const member = guild?.members.find((m) => m.id === userId);
  const [, tick] = useState(0);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api<{ profile: Profile }>(`/users/${userId}/profile`).then(
      (r) => setProfile(r.profile),
      (err) => setError((err as Error).message),
    );
  }, [userId]);

  // reconta "jogando há X min"
  useEffect(() => {
    if (!activity) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [activity]);

  const user = { ...profile?.user, ...live } as Profile['user'] | undefined;
  if (error) return <div className="profile-card"><p className="error">{error}</p></div>;
  if (!user?.id) return <div className="profile-card"><p className="muted small center">Carregando perfil…</p></div>;

  const isMe = userId === meId;
  const status = activeStatus(user);
  const banner = imageUrl(profile?.bannerId);
  const nameColor = guild ? memberColor(guild, userId, 'var(--text)') : 'var(--text)';
  const done = () => onAction?.();

  return (
    <div className="profile-card">
      <div className="profile-banner" style={banner ? { backgroundImage: `url(${banner})` } : { background: user.avatarColor }} />
      <div className="profile-head">
        <span className="profile-avatar">
          <Avatar user={user} size={84} online={online} />
        </span>
        {status && (
          <span className="profile-status-bubble" title={status.expiresAt ? `Até ${new Date(status.expiresAt).toLocaleString('pt-BR', { timeStyle: 'short', dateStyle: 'short' })}` : undefined}>
            {status.emoji} {status.text}
          </span>
        )}
      </div>
      <div className="profile-body">
        <h3 style={{ color: nameColor }}>{user.displayName}</h3>
        <div className="muted small">
          @{user.username}
          {member?.nick && profile && profile.user.displayName !== member.nick ? ` · ${profile.user.displayName}` : ''}
          {profile?.pronouns ? ` · ${profile.pronouns}` : ''}
        </div>

        {activity && (
          <div className="profile-activity">
            <span className="profile-activity-icon">🎮</span>
            <div>
              <strong>Jogando {activity.name}</strong>
              <div className="muted small">{playingFor(activity)}</div>
            </div>
          </div>
        )}

        {profile?.bio && <p className="profile-bio">{profile.bio}</p>}

        {!!profile?.links.length && (
          <div className="profile-links">
            {profile.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="profile-link" title={l.url}>
                <span>{LINK_INFO[l.type]?.icon}</span> {LINK_INFO[l.type]?.label ?? 'Link'}
              </a>
            ))}
          </div>
        )}

        {guild && member && <MemberModeration guild={guild} member={member} compact />}

        {profile && (
          <div className="profile-meta muted small">
            No Resenha desde {sinceFmt.format(new Date(profile.createdAt))}
            {profile.mutualGuilds.length > 0 && (
              <div className="profile-mutual">
                {profile.mutualGuilds.length} servidor{profile.mutualGuilds.length > 1 ? 'es' : ''} em comum:{' '}
                {profile.mutualGuilds.map((g) => g.name).join(', ')}
              </div>
            )}
            {profile.mutualFriends.length > 0 && (
              <div className="profile-mutual row gap-s">
                <span>
                  {profile.mutualFriends.length} amigo{profile.mutualFriends.length > 1 ? 's' : ''} em comum
                </span>
                <span className="avatar-stack">
                  {profile.mutualFriends.slice(0, 5).map((f) => (
                    <Avatar key={f.id} user={f} size={20} />
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="profile-actions">
          {isMe ? (
            <button
              className="btn small"
              onClick={() => {
                done();
                openModal({ kind: 'userSettings' });
              }}
            >
              <Pencil size={15} /> Editar perfil
            </button>
          ) : (
            <>
              <button
                className="btn small primary"
                onClick={() => {
                  done();
                  closeModal();
                  void openDm(userId);
                }}
              >
                <MessageCircle size={15} /> Enviar mensagem
              </button>
              {friendStatus === 'friend' ? (
                <span className="muted small row friend-ok">
                  <UserCheck size={15} /> Amigos
                </span>
              ) : friendStatus === 'outgoing' ? (
                <span className="muted small">Pedido enviado</span>
              ) : (
                <button
                  className="btn small"
                  onClick={async () => {
                    try {
                      const accepted = await sendFriendRequest(user.username);
                      toast(accepted ? 'Vocês agora são amigos!' : 'Pedido de amizade enviado.');
                    } catch (err) {
                      toast((err as Error).message);
                    }
                  }}
                >
                  <UserPlus size={15} /> {friendStatus === 'incoming' ? 'Aceitar amizade' : 'Adicionar amigo'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
