import { Fragment, useState, type ReactNode } from 'react';
import type { PublicUser } from '../../../../shared/types';
import { MENTION_RE } from '../../lib/mentions';
import { findChannel, openModal, selectChannel, useApp } from '../../store/app';
import { isEmojiOnly, renderCustomEmojis } from '../../lib/expressions';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;

/** Procura alguém pelo @usuario entre você, membros dos servidores, DMs e amigos. */
export function findByUsername(username: string): PublicUser | undefined {
  const s = useApp.getState();
  const u = username.toLowerCase();
  if (s.me?.username === u) return s.me;
  for (const g of Object.values(s.guilds)) {
    const m = g.members.find((m) => m.username === u);
    if (m) return m;
  }
  for (const dm of Object.values(s.dms)) if (dm.recipient.username === u) return dm.recipient;
  return s.friends.find((f) => f.user.username === u)?.user;
}

/** Texto com @menções destacadas (só quando a pessoa existe, ou @todos em servidores). */
function renderMentions(text: string, keyPrefix: string, meUsername: string, everyone: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index! + m[1].length;
    const name = m[2].toLowerCase();
    const user = name === 'todos' ? null : findByUsername(name);
    if (name === 'todos' ? !everyone : !user) continue;
    if (start > last) out.push(<Fragment key={`${keyPrefix}-t${last}`}>{text.slice(last, start)}</Fragment>);
    const isMe = name === 'todos' || name === meUsername;
    out.push(
      user ? (
        // tocar no @ abre o perfil da pessoa (sugestão da comunidade)
        <button
          type="button"
          key={`${keyPrefix}-m${start}`}
          className={`mention mention-btn${isMe ? ' me' : ''}`}
          title={`Ver o perfil de @${user.username}`}
          onClick={(e) => {
            e.stopPropagation();
            const s = useApp.getState();
            openModal({ kind: 'profile', userId: user.id, guildId: s.selectedGuildId });
          }}
        >
          @{user.displayName}
        </button>
      ) : (
        <span key={`${keyPrefix}-m${start}`} className={`mention${isMe ? ' me' : ''}`} title="Todos do servidor">
          @todos
        </span>
      ),
    );
    last = start + 1 + m[2].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyPrefix}-t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

/** Canal marcado na mensagem: "#nome" que abre o canal (ou "#canal" apagado/sem acesso). */
function ChannelChip({ id }: { id: string }) {
  const c = useApp(() => findChannel(id));
  if (!c) return <span className="mention channel-mention gone">#canal</span>;
  return (
    <button
      type="button"
      className="mention channel-mention"
      title={c.type === 'voice' ? 'Abrir o canal de voz' : 'Abrir o canal'}
      onClick={(e) => {
        e.stopPropagation();
        selectChannel(c.id);
      }}
    >
      {c.type === 'voice' ? '🔊 ' : '#'}
      {c.name}
    </button>
  );
}

/** Spoiler: ||texto|| fica escondido até tocar. */
function Spoiler({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <span
      className={`md-spoiler${on ? ' on' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={on ? undefined : 'Spoiler: toque para ver'}
      onClick={(e) => {
        e.stopPropagation();
        setOn(true);
      }}
      onKeyDown={(e) => e.key === 'Enter' && setOn(true)}
    >
      {children}
    </span>
  );
}

// links viram marcadores antes da formatação (um "_" dentro de um link não vira itálico)
const PH = /(\d+)/g;
type Leaf = (text: string, key: string) => ReactNode[];

/** Formatação dentro da linha (igual à do Discord/WhatsApp): **negrito**, *itálico*, __sublinhado__, ~~riscado~~, `código`, ||spoiler||. */
const RULES: { re: RegExp; wrap(inner: ReactNode[], raw: string, key: string): ReactNode; raw?: boolean }[] = [
  { re: /`([^`\n]+)`/, raw: true, wrap: (_i, raw, k) => <code key={k} className="md-code">{raw}</code> },
  { re: /\|\|(.+?)\|\|/s, wrap: (i, _r, k) => <Spoiler key={k}>{i}</Spoiler> },
  { re: /\*\*(.+?)\*\*/s, wrap: (i, _r, k) => <strong key={k}>{i}</strong> },
  { re: /__(.+?)__/s, wrap: (i, _r, k) => <u key={k}>{i}</u> },
  { re: /~~(.+?)~~/s, wrap: (i, _r, k) => <s key={k}>{i}</s> },
  { re: /(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/s, wrap: (i, _r, k) => <em key={k}>{i}</em> },
  { re: /(?<![\p{L}\p{N}_])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}_])/su, wrap: (i, _r, k) => <em key={k}>{i}</em> },
];

function inline(text: string, key: string, leaf: Leaf, restore: (s: string) => string): ReactNode[] {
  let best: { m: RegExpExecArray; rule: (typeof RULES)[number] } | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m && (!best || m.index < best.m.index)) best = { m, rule };
  }
  if (!best) return leaf(text, key);
  const { m, rule } = best;
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const k = `${key}-${m.index}`;
  return [
    ...(before ? leaf(before, `${k}b`) : []),
    rule.wrap(rule.raw ? [] : inline(m[1], `${k}i`, leaf, restore), restore(m[1]), k),
    ...(after ? inline(after, `${k}a`, leaf, restore) : []),
  ];
}

