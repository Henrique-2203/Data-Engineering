import { useState, type FormEvent } from 'react';
import { Check, MessageCircle, UserMinus, UserPlus, Users, X } from 'lucide-react';
import type { Friend } from '../../../shared/types';
import { acceptFriend, openDm, removeFriend, sendFriendRequest } from '../lib/social';
import { openModal, toast, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { MobileHeader } from './MobileHeader';

type Tab = 'online' | 'all' | 'pending' | 'add';

export function FriendsView() {
  const friends = useApp((s) => s.friends);
  const online = useApp((s) => s.online);
  const hasGuilds = useApp((s) => s.guildOrder.length > 0);
  const incoming = friends.filter((f) => f.status === 'incoming').length;
  const [tab, setTab] = useState<Tab>(incoming > 0 ? 'pending' : 'online');

  const accepted = friends.filter((f) => f.status === 'friend');
  const list =
    tab === 'online'
      ? accepted.filter((f) => online[f.user.id])
      : tab === 'all'
        ? accepted
        : friends.filter((f) => f.status !== 'friend');

  return (
    <div className="friends">
      <MobileHeader title="Amigos" icon={<Users size={20} className="muted" />} />
      <nav className="friends-tabs" role="tablist">
        {(
          [
            ['online', 'Online'],
            ['all', 'Todos'],
            ['pending', 'Pendentes'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
            {id === 'pending' && incoming > 0 && <span className="count-badge">{incoming}</span>}
          </button>
        ))}
        <button role="tab" className="add-tab" aria-selected={tab === 'add'} onClick={() => setTab('add')}>
          Adicionar amigo
        </button>
      </nav>

      <div className="friends-body">
        {!hasGuilds && tab !== 'add' && (
          <div className="welcome-card">
            <img src="/icon.svg" alt="" width={44} height={44} />
            <div>
              <strong>Bem-vindo à Resenha!</strong>
              <p className="muted">Crie um servidor para a galera ou entre em um com um link de convite.</p>
            </div>
            <div className="row gap">
              <button className="btn primary" onClick={() => openModal({ kind: 'createGuild' })}>Criar servidor</button>
              <button className="btn" onClick={() => openModal({ kind: 'joinGuild' })}>Entrar com convite</button>
            </div>
          </div>
        )}

        {tab === 'add' ? (
          <AddFriend onSent={() => setTab('pending')} />
        ) : (
          <>
            <div className="section-title">
              <span>
                {tab === 'online' ? 'Online' : tab === 'all' ? 'Todos os amigos' : 'Pedidos pendentes'} — {list.length}
              </span>
            </div>
            {list.length === 0 && (
              <p className="muted empty-friends">
                {tab === 'pending'
                  ? 'Nenhum pedido pendente.'
                  : tab === 'online'
                    ? 'Nenhum amigo online agora.'
                    : 'Você ainda não adicionou ninguém. Use "Adicionar amigo" com o nome de usuário da pessoa.'}
              </p>
            )}
            <ul className="friend-list">
              {list.map((f) => (
                <FriendRow key={f.user.id} friend={f} online={!!online[f.user.id]} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function FriendRow({ friend, online }: { friend: Friend; online: boolean }) {
  const { user, status } = friend;
  const subtitle =
    status === 'incoming' ? 'Pedido de amizade recebido' : status === 'outgoing' ? 'Pedido enviado' : online ? 'Online' : 'Offline';
  return (
    <li className="friend-row">
      <Avatar user={user} size={36} online={status === 'friend' ? online : undefined} />
      <div className="friend-name">
        <strong className="ellipsis">{user.displayName}</strong>
        <span className="muted small ellipsis">
          @{user.username} · {subtitle}
        </span>
      </div>
      <div className="friend-actions">
        {status === 'friend' && (
          <>
            <button className="icon-btn round" title="Enviar mensagem" aria-label={`Enviar mensagem para ${user.displayName}`} onClick={() => void openDm(user.id)}>
              <MessageCircle size={18} />
            </button>
            <button
              className="icon-btn round"
              title="Desfazer amizade"
              aria-label={`Desfazer amizade com ${user.displayName}`}
              onClick={() => confirm(`Desfazer amizade com ${user.displayName}?`) && void removeFriend(user.id)}
            >
              <UserMinus size={18} />
            </button>
          </>
        )}
        {status === 'incoming' && (
          <>
            <button className="icon-btn round ok-btn" title="Aceitar" aria-label={`Aceitar ${user.displayName}`} onClick={() => void acceptFriend(user.id)}>
              <Check size={18} />
            </button>
            <button className="icon-btn round" title="Recusar" aria-label={`Recusar ${user.displayName}`} onClick={() => void removeFriend(user.id)}>
              <X size={18} />
            </button>
          </>
        )}
        {status === 'outgoing' && (
          <button className="icon-btn round" title="Cancelar pedido" aria-label={`Cancelar pedido para ${user.displayName}`} onClick={() => void removeFriend(user.id)}>
            <X size={18} />
          </button>
        )}
      </div>
    </li>
  );
}

function AddFriend({ onSent }: { onSent(): void }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const accepted = await sendFriendRequest(username);
      toast(accepted ? 'Vocês agora são amigos!' : `Pedido enviado para @${username.replace(/^@/, '').toLowerCase()}.`);
      setUsername('');
      if (!accepted) onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-friend" onSubmit={submit}>
      <h3>Adicionar amigo</h3>
      <p className="muted">Digite o nome de usuário da pessoa (o que aparece com @ embaixo do nome).</p>
      <div className="copy-row">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="ex.: joao_silva"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Nome de usuário"
          autoFocus
        />
        <button className="btn primary" disabled={busy || !username.trim()}>
          <UserPlus size={16} /> Enviar pedido
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
