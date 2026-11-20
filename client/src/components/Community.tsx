import { useEffect, useState, type FormEvent } from 'react';
import { BarChart3, CalendarDays, Check, Palette, Pin, Search, Trash2, Volume2, X } from 'lucide-react';
import type { AutomodSettings, Channel, Guild, GuildEvent, Message } from '../../../shared/types';
import { api } from '../lib/api';
import { closeModal, findChannel, findMember, jumpToMessage, openModal, toast, updateMessage, useApp } from '../store/app';
import { Perm, has, useCan, usePerms } from '../lib/perms';
import { encodeEmojis } from '../lib/expressions';
import { Modal, useSubmit } from './Modals';
import { Avatar } from './Avatar';
import { formatDateTime, renderContent } from './chat/format';
import { disablePush, enablePush, needsHomeScreen, pushActive, pushSupported } from '../lib/push';
import { voice } from '../voice/engine';

// ======================================================================
// Enquetes
// ======================================================================

const POLL_DURATIONS = [
  { hours: 1, label: '1 hora' },
  { hours: 4, label: '4 horas' },
  { hours: 8, label: '8 horas' },
  { hours: 24, label: '1 dia' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '1 semana' },
];

export function CreatePollModal({ channelId }: { channelId: string }) {
  const channel = findChannel(channelId);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [hours, setHours] = useState(24);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/channels/${channelId}/messages`, {
      body: { content: '', poll: { question: encodeEmojis(question.trim(), channel?.guildId), options: filled, multi, hours } },
    });
    closeModal();
  });
  return (
    <Modal title="Criar enquete">
      <form className="form" onSubmit={submit}>
        <label>
          Pergunta
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} required autoFocus placeholder="Qual jogo hoje?" />
        </label>
        <div className="poll-options-edit">
          {options.map((o, i) => (
            <div key={i} className="poll-option-edit">
              <input
                aria-label={`Opção ${i + 1}`}
                placeholder={`Opção ${i + 1}`}
                value={o}
                maxLength={55}
                onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 && (
                <button type="button" className="icon-btn small" aria-label={`Remover opção ${i + 1}`} onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}>
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button type="button" className="btn ghost small" onClick={() => setOptions((all) => [...all, ''])}>
              + Adicionar opção
            </button>
          )}
        </div>
        <label>
          Duração
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {POLL_DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Pode escolher mais de uma opção
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={closeModal}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !question.trim() || filled.length < 2}>
            Publicar enquete
          </button>
        </div>
      </form>
    </Modal>
  );
}

function timeLeft(endsAt: string) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'Encerrada';
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `Termina em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `Termina em ${h} h`;
  return `Termina em ${Math.round(h / 24)} dias`;
}

