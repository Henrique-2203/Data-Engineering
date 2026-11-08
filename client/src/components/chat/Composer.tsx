import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react';
import type { Attachment, Channel, Message, PublicUser } from '../../../../shared/types';
import { api } from '../../lib/api';
import { mentionQuery } from '../../lib/mentions';
import { getSocket } from '../../lib/socket';
import { isImageFile, uploadImage } from '../../lib/upload';
import { findMember, toast, useApp } from '../../store/app';
import { Perm, has, myPermissions, timeoutUntil } from '../../lib/perms';
import { Avatar } from '../Avatar';

const MAX_ATTACHMENTS = 4;
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

export interface ComposerHandle {
  addFiles(files: File[]): void;
  focus(): void;
}

interface Pending {
  key: string;
  preview: string;
  status: 'uploading' | 'done' | 'error';
  attachment?: Attachment;
}

interface Props {
  channel: Channel;
  replyTo: Message | null;
  onCancelReply(): void;
  onSent(): void;
  ref?: Ref<ComposerHandle>;
}

type Candidate = { username: string; label: string; user: PublicUser | null };

/** Quem pode ser mencionado aqui: membros do servidor (+ @todos) ou os dois da DM. */
function mentionCandidates(channel: Channel): Candidate[] {
  const s = useApp.getState();
  if (channel.type === 'dm') {
    const dm = s.dms[channel.id];
    return [dm?.recipient, s.me].filter(Boolean).map((u) => ({ username: u!.username, label: u!.displayName, user: u! }));
  }
  const guild = s.guilds[channel.guildId];
  const members = guild?.members ?? [];
  const canEveryone = has(myPermissions(guild, s.me?.id), Perm.MENTION_EVERYONE);
  return [
    ...members.map((m) => ({ username: m.username, label: m.displayName, user: m as PublicUser })),
    ...(canEveryone ? [{ username: 'todos', label: 'Notificar todos do servidor', user: null }] : []),
  ];
}

