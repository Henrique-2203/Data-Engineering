import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react';
import { loadCommands } from '../../lib/botCommands';
import { BarChart3, Bold, Code, EyeOff, Heading, Italic, List, Loader2, Paperclip, Plus, Quote, SendHorizontal, Smile, Sticker, Strikethrough, Type, Underline, X } from 'lucide-react';
import { FileIcon } from './Attachments';
import type { Attachment, BotCommandInfo, Channel, Expression, Message, PublicUser } from '../../../../shared/types';
import { api } from '../../lib/api';
import { mentionQuery } from '../../lib/mentions';
import { getSocket } from '../../lib/socket';
import { formatBytes, isImageFile, uploadAttachment } from '../../lib/upload';
import { findMember, openModal, toast, useApp } from '../../store/app';
import { slowLabel } from '../AuditLog';
import { Perm, has, myPermissions, timeoutUntil } from '../../lib/perms';
import { Avatar } from '../Avatar';
import { EmojiPicker } from '../EmojiPicker';
import { StickerPicker } from '../StickerPicker';
import { encodeEmojis, expressionGroups, fileUrl, plainEmojis } from '../../lib/expressions';
import { encodeChannels } from '../../lib/channelMentions';
import { Hash, Volume2 } from 'lucide-react';

/** Texto antes do cursor termina com ":algo" (2+ letras)? Retorna o que foi digitado depois dos dois-pontos. */
const emojiQuery = (before: string) => /(^|\s):([a-z0-9_]{2,32})$/i.exec(before)?.[2].toLowerCase() ?? null;