export function PollView({ message, channel }: { message: Message; channel: Channel }) {
  const poll = message.poll!;
  const meId = useApp((s) => s.me?.id ?? '');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const ended = new Date(poll.endsAt).getTime() <= Date.now();
  const mine = poll.options.map((o, i) => (o.userIds.includes(meId) ? i : -1)).filter((i) => i >= 0);
  const voters = new Set(poll.options.flatMap((o) => o.userIds)).size;
  const totalVotes = poll.options.reduce((a, o) => a + o.userIds.length, 0);
  const top = Math.max(...poll.options.map((o) => o.userIds.length));
  const showResults = ended || mine.length > 0;
  const [showVoters, setShowVoters] = useState(false);
  const member = (id: string) => findMember(channel.guildId, id);
  const nameOf = (id: string) => (id === meId ? 'Você' : (member(id)?.displayName ?? 'Alguém'));

  async function vote(i: number) {
    if (ended) return;
    const next = poll.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : mine.includes(i) ? [] : [i];
    try {
      const res = await api<{ message: Message }>(`/messages/${message.id}/poll`, { body: { options: next } });
      updateMessage(res.message);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className={`poll${ended ? ' ended' : ''}`}>
      <div className="poll-question">
        <BarChart3 size={16} /> <strong>{renderContent(poll.question, { meUsername: '', everyone: false })}</strong>
      </div>
      <div className="muted small">{poll.multi ? 'Escolha uma ou mais opções' : 'Escolha uma opção'}</div>
      <div className="poll-options">
        {poll.options.map((o, i) => {
          const pct = totalVotes ? Math.round((o.userIds.length / totalVotes) * 100) : 0;
          const chosen = mine.includes(i);
          const winner = ended && top > 0 && o.userIds.length === top;
          const names = o.userIds.map((id) => (id === meId ? 'você' : (findMember(channel.guildId, id)?.displayName ?? 'alguém')));
          return (
            <button
              key={i}
              className={`poll-option${chosen ? ' chosen' : ''}${winner ? ' winner' : ''}`}
              aria-pressed={chosen}
              disabled={ended}
              title={names.length ? names.join(', ') : 'Ninguém votou ainda'}
              onClick={() => void vote(i)}
            >
              {showResults && <span className="poll-bar" style={{ width: `${pct}%` }} />}
              <span className="poll-text">
                {chosen && <Check size={14} />} {o.text}
              </span>
              {showResults && (
                <span className="poll-count">
                  {o.userIds.length > 0 && (
                    <span className="poll-faces" aria-hidden>
                      {o.userIds.slice(0, 4).map((id) => (
                        <Avatar key={id} user={member(id)} size={18} />
                      ))}
                    </span>
                  )}
                  {o.userIds.length} · {pct}%
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="muted small poll-foot">
        {voters === 1 ? '1 voto' : `${voters} votos`} · {timeLeft(poll.endsAt)}
        {!ended && mine.length > 0 && ' · clique de novo para tirar o voto'}
        {showResults && voters > 0 && (
          <>
            {' · '}
            <button className="link-btn small" aria-expanded={showVoters} onClick={() => setShowVoters((v) => !v)}>
              {showVoters ? 'Esconder quem votou' : 'Ver quem votou'}
            </button>
          </>
        )}
        {!showResults && voters > 0 && ' · vote para ver o resultado e quem votou'}
      </div>
      {showResults && showVoters && (
        <div className="poll-voters" role="region" aria-label="Quem votou" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
          {poll.options.map((o, i) => (
            <div key={i} className="poll-voters-option">
              <strong>
                {o.text} <span className="muted small">({o.userIds.length})</span>
              </strong>
              {o.userIds.length === 0 ? (
                <span className="muted small">Ninguém</span>
              ) : (
                <ul>
                  {o.userIds.map((id) => (
                    <li key={id}>
                      <Avatar user={member(id)} size={20} />
                      <span>{nameOf(id)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ======================================================================
// Mensagens fixadas e busca (painel da direita)
// ======================================================================

/** Pode fixar aqui: na DM qualquer um dos dois; no servidor, quem gerencia mensagens. */
export function useCanPin(channel: Channel) {
  const perms = usePerms(channel.type === 'dm' ? null : channel.guildId);
  return channel.type === 'dm' || has(perms, Perm.MANAGE_MESSAGES);
}

export async function togglePin(message: Message) {
  try {
    const res = await api<{ message: Message }>(`/messages/${message.id}/pin`, { method: message.pinnedAt ? 'DELETE' : 'POST' });
    updateMessage(res.message);
    toast(message.pinnedAt ? 'Mensagem desafixada.' : 'Mensagem fixada. 📌');
    window.dispatchEvent(new Event('resenha:pins-changed'));
  } catch (err) {
    toast((err as Error).message);
  }
}

/** Botões do cabeçalho do chat: busca e fixadas. */
export function ChatHeaderTools({ channel }: { channel: Channel }) {
  const [text, setText] = useState('');
  const panel = useApp((s) => s.sidePanel);
  const scope = channel.type === 'dm' ? { channelId: channel.id } : { guildId: channel.guildId };
  const search = (t: string) => useApp.setState({ sidePanel: { kind: 'search', text: t, scope }, mobilePanel: 'members' });
  return (
    <>
      <button
        className="icon-btn"
        aria-label="Papel de parede desta conversa"
        title="Papel de parede desta conversa"
        onClick={() => openModal({ kind: 'wallpaper', channelId: channel.id })}
      >
        <Palette size={19} />
      </button>
      <button
        className={`icon-btn${panel?.kind === 'pins' ? ' active' : ''}`}
        aria-label="Mensagens fixadas"
        title="Mensagens fixadas"
        onClick={() => useApp.setState({ sidePanel: panel?.kind === 'pins' ? null : { kind: 'pins', channelId: channel.id }, mobilePanel: 'members' })}
      >
        <Pin size={19} />
      </button>
      <form
        className="header-search desktop-only"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) search(text.trim());
        }}
      >
        <input
          type="search"
          aria-label="Buscar mensagens"
          placeholder={channel.type === 'dm' ? 'Buscar na conversa' : 'Buscar'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Search size={15} />
      </form>
      <button className="icon-btn mobile-only" aria-label="Buscar" title="Buscar" onClick={() => search('')}>
        <Search size={19} />
      </button>
    </>
  );
}

const HAS: { id: string; label: string }[] = [
  { id: '', label: 'Qualquer coisa' },
  { id: 'file', label: 'Com arquivo' },
  { id: 'image', label: 'Com imagem' },
  { id: 'link', label: 'Com link' },
  { id: 'pinned', label: 'Fixadas' },
  { id: 'poll', label: 'Enquetes' },
];

export function SidePanel() {
  const panel = useApp((s) => s.sidePanel);
  if (!panel) return null;
  return (
    <aside className="side-panel" aria-label={panel.kind === 'pins' ? 'Mensagens fixadas' : 'Busca'}>
      {panel.kind === 'pins' ? <PinsPanel channelId={panel.channelId} /> : <SearchPanel key={JSON.stringify(panel.scope) + panel.text} initial={panel.text} scope={panel.scope} />}
    </aside>
  );
}

const closePanel = () => useApp.setState({ sidePanel: null, mobilePanel: 'main' });

function PanelHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="side-panel-head">
      {icon}
      <strong className="ellipsis">{title}</strong>
      <button className="icon-btn" aria-label="Fechar painel" title="Fechar" onClick={closePanel}>
        <X size={18} />
      </button>
    </div>
  );
}

function ResultItem({ message, onOpen, showChannel, actions }: { message: Message; onOpen(): void; showChannel?: boolean; actions?: React.ReactNode }) {
  const channel = findChannel(message.channelId);
  const guildId = channel?.type === 'dm' ? null : channel?.guildId;
  const author = findMember(guildId, message.author.id) ?? message.author;
  const me = useApp((s) => s.me);
  return (
    <div className="message search-result" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <Avatar user={author} size={32} />
      <div className="message-body">
        <div className="message-head">
          <strong>{author.displayName}</strong>
          {showChannel && channel && channel.type !== 'dm' && <span className="muted small">{channel.type === 'voice' ? '🔊' : '#'}{channel.name}</span>}
          <span className="muted small">{formatDateTime(message.createdAt)}</span>
        </div>
        {message.content && <div className="message-content">{renderContent(message.content, { meUsername: me?.username ?? '', everyone: message.mentionEveryone })}</div>}
        {message.poll && <div className="muted small">📊 {message.poll.question}</div>}
        {message.attachments.length > 0 && <div className="muted small">📎 {message.attachments.map((a) => a.name).join(', ')}</div>}
        {message.sticker && <div className="muted small">Figurinha: {message.sticker.name}</div>}
      </div>
      {actions && (
        <div className="result-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

function PinsPanel({ channelId }: { channelId: string }) {
  const channel = useApp(() => findChannel(channelId));
  const [items, setItems] = useState<Message[] | null>(null);
  const canPin = useCanPin(channel ?? ({ type: 'text', guildId: '' } as Channel));
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ messages: Message[] }>(`/channels/${channelId}/pins`).then(
        (r) => alive && setItems(r.messages),
        (e) => toast(e.message),
      );
    void load();
    window.addEventListener('resenha:pins-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('resenha:pins-changed', load);
    };
  }, [channelId]);
  // fixadas por outra pessoa chegam pelo tempo real: atualiza a lista
  const pinnedNow = useApp((s) => (s.messages[channelId]?.items ?? []).filter((m) => m.pinnedAt).map((m) => m.id).join(','));
  useEffect(() => {
    if (items) window.dispatchEvent(new Event('resenha:pins-changed'));
  }, [pinnedNow]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PanelHead icon={<Pin size={18} />} title={`Fixadas${channel && channel.type !== 'dm' ? ` em #${channel.name}` : ''}`} />
      <div className="side-panel-body">
        {!items && <p className="muted center">Carregando…</p>}
        {items?.length === 0 && (
          <p className="muted center small-pad">
            Nenhuma mensagem fixada ainda.{canPin ? ' Passe o mouse numa mensagem e clique no 📌 para fixar.' : ''}
          </p>
        )}
        {items?.map((m) => (
          <ResultItem
            key={m.id}
            message={m}
            onOpen={() => jumpToMessage(m.channelId, m.id)}
            actions={
              canPin && (
                <button className="icon-btn small" aria-label="Desafixar" title="Desafixar" onClick={() => void togglePin(m)}>
                  <Trash2 size={14} />
                </button>
              )
            }
          />
        ))}
      </div>
    </>
  );
}

function SearchPanel({ initial, scope }: { initial: string; scope: { guildId: string } | { channelId: string } }) {
  const guildId = 'guildId' in scope ? scope.guildId : null;
  const guild = useApp((s) => (guildId ? s.guilds[guildId] : undefined));
  const [text, setText] = useState(initial);
  const [authorId, setAuthorId] = useState('');
  const [hasFilter, setHas] = useState('');
  const [channelId, setChannelId] = useState('');
  const [result, setResult] = useState<{ messages: Message[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(offset = 0) {
    if (!text.trim() && !authorId && !hasFilter) return setResult(null);
    setBusy(true);
    try {
      const q = new URLSearchParams({
        ...scope,
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(authorId ? { authorId } : {}),
        ...(hasFilter ? { has: hasFilter } : {}),
        ...(channelId ? { channelId } : {}),
        offset: String(offset),
      });
      const r = await api<{ messages: Message[]; total: number }>(`/search?${q}`);
      setResult((old) => (offset && old ? { total: r.total, messages: [...old.messages, ...r.messages] } : r));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run();
  }, [authorId, hasFilter, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = guild ? guild.members : [];
  const channels = guild ? guild.channels : [];
  return (
    <>
      <PanelHead icon={<Search size={18} />} title={guild ? `Buscar em ${guild.name}` : 'Buscar na conversa'} />
      <form
        className="search-filters"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run();
        }}
      >
        <input type="search" aria-label="O que procurar" placeholder="Palavras (sem precisar de acento)" value={text} onChange={(e) => setText(e.target.value)} autoFocus={!initial} />
        <div className="search-selects">
          {guild && (
            <select aria-label="De quem" value={authorId} onChange={(e) => setAuthorId(e.target.value)}>
              <option value="">De: qualquer pessoa</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  De: {m.displayName}
                </option>
              ))}
            </select>
          )}
          {guild && (
            <select aria-label="Em qual canal" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">Em: todos os canais</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  Em: {c.type === 'voice' ? '🔊 ' : '#'}
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Tipo de mensagem" value={hasFilter} onChange={(e) => setHas(e.target.value)}>
            {HAS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
      </form>
      <div className="side-panel-body">
        {busy && !result && <p className="muted center">Buscando…</p>}
        {!result && !busy && <p className="muted center small-pad">Digite uma palavra ou escolha um filtro.</p>}
        {result && (
          <p className="muted small search-total">
            {result.total === 0 ? 'Nada encontrado.' : result.total === 1 ? '1 resultado' : `${result.total} resultados`}
          </p>
        )}
        {result?.messages.map((m) => (
          <ResultItem key={m.id} message={m} showChannel={!!guild} onOpen={() => jumpToMessage(m.channelId, m.id)} />
        ))}
        {result && result.messages.length < result.total && (
          <button className="btn ghost small center-btn" disabled={busy} onClick={() => void run(result.messages.length)}>
            Ver mais
          </button>
        )}
      </div>
    </>
  );
}

// ======================================================================
// Eventos agendados
// ======================================================================

const fmtEvent = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const eventLive = (e: GuildEvent, now = Date.now()) =>
  new Date(e.startsAt).getTime() <= now && (e.endsAt ? new Date(e.endsAt).getTime() : new Date(e.startsAt).getTime() + 3 * 3600_000) > now;

/** Botão "Eventos" na barra de canais (com destaque quando um evento está acontecendo). */
export function EventsButton({ guild }: { guild: Guild }) {
  const events = guild.events ?? [];
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const live = events.find((e) => eventLive(e));
  return (
    <button className={`events-btn${live ? ' live' : ''}`} onClick={() => openModal({ kind: 'events', guildId: guild.id })}>
      <CalendarDays size={16} />
      <span className="ellipsis">{live ? `Agora: ${live.title}` : 'Eventos'}</span>
      {events.length > 0 && !live && <span className="count">{events.length}</span>}
    </button>
  );
}

export function EventsModal({ guildId, create }: { guildId: string; create?: boolean }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const meId = useApp((s) => s.me?.id ?? '');
  const canCreate = useCan(guildId, Perm.CREATE_EVENTS);
  const canManageAll = useCan(guildId, Perm.MANAGE_GUILD);
  const [editing, setEditing] = useState<GuildEvent | 'new' | null>(create && canCreate ? 'new' : null);
  if (!guild) return null;
  const events = guild.events ?? [];

  async function interest(e: GuildEvent, on: boolean) {
    try {
      await api(`/events/${e.id}/interest`, { body: { interested: on } });
    } catch (err) {
      toast((err as Error).message);
    }
  }
  async function remove(e: GuildEvent) {
    if (!confirm(`Cancelar o evento "${e.title}"?`)) return;
    try {
      await api(`/events/${e.id}`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  if (editing) return <EventForm guild={guild} event={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;

  return (
    <Modal title={`Eventos de ${guild.name}`} wide>
      <div className="events-list">
        {events.length === 0 && <p className="muted">Nenhum evento marcado. {canCreate ? 'Que tal marcar uma jogatina?' : ''}</p>}
        {events.map((e) => {
          const interested = e.interestedIds.includes(meId);
          const live = eventLive(e);
          const ch = e.channelId ? guild.channels.find((c) => c.id === e.channelId) : null;
          const canManage = e.creator?.id === meId || canManageAll;
          return (
            <article key={e.id} className={`event-card${live ? ' live' : ''}`}>
              <div className="event-when">{live ? <span className="live-badge">AGORA</span> : fmtEvent(e.startsAt)}</div>
              <h3>{e.title}</h3>
              {e.description && <p className="event-desc">{e.description}</p>}
              <div className="muted small">
                {ch && (
                  <>
                    <Volume2 size={13} /> {ch.name} ·{' '}
                  </>
                )}
                {e.interestedIds.length} {e.interestedIds.length === 1 ? 'pessoa interessada' : 'pessoas interessadas'}
                {e.creator && ` · marcado por ${findMember(guildId, e.creator.id)?.displayName ?? e.creator.displayName}`}
              </div>
              <div className="event-actions">
                <button className={`btn small ${interested ? 'primary' : 'ghost'}`} aria-pressed={interested} onClick={() => void interest(e, !interested)}>
                  {interested ? (
                    <>
                      <Check size={14} /> Interessado
                    </>
                  ) : (
                    'Tenho interesse'
                  )}
                </button>
                {live && ch && (
                  <button
                    className="btn small primary"
                    onClick={() => {
                      closeModal();
                      void voice.join(ch.id);
                    }}
                  >
                    Entrar na call
                  </button>
                )}
                {canManage && (
                  <>
                    <button className="btn small ghost" onClick={() => setEditing(e)}>
                      Editar
                    </button>
                    <button className="btn small ghost danger" onClick={() => void remove(e)}>
                      Cancelar evento
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={closeModal}>
          Fechar
        </button>
        {canCreate && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            Marcar evento
          </button>
        )}
      </div>
    </Modal>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function EventForm({ guild, event, onDone }: { guild: Guild; event: GuildEvent | null; onDone(): void }) {
  const defaultStart = () => {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    return d;
  };
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [start, setStart] = useState(toLocalInput(event ? new Date(event.startsAt) : defaultStart()));
  const initialHours = event?.endsAt ? Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 3600_000) : 0;
  const [hours, setHours] = useState(initialHours);
  const voiceChannels = guild.channels.filter((c) => c.type === 'voice');
  const [channelId, setChannelId] = useState(event ? (event.channelId ?? '') : (voiceChannels[0]?.id ?? ''));
  const { busy, error, submit } = useSubmit(async () => {
    const startsAt = new Date(start);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Escolha a data e a hora.');
    const body = {
      title: title.trim(),
      description: description.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: hours ? new Date(startsAt.getTime() + hours * 3600_000).toISOString() : null,
      channelId: channelId || null,
    };
    if (event) await api(`/events/${event.id}`, { method: 'PATCH', body });
    else await api(`/guilds/${guild.id}/events`, { body });
    toast(event ? 'Evento atualizado.' : 'Evento marcado! 📅');
    onDone();
  });
  return (
    <Modal title={event ? 'Editar evento' : 'Marcar evento'}>
      <form className="form" onSubmit={submit}>
        <label>
          Nome do evento
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required autoFocus placeholder="Jogatina de sexta" />
        </label>
        <label>
          Quando
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          Duração
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={0}>Sem hora para acabar</option>
            {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h === 24 ? '1 dia' : `${h} hora${h > 1 ? 's' : ''}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Onde
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Fora do Resenha / sem canal</option>
            {voiceChannels.map((c) => (
              <option key={c.id} value={c.id}>
                🔊 {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Descrição (opcional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} placeholder="Valorant 5x5, quem perder paga o lanche" />
        </label>
        <p className="muted small">Quem marcar "Tenho interesse" recebe um aviso quando o evento começar (no site e no celular).</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onDone}>
            Voltar
          </button>
          <button className="btn primary" disabled={busy || !title.trim()}>
            {event ? 'Salvar' : 'Marcar evento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ======================================================================
// Moderação automática (configurações do servidor)
// ======================================================================

export function AutomodPanel({ guild }: { guild: Guild }) {
  const [s, setS] = useState<AutomodSettings | null>(null);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ automod: AutomodSettings }>(`/guilds/${guild.id}/automod`).then(
      (r) => {
        setS(r.automod);
        setWords(r.automod.words.join(', '));
      },
      (e) => toast(e.message),
    );
  }, [guild.id]);
  if (!s) return <p className="muted">Carregando…</p>;
  const roles = guild.roles;

  async function save() {
    setBusy(true);
    try {
      const list = words
        .split(/[,\n]/)
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
      const r = await api<{ automod: AutomodSettings }>(`/guilds/${guild.id}/automod`, { method: 'PUT', body: { ...s, words: list } });
      setS(r.automod);
      setWords(r.automod.words.join(', '));
      toast('Moderação automática salva. 🛡️');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form automod">
      <h2>Moderação automática</h2>
      <p className="muted">
        O Resenha bloqueia sozinho as mensagens que quebram as regras abaixo, antes de alguém ver. Quem escreveu recebe o aviso e o bloqueio fica no
        Registro. Donos, administradores e quem gerencia mensagens não são filtrados.
      </p>
      <label>
        Palavras proibidas
        <textarea
          rows={4}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="separe por vírgula: palavrão, ofensa, xing*"
        />
      </label>
      <p className="muted small">
        Não diferencia maiúsculas nem acentos e pega os disfarces mais comuns (b0b4o, buuurro). Termine com * para pegar o começo da palavra
        (idiot* pega idiota e idiotice).
      </p>
      <label className="check">
        <input type="checkbox" checked={s.blockInvites} onChange={(e) => setS({ ...s, blockInvites: e.target.checked })} />
        Bloquear convites de outros servidores (Resenha e Discord)
      </label>
      <label className="check">
        <input type="checkbox" checked={s.blockLinks} onChange={(e) => setS({ ...s, blockLinks: e.target.checked })} />
        Bloquear todos os links
      </label>
      <label className="check">
        <input type="checkbox" checked={s.antiSpam} onChange={(e) => setS({ ...s, antiSpam: e.target.checked })} />
        Anti-spam: mesma mensagem repetida, menções demais, letras repetidas sem fim
      </label>
      {roles.length > 0 && (
        <fieldset className="automod-roles">
          <legend>Cargos que não passam pelo filtro</legend>
          {roles.map((r) => (
            <label key={r.id} className="check">
              <input
                type="checkbox"
                checked={s.exemptRoleIds.includes(r.id)}
                onChange={(e) =>
                  setS({ ...s, exemptRoleIds: e.target.checked ? [...s.exemptRoleIds, r.id] : s.exemptRoleIds.filter((x) => x !== r.id) })
                }
              />
              <span style={{ color: r.color }}>{r.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="muted small">Modo lento: fica nas configurações de cada canal (lápis ao lado do nome do canal).</p>
      <div className="modal-actions">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          Salvar moderação
        </button>
      </div>
    </div>
  );
}

// ======================================================================
// Notificações no celular (Configurações → Notificações e sons)
// ======================================================================

export function PushSettings() {
  const [on, setOn] = useState(pushActive());
  const [busy, setBusy] = useState(false);
  if (!pushSupported()) {
    return (
      <p className="muted small">
        {typeof window !== 'undefined' && 'serviceWorker' in navigator
          ? 'No app de Windows as notificações já aparecem pelo próprio app.'
          : 'Este navegador não recebe notificações com o Resenha fechado.'}
      </p>
    );
  }
  return (
    <div className="form push-settings">
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            if (e.target.checked) {
              const r = await enablePush();
              setOn(r.ok);
              if (!r.ok && r.error) toast(r.error);
              else toast('Notificações ligadas neste aparelho. 🔔');
            } else {
              await disablePush();
              setOn(false);
            }
            setBusy(false);
          }}
        />
        Notificações neste aparelho mesmo com o Resenha fechado (mensagens diretas, menções e eventos)
      </label>
      {needsHomeScreen() && (
        <p className="muted small">
          No iPhone/iPad: toque em Compartilhar → <strong>Adicionar à Tela de Início</strong>, abra o Resenha pelo ícone e ligue aqui.
        </p>
      )}
      {on && (
        <button
          className="btn ghost small"
          onClick={() =>
            api('/push/test', { body: {} }).then(
              () => toast('Notificação de teste enviada.'),
              (e) => toast(e.message),
            )
          }
        >
          Enviar notificação de teste
        </button>
      )}
      <p className="muted small">O texto vai criptografado até o seu aparelho. Você só recebe aqui quando não está com o Resenha aberto em outro lugar.</p>
    </div>
  );
}
