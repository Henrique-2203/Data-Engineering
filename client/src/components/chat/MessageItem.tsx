import { Fragment, memo, useState } from 'react';
import { CornerUpLeft, Flag, Image as ImageIcon, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { PollView, togglePin, useCanPin } from '../Community';
import type { Channel, Message, StickerRef } from '../../../../shared/types';
import { EmojiView, encodeEmojis, fileUrl, plainEmojis, renderCustomEmojis } from '../../lib/expressions';
import { api } from '../../lib/api';
import { mentionsUser } from '../../lib/mentions';
import { AttachmentList } from './Attachments';
import { findMember, openModal, toast, updateReactions, useApp } from '../../store/app';
import { memberColor } from '../../lib/perms';
import { Avatar } from '../Avatar';
import { EmojiPicker } from '../EmojiPicker';
import { formatDateTime, formatTime, renderContent } from './format';

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

export const MessageItem = memo(function MessageItem({ message, grouped, channel, onReply, onJump }: Props) {
  const me = useApp((s) => s.me)!;
  const isOwner = useApp((s) => !!channel.guildId && s.guilds[channel.guildId]?.ownerId === me.id);
  // usa dados atualizados do membro (nome/cor podem ter mudado)
  const author = useApp(() => findMember(channel.guildId, message.author.id)) ?? message.author;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plainEmojis(message.content));
  const [picker, setPicker] = useState(false);
  const mine = message.author.id === me.id;
  const nameColor = useApp((s) => memberColor(s.guilds[channel.guildId], message.author.id, author.avatarColor));
  const inGuild = channel.type === 'text';
  const mentioned = !mine && mentionsUser(message.content, me.username, message.mentionEveryone);
  const canPin = useCanPin(channel);

  async function saveEdit() {
    const content = encodeEmojis(draft.trim(), channel.guildId);
    setEditing(false);
    if (content === message.content || (!content && message.attachments.length === 0)) return;
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
    <div
      id={`msg-${message.id}`}
      className={`message${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${message.pinnedAt ? ' pinned' : ''}`}
      tabIndex={-1}
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
        {!grouped && (
          <div className="message-head">
            <button className="author-name" style={{ color: nameColor }} onClick={() => openModal({ kind: 'profile', userId: author.id, guildId: channel.guildId || null })}>
              {author.displayName}
            </button>
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
          message.content && (
            <div className="message-content">
              {renderContent(message.content, { meUsername: me.username, everyone: message.mentionEveryone })}
              {message.editedAt && <span className="muted small"> (editada)</span>}
            </div>
          )
        )}

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
              onClick={() => {
                setDraft(plainEmojis(message.content));
                setEditing(true);
              }}
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
              renderCustomEmojis(reply.content, 'r', (t, key) => [<Fragment key={key}>{t}</Fragment>])
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
