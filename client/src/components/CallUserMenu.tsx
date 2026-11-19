import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, User, Volume2, VolumeX } from 'lucide-react';
import type { VoiceState } from '../../../shared/types';
import { openDm } from '../lib/social';
import { findMember, openModal, useApp } from '../store/app';
import { setUserVolume, useVoice } from '../store/voice';
import { voiceMod, voiceModRights } from '../voice/moderation';
import { Avatar } from './Avatar';

/**
 * Menu de uma pessoa na call (botão direito no quadro dela ou no nome na lista do canal de voz), como no
 * Discord: ver perfil, mandar mensagem, volume só para você e silenciar só para você. Quem modera vê
 * também mover, silenciar/ensurdecer na call e tirar da call (o servidor confere a permissão).
 */
export interface CallMenuTarget {
  state: VoiceState;
  x: number;
  y: number;
}

let open: ((t: CallMenuTarget) => void) | null = null;
export function openCallUserMenu(state: VoiceState, x: number, y: number) {
  open?.({ state, x, y });
}

/** fica no app uma vez só (Layout) e abre onde a pessoa clicou */
export function CallUserMenuHost() {
  const [target, setTarget] = useState<CallMenuTarget | null>(null);
  useEffect(() => {
    open = setTarget;
    return () => {
      open = null;
    };
  }, []);
  if (!target) return null;
  return createPortal(<CallUserMenu key={target.state.socketId + target.x} target={target} onClose={() => setTarget(null)} />, document.body);
}

function CallUserMenu({ target, onClose }: { target: CallMenuTarget; onClose(): void }) {
  const { state } = target;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const user = useApp(() => findMember(state.guildId, state.userId));
  const meId = useApp((s) => s.me?.id);
  const guild = useApp((s) => (state.guildId ? s.guilds[state.guildId] : undefined));
  const allChannels = guild?.channels;
  const isMe = state.userId === meId;
  const rights = isMe ? { move: false, mute: false, deafen: false, any: false } : voiceModRights(guild, meId, state);
  const volume = useVoice((s) => s.settings.volumes[state.userId] ?? 1);
  const [lastVolume, setLastVolume] = useState(volume > 0 ? volume : 1);
  const [moving, setMoving] = useState(false);
  const name = user?.displayName ?? 'essa pessoa';

  // cabe na tela (abre para cima/esquerda se precisar)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - r.height - 8)),
    });
  }, [target.x, target.y, moving]);
  useEffect(() => {
    const off = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', off);
      document.addEventListener('contextmenu', off);
    }, 0);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('contextmenu', off);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const mod = (action: Parameters<typeof voiceMod>[0], channelId?: string) => {
    onClose();
    void voiceMod(action, state.socketId, channelId);
  };
  const channels = (allChannels ?? []).filter((c) => c.type === 'voice' && c.id !== state.channelId);

  return (
    <div className="vp-menu call-user-menu" role="menu" aria-label={`Opções de ${name}`} ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {moving ? (
        <>
          <div className="vp-menu-title">Mover {name} para:</div>
          {channels.length === 0 && <div className="vp-menu-empty">Não há outro canal de voz.</div>}
          {channels.map((c) => (
            <button key={c.id} role="menuitem" onClick={() => mod('move', c.id)}>
              <Volume2 size={14} /> {c.name}
            </button>
          ))}
          <button role="menuitem" className="muted" onClick={() => setMoving(false)}>
            ← Voltar
          </button>
        </>
      ) : (
        <>
          <div className="cum-head">
            <Avatar user={user} size={32} />
            <strong className="ellipsis">{name}</strong>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              openModal({ kind: 'profile', userId: state.userId, guildId: state.guildId || null });
            }}
          >
            <User size={15} /> Ver perfil
          </button>
          {!isMe && (
            <button
              role="menuitem"
              onClick={() => {
                onClose();
                void openDm(state.userId);
              }}
            >
              <MessageCircle size={15} /> Enviar mensagem
            </button>
          )}
          {!isMe && (
            <>
              <div className="cum-sep" />
              <label className="cum-volume">
                <span>
                  Volume <small className="muted">(só para você)</small>
                  <b>{Math.round(volume * 100)}%</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-label={`Volume de ${name}`}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0) setLastVolume(v);
                    setUserVolume(state.userId, v);
                  }}
                />
              </label>
              <button role="menuitemcheckbox" aria-checked={volume === 0} onClick={() => setUserVolume(state.userId, volume === 0 ? lastVolume : 0)}>
                {volume === 0 ? <Volume2 size={15} /> : <VolumeX size={15} />} {volume === 0 ? 'Ouvir de novo' : 'Silenciar para mim'}
              </button>
            </>
          )}
          {rights.any && (
            <>
              <div className="cum-sep" />
              <div className="vp-menu-title">Moderação</div>
              {rights.move && (
                <button role="menuitem" onClick={() => setMoving(true)}>
                  🔀 Mover para outro canal…
                </button>
              )}
              {rights.mute && (
                <button role="menuitem" onClick={() => mod(state.serverMuted ? 'unmute' : 'mute')}>
                  {state.serverMuted ? '🎙️ Tirar o silêncio' : '🔇 Silenciar na call'}
                </button>
              )}
              {rights.deafen && (
                <button role="menuitem" onClick={() => mod(state.serverDeafened ? 'undeafen' : 'deafen')}>
                  {state.serverDeafened ? '🎧 Tirar o ensurdecimento' : '🙉 Ensurdecer na call'}
                </button>
              )}
              {rights.move && (
                <button role="menuitem" className="danger" onClick={() => mod('disconnect')}>
                  📴 Tirar da call
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
