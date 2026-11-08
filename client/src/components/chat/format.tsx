import { Fragment, type ReactNode } from 'react';
import type { PublicUser } from '../../../../shared/types';
import { MENTION_RE } from '../../lib/mentions';
import { useApp } from '../../store/app';

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
function renderMentions(text: string, keyPrefix: string, meUsername: string, inGuild: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index! + m[1].length;
    const name = m[2].toLowerCase();
    const user = name === 'todos' ? null : findByUsername(name);
    if (name === 'todos' ? !inGuild : !user) continue;
    if (start > last) out.push(<Fragment key={`${keyPrefix}-t${last}`}>{text.slice(last, start)}</Fragment>);
    const isMe = name === 'todos' || name === meUsername;
    out.push(
      <span key={`${keyPrefix}-m${start}`} className={`mention${isMe ? ' me' : ''}`} title={user ? `@${user.username}` : 'Todos do servidor'}>
        @{user ? user.displayName : 'todos'}
      </span>,
    );
    last = start + 1 + m[2].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyPrefix}-t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

export function renderContent(text: string, opts: { meUsername: string; inGuild: boolean }): ReactNode[] {
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
      out.push(...renderMentions(part, String(i), opts.meUsername, opts.inGuild));
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
