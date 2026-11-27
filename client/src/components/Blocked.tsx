import { Ban } from 'lucide-react';
import type { PublicUser } from '../../../shared/types';
import { unblockUser } from '../lib/social';
import { openModal, useApp } from '../store/app';
import { Avatar } from './Avatar';

/** no lugar da caixa de mensagem, numa conversa com alguém que EU bloqueei */
export function BlockedGate({ user }: { user: PublicUser }) {
  return (
    <div className="composer-gate" role="status">
      <Ban size={18} />
      <span>
        Você bloqueou @{user.username}. Desbloqueie para voltar a conversar.
      </span>
      <button type="button" className="btn small" onClick={() => void unblockUser(user)}>
        Desbloquear
      </button>
    </div>
  );
}

/** Configurações → Bloqueados */
export function BlockedList() {
  const blocks = useApp((s) => s.blocks);
  return (
    <div className="settings-card">
      <p className="muted small">
        Quem você bloqueia não consegue te mandar mensagem privada, pedido de amizade nem ligar, e você não vê quando a pessoa está online. As mensagens dela nos servidores em comum ficam recolhidas para você. A pessoa <strong>não é avisada</strong>.
        Se ela entrar numa call em que você está (ou se você for entrar numa em que ela está), você recebe um aviso com o @ dela, mesmo que ela troque de nome e foto.
      </p>
      {blocks.length === 0 ? (
        <p className="muted">Você não bloqueou ninguém.</p>
      ) : (
        <ul className="blocked-list">
          {blocks.map((u) => (
            <li key={u.id} className="row gap-s blocked-row">
              <button type="button" className="author-avatar" aria-label={`Perfil de ${u.displayName}`} onClick={() => openModal({ kind: 'profile', userId: u.id })}>
                <Avatar user={u} size={36} />
              </button>
              <span className="grow ellipsis">
                <strong>{u.displayName}</strong> <span className="muted small">@{u.username}</span>
              </span>
              <button type="button" className="btn small" onClick={() => void unblockUser(u)}>
                Desbloquear
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