export function Composer({ channel, replyTo, onCancelReply, onSent, ref }: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  /** posição do cursor a aplicar logo após o próximo render (sem atraso, para quem digita rápido) */
  const pendingCaret = useRef<number | null>(null);
  const replyAuthor = useApp(() => (replyTo ? findMember(channel.guildId, replyTo.author.id) : undefined)) ?? replyTo?.author;
  // castigo: recalculado a cada minuto para liberar o campo sozinho quando acabar
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // (seletor devolve número: um Date novo a cada leitura faria o React renderizar em laço)
  const punishedMs = useApp((s) => (channel.type === 'dm' ? null : (timeoutUntil(s.guilds[channel.guildId], s.me?.id)?.getTime() ?? null)));
  const punishedUntil = punishedMs ? new Date(punishedMs) : null;

  useEffect(() => {
    setText('');
    setPending((p) => {
      p.forEach((x) => URL.revokeObjectURL(x.preview));
      return [];
    });
    if (!isTouch()) inputRef.current?.focus();
  }, [channel.id]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function addFiles(files: File[]) {
    const images = files.filter(isImageFile);
    if (images.length < files.length) toast('Só dá para enviar imagens (PNG, JPG, GIF, WebP).');
    const room = MAX_ATTACHMENTS - pending.length;
    if (images.length > room) toast(`No máximo ${MAX_ATTACHMENTS} imagens por mensagem.`);
    for (const file of images.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      setPending((p) => [...p, { key, preview: URL.createObjectURL(file), status: 'uploading' }]);
      uploadImage(file).then(
        (attachment) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'done', attachment } : x))),
        (err) => {
          toast((err as Error).message);
          setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'error' } : x)));
        },
      );
    }
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => inputRef.current?.focus() }));

  function removePending(key: string) {
    setPending((p) => {
      const item = p.find((x) => x.key === key);
      if (item) URL.revokeObjectURL(item.preview);
      return p.filter((x) => x.key !== key);
    });
  }

  const uploading = pending.some((p) => p.status === 'uploading');
  const ready = pending.filter((p) => p.status === 'done');
  const canSend = !sending && !uploading && (!!text.trim() || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      await api(`/channels/${channel.id}/messages`, {
        body: { content: text.trim(), replyToId: replyTo?.id, attachmentIds: ready.map((p) => p.attachment!.id) },
      });
      setText('');
      pending.forEach((p) => URL.revokeObjectURL(p.preview));
      setPending([]);
      onCancelReply();
      onSent();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSending(false);
      if (!isTouch()) inputRef.current?.focus();
    }
  }

  // ---------- autocompletar @menções ----------
  const query = mentionClosed ? null : mentionQuery(text.slice(0, caret));
  const matches =
    query === null
      ? []
      : mentionCandidates(channel)
          .filter((c) => c.username.startsWith(query.toLowerCase()) || c.label.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8);
  const showMentions = matches.length > 0;

  function pickMention(c: Candidate) {
    const before = text.slice(0, caret).replace(/@[\w.]*$/, `@${c.username} `);
    const next = before + text.slice(caret);
    pendingCaret.current = before.length;
    setText(next);
    setCaret(before.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showMentions) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(matches[Math.min(mentionIdx, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionClosed(true);
        return;
      }
    }
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      onCancelReply();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      void send();
    }
  }

  function onChange(value: string, caretPos: number) {
    setText(value);
    setCaret(caretPos);
    setMentionIdx(0);
    setMentionClosed(false);
    const now = Date.now();
    if (value && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      getSocket()?.emit('typing', { guildId: channel.guildId || undefined, channelId: channel.id });
    }
  }

  if (punishedUntil) {
    return (
      <div className="composer-wrap">
        <div className="composer timed-out" role="status">
          ⏳ Você está de castigo neste servidor até{' '}
          {punishedUntil.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Dá para ler, mas não escrever.
        </div>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {showMentions && (
        <ul className="mention-popup" role="listbox" aria-label="Mencionar">
          {matches.map((c, i) => (
            <li key={c.username}>
              <button
                role="option"
                aria-selected={i === mentionIdx}
                className={i === mentionIdx ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault(); // não tira o foco do campo
                  pickMention(c);
                }}
                onMouseEnter={() => setMentionIdx(i)}
              >
                {c.user ? <Avatar user={c.user} size={22} /> : <span className="mention-all">@</span>}
                <strong>{c.user ? c.label : '@todos'}</strong>
                <span className="muted small">{c.user ? `@${c.username}` : c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {replyTo && (
        <div className="reply-bar">
          <span className="ellipsis">
            Respondendo a <strong>{replyAuthor?.displayName}</strong>
          </span>
          <button className="icon-btn small" aria-label="Cancelar resposta" title="Cancelar resposta (Esc)" onClick={onCancelReply}>
            <X size={15} />
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="pending-attachments">
          {pending.map((p) => (
            <div key={p.key} className={`pending ${p.status}`}>
              <img src={p.preview} alt="" />
              {p.status === 'uploading' && (
                <span className="pending-state" aria-label="Enviando">
                  <Loader2 size={20} className="spin" />
                </span>
              )}
              {p.status === 'error' && <span className="pending-state error-text">Falhou</span>}
              <button className="pending-remove" aria-label="Remover imagem" onClick={() => removePending(p.key)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`composer${replyTo || pending.length ? ' attached' : ''}`}>
        <button
          className="icon-btn attach-btn"
          aria-label="Enviar imagem"
          title="Enviar imagem (ou cole / arraste aqui)"
          onClick={() => fileRef.current?.click()}
          disabled={pending.length >= MAX_ATTACHMENTS}
        >
          <ImagePlus size={20} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={channel.type === 'dm' ? `Conversar com ${channel.name}` : `Conversar em #${channel.name}`}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter(isImageFile);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          maxLength={4000}
          enterKeyHint="send"
          aria-autocomplete="list"
        />
        <button className="icon-btn send-btn" aria-label="Enviar" disabled={!canSend} onClick={() => void send()}>
          <SendHorizontal size={20} />
        </button>
      </div>
    </div>
  );
}
