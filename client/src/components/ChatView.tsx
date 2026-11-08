import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Hash, Pencil, SendHorizontal, Trash2 } from 'lucide-react';
import type { Channel, DmChannel, Message } from '../../../shared/types';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { channelMessages, findMember, patchMessages, toast, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { MobileHeader } from './MobileHeader';

const GROUP_WINDOW_MS = 5 * 60_000;
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

async function loadMessages(channelId: string, older = false) {
  const cm = channelMessages(channelId);
  if (cm.loading || (older && !cm.hasMore)) return;
  patchMessages(channelId, { loading: true });
  try {
    const before = older && cm.items[0] ? `?before=${cm.items[0].id}` : '';
    const res = await api<{ messages: Message[]; hasMore: boolean }>(`/channels/${channelId}/messages${before}`);
    const current = channelMessages(channelId).items;
    const ids = new Set(res.messages.map((m) => m.id));
    patchMessages(channelId, {
      items: older ? [...res.messages, ...current] : [...res.messages, ...current.filter((m) => !ids.has(m.id))],
      hasMore: res.hasMore,
      loaded: true,
      loading: false,
    });
  } catch (err) {
    patchMessages(channelId, { loading: false });
    toast((err as Error).message);
  }
}

export function ChatView({ channel }: { channel: Channel }) {
  const cm = useApp((s) => s.messages[channel.id]);
  const dm = channel.type === 'dm' ? (channel as DmChannel) : null;
  const recipientOnline = useApp((s) => (dm ? !!s.online[dm.recipient.id] : false));
  const connected = useApp((s) => s.connected);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevFirstId = useRef<string | undefined>(undefined);

  // carrega ao abrir o canal e ao reconectar (pega o que chegou enquanto estava offline)
  useEffect(() => {
    if (connected || !channelMessages(channel.id).loaded) void loadMessages(channel.id);
  }, [channel.id, connected]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [channel.id]);

  // mantém a rolagem: no fim quando chegam novas, ou no mesmo lugar ao carregar antigas
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const firstId = cm?.items[0]?.id;
    if (prevFirstId.current && firstId !== prevFirstId.current && !stickToBottom.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirstId.current = firstId;
    prevHeight.current = el.scrollHeight;
  }, [cm?.items]);

  function onScroll() {
    const el = listRef.current!;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    prevHeight.current = el.scrollHeight;
    if (el.scrollTop < 200 && cm?.hasMore && !cm.loading) void loadMessages(channel.id, true);
  }

  const items = cm?.items ?? [];

  return (
    <div className="chat">
      {dm ? (
        <MobileHeader title={dm.recipient.displayName} icon={<Avatar user={dm.recipient} size={26} online={recipientOnline} />} />
      ) : (
        <MobileHeader title={channel.name} icon={<Hash size={20} className="muted" />} showMembersButton />
      )}
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {cm?.loaded && !cm.hasMore && (
          <div className="channel-start">
            {dm ? (
              <>
                <Avatar user={dm.recipient} size={72} />
                <h3>{dm.recipient.displayName}</h3>
                <p className="muted">
                  Este é o começo da sua conversa com <strong>@{dm.recipient.username}</strong>. Só vocês dois veem estas mensagens.
                </p>
              </>
            ) : (
              <>
                <div className="channel-start-icon">
                  <Hash size={36} />
                </div>
                <h3>Bem-vindo a #{channel.name}!</h3>
                <p className="muted">Este é o começo do canal.</p>
              </>
            )}
          </div>
        )}
        {cm?.loading && <div className="muted center small-pad">Carregando…</div>}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped =
            !newDay &&
            prev &&
            prev.author.id === m.author.id &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep"><span>{formatDay(m.createdAt)}</span></div>}
              <MessageItem message={m} grouped={!!grouped} guildId={channel.guildId} />
            </Fragment>
          );
        })}
      </div>
      <TypingIndicator channel={channel} />
      <Composer channel={channel} onSent={() => (stickToBottom.current = true)} />
    </div>
  );
}

