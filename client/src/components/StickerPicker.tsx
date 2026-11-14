import { useRef } from 'react';
import type { Expression } from '../../../shared/types';
import { expressionGroups, fileUrl } from '../lib/expressions';
import { openModal, useApp } from '../store/app';
import { Perm, has, myPermissions } from '../lib/perms';
import { useDismiss } from './EmojiPicker';

interface Props {
  guildId?: string | null;
  onPick(sticker: Expression): void;
  onClose(): void;
}

/** Figurinhas de todos os seus servidores (no Discord, usar de outro servidor exige Nitro). */
export function StickerPicker({ guildId, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const guilds = useApp((s) => s.guilds);
  const order = useApp((s) => s.guildOrder);
  const canAdd = useApp((s) => !!guildId && has(myPermissions(s.guilds[guildId], s.me?.id), Perm.MANAGE_EXPRESSIONS));
  const groups = expressionGroups(guilds, order, 'sticker', guildId);

  return (
    <div className="emoji-picker sticker-picker" ref={ref} role="dialog" aria-label="Escolher figurinha">
      {groups.length === 0 && (
        <p className="muted small sticker-empty">
          Nenhuma figurinha ainda.{' '}
          {canAdd ? (
            <button
              className="link-btn"
              onClick={() => {
                onClose();
                openModal({ kind: 'guildSettings', guildId: guildId!, tab: 'expressions' });
              }}
            >
              Adicionar figurinhas
            </button>
          ) : (
            'Quem gerencia o servidor pode adicionar nas configurações.'
          )}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.guild.id} className="emoji-group">
          <div className="emoji-group-title ellipsis">{g.guild.name}</div>
          <div className="sticker-grid">
            {g.items.map((st) => (
              <button
                key={st.id}
                className="sticker-btn"
                aria-label={`Enviar figurinha ${st.name}`}
                title={st.name}
                onClick={() => {
                  onPick(st);
                  onClose();
                }}
              >
                <img src={fileUrl(st.fileId)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
