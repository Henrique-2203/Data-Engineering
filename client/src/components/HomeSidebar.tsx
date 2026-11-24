import { AtSign, Gamepad2, MessageSquare, Music, Phone, UserPlus, Users, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PublicUser } from '../../../shared/types';
import { openDm } from '../lib/social';
import { selectChannel, selectGuild } from '../store/app';
import { goHome, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { useNovoLayout } from '../lib/layoutMode';
import { tabDrag } from './NovoLayout';

/** Barra lateral do Início: atalho para Amigos e a lista de conversas diretas. */
export function HomeSidebar() {
  const selected = useApp((s) => s.selectedChannelId);
  const novo = useNovoLayout();
  const dmOrder = useApp((s) => s.dmOrder);
  const dms = useApp((s) => s.dms);
  const online = useApp((s) => s.online);
  const unread = useApp((s) => s.unread);
  const voiceStates = useApp((s) => s.voiceStates);
  const inCall = new Set(Object.values(voiceStates).filter((v) => !v.guildId).map((v) => v.channelId));
  const incoming = useApp((s) => s.friends.filter((f) => f.status === 'incoming').length);

  return (
    <>
      <OnlineFriends />
      <Happening />
      <div className={`channel home-item${selected === null ? ' active' : ''}`}>
        <button className="channel-main" onClick={() => goHome(null)}>
          <Users size={20} className="channel-icon" />
          <span className="ellipsis">Amigos</span>
          {incoming > 0 && <span className="count-badge">{incoming}</span>}
        </button>
      </div>

      <div className="section-title">
        <span>Mensagens diretas</span>
      </div>
      {dmOrder.length === 0 && <p className="muted small dm-empty">Suas conversas aparecem aqui.</p>}
      {dmOrder.map((id) => {
        const dm = dms[id];
        if (!dm) return null;
        return (
          <div key={id} className={`channel dm-item${selected === id ? ' active' : ''}${unread[id] ? ' unread' : ''}`} {...tabDrag(id, novo)}>
            <button className="channel-main" onClick={() => goHome(id)}>
              <Avatar user={dm.recipient} size={30} online={!!online[dm.recipient.id]} />
              <span className="ellipsis">{dm.recipient.displayName}</span>
              {inCall.has(id) && (
                <span className="dm-call" title="Chamada em andamento" aria-label="Chamada em andamento">
                  <Phone size={14} />
                </span>
              )}
              {!!unread[id] && (
                <span className="count-badge" aria-label={`${unread[id] >= 100 ? 'mais de 99' : unread[id]} mensagens não lidas`}>
                  {unread[id] >= 100 ? '99+' : unread[id]}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** Amigos online agora, numa fileira (toque abre a conversa). Quem está em call ou jogando vem primeiro. */
function OnlineFriends() {
  const friends = useApp((s) => s.friends);
  const online = useApp((s) => s.online);
  const activities = useApp((s) => s.activities);
  const voiceStates = useApp((s) => s.voiceStates);
  const inVoice = new Set(Object.values(voiceStates).map((v) => v.userId));
  const list = friends
    .filter((f) => f.status === 'friend' && online[f.user.id])
    .map((f) => f.user)
    .sort((a, b) => Number(inVoice.has(b.id)) - Number(inVoice.has(a.id)) || Number(!!activities[b.id]) - Number(!!activities[a.id]));
  if (!list.length) return null;
  return (
    <section className="home-online" aria-label="Amigos online">
      <div className="section-title">
        <span>Online agora — {list.length}</span>
      </div>
      <div className="home-online-row">
        {list.slice(0, 20).map((u) => (
          <button key={u.id} className="home-online-item" title={u.displayName} aria-label={`Conversar com ${u.displayName}`} onClick={() => void openDm(u.id)}>
            <span className="home-online-av">
              <Avatar user={u} size={48} online />
              {inVoice.has(u.id) ? (
                <span className="home-online-tag voice" aria-label="em call"><Volume2 size={11} strokeWidth={2.8} /></span>
              ) : activities[u.id] ? (
                <span className="home-online-tag" aria-label="jogando ou ouvindo">{activities[u.id].kind === 'music' ? <Music size={11} /> : <Gamepad2 size={11} />}</span>
              ) : null}
            </span>
            <span className="ellipsis">{u.displayName.split(' ')[0]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

interface Item {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  sub?: string;
  people?: PublicUser[];
  tone?: 'voice' | 'mention' | 'friend';
  onClick(): void;
}

/** Prévia do que está rolando: calls com gente, menções, mensagens novas, amigos jogando e pedidos de amizade. */
export function Happening({ empty }: { empty?: ReactNode } = {}) {
  const guilds = useApp((s) => s.guilds);
  const guildOrder = useApp((s) => s.guildOrder);
  const voiceStates = useApp((s) => s.voiceStates);
  const mentions = useApp((s) => s.mentions);
  const unread = useApp((s) => s.unread);
  const friends = useApp((s) => s.friends);
  const online = useApp((s) => s.online);
  const activities = useApp((s) => s.activities);
  const me = useApp((s) => s.me);
  const items: Item[] = [];

  // calls com gente nos meus servidores
  const byChannel = new Map<string, PublicUser[]>();
  for (const v of Object.values(voiceStates)) {
    if (!v.guildId || !guilds[v.guildId]) continue;
    const u = guilds[v.guildId].members.find((m) => m.id === v.userId);
    if (!u) continue;
    const arr = byChannel.get(v.channelId) ?? [];
    if (!arr.some((x) => x.id === u.id)) arr.push(u);
    byChannel.set(v.channelId, arr);
  }
  for (const gid of guildOrder) {
    const g = guilds[gid];
    if (!g) continue;
    for (const c of g.channels) {
      const people = byChannel.get(c.id);
      if (!people?.length) continue;
      const mine = people.some((p) => p.id === me?.id);
      items.push({
        key: `v${c.id}`,
        icon: <Volume2 size={18} />,
        tone: 'voice',
        title: <><strong>{c.name}</strong> · {g.name}</>,
        sub: mine ? 'Você está nesta call' : `${people.length} ${people.length > 1 ? 'pessoas' : 'pessoa'} na call`,
        people,
        onClick: () => selectChannel(c.id),
      });
    }
  }
  // menções e mensagens novas por servidor
  for (const gid of guildOrder) {
    const g = guilds[gid];
    if (!g) continue;
    const m = g.channels.reduce((n, c) => n + (mentions[c.id] ?? 0), 0);
    const u = g.channels.reduce((n, c) => n + (unread[c.id] ?? 0), 0);
    if (m > 0) {
      const ch = g.channels.find((c) => mentions[c.id]);
      items.push({
        key: `m${gid}`,
        icon: <AtSign size={18} />,
        tone: 'mention',
        title: <>Te mencionaram em <strong>{g.name}</strong></>,
        sub: `${m} ${m > 1 ? 'menções' : 'menção'}${ch ? ` · #${ch.name}` : ''}`,
        onClick: () => (ch ? selectChannel(ch.id) : selectGuild(gid)),
      });
    } else if (u > 0) {
      items.push({
        key: `u${gid}`,
        icon: <MessageSquare size={18} />,
        title: <><strong>{g.name}</strong></>,
        sub: `${u > 99 ? '99+' : u} ${u > 1 ? 'mensagens novas' : 'mensagem nova'}`,
        onClick: () => selectGuild(gid),
      });
    }
  }
  // pedidos de amizade
  const incoming = friends.filter((f) => f.status === 'incoming');
  if (incoming.length) {
    items.push({
      key: 'fr',
      icon: <UserPlus size={18} />,
      tone: 'friend',
      title: <>{incoming.length > 1 ? `${incoming.length} pedidos de amizade` : <><strong>{incoming[0].user.displayName}</strong> quer ser seu amigo</>}</>,
      people: incoming.map((f) => f.user),
      onClick: () => goHome(null),
    });
  }
  // amigos jogando ou ouvindo (fora de call)
  const inVoice = new Set(Object.values(voiceStates).map((v) => v.userId));
  for (const f of friends) {
    const a = activities[f.user.id];
    if (f.status !== 'friend' || !online[f.user.id] || !a || inVoice.has(f.user.id)) continue;
    items.push({
      key: `a${f.user.id}`,
      icon: a.kind === 'music' ? <Music size={18} /> : <Gamepad2 size={18} />,
      title: <><strong>{f.user.displayName}</strong> {a.kind === 'music' ? 'está ouvindo' : 'está jogando'} {a.name}</>,
      sub: a.kind === 'music' && a.details ? a.details : undefined,
      people: [f.user],
      onClick: () => void openDm(f.user.id),
    });
  }
  if (!items.length) return empty ? <>{empty}</> : null;
  return (
    <section className="home-happening" aria-label="Acontecendo agora">
      <div className="section-title">
        <span>Acontecendo agora</span>
      </div>
      <ul>
        {items.slice(0, 8).map((it) => (
          <li key={it.key}>
            <button className={`happening-item${it.tone ? ` ${it.tone}` : ''}`} onClick={it.onClick}>
              <span className="happening-icon">{it.icon}</span>
              <span className="happening-text">
                <span className="ellipsis">{it.title}</span>
                {it.sub && <span className="muted small ellipsis">{it.sub}</span>}
              </span>
              {it.people && it.people.length > 0 && (
                <span className="happening-people" aria-hidden>
                  {it.people.slice(0, 3).map((p) => (
                    <Avatar key={p.id} user={p} size={24} />
                  ))}
                  {it.people.length > 3 && <span className="happening-more">+{it.people.length - 3}</span>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
