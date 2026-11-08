import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Hash,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  Pencil,
  PhoneOff,
  Plus,
  Settings,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import type { Channel, VoiceState } from '../../../shared/types';
import { api } from '../lib/api';
import { findChannel, findMember, openModal, selectChannel, toast, useApp } from '../store/app';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { canShareScreen } from '../voice/settings';
import { Avatar } from './Avatar';
import { HomeSidebar } from './HomeSidebar';

export function ChannelSidebar({ onLogout }: { onLogout(): void }) {
  const guildId = useApp((s) => s.selectedGuildId);
  const guild = useApp((s) => (guildId ? s.guilds[guildId] : undefined));
  const me = useApp((s) => s.me)!;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const isOwner = guild?.ownerId === me.id;
  const text = guild?.channels.filter((c) => c.type === 'text') ?? [];
  const voiceChannels = guild?.channels.filter((c) => c.type === 'voice') ?? [];

  async function leaveGuild() {
    if (!guild || !confirm(`Sair do servidor "${guild.name}"?`)) return;
    try {
      await api(`/guilds/${guild.id}/members/@me`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="sidebar">
      {guild ? (
        <div className="sidebar-header" ref={menuRef}>
          <button className="guild-name" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            <span className="ellipsis">{guild.name}</span>
            <ChevronDown size={18} />
          </button>
          {menuOpen && (
            <div className="menu" onClick={() => setMenuOpen(false)}>
              <button onClick={() => openModal({ kind: 'invite', guildId: guild.id })}>
                <UserPlus size={16} /> Convidar amigos
              </button>
              {isOwner && (
                <>
                  <button onClick={() => openModal({ kind: 'createChannel', guildId: guild.id, type: 'text' })}>
                    <Hash size={16} /> Criar canal de texto
                  </button>
                  <button onClick={() => openModal({ kind: 'createChannel', guildId: guild.id, type: 'voice' })}>
                    <Volume2 size={16} /> Criar canal de voz
                  </button>
                  <button onClick={() => openModal({ kind: 'guildSettings', guildId: guild.id })}>
                    <Settings size={16} /> Configurações do servidor
                  </button>
                </>
              )}
              {!isOwner && (
                <button className="danger" onClick={leaveGuild}>
                  <LogOut size={16} /> Sair do servidor
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="sidebar-header">
          <span className="guild-name static">Início</span>
        </div>
      )}

      <div className="channel-list">
        {!guild && <HomeSidebar />}
        {guild && (
          <>
            <Section title="Canais de texto" onAdd={isOwner ? () => openModal({ kind: 'createChannel', guildId: guild.id, type: 'text' }) : undefined} />
            {text.map((c) => (
              <TextChannelItem key={c.id} channel={c} canEdit={isOwner} />
            ))}
            <Section title="Canais de voz" onAdd={isOwner ? () => openModal({ kind: 'createChannel', guildId: guild.id, type: 'voice' }) : undefined} />
            {voiceChannels.map((c) => (
              <VoiceChannelItem key={c.id} channel={c} canEdit={isOwner} />
            ))}
          </>
        )}
      </div>

      <VoicePanel />
      <UserPanel onLogout={onLogout} />
    </div>
  );
}

function Section({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="section-title">
      <span>{title}</span>
      {onAdd && (
        <button className="icon-btn small" onClick={onAdd} aria-label={`Criar em ${title}`} title="Criar canal">
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

function TextChannelItem({ channel, canEdit }: { channel: Channel; canEdit: boolean }) {
  const active = useApp((s) => s.selectedChannelId === channel.id);
  const unread = useApp((s) => !!s.unread[channel.id]);
  return (
    <div className={`channel${active ? ' active' : ''}${unread ? ' unread' : ''}`}>
      <button className="channel-main" onClick={() => selectChannel(channel.id)}>
        <Hash size={18} className="channel-icon" />
        <span className="ellipsis">{channel.name}</span>
      </button>
      {canEdit && (
        <button className="icon-btn small channel-edit" aria-label="Editar canal" onClick={() => openModal({ kind: 'channelSettings', channelId: channel.id })}>
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

function VoiceChannelItem({ channel, canEdit }: { channel: Channel; canEdit: boolean }) {
  const active = useApp((s) => s.selectedChannelId === channel.id);
  const allStates = useApp((s) => s.voiceStates);
  const participants = Object.values(allStates).filter((v) => v.channelId === channel.id);
  const myChannel = useVoice((s) => s.channelId);

  return (
    <>
      <div className={`channel${active ? ' active' : ''}${myChannel === channel.id ? ' connected' : ''}`}>
        <button
          className="channel-main"
          onClick={() => {
            selectChannel(channel.id);
            void voice.join(channel.id);
          }}
        >
          <Volume2 size={18} className="channel-icon" />
          <span className="ellipsis">{channel.name}</span>
        </button>
        {canEdit && (
          <button className="icon-btn small channel-edit" aria-label="Editar canal" onClick={() => openModal({ kind: 'channelSettings', channelId: channel.id })}>
            <Pencil size={14} />
          </button>
        )}
      </div>
      {participants.length > 0 && (
        <ul className="voice-participants">
          {participants.map((p) => (
            <VoiceParticipant key={p.socketId} state={p} />
          ))}
        </ul>
      )}
    </>
  );
}

function VoiceParticipant({ state }: { state: VoiceState }) {
  const user = useApp(() => findMember(state.guildId, state.userId));
  const mySocket = useApp((s) => s.socketId);
  const speaking = useVoice((s) => (state.socketId === mySocket ? s.speaking.me : s.speaking[state.socketId]));
  return (
    <li className="voice-participant">
      <Avatar user={user} size={22} speaking={!!speaking && !state.muted} />
      <span className="ellipsis">{user?.displayName ?? 'Alguém'}</span>
      <span className="vp-icons">
        {state.screen && <span className="live-badge">AO VIVO</span>}
        {state.camera && <Video size={14} />}
        {state.deafened ? <HeadphoneOff size={14} className="danger-icon" /> : state.muted && <MicOff size={14} className="danger-icon" />}
      </span>
    </li>
  );
}

function VoicePanel() {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  // seletores retornam strings (valores estáveis) para não re-renderizar à toa
  const channelName = useApp((s) => findChannel(channelId)?.name);
  const guildName = useApp((s) => {
    const c = findChannel(channelId);
    return c ? s.guilds[c.guildId]?.name : undefined;
  });
  if (status === 'idle' || !channelId) return null;

  return (
    <div className="voice-panel">
      <div className="voice-panel-info">
        <button className="link-btn" onClick={() => selectChannel(channelId)}>
          <strong className={status === 'connected' ? 'ok' : 'warn'}>
            {status === 'connected' ? 'Voz conectada' : 'Conectando…'}
          </strong>
          <span className="muted ellipsis">
            {channelName} / {guildName}
          </span>
        </button>
        <button className="icon-btn" title="Desconectar" aria-label="Desconectar" onClick={() => voice.leave()}>
          <PhoneOff size={20} />
        </button>
      </div>
      <div className="voice-panel-actions">
        <button className={`btn small${camera ? ' on' : ''}`} onClick={() => void voice.toggleCamera()}>
          {camera ? <VideoOff size={16} /> : <Video size={16} />} Câmera
        </button>
        {canShareScreen() && (
          <button
            className={`btn small${screen ? ' on' : ''}`}
            onClick={() => (screen ? voice.stopScreen() : openModal({ kind: 'screenShare' }))}
          >
            <MonitorUp size={16} /> {screen ? 'Parar' : 'Tela'}
          </button>
        )}
      </div>
    </div>
  );
}

function UserPanel({ onLogout: _onLogout }: { onLogout(): void }) {
  const me = useApp((s) => s.me)!;
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const speaking = useVoice((s) => !!s.speaking.me);
  return (
    <div className="user-panel">
      <Avatar user={me} size={34} speaking={speaking} />
      <div className="user-panel-name">
        <strong className="ellipsis">{me.displayName}</strong>
        <span className="muted ellipsis">@{me.username}</span>
      </div>
      <button
        className={`icon-btn${muted ? ' danger-icon' : ''}`}
        title={muted ? 'Ativar microfone' : 'Silenciar microfone'}
        aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'}
        onClick={() => voice.setMuted(!muted)}
      >
        {muted ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <button
        className={`icon-btn${deafened ? ' danger-icon' : ''}`}
        title={deafened ? 'Ativar áudio' : 'Desativar áudio'}
        aria-label={deafened ? 'Ativar áudio' : 'Desativar áudio'}
        onClick={() => voice.setDeafened(!deafened)}
      >
        {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      </button>
      <button className="icon-btn" title="Configurações" aria-label="Configurações" onClick={() => openModal({ kind: 'userSettings' })}>
        <Settings size={20} />
      </button>
    </div>
  );
}
