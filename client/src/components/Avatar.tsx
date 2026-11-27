import type { CSSProperties } from 'react';
import type { FounderRing, PublicUser } from '../../../shared/types';

interface Props {
  user: (Pick<PublicUser, 'displayName' | 'avatarColor'> & { avatarId?: string | null; ring?: FounderRing | null }) | undefined;
  size?: number;
  online?: boolean;
  speaking?: boolean;
  /** prévia: mostra este anel no lugar do da pessoa (null = sem anel) */
  ring?: FounderRing | null;
}

/** folhinha do Resenha (no anel Selo) */
const Leaf = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14Z" fill="#06281a" />
    <path d="M5 19 13 11" stroke="#f5b301" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Anel de Fundador em volta da foto (só vem do servidor para quem teve o apoio confirmado). */
export function FounderRingMark({ ring, size }: { ring: FounderRing; size: number }) {
  return (
    <span className={`founder-ring fr-${ring}`} aria-hidden>
      {ring === 'selo' && size >= 40 && (
        <span className="fr-leaf">
          <Leaf />
        </span>
      )}
    </span>
  );
}

/** Foto de perfil (inclusive GIF) ou, sem foto, a inicial na cor escolhida. */
export function Avatar({ user, size = 32, online, speaking, ring: preview }: Props) {
  const initial = (user?.displayName ?? '?').trim().charAt(0).toUpperCase() || '?';
  const ring = preview !== undefined ? preview : user?.ring;
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}${ring ? ' has-ring' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.45, background: user?.avatarColor ?? '#555', '--av': `${size}px` } as CSSProperties}
      aria-hidden
    >
      {user?.avatarId ? <img src={`/api/images/${user.avatarId}`} alt="" className="avatar-img" loading="lazy" draggable={false} /> : initial}
      {ring && <FounderRingMark ring={ring} size={size} />}
      {online !== undefined && <span className={`presence ${online ? 'on' : 'off'}`} />}
    </span>
  );
}
