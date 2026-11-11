import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Hash, ImagePlus, Phone, Volume2 } from 'lucide-react';
import { WallpaperLayer, useChatWallpaper } from './AppearanceSettings';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { VoiceStage } from './VoiceStage';
import type { Channel, DmChannel, Message } from '../../../shared/types';
import { api } from '../lib/api';
import { channelMessages, findMember, jumpToMessage, openModal, patchMessages, toast, useApp } from '../store/app';
import { ChatHeaderTools } from './Community';
import { Avatar } from './Avatar';
import { MobileHeader } from './MobileHeader';
import { MessageItem } from './chat/MessageItem';
import { Composer, type ComposerHandle } from './chat/Composer';
import { formatDay } from './chat/format';

const GROUP_WINDOW_MS = 5 * 60_000;

export async function loadMessages(channelId: string, older = false) {
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

/** `callPanel`: chat da call (painel ao lado da chamada, num canal de voz). */
export function ChatView({ channel, callPanel }: { channel: Channel; callPanel?: boolean }) {
  const cm = useApp((s) => s.messages[channel.id]);
  const dm = channel.type === 'dm' ? (channel as DmChannel) : null;
  const recipientOnline = useApp((s) => (dm ? !!s.online[dm.recipient.id] : false));
  const connected = useApp((s) => s.connected);
  // ligação ativa nesta DM (alguém na chamada) e se eu estou nela
  const callActive = useApp((s) => !!dm && Object.values(s.voiceStates).some((v) => v.channelId === dm.id));
  const inThisCall = useVoice((s) => !!dm && s.channelId === dm.id && s.status !== 'idle');
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevFirstId = useRef<string | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // carrega ao abrir o canal e ao reconectar (pega o que chegou enquanto estava offline)
  useEffect(() => {
    if (connected || !channelMessages(channel.id).loaded) void loadMessages(channel.id);
  }, [channel.id, connected]);

  useEffect(() => {
    stickToBottom.current = true;
    setReplyTo(null);
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

  // imagens terminando de carregar aumentam a altura: continua colado no fim
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onLoad = () => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, []);

  function onScroll() {
    const el = listRef.current!;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    prevHeight.current = el.scrollHeight;
    if (el.scrollTop < 200 && cm?.hasMore && !cm.loading) void loadMessages(channel.id, true);
  }

  const onReply = useCallback((m: Message) => setReplyTo(m), []);
  const onJump = useCallback((id: string) => jumpToMessage(channel.id, id), [channel.id]);

  // pular até uma mensagem (busca, fixadas, respostas): carrega as mais antigas até achar
  const jumpTo = useApp((s) => (s.jumpTo?.channelId === channel.id ? s.jumpTo : null));
  useEffect(() => {
    if (!jumpTo) return;
    let cancelled = false;
    void (async () => {
      stickToBottom.current = false;
      for (let i = 0; i < 40 && !cancelled; i++) {
        const cm = channelMessages(channel.id);
        if (cm.items.some((m) => m.id === jumpTo.messageId)) break;
        if (cm.loaded && !cm.hasMore) break;
        if (cm.loading) await new Promise((r) => setTimeout(r, 100));
        else await loadMessages(channel.id, cm.loaded);
      }
      if (cancelled) return;
      requestAnimationFrame(() => {
        const el = document.getElementById(`msg-${jumpTo.messageId}`);
        if (!el) toast('Não achei essa mensagem (ela pode ter sido apagada).');
        else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('flash');
          void el.offsetWidth; // reinicia a animação
          el.classList.add('flash');
        }
        useApp.setState({ jumpTo: null });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [jumpTo, channel.id]);

  const items = cm?.items ?? [];
  const wallpaper = useChatWallpaper(channel.id);
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');

  return (
    <div
      className={`chat${callPanel ? ' call-chat' : ''}${wallpaper.choice.kind !== 'none' ? ' has-wallpaper' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composerRef.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      <WallpaperLayer choice={wallpaper.choice} photoKey={wallpaper.photoKey} />
      {dm ? (
        <MobileHeader
          title={dm.recipient.displayName}
          icon={
            <button className="author-avatar" aria-label={`Perfil de ${dm.recipient.displayName}`} onClick={() => openModal({ kind: 'profile', userId: dm.recipient.id })}>
              <Avatar user={dm.recipient} size={26} online={recipientOnline} />
            </button>
          }
          actions={
            <>
              <ChatHeaderTools channel={channel} />
              {!inThisCall && (
              <button
                className="icon-btn"
                aria-label={callActive ? 'Entrar na chamada' : `Ligar para ${dm.recipient.displayName}`}
                title={callActive ? 'Entrar na chamada' : 'Iniciar chamada de voz'}
                onClick={() => void voice.join(dm.id)}
              >
                <Phone size={20} />
              </button>
              )}
            </>
          }
        />
      ) : callPanel ? null : (
        <MobileHeader title={channel.name} icon={<Hash size={20} className="muted" />} showMembersButton actions={<ChatHeaderTools channel={channel} />} />
      )}
      {dm && (callActive || inThisCall) && <VoiceStage channelId={dm.id} embedded />}
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
                <div className="channel-start-icon">{channel.type === 'voice' ? <Volume2 size={36} /> : <Hash size={36} />}</div>
                <h3>{channel.type === 'voice' ? `Chat de ${channel.name}` : `Bem-vindo a #${channel.name}!`}</h3>
                <p className="muted">
                  {channel.type === 'voice'
                    ? 'Mande links, prints e recados para quem está na call. As mensagens continuam aqui depois que a call acabar.'
                    : 'Este é o começo do canal.'}
                </p>
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
            !m.replyTo &&
            prev &&
            prev.author.id === m.author.id &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep"><span>{formatDay(m.createdAt)}</span></div>}
              <MessageItem message={m} grouped={!!grouped} channel={channel} onReply={onReply} onJump={onJump} />
            </Fragment>
          );
        })}
      </div>
      <TypingIndicator channel={channel} />
      <Composer
        ref={composerRef}
        channel={channel}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => (stickToBottom.current = true)}
      />
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={40} />
          <strong>Solte para enviar em {dm ? dm.recipient.displayName : `#${channel.name}`}</strong>
          <span className="muted">Até 4 imagens por mensagem</span>
        </div>
      )}
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
