import { Fragment, memo, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { BotTag, EmbedView } from '../Bots';
import { createPortal } from 'react-dom';
import { Copy, CornerUpLeft, Flag, Image as ImageIcon, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2, X } from 'lucide-react';
import { PollView, togglePin, useCanPin } from '../Community';
import { LinkEmbeds } from './LinkEmbed';
import type { Channel, Message, StickerRef } from '../../../../shared/types';
import { EmojiView, encodeEmojis, fileUrl, plainEmojis, renderCustomEmojis } from '../../lib/expressions';
import { api } from '../../lib/api';
import { encodeChannels, plainChannels } from '../../lib/channelMentions';
import { mentionsUser } from '../../lib/mentions';
import { AttachmentList } from './Attachments';
import { findMember, openModal, toast, updateReactions, useApp } from '../../store/app';
import { memberColor } from '../../lib/perms';
import { Avatar } from '../Avatar';
import { EmojiPicker } from '../EmojiPicker';
import { formatDateTime, formatTime, renderContent } from './format';
import { askConfirm } from '../../lib/ask';

interface Props {
  message: Message;
  grouped: boolean;
  channel: Channel;
  onReply(message: Message): void;
  onJump(messageId: string): void;
}

export async function toggleReaction(message: Message, emoji: string) {
  try {
    const res = await api<{ reactions: Message['reactions'] }>(`/messages/${message.id}/reactions`, { body: { emoji } });
    updateReactions(message.channelId, message.id, res.reactions);
  } catch (err) {
    toast((err as Error).message);
  }
}

/** celular/tablet: sem mouse, as ações abrem segurando a mensagem (como no WhatsApp e no Discord) */
const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;

/** Segurar ~0,45 s abre o menu. Arrastar (rolar a tela) ou soltar antes cancela. */
function useLongPress(onLong: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType !== 'touch') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        start.current = null;
        navigator.vibrate?.(12);
        onLong();
      }, 450);
    },
    onPointerMove: (e: RPointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: { preventDefault(): void }) => {
      if (isTouch()) e.preventDefault();
    },
  };
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export const MessageItem = memo(function MessageItem({ message, grouped, channel, onReply, onJump }: Props) {
  const me = useApp((s) => s.me)!;
  const isOwner = useApp((s) => !!channel.guildId && s.guilds[channel.guildId]?.ownerId === me.id);
  // usa dados atualizados do membro (nome/cor podem ter mudado)
  const author = useApp(() => findMember(channel.guildId, message.author.id)) ?? message.author;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plainChannels(plainEmojis(message.content)));
  const [picker, setPicker] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [reveal, setReveal] = useState(false);
  const blockedAuthor = useApp((s) => message.author.id !== s.me?.id && s.blocks.some((b) => b.id === message.author.id));
  const press = useLongPress(() => setSheet(true));
  const editRef = useRef<HTMLTextAreaElement>(null);
  const mine = message.author.id === me.id;
  const nameColor = useApp((s) => memberColor(s.guilds[channel.guildId], message.author.id, author.avatarColor));
  const inGuild = channel.type === 'text';
  const mentioned = !mine && mentionsUser(message.content, me.username, message.mentionEveryone);
  const canPin = useCanPin(channel);

  async function saveEdit() {
    const content = encodeChannels(encodeEmojis(draft.trim(), channel.guildId), channel.guildId);
    setEditing(false);
    if (content === message.content || (!content && message.attachments.length === 0)) return;
    try {
      await api(`/messages/${message.id}`, { method: 'PATCH', body: { content } });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function startEdit() {
    setDraft(plainChannels(plainEmojis(message.content)));
    setEditing(true);
  }
  // a caixa de edição cresce com o texto e fica à vista (no celular o teclado sobe por cima)
  useEffect(() => {
    const el = editRef.current;
    if (!editing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 280)}px`;
  }, [editing, draft]);
  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.setSelectionRange(el.value.length, el.value.length);
    window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  }, [editing]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(plainChannels(plainEmojis(message.content)));
      toast('Texto copiado');
    } catch {
      toast('Não deu para copiar');
    }
  }

  async function remove() {
    if (!(await askConfirm('Excluir esta mensagem?'))) return;
    try {
      await api(`/messages/${message.id}`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  if (message.system === 'join') return <JoinLine message={message} channel={channel} name={author.displayName} />;

  // pessoa que EU bloqueei: a mensagem fica recolhida (dá para mostrar caso a caso)
  if (blockedAuthor && !reveal) {
    return (
      <div id={`msg-${message.id}`} className="message blocked-msg" tabIndex={-1}>
        <span className="muted small">
          Mensagem de @{message.author.username}, que você bloqueou.{' '}
          <button type="button" className="link-btn" onClick={() => setReveal(true)}>
            Mostrar
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`message${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${message.pinnedAt ? ' pinned' : ''}${sheet ? ' pressed' : ''}`}
      tabIndex={-1}
      {...(editing ? {} : press)}
    >
      {message.replyTo && <ReplyLine reply={message.replyTo} channel={channel} onJump={onJump} />}
      {grouped ? (
        <span className="message-time-gutter">{formatTime(message.createdAt)}</span>
      ) : (
        <button className="author-avatar" aria-label={`Perfil de ${author.displayName}`} onClick={() => openModal({ kind: 'profile', userId: author.id, guildId: channel.guildId || null })}>
          <Avatar user={author} size={40} />
        </button>
      )}
      <div className="message-body">
        {message.interaction && (
          <div className="interaction-line">
            ↪ <strong>{message.interaction.displayName}</strong> usou <code>/{message.interaction.command}</code>
          </div>
        )}
        {!grouped && (
          <div className="message-head">
            <button className="author-name" style={{ color: nameColor }} onClick={() => openModal({ kind: 'profile', userId: author.id, guildId: channel.guildId || null })}>
              {author.displayName}
            </button>
            {author.bot && <BotTag />}
            <span className="muted small">{formatDateTime(message.createdAt)}</span>
            {message.pinnedAt && (
              <span className="pinned-tag" title="Mensagem fixada">
                <Pin size={12} /> fixada
              </span>
            )}
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea
              ref={editRef}
              value={draft}
              autoFocus
              aria-label="Editar mensagem"
              enterKeyHint={isTouch() ? 'enter' : 'done'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // no computador Enter salva; no celular o Enter pula linha e quem salva é o botão
                if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="edit-actions">
              <span className="small muted edit-hint">Enter para salvar · Esc para cancelar</span>
              <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button type="button" className="btn primary small" onClick={() => void saveEdit()}>
                Salvar
              </button>
            </div>
          </div>
        ) : (
          message.content && (
            <div className="message-content">
              {renderContent(message.content, { meUsername: me.username, everyone: message.mentionEveryone })}
              {message.editedAt && <span className="muted small"> (editada)</span>}
            </div>
          )
        )}

        {message.content && !editing && <LinkEmbeds content={message.content} />}

        {message.embeds?.map((e, i) => <EmbedView key={i} embed={e} />)}

        {message.poll && <PollView message={message} channel={channel} />}

        {message.sticker && <StickerView sticker={message.sticker} />}

        {message.attachments.length > 0 && <AttachmentList attachments={message.attachments} />}

        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((r) => {
              const mineR = r.userIds.includes(me.id);
              const names = r.userIds.map((id) => (id === me.id ? 'você' : (findMember(channel.guildId, id)?.displayName ?? 'alguém')));
              return (
                <button
                  key={r.emoji}
                  className={`reaction${mineR ? ' mine' : ''}`}
                  title={`${names.join(', ')} reagiu com ${plainEmojis(r.emoji)}`}
                  aria-label={`${plainEmojis(r.emoji)} ${r.userIds.length}${mineR ? ', você reagiu' : ''}`}
                  aria-pressed={mineR}
                  onClick={() => void toggleReaction(message, r.emoji)}
                >
                  <span className="reaction-emoji"><EmojiView emoji={r.emoji} /></span> {r.userIds.length}
                </button>
              );
            })}
            <button className="reaction add" aria-label="Adicionar reação" title="Adicionar reação" onClick={() => setPicker(true)}>
              <SmilePlus size={15} />
            </button>
          </div>
        )}
      </div>

      {!editing && (
        <div className={`message-actions${picker ? ' open' : ''}`}>
          <button className="icon-btn small" data-picker-toggle aria-label="Reagir" title="Reagir" onClick={() => setPicker((v) => !v)}>
            <SmilePlus size={15} />
          </button>
          <button className="icon-btn small" aria-label="Responder" title="Responder" onClick={() => onReply(message)}>
            <Reply size={15} />
          </button>
          {canPin && (
            <button
              className="icon-btn small"
              aria-label={message.pinnedAt ? 'Desafixar' : 'Fixar'}
              title={message.pinnedAt ? 'Desafixar mensagem' : 'Fixar mensagem'}
              onClick={() => void togglePin(message)}
            >
              {message.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
          {mine && (
            <button
              className="icon-btn small"
              aria-label="Editar"
              title="Editar"
              onClick={startEdit}
            >
              <Pencil size={15} />
            </button>
          )}
          {!mine && (
            <button
              className="icon-btn small"
              aria-label="Denunciar"
              title="Denunciar"
              onClick={() =>
                openModal({
                  kind: 'report',
                  target: { type: 'message', id: message.id, label: `${author.displayName}: ${plainEmojis(message.content).slice(0, 120) || (message.sticker ? 'figurinha' : 'anexo')}` },
                })
              }
            >
              <Flag size={15} />
            </button>
          )}
          {(mine || isOwner) && (
            <button className="icon-btn small" aria-label="Excluir" title="Excluir" onClick={() => void remove()}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
      {sheet &&
        createPortal(
          <div className="msg-sheet-backdrop" onClick={() => setSheet(false)}>
            <div className="msg-sheet" role="dialog" aria-label="Ações da mensagem" onClick={(e) => e.stopPropagation()}>
              <div className="msg-sheet-grab" aria-hidden />
              <div className="msg-sheet-preview">
                <strong>{author.displayName}</strong>
                <span className="ellipsis muted">{plainEmojis(message.content).slice(0, 120) || (message.sticker ? 'Figurinha' : message.attachments.length ? 'Anexo' : '')}</span>
              </div>
              <div className="msg-sheet-reacts" role="group" aria-label="Reagir">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={`Reagir com ${e}`}
                    onClick={() => {
                      setSheet(false);
                      void toggleReaction(message, e);
                    }}
                  >
                    {e}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Mais reações"
                  onClick={() => {
                    setSheet(false);
                    setPicker(true);
                  }}
                >
                  <SmilePlus size={22} />
                </button>
              </div>
              <div className="msg-sheet-list">
                <button type="button" onClick={() => (setSheet(false), onReply(message))}>
                  <Reply size={20} /> Responder
                </button>
                {message.content && (
                  <button type="button" onClick={() => (setSheet(false), void copyText())}>
                    <Copy size={20} /> Copiar texto
                  </button>
                )}
                {mine && message.content !== undefined && !message.poll && (
                  <button type="button" onClick={() => (setSheet(false), startEdit())}>
                    <Pencil size={20} /> Editar
                  </button>
                )}
                {canPin && (
                  <button type="button" onClick={() => (setSheet(false), void togglePin(message))}>
                    {message.pinnedAt ? <PinOff size={20} /> : <Pin size={20} />} {message.pinnedAt ? 'Desafixar' : 'Fixar'}
                  </button>
                )}
                {!mine && (
                  <button
                    type="button"
                    onClick={() => {
                      setSheet(false);
                      openModal({
                        kind: 'report',
                        target: { type: 'message', id: message.id, label: `${author.displayName}: ${plainEmojis(message.content).slice(0, 120) || (message.sticker ? 'figurinha' : 'anexo')}` },
                      });
                    }}
                  >
                    <Flag size={20} /> Denunciar
                  </button>
                )}
                {(mine || isOwner) && (
                  <button type="button" className="danger" onClick={() => (setSheet(false), void remove())}>
                    <Trash2 size={20} /> Excluir
                  </button>
                )}
              </div>
              <button type="button" className="msg-sheet-close" onClick={() => setSheet(false)}>
                <X size={18} /> Fechar
              </button>
            </div>
          </div>,
          document.body,
        )}
      {picker && (
        <div className="message-picker">
          <EmojiPicker guildId={channel.guildId} onPick={(e) => void toggleReaction(message, e)} onClose={() => setPicker(false)} />
        </div>
      )}
    </div>
  );
});

function ReplyLine({ reply, channel, onJump }: { reply: NonNullable<Message['replyTo']>; channel: Channel; onJump(id: string): void }) {
  const author = useApp(() => (reply.deleted ? undefined : findMember(channel.guildId, reply.author.id))) ?? (reply.deleted ? undefined : reply.author);
  return (
    <button className="reply-line" onClick={() => !reply.deleted && onJump(reply.id)} disabled={reply.deleted}>
      <CornerUpLeft size={14} className="reply-icon" />
      {reply.deleted || !author ? (
        <span className="muted">Mensagem original apagada</span>
      ) : (
        <>
          <Avatar user={author} size={16} />
          <strong style={{ color: author.avatarColor }}>{author.displayName}</strong>
          <span className="ellipsis muted">
            {reply.content ? (
              renderCustomEmojis(plainChannels(reply.content), 'r', (t, key) => [<Fragment key={key}>{t}</Fragment>])
            ) : reply.hasAttachments ? (
              <>
                <ImageIcon size={13} /> Anexo
              </>
            ) : reply.hasSticker ? (
              'Figurinha'
            ) : (
              ''
            )}
          </span>
        </>
      )}
    </button>
  );
}

function StickerView({ sticker }: { sticker: StickerRef }) {
  if (!sticker.fileId) return <div className="sticker-missing muted small">Figurinha removida do servidor{sticker.name ? ` (${sticker.name})` : ''}</div>;
  return <img className="sticker" src={fileUrl(sticker.fileId)} alt={`Figurinha ${sticker.name}`} title={sticker.name} loading="lazy" />;
}

const JOIN_PHRASES = ['chegou na resenha! 👋', 'acabou de entrar. Bora dar as boas-vindas! 🎉', 'chegou! Puxa uma cadeira 🪑', 'entrou no servidor. Seja bem-vindo(a)! 💚', 'apareceu por aqui! 🙌'];

/** Aviso automático "fulano chegou": com botão de acenar (responde com 👋) e, para quem chegou, rever as boas-vindas. */
function JoinLine({ message, channel, name }: { message: Message; channel: Channel; name: string }) {
  const me = useApp((s) => s.me)!;
  const hasWelcome = useApp((s) => !!s.guilds[channel.guildId ?? '']?.welcomeText?.trim());
  const mine = message.author.id === me.id;
  // a frase muda conforme a mensagem, mas é sempre a mesma para a mesma mensagem
  const phrase = JOIN_PHRASES[[...message.id].reduce((a, c) => a + c.charCodeAt(0), 0) % JOIN_PHRASES.length];
  const [waved, setWaved] = useState(false);
  async function wave() {
    try {
      await api(`/channels/${channel.id}/messages`, { body: { content: `👋 Bem-vindo(a), @${message.author.username}!`, replyToId: message.id } });
      setWaved(true);
    } catch (err) {
      toast((err as Error).message);
    }
  }
  return (
    <div id={`msg-${message.id}`} className="message system-join" tabIndex={-1}>
      <span className="join-arrow" aria-hidden>→</span>
      <div className="join-body">
        <span>
          <button className="join-name" onClick={() => openModal({ kind: 'profile', userId: message.author.id, guildId: channel.guildId || null })}>
            {name}
          </button>{' '}
          {phrase} <span className="muted small">{formatDateTime(message.createdAt)}</span>
        </span>
        <span className="join-actions">
          {mine
            ? hasWelcome && (
                <button className="btn small" onClick={() => openModal({ kind: 'guildWelcome', guildId: channel.guildId! })}>
                  Ver as boas-vindas
                </button>
              )
            : !waved && (
                <button className="btn small" onClick={() => void wave()}>
                  👋 Dar oi
                </button>
              )}
        </span>
      </div>
    </div>
  );
}
