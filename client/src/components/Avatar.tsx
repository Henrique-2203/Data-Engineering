import type { PublicUser } from '../../../shared/types';

interface Props {
  user: (Pick<PublicUser, 'displayName' | 'avatarColor'> & { avatarId?: string | null }) | undefined;
  size?: number;
  online?: boolean;
  speaking?: boolean;
}

/** Foto de perfil (inclusive GIF) ou, sem foto, a inicial na cor escolhida. */
export function Avatar({ user, size = 32, online, speaking }: Props) {
  const initial = (user?.displayName ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.45, background: user?.avatarColor ?? '#555' }}
      aria-hidden
    >
      {user?.avatarId ? <img src={`/api/images/${user.avatarId}`} alt="" className="avatar-img" loading="lazy" draggable={false} /> : initial}
      {online !== undefined && <span className={`presence ${online ? 'on' : 'off'}`} />}
    </span>
  );
}