function MessageItem({ message, grouped, guildId }: { message: Message; grouped: boolean; guildId: string }) {
  const me = useApp((s) => s.me)!;
  const isOwner = useApp((s) => s.guilds[guildId]?.ownerId === me.id);
  // usa dados atualizados do membro (nome/cor podem ter mudado)
  const author = useApp(() => findMember(guildId, message.author.id)) ?? message.author;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const mine = message.author.id === me.id;

  async function saveEdit() {
    const content = draft.trim();
    setEditing(false);
    if (!content || content === message.content) return;
    try {
      await api(`/messages/${message.id}`, { method: 'PATCH', body: { content } });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm('Excluir esta mensagem?')) return;
    try {
      await api(`/messages/${message.id}`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className={`message${grouped ? ' grouped' : ''}`} tabIndex={-1}>
      {grouped ? (
        <span className="message-time-gutter">{formatTime(message.createdAt)}</span>
      ) : (
        <Avatar user={author} size={40} />
      )}
      <div className="message-body">
        {!grouped && (
          <div className="message-head">
            <strong style={{ color: author.avatarColor }}>{author.displayName}</strong>
            <span className="muted small">{formatDateTime(message.createdAt)}</span>
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="small muted">
              Enter para salvar · Esc para cancelar ·{' '}
              <button className="link-btn" onClick={() => void saveEdit()}>salvar</button>
            </div>
          </div>
        ) : (
          <div className="message-content">
            {renderContent(message.content)}
            {message.editedAt && <span className="muted small"> (editada)</span>}
          </div>
        )}
      </div>
      {!editing && (mine || isOwner) && (
        <div className="message-actions">
          {mine && (
            <button className="icon-btn small" aria-label="Editar" title="Editar" onClick={() => { setDraft(message.content); setEditing(true); }}>
              <Pencil size={15} />
            </button>
          )}
          <button className="icon-btn small" aria-label="Excluir" title="Excluir" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Composer({ channel, onSent }: { channel: Channel; onSent(): void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    setText('');
    if (!isTouch()) ref.current?.focus();
  }, [channel.id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await api(`/channels/${channel.id}/messages`, { body: { content } });
      setText('');
      onSent();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSending(false);
      if (!isTouch()) ref.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      void send();
    }
  }

  function onChange(value: string) {
    setText(value);
    const now = Date.now();
    if (value && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      getSocket()?.emit('typing', { guildId: channel.guildId || undefined, channelId: channel.id });
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={channel.type === 'dm' ? `Conversar com ${channel.name}` : `Conversar em #${channel.name}`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={4000}
        enterKeyHint="send"
      />
      <button className="icon-btn send-btn" aria-label="Enviar" disabled={!text.trim() || sending} onClick={() => void send()}>
        <SendHorizontal size={20} />
      </button>
    </div>
  );
}

function TypingIndicator({ channel }: { channel: Channel }) {
  const typing = useApp((s) => s.typing[channel.id]);
  const meId = useApp((s) => s.me?.id);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const names = Object.entries(typing ?? {})
    .filter(([id, exp]) => exp > now && id !== meId)
    .map(([id]) => findMember(channel.guildId, id)?.displayName ?? 'Alguém');
  return (
    <div className="typing">
      {names.length > 0 && (
        <>
          <span className="typing-dots"><i /><i /><i /></span>
          <strong>{names.slice(0, 3).join(', ')}</strong>
          {names.length === 1 ? ' está digitando…' : ' estão digitando…'}
        </>
      )}
    </div>
  );
}

// ---------- formatação ----------

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;

function renderContent(text: string): ReactNode[] {
  const parts = text.split(URL_RE);
  const out: ReactNode[] = [];
  const images: string[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <a key={i} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </a>,
      );
      if (IMG_RE.test(part)) images.push(part);
    } else if (part) {
      out.push(<Fragment key={i}>{part}</Fragment>);
    }
  });
  for (const src of images.slice(0, 4)) {
    out.push(
      <a key={`img-${src}`} className="message-image" href={src} target="_blank" rel="noopener noreferrer">
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </a>,
    );
  }
  return out;
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

function formatTime(iso: string) {
  return timeFmt.format(new Date(iso));
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dayFmt.format(d);
}

function formatDateTime(iso: string) {
  const day = formatDay(iso);
  const prefix = day === 'Hoje' || day === 'Ontem' ? day : new Date(iso).toLocaleDateString('pt-BR');
  return `${prefix} às ${formatTime(iso)}`;
}
