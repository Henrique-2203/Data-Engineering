import { useEffect, useRef, useState, type RefObject } from 'react';
import { emojiToken, expressionGroups, fileUrl } from '../lib/expressions';
import { useApp } from '../store/app';

/** Seleção de emojis mais usados em conversa (sem biblioteca: o celular já desenha os emojis). */
const EMOJIS = [
  '👍', '👎', '😂', '🤣', '😭', '😍', '🥰', '😎', '🤔', '😮',
  '😱', '😡', '🥲', '😅', '🙏', '👏', '🙌', '💪', '🫡', '🤝',
  '❤️', '🔥', '💯', '✅', '❌', '⭐', '🎉', '🏆', '👀', '💀',
  '🎮', '🕹️', '🎯', '🍿', '🍕', '🍺', '☕', '⚽', '🇧🇷', '🤡',
];

interface Props {
  onPick(emoji: string): void;
  onClose(): void;
  /** mostrar os emojis personalizados dos seus servidores (não serve para o status) */
  custom?: boolean;
  /** servidor atual: os emojis dele aparecem primeiro */
  guildId?: string | null;
  /** texto dos botões: "Reagir com" (padrão) ou "Inserir" */
  verb?: string;
}

/** Fecha ao clicar fora ou apertar Esc (o botão que abre/fecha, marcado com data-picker-toggle, não conta). */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('[data-picker-toggle]')) latest.current();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && latest.current();
    // registra no próximo ciclo para o clique que abriu não fechar na hora
    const t = setTimeout(() => document.addEventListener('pointerdown', close));
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [ref]);
}

export function EmojiPicker({ onPick, onClose, custom = true, guildId, verb = 'Reagir com' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const guilds = useApp((s) => s.guilds);
  const order = useApp((s) => s.guildOrder);
  const groups = custom ? expressionGroups(guilds, order, 'emoji', guildId) : [];
  const q = search.trim().toLowerCase().replace(/:/g, '');
  const filtered = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((e) => e.name.includes(q)) : g.items }))
    .filter((g) => g.items.length);
  const totalCustom = groups.reduce((n, g) => n + g.items.length, 0);

  useDismiss(ref, onClose);

  const pick = (e: string) => {
    onPick(e);
    onClose();
  };

  return (
    <div className={`emoji-picker${totalCustom ? ' with-custom' : ''}`} ref={ref} role="dialog" aria-label="Escolher emoji">
      {totalCustom > 12 && (
        <input className="emoji-search" placeholder="Buscar emoji do servidor" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar emoji" />
      )}
      {filtered.map((g) => (
        <div key={g.guild.id} className="emoji-group">
          <div className="emoji-group-title ellipsis">{g.guild.name}</div>
          <div className="emoji-grid">
            {g.items.map((e) => (
              <button key={e.id} className="emoji-btn" aria-label={`${verb} :${e.name}:`} title={`:${e.name}:`} onClick={() => pick(emojiToken(e))}>
                <img src={fileUrl(e.fileId)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {!q && (
        <div className="emoji-group">
          {totalCustom > 0 && <div className="emoji-group-title">Padrão</div>}
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button key={e} className="emoji-btn" aria-label={`${verb} ${e}`} onClick={() => pick(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