/** Formatação por linha: # título, ## subtítulo, ### menor, -# texto pequeno, > citação, - lista, 1. lista numerada, ``` bloco de código ```. */
function blocks(src: string, leaf: Leaf, restore: (s: string) => string): ReactNode[] {
  const out: ReactNode[] = [];
  const segs = src.split(/```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/i);
  segs.forEach((seg, si) => {
    if (si % 2 === 1) {
      out.push(<code key={`pre${si}`} className="md-pre">{restore(seg.replace(/^\n|\n$/g, ''))}</code>);
      return;
    }
    const lines = seg.split('\n');
    // a quebra de linha logo antes/depois de um bloco de código não vira linha vazia
    if (si > 0 && lines[0] === '') lines.shift();
    if (si < segs.length - 1 && lines[lines.length - 1] === '') lines.pop();
    let quote: ReactNode[] | null = null;
    const flushQuote = (k: string) => {
      if (quote) out.push(<span key={`q${k}`} className="md-quote">{quote}</span>);
      quote = null;
    };
    lines.forEach((line, li) => {
      const k = `${si}-${li}`;
      const q = /^>\s?(.*)$/.exec(line);
      if (q) {
        (quote ??= []).push(<span key={k} className="md-line">{inline(q[1], k, leaf, restore)}</span>);
        return;
      }
      flushQuote(k);
      const h = /^((?:@\S+\s+)*)(#{1,3})\s+(.+)$/.exec(line);
      const sub = /^-#\s+(.+)$/.exec(line);
      const li1 = /^\s*[-*•]\s+(.+)$/.exec(line);
      const ln = /^\s*(\d{1,3})[.)]\s+(.+)$/.exec(line);
      if (h) {
        out.push(
          <span key={k} className={`md-line md-h md-h${h[2].length}`}>
            {h[1] ? inline(h[1], `${k}p`, leaf, restore) : null}
            {inline(h[3], k, leaf, restore)}
          </span>,
        );
      } else if (sub) {
        out.push(<span key={k} className="md-line md-sub">{inline(sub[1], k, leaf, restore)}</span>);
      } else if (li1 && !sub) {
        out.push(<span key={k} className="md-line md-li">{inline(li1[1], k, leaf, restore)}</span>);
      } else if (ln) {
        out.push(<span key={k} className="md-line md-li md-ol" data-n={`${ln[1]}.`}>{inline(ln[2], k, leaf, restore)}</span>);
      } else {
        out.push(<span key={k} className="md-line">{line ? inline(line, k, leaf, restore) : null}</span>);
      }
    });
    flushQuote(`${si}-end`);
  });
  return out;
}

export function renderContent(text: string, opts: { meUsername: string; everyone: boolean }): ReactNode[] {
  const big = isEmojiOnly(text);
  const mention = (t: string, key: string) => renderMentions(t, key, opts.meUsername, opts.everyone);
  if (big) return [<span key="big" className="emoji-only">{renderCustomEmojis(text, 'e', mention, true)}</span>];
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (u) => `${urls.push(u) - 1}`);
  const restore = (s: string) => s.replace(PH, (_m, i) => urls[Number(i)]);
  const leaf: Leaf = (t, key) => {
    const parts = t.split(PH);
    const out: ReactNode[] = [];
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const href = urls[Number(part)];
        out.push(
          <a key={`${key}-l${i}`} href={href} target="_blank" rel="noopener noreferrer">
            {href}
          </a>,
        );
      } else if (part) {
        // <#id> = canal marcado: vira "#nome" clicável
        part.split(/<#([0-9a-f-]{8,64})>/i).forEach((seg, j) => {
          if (j % 2 === 1) out.push(<ChannelChip key={`${key}-c${i}-${j}`} id={seg} />);
          else if (seg) out.push(...renderCustomEmojis(seg, `${key}-${i}-${j}`, mention, false));
        });
      }
    });
    return out;
  };
  const out = blocks(masked, leaf, restore);
  for (const src of urls.filter((u) => IMG_RE.test(u)).slice(0, 4)) out.push(<ExternalImage key={`img-${src}`} src={src} />);
  return out;
}

const OK_HOSTS_KEY = 'resenha.imageHosts';
const okHosts = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(OK_HOSTS_KEY) ?? '[]');
  } catch {
    return [];
  }
};

/**
 * Imagem de OUTRO site (link no chat): só carrega depois de um clique. Carregar sozinho entregaria o seu endereço de
 * internet (e o horário em que você abriu o chat) para quem hospeda a imagem: é como um "pixel de rastreio".
 */
function ExternalImage({ src }: { src: string }) {
  let host = '';
  try {
    host = new URL(src).hostname;
  } catch {
    return null;
  }
  const [shown, setShown] = useState(() => okHosts().includes(host));
  if (shown) {
    return (
      <a className="message-image" href={src} target="_blank" rel="noopener noreferrer">
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </a>
    );
  }
  return (
    <div className="message-image-gate">
      <button type="button" className="btn small" onClick={() => setShown(true)} title="O site que hospeda a imagem vai ver o seu endereço de internet">
        🖼️ Carregar imagem de {host}
      </button>
      <button
        type="button"
        className="link-btn small"
        onClick={() => {
          try {
            localStorage.setItem(OK_HOSTS_KEY, JSON.stringify([...new Set([...okHosts(), host])].slice(-50)));
          } catch {
            /* sem armazenamento: só desta vez */
          }
          setShown(true);
        }}
      >
        sempre deste site
      </button>
    </div>
  );
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

export function formatTime(iso: string) {
  return timeFmt.format(new Date(iso));
}

export function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dayFmt.format(d);
}

export function formatDateTime(iso: string) {
  const day = formatDay(iso);
  const prefix = day === 'Hoje' || day === 'Ontem' ? day : new Date(iso).toLocaleDateString('pt-BR');
  return `${prefix} às ${formatTime(iso)}`;
}
