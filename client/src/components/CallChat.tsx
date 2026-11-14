import { useEffect, useRef, useState } from 'react';
import { Hash, Lock, MessageSquare, SendHorizontal, Trash2, Tv, X } from 'lucide-react';
import type { CallChatMessage, Channel } from '../../../shared/types';
import { findMember, toast, useApp } from '../store/app';
import { useVoice } from '../store/voice';
import { callChat } from '../voice/callChat';
import { encodeEmojis } from '../lib/expressions';
import { memberColor } from '../lib/perms';
import { Avatar } from './Avatar';
import { ChatView } from './ChatView';
import { LinkEmbeds } from './chat/LinkEmbed';
import { renderContent } from './chat/format';

type Tab = 'call' | 'channel';
const TAB_KEY = 'resenha.callChatTab';

const readTab = (): Tab => {
  try {
    return localStorage.getItem(TAB_KEY) === 'channel' ? 'channel' : 'call';
  } catch {
    return 'call';
  }
};

/**
 * Painel ao lado da call: o chat privado (só quem está na call, nada fica salvo) e o chat do canal
 * de voz (salvo, para quem tem acesso ao canal).
 */
export function CallChatPanel({ channel, onClose }: { channel: Channel; onClose(): void }) {
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* sem armazenamento */
    }
  };
  // a busca/fixadas levam a uma mensagem salva: mostra o chat do canal
  useEffect(() => {
    const open = () => setTab('channel');
    window.addEventListener('resenha:open-call-chat', open);
    return () => window.removeEventListener('resenha:open-call-chat', open);
  }, []);
  const privateCount = useVoice((s) => s.callChat.length);
  const [seenPrivate, setSeenPrivate] = useState(privateCount);
  useEffect(() => {
    if (tab === 'call') setSeenPrivate(privateCount);
  }, [tab, privateCount]);
  const freshPrivate = tab === 'call' ? 0 : Math.max(0, privateCount - seenPrivate);

  return (
    <div className="call-chat-panel">
      <div className="call-chat-head">
        <MessageSquare size={18} />
        <div className="call-chat-tabs" role="tablist" aria-label="Chat da call">
          <button role="tab" aria-selected={tab === 'call'} className={tab === 'call' ? 'active' : ''} onClick={() => setTab('call')}>
            <Lock size={13} /> Só da call
            {freshPrivate > 0 && <span className="badge-count inline">{freshPrivate > 9 ? '9+' : freshPrivate}</span>}
          </button>
          <button role="tab" aria-selected={tab === 'channel'} className={tab === 'channel' ? 'active' : ''} onClick={() => setTab('channel')}>
            <Hash size={13} /> Canal
          </button>
        </div>
        <button className="icon-btn" aria-label="Fechar o chat da call" title="Fechar" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {tab === 'call' ? <PrivateCallChat channel={channel} /> : <ChatView channel={channel} callPanel />}
    </div>
  );
}

function PrivateCallChat({ channel }: { channel: Channel }) {
  const joined = useVoice((s) => s.status === 'connected' && s.channelId === channel.id);
  const messages = useVoice((s) => s.callChat);
  const me = useApp((s) => s.me)!;
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const r = await callChat.send(encodeEmojis(text, channel.guildId));
    setSending(false);
    if (!r.ok) return toast(r.error ?? 'Não deu para mandar.');
    stick.current = true;
    setDraft('');
  }

  if (!joined)
    return (
      <div className="call-private-empty">
        <Lock size={28} />
        <p>
          <strong>Chat só de quem está na call.</strong>
        </p>
        <p className="muted small">Entre na call para conversar com quem está nela. As mensagens não ficam salvas.</p>
      </div>
    );

  return (
    <div className="call-private">
      <div className="call-private-note" role="note">
        <Lock size={13} /> Só quem está na call vê. Nada fica salvo: some quando a call acabar.
      </div>
      <div
        className="call-private-list"
        ref={listRef}
        aria-live="polite"
        aria-label="Mensagens do chat privado da call"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {messages.length === 0 && (
          <p className="muted small call-private-hint">Ninguém escreveu ainda. Mande um link do YouTube ou do Spotify para ouvir ou assistir junto.</p>
        )}
        {messages.map((m, i) => (
          <PrivateMessage key={m.id} m={m} prev={messages[i - 1]} channel={channel} mine={m.userId === me.id} meUsername={me.username} />
        ))}
      </div>
      <form
        className="call-private-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          rows={1}
          maxLength={1000}
          placeholder="Mensagem só para a call"
          aria-label="Mensagem só para quem está na call"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="icon-btn" type="submit" aria-label="Enviar na call" disabled={!draft.trim() || sending}>
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function PrivateMessage({ m, prev, channel, mine, meUsername }: { m: CallChatMessage; prev?: CallChatMessage; channel: Channel; mine: boolean; meUsername: string }) {
  const author = useApp(() => findMember(channel.guildId, m.userId));
  const color = useApp((s) => memberColor(s.guilds[channel.guildId], m.userId, author?.avatarColor ?? 'var(--text)'));
  const name = author?.displayName ?? 'Alguém';
  if (m.kind === 'together')
    return (
      <div className="call-private-event">
        <Tv size={14} /> <span>
          <strong>{mine ? 'Você' : name}</strong> colocou <strong>{m.content}</strong> para assistir junto
        </span>
        <span className="muted small">{time(m.at)}</span>
      </div>
    );
  const grouped = !!prev && prev.kind !== 'together' && prev.userId === m.userId && m.at - prev.at < 5 * 60_000;
  return (
    <div className={`message call-private-msg${grouped ? ' grouped' : ''}`}>
      {grouped ? (
        <span className="message-time-gutter">{time(m.at)}</span>
      ) : (
        <span className="author-avatar">{author ? <Avatar user={author} size={32} /> : null}</span>
      )}
      <div className="message-body">
        {!grouped && (
          <div className="message-head">
            <span className="author-name" style={{ color }}>
              {name}
            </span>
            <span className="muted small">{time(m.at)}</span>
          </div>
        )}
        <div className="message-content">{renderContent(m.content, { meUsername, everyone: false })}</div>
        <LinkEmbeds content={m.content} />
      </div>
      {mine && (
        <div className="message-actions">
          <button className="icon-btn" aria-label="Apagar mensagem" title="Apagar" onClick={() => callChat.remove(m.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
