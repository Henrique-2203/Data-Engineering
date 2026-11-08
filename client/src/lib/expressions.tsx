import { Fragment, useState, type ReactNode } from 'react';
import type { Expression, ExpressionKind, Guild } from '../../../shared/types';
import { useApp } from '../store/app';

/** Emoji personalizado dentro do texto: <:nome:id> */
export const CUSTOM_EMOJI_RE = /<:([a-z0-9_]{2,32}):([0-9a-f-]{36})>/g;
const SINGLE_CUSTOM_RE = /^<:([a-z0-9_]{2,32}):([0-9a-f-]{36})>$/;

export const fileUrl = (fileId: string) => `/api/images/${fileId}`;
export const emojiToken = (e: Pick<Expression, 'name' | 'id'>) => `<:${e.name}:${e.id}>`;

export interface ExpressionGroup {
  guild: Pick<Guild, 'id' | 'name' | 'iconId'>;
  items: Expression[];
}

/**
 * Emojis/figurinhas/sons de todos os seus servidores (dá para usar em qualquer lugar, de graça).
 * O servidor `firstGuildId` aparece primeiro.
 */
export function expressionGroups(guilds: Record<string, Guild>, order: string[], kind: ExpressionKind, firstGuildId?: string | null): ExpressionGroup[] {
  const ids = firstGuildId && guilds[firstGuildId] ? [firstGuildId, ...order.filter((id) => id !== firstGuildId)] : order;
  const out: ExpressionGroup[] = [];
  for (const id of ids) {
    const g = guilds[id];
    const items = g?.expressions?.filter((e) => e.kind === kind) ?? [];
    if (items.length) out.push({ guild: { id: g.id, name: g.name, iconId: g.iconId }, items });
  }
  return out;
}

/** Procura um emoji pelo id entre os seus servidores (para mostrar o nome atualizado). */
export function findExpression(id: string): Expression | undefined {
  for (const g of Object.values(useApp.getState().guilds)) {
    const e = g.expressions?.find((x) => x.id === id);
    if (e) return e;
  }
}

/** Imagem do emoji personalizado; se ele foi apagado, vira o texto :nome:. */
export function CustomEmoji({ name, id, big }: { name: string; id: string; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  // pelo id do emoji (funciona até para quem não está no servidor dele)
  const src = `/api/emojis/${id}`;
  if (broken) return <span className="custom-emoji-missing">:{name}:</span>;
  return (
    <img
      className={`custom-emoji${big ? ' big' : ''}`}
      src={src}
      alt={`:${name}:`}
      title={`:${name}:`}
      draggable={false}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/** Um emoji (padrão ou personalizado), como nas reações. */
export function EmojiView({ emoji, big }: { emoji: string; big?: boolean }) {
  const m = SINGLE_CUSTOM_RE.exec(emoji);
  if (m) return <CustomEmoji name={m[1]} id={m[2]} big={big} />;
  return <>{emoji}</>;
}

/** Nome legível para textos simples (notificações, dicas): <:festa:id> -> :festa: */
export const plainEmojis = (text: string) => text.replace(CUSTOM_EMOJI_RE, ':$1:');

/** Divide o texto em pedaços: texto comum (passa por `renderText`) e emojis personalizados. */
export function renderCustomEmojis(text: string, keyPrefix: string, renderText: (t: string, key: string) => ReactNode[], big = false): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CUSTOM_EMOJI_RE)) {
    if (m.index! > last) out.push(...renderText(text.slice(last, m.index), `${keyPrefix}-${last}`));
    out.push(<CustomEmoji key={`${keyPrefix}-e${m.index}`} name={m[1]} id={m[2]} big={big} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...renderText(text.slice(last), `${keyPrefix}-${last}`));
  return out.length ? out : [<Fragment key={keyPrefix} />];
}

/** Mensagem só com emojis (até 27): mostra grande, como no Discord. */
export function isEmojiOnly(text: string): boolean {
  const rest = text.replace(CUSTOM_EMOJI_RE, '').replace(/\s+/g, '');
  const customs = text.match(CUSTOM_EMOJI_RE)?.length ?? 0;
  if (!rest) return customs > 0 && customs <= 27;
  if (!/^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣)+$/u.test(rest)) return false;
  const count = [...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(rest)].length + customs;
  return count <= 27;
}
