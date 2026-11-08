import { useEffect, useRef } from 'react';

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
}

export function EmojiPicker({ onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // registra no próximo ciclo para o clique que abriu não fechar na hora
    const t = setTimeout(() => document.addEventListener('pointerdown', close));
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="Escolher emoji">
      {EMOJIS.map((e) => (
        <button
          key={e}
          className="emoji-btn"
          aria-label={`Reagir com ${e}`}
          onClick={() => {
            onPick(e);
            onClose();
          }}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
