import type { Activity, ProfileLinkType, PublicUser, UserStatus } from '../../../shared/types';

/** Status ainda válido (o servidor já filtra, mas ele pode expirar com a página aberta). */
export function activeStatus(user: Pick<PublicUser, 'status'> | undefined): UserStatus | null {
  const st = user?.status;
  if (!st || (!st.text && !st.emoji)) return null;
  if (st.expiresAt && new Date(st.expiresAt).getTime() <= Date.now()) return null;
  return st;
}

export function playingFor(activity: Activity): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(activity.startedAt).getTime()) / 60_000));
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  return `há ${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
}

/** Linha curta embaixo do nome: o jogo/música (se tiver) ou o status. */
export function presenceLine(user: Pick<PublicUser, 'status'> | undefined, activity: Activity | undefined): string | null {
  if (activity?.kind === 'music') return `🎵 Ouvindo ${activity.name}${activity.details ? ` · ${activity.details}` : ''}`;
  if (activity) return `🎮 Jogando ${activity.name}`;
  const st = activeStatus(user);
  return st ? `${st.emoji ? `${st.emoji} ` : ''}${st.text}`.trim() : null;
}

export const LINK_INFO: Record<ProfileLinkType, { label: string; icon: string; placeholder: string }> = {
  steam: { label: 'Steam', icon: '🎮', placeholder: 'https://steamcommunity.com/id/…' },
  twitch: { label: 'Twitch', icon: '📺', placeholder: 'https://twitch.tv/…' },
  youtube: { label: 'YouTube', icon: '▶️', placeholder: 'https://youtube.com/@…' },
  instagram: { label: 'Instagram', icon: '📷', placeholder: 'https://instagram.com/…' },
  tiktok: { label: 'TikTok', icon: '🎵', placeholder: 'https://tiktok.com/@…' },
  x: { label: 'X / Twitter', icon: '✖️', placeholder: 'https://x.com/…' },
  spotify: { label: 'Spotify', icon: '🎧', placeholder: 'https://open.spotify.com/user/…' },
  site: { label: 'Site', icon: '🔗', placeholder: 'https://…' },
};