const MAX_ATTACHMENTS = 10;
/** modo lento: quando mandei a última mensagem em cada canal */
const lastSent = new Map<string, number>();
/** celular/tablet (sem mouse): Enter pula linha e quem envia é o botão */
const isTouch = () => !!window.matchMedia?.('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches;

export interface ComposerHandle {
  addFiles(files: File[]): void;
  focus(): void;
}

interface Pending {
  key: string;
  /** miniatura (só imagens) */
  preview: string;
  name: string;
  size: number;
  progress: number;
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
  const [picker, setPicker] = useState<'emoji' | 'sticker' | null>(null);
  /** celular: menu do "+" (bolhas). 'closing' = animação de saída */
  const [menu, setMenu] = useState<'open' | 'closing' | null>(null);
  const [formatBar, setFormatBar] = useState(false);
  const [sentAnim, setSentAnim] = useState(0);
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
  // modo lento (quem gerencia mensagens ou canais não espera)
  const slowBypass = useApp((s) => {
    if (channel.type === 'dm') return true;
    const p = myPermissions(s.guilds[channel.guildId], s.me?.id);
    return has(p, Perm.MANAGE_MESSAGES) || has(p, Perm.MANAGE_CHANNELS);
  });
  const slowmode = slowBypass ? 0 : (channel.slowmode ?? 0);
  const [now, setNow] = useState(Date.now());
  const waitLeft = slowmode ? Math.max(0, Math.ceil(((lastSent.get(channel.id) ?? 0) + slowmode * 1000 - now) / 1000)) : 0;
  useEffect(() => {
    if (!waitLeft) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [waitLeft, now]);

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
    const room = MAX_ATTACHMENTS - pending.length;
    if (files.length > room) toast(`No máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const preview = isImageFile(file) ? URL.createObjectURL(file) : '';
      setPending((p) => [...p, { key, preview, name: file.name || 'arquivo', size: file.size, progress: 0, status: 'uploading' }]);
      uploadAttachment(file, channel.id, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x)))).then(
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
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return p.filter((x) => x.key !== key);
    });
  }

  const uploading = pending.some((p) => p.status === 'uploading');
  const ready = pending.filter((p) => p.status === 'done');
  const canSend = !sending && !uploading && !waitLeft && (!!text.trim() || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      // comando de bot (ex.: /dado d20): só vale se o servidor tem o bot e o comando está ligado
      const cm = channel.guildId ? /^\/([\p{L}\p{N}_]+)(?:\s+([\s\S]*))?$/u.exec(text.trim()) : null;
      if (cm) {
        const list = cmds.length ? cmds : await loadCommands(channel.guildId);
        const known = list.find((c) => c.name === cm[1].toLowerCase());
        if (known) {
          await api(`/channels/${channel.id}/interactions`, { body: { command: known.name, args: cm[2] ?? '' } });
          setText('');
          setSentAnim((n) => n + 1);
          lastSent.set(channel.id, Date.now());
          setNow(Date.now());
          onSent();
          return;
        }
      }
      await api(`/channels/${channel.id}/messages`, {
        body: { content: encodeChannels(encodeEmojis(text.trim(), channel.guildId), channel.guildId), replyToId: replyTo?.id, attachmentIds: ready.map((p) => p.attachment!.id) },
      });
      setText('');
      setSentAnim((n) => n + 1);
      lastSent.set(channel.id, Date.now());
      setNow(Date.now());
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
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

  async function sendSticker(sticker: Expression) {
    try {
      await api(`/channels/${channel.id}/messages`, { body: { content: '', stickerId: sticker.id, replyToId: replyTo?.id } });
      onCancelReply();
      onSent();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function closeMenu() {
    setMenu('closing');
    window.setTimeout(() => setMenu((m) => (m === 'closing' ? null : m)), 160);
  }
  function menuAction(fn: () => void) {
    closeMenu();
    fn();
  }

  /** Formatar: envolve o trecho selecionado (ou põe os símbolos com o cursor no meio). */
  function wrapSelection(before: string, after = before) {
    const el = inputRef.current;
    const s = el?.selectionStart ?? caret;
    const e = el?.selectionEnd ?? caret;
    const sel = text.slice(s, e);
    const next = text.slice(0, s) + before + sel + after + text.slice(e);
    pendingCaret.current = sel ? s + before.length + sel.length + after.length : s + before.length;
    setText(next);
  }
  /** Formatar a linha: título, citação, lista. */
  function prefixLine(prefix: string) {
    const el = inputRef.current;
    const s = el?.selectionStart ?? caret;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
    pendingCaret.current = s + prefix.length;
    setText(next);
  }

  /** Coloca o emoji onde está o cursor. */
  function insertAtCaret(raw: string) {
    const insert = plainEmojis(raw);
    const before = text.slice(0, caret);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const nextBefore = `${before}${pad}${insert} `;
    pendingCaret.current = nextBefore.length;
    setText(nextBefore + text.slice(caret));
    setCaret(nextBefore.length);
  }

  // ---------- comandos de bot: digitar "/" mostra a lista ----------
  const slashing = text.startsWith('/') && !!channel.guildId;
  const [cmds, setCmds] = useState<BotCommandInfo[]>([]);
  useEffect(() => {
    if (!slashing) return;
    let alive = true;
    void loadCommands(channel.guildId).then((l) => alive && setCmds(l));
    return () => {
      alive = false;
    };
  }, [slashing, channel.guildId]);
  const sQuery = slashing && !mentionClosed ? (/^\/([\p{L}]*)$/u.exec(text)?.[1] ?? null) : null;
  const slashMatches = sQuery === null ? [] : cmds.filter((c) => c.name.startsWith(sQuery.toLowerCase())).slice(0, 8);
  // já digitou o nome inteiro: não precisa da lista (o Enter envia)
  const showSlash = slashMatches.length > 0 && !slashMatches.some((c) => c.name === (sQuery ?? '').toLowerCase());
  const typedCommand = slashing ? cmds.find((c) => new RegExp(`^/${c.name}(\\s|$)`, 'i').test(text)) : undefined;
  function pickSlash(c: BotCommandInfo) {
    pendingCaret.current = c.name.length + 2;
    setText(`/${c.name} `);
    setCaret(c.name.length + 2);
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

  // ---------- autocompletar :emojis: personalizados (de todos os seus servidores) ----------
  const eQuery = showMentions || mentionClosed ? null : emojiQuery(text.slice(0, caret));
  const guilds = useApp((s) => s.guilds);
  const guildOrder = useApp((s) => s.guildOrder);
  const emojiMatches: Expression[] =
    eQuery === null
      ? []
      : expressionGroups(guilds, guildOrder, 'emoji', channel.guildId)
          .flatMap((g) => g.items)
          .filter((e) => e.name.includes(eQuery))
          .sort((a, b) => Number(!a.name.startsWith(eQuery)) - Number(!b.name.startsWith(eQuery)))
          .slice(0, 8);
  const showEmojis = emojiMatches.length > 0;

  // ---------- autocompletar #canais do servidor ----------
  const cQuery = showMentions || showEmojis || mentionClosed || !channel.guildId ? null : (/(^|\s)#([\p{L}\p{N}_ -]{0,32})$/u.exec(text.slice(0, caret))?.[2] ?? null);
  const channelMatches =
    cQuery === null
      ? []
      : (guilds[channel.guildId]?.channels ?? [])
          .filter((c) => c.type !== 'dm' && c.name.toLowerCase().includes(cQuery.trim().toLowerCase()))
          .sort((a, b) => Number(!a.name.toLowerCase().startsWith(cQuery.toLowerCase())) - Number(!b.name.toLowerCase().startsWith(cQuery.toLowerCase())))
          .slice(0, 8);
  // já digitou o nome inteiro de um canal: não precisa da lista (o Enter envia; "#geral" vira o canal do mesmo jeito)
  const showChannels = channelMatches.length > 0 && !channelMatches.some((c) => c.name.toLowerCase() === (cQuery ?? '').toLowerCase());
  function pickChannel(c: { name: string }) {
    const before = text.slice(0, caret).replace(/#([\p{L}\p{N}_ -]{0,32})$/u, `#${c.name} `);
    const next = before + text.slice(caret);
    pendingCaret.current = before.length;
    setText(next);
    setCaret(before.length);
  }

  function pickEmoji(e: Expression) {
    // no campo aparece :nome: (legível); vira o emoji de verdade só ao enviar
    const before = text.slice(0, caret).replace(/:[a-z0-9_]*$/i, `:${e.name}: `);
    pendingCaret.current = before.length;
    setText(before + text.slice(caret));
    setCaret(before.length);
  }

  function pickMention(c: Candidate) {
    const before = text.slice(0, caret).replace(/@[\w.]*$/, `@${c.username} `);
    const next = before + text.slice(caret);
    pendingCaret.current = before.length;
    setText(next);
    setCaret(before.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlash) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : slashMatches.length - 1)) % slashMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlash(slashMatches[Math.min(mentionIdx, slashMatches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionClosed(true);
        return;
      }
    }
    if (showChannels) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : channelMatches.length - 1)) % channelMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickChannel(channelMatches[Math.min(mentionIdx, channelMatches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionClosed(true);
        return;
      }
    }
    if (showEmojis) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : emojiMatches.length - 1)) % emojiMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickEmoji(emojiMatches[Math.min(mentionIdx, emojiMatches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionClosed(true);
        return;
      }
    }
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
      {showSlash && (
        <ul className="mention-popup" role="listbox" aria-label="Comandos">
          {slashMatches.map((c, i) => (
            <li key={c.name}>
              <button
                role="option"
                aria-selected={i === mentionIdx}
                className={i === mentionIdx ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSlash(c);
                }}
                onMouseEnter={() => setMentionIdx(i)}
              >
                <span className="mention-all">/</span>
                <strong>/{c.name}</strong>
                <span className="muted small">{c.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {typedCommand && !showSlash && (
        <div className="slash-hint" aria-live="polite">
          <code>{typedCommand.usage}</code>
        </div>
      )}
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

      {showChannels && (
        <ul className="mention-popup" role="listbox" aria-label="Canais">
          {channelMatches.map((c, i) => (
            <li key={c.id}>
              <button
                role="option"
                aria-selected={i === mentionIdx}
                className={i === mentionIdx ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickChannel(c);
                }}
                onMouseEnter={() => setMentionIdx(i)}
              >
                {c.type === 'voice' ? <Volume2 size={18} className="muted" /> : <Hash size={18} className="muted" />}
                <strong>{c.name}</strong>
                <span className="muted small">{c.type === 'voice' ? 'canal de voz' : 'canal de texto'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showEmojis && (
        <ul className="mention-popup" role="listbox" aria-label="Emojis">
          {emojiMatches.map((em, i) => (
            <li key={em.id}>
              <button
                role="option"
                aria-selected={i === mentionIdx}
                className={i === mentionIdx ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickEmoji(em);
                }}
                onMouseEnter={() => setMentionIdx(i)}
              >
                <img className="custom-emoji" src={fileUrl(em.fileId)} alt="" />
                <strong>:{em.name}:</strong>
                <span className="muted small">{guilds[em.guildId]?.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picker && (
        <div className="composer-picker">
          {picker === 'emoji' ? (
            <EmojiPicker guildId={channel.guildId} verb="Inserir" onPick={insertAtCaret} onClose={() => setPicker(null)} />
          ) : (
            <StickerPicker guildId={channel.guildId} onPick={(st) => void sendSticker(st)} onClose={() => setPicker(null)} />
          )}
        </div>
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
            <div key={p.key} className={`pending ${p.status}${p.preview ? '' : ' file'}`} title={`${p.name} · ${formatBytes(p.size)}`}>
              {p.preview ? (
                <img src={p.preview} alt="" />
              ) : (
                <span className="pending-file">
                  <FileIcon name={p.name} size={22} />
                  <span className="pending-name">{p.name}</span>
                  <span className="muted small">{formatBytes(p.size)}</span>
                </span>
              )}
              {p.status === 'uploading' && (
                <span className="pending-state" aria-label={`Enviando ${Math.round(p.progress * 100)}%`}>
                  <Loader2 size={20} className="spin" />
                  {p.size > 512 * 1024 && <small>{Math.round(p.progress * 100)}%</small>}
                </span>
              )}
              {p.status === 'uploading' && <span className="pending-progress" style={{ width: `${Math.round(p.progress * 100)}%` }} />}
              {p.status === 'error' && <span className="pending-state error-text">Falhou</span>}
              <button className="pending-remove" aria-label={`Remover ${p.name}`} onClick={() => removePending(p.key)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {slowmode > 0 && (
        <div className="slowmode-bar muted small" role="status">
          🐢 Modo lento: uma mensagem a cada {slowLabel(slowmode)}
          {waitLeft > 0 && <strong> · espere {waitLeft}s</strong>}
        </div>
      )}

      {formatBar && (
        <div className="format-bar" role="toolbar" aria-label="Formatar texto" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" aria-label="Negrito" title="Negrito (**texto**)" onClick={() => wrapSelection('**')}><Bold size={17} /></button>
          <button type="button" aria-label="Itálico" title="Itálico (*texto*)" onClick={() => wrapSelection('*')}><Italic size={17} /></button>
          <button type="button" aria-label="Sublinhado" title="Sublinhado (__texto__)" onClick={() => wrapSelection('__')}><Underline size={17} /></button>
          <button type="button" aria-label="Riscado" title="Riscado (~~texto~~)" onClick={() => wrapSelection('~~')}><Strikethrough size={17} /></button>
          <button type="button" aria-label="Título" title="Título (# no começo da linha)" onClick={() => prefixLine('# ')}><Heading size={17} /></button>
          <button type="button" aria-label="Lista" title="Lista (- no começo da linha)" onClick={() => prefixLine('- ')}><List size={17} /></button>
          <button type="button" aria-label="Citação" title="Citação (> no começo da linha)" onClick={() => prefixLine('> ')}><Quote size={17} /></button>
          <button type="button" aria-label="Código" title="Código (`texto`)" onClick={() => wrapSelection('`')}><Code size={17} /></button>
          <button type="button" aria-label="Spoiler" title="Spoiler (||texto||)" onClick={() => wrapSelection('||')}><EyeOff size={17} /></button>
          <button type="button" className="fb-close" aria-label="Fechar formatação" onClick={() => setFormatBar(false)}><X size={17} /></button>
        </div>
      )}

      {menu && (
        <>
          <div className={`attach-scrim${menu === 'closing' ? ' closing' : ''}`} onClick={closeMenu} />
          <div className={`attach-menu${menu === 'closing' ? ' closing' : ''}`} role="menu" aria-label="Enviar">
            <button type="button" role="menuitem" style={{ '--i': 3 } as CSSProperties} onClick={() => menuAction(() => setFormatBar((v) => !v))}>
              <span className="bubble" style={{ background: '#2fb37a' }}><Type size={22} /></span>
              <span className="lbl">Formatar texto</span>
            </button>
            <button type="button" role="menuitem" style={{ '--i': 2 } as CSSProperties} onClick={() => menuAction(() => setPicker('sticker'))}>
              <span className="bubble" style={{ background: '#8b5cf6' }}><Sticker size={22} /></span>
              <span className="lbl">Figurinha</span>
            </button>
            <button type="button" role="menuitem" style={{ '--i': 1 } as CSSProperties} onClick={() => menuAction(() => openModal({ kind: 'createPoll', channelId: channel.id }))}>
              <span className="bubble" style={{ background: '#f08c2e' }}><BarChart3 size={22} /></span>
              <span className="lbl">Enquete</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{ '--i': 0 } as CSSProperties}
              disabled={pending.length >= MAX_ATTACHMENTS}
              onClick={() => menuAction(() => fileRef.current?.click())}
            >
              <span className="bubble" style={{ background: '#3b82f6' }}><Paperclip size={22} /></span>
              <span className="lbl">Foto, vídeo ou arquivo</span>
            </button>
          </div>
        </>
      )}

      <div className={`composer${replyTo || pending.length ? ' attached' : ''}${text ? ' has-text' : ''}`}>
        <button
          type="button"
          className={`icon-btn plus-btn${menu === 'open' ? ' open' : ''}`}
          aria-label="Mais opções"
          aria-expanded={menu === 'open'}
          onClick={() => (menu === 'open' ? closeMenu() : setMenu('open'))}
        >
          <Plus size={24} />
        </button>
        <button
          className="icon-btn attach-btn"
          aria-label="Enviar arquivo"
          title="Enviar foto, vídeo ou arquivo (ou cole / arraste aqui)"
          onClick={() => fileRef.current?.click()}
          disabled={pending.length >= MAX_ATTACHMENTS}
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileRef}
          type="file"
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
          placeholder={
            channel.type === 'dm'
              ? `Conversar com ${channel.name}`
              : channel.type === 'voice'
                ? 'Mandar no canal (fica salvo)'
                : `Conversar em #${channel.name}`
          }
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          maxLength={4000}
          enterKeyHint={isTouch() ? 'enter' : 'send'}
          aria-autocomplete="list"
        />
        <button className="icon-btn composer-tool" aria-label="Criar enquete" title="Criar enquete" onClick={() => openModal({ kind: 'createPoll', channelId: channel.id })}>
          <BarChart3 size={20} />
        </button>
        <button className="icon-btn composer-tool" data-picker-toggle aria-label="Figurinhas" title="Figurinhas" onClick={() => setPicker((p) => (p === 'sticker' ? null : 'sticker'))}>
          <Sticker size={20} />
        </button>
        <button className={`icon-btn composer-tool${formatBar ? ' active' : ''}`} aria-label="Formatar texto" title="Formatar texto (negrito, itálico, título…)" aria-pressed={formatBar} onClick={() => setFormatBar((v) => !v)}>
          <Type size={20} />
        </button>
        <button className="icon-btn composer-tool" data-picker-toggle aria-label="Emojis" title="Emojis" onClick={() => setPicker((p) => (p === 'emoji' ? null : 'emoji'))}>
          <Smile size={20} />
        </button>
        <button key={sentAnim} className={`icon-btn send-btn${canSend ? ' ready' : ''}${sentAnim ? ' sent' : ''}`} aria-label="Enviar" disabled={!canSend} onClick={() => void send()}>
          <SendHorizontal size={20} />
        </button>
      </div>
    </div>
  );
}
