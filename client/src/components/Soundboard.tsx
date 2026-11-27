import { useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { expressionGroups } from '../lib/expressions';
import { Perm, has, myPermissions } from '../lib/perms';
import { playOnSoundboard } from '../lib/soundboard';
import { openModal, useApp } from '../store/app';
import { updateSettings, useVoice } from '../store/voice';
import { useDismiss } from './EmojiPicker';

/** Botão + painel do soundboard (sons de todos os seus servidores; os do servidor da chamada primeiro). */
export function SoundboardButton({ className, small }: { className: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const guildId = useVoice((s) => s.guildId);
  const allowed = useApp((s) => !guildId || has(myPermissions(s.guilds[guildId], s.me?.id), Perm.USE_SOUNDBOARD));
  return (
    <span className="soundboard-anchor">
      <button
        className={className}
        data-picker-toggle
        aria-label="Soundboard"
        title={allowed ? 'Soundboard' : 'Seu cargo não pode usar o soundboard neste servidor'}
        disabled={!allowed}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <AudioLines size={small ? 16 : undefined} />
        {small && ' Sons'}
      </button>
      {open && <SoundboardPanel guildId={guildId} onClose={() => setOpen(false)} />}
    </span>
  );
}

function SoundboardPanel({ guildId, onClose }: { guildId: string | null; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const guilds = useApp((s) => s.guilds);
  const order = useApp((s) => s.guildOrder);
  const canAdd = useApp((s) => !!guildId && has(myPermissions(s.guilds[guildId], s.me?.id), Perm.MANAGE_EXPRESSIONS));
  const volume = useVoice((s) => s.settings.soundboardVolume);
  const groups = expressionGroups(guilds, order, 'sound', guildId);

  return (
    <div className="soundboard-panel" ref={ref} role="dialog" aria-label="Soundboard">
      <div className="soundboard-head">
        <strong>Soundboard</strong>
        <label className="soundboard-volume" title="Volume dos sons (só para você)">
          🔈
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label="Volume do soundboard"
            onChange={(e) => updateSettings({ soundboardVolume: Number(e.target.value) })}
          />
        </label>
      </div>
      {groups.length === 0 && (
        <p className="muted small">
          Nenhum som ainda.{' '}
          {canAdd && (
            <button
              className="link-btn"
              onClick={() => {
                onClose();
                openModal({ kind: 'guildSettings', guildId: guildId!, tab: 'expressions' });
              }}
            >
              Adicionar sons
            </button>
          )}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.guild.id} className="emoji-group">
          {groups.length > 1 && <div className="emoji-group-title ellipsis">{g.guild.name}</div>}
          <div className="sound-grid">
            {g.items.map((s) => (
              <button key={s.id} className="sound-btn" aria-label={`Tocar ${s.name}`} onClick={() => playOnSoundboard(s.id)}>
                <span className="sound-emoji">{s.emoji ?? '🔊'}</span>
                <span className="ellipsis">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Emoji do som que a pessoa acabou de tocar (em cima do bloco dela). */
export function SoundBurstBadge({ socketId }: { socketId: string }) {
  const burst = useVoice((s) => s.soundBursts[socketId]);
  if (!burst) return null;
  return (
    <span key={burst.key} className="sound-burst" title={burst.name} aria-label={`Tocou ${burst.name}`}>
      {burst.emoji}
    </span>
  );
}
