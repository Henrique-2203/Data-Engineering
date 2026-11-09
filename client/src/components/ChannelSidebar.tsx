import { useEffect, useRef, useState } from 'react';
import { EventsButton } from './Community';
import {
  UserPen,
  Flag,
  ShieldAlert,
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
  FolderPlus,
  Lock,
  Plus,
  Settings,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import type { Channel, VoiceState } from '../../../shared/types';
import { api } from '../lib/api';
import { findChannel, findMember, openModal, selectChannel, toast, updateGuildChannels, useApp } from '../store/app';
import { Perm, has, imageUrl, memberColor, myPermissions, usePerms } from '../lib/perms';
import { refreshGuild } from '../lib/socket';
import { presenceLine } from '../lib/presence';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { SoundboardButton } from './Soundboard';
import { canShareScreen } from '../voice/settings';
import { Avatar } from './Avatar';
import { HomeSidebar } from './HomeSidebar';

export function ChannelSidebar({ onLogout }: { onLogout(): void }) {
  const guildId = useApp((s) => s.selectedGuildId);
  const guild = useApp((s) => (guildId ? s.guilds[guildId] : undefined));
  const me = useApp((s) => s.me)!;
  const perms = usePerms(guildId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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
  const canManage = has(perms, Perm.MANAGE_CHANNELS);
  const canSettings = [Perm.MANAGE_GUILD, Perm.MANAGE_ROLES, Perm.KICK, Perm.BAN, Perm.TIMEOUT, Perm.MANAGE_EXPRESSIONS, Perm.MANAGE_NICKNAMES, Perm.VIEW_AUDIT_LOG].some((p) => has(perms, p));
  const canInvite = has(perms, Perm.CREATE_INVITE);

  const sorted = [...(guild?.channels ?? [])].sort((a, b) => a.position - b.position);
  const uncatText = sorted.filter((c) => !c.categoryId && c.type === 'text');
  const uncatVoice = sorted.filter((c) => !c.categoryId && c.type === 'voice');
  const categories = [...(guild?.categories ?? [])].sort((a, b) => a.position - b.position);

  async function leaveGuild() {
    if (!guild || !confirm(`Sair do servidor "${guild.name}"?`)) return;
    try {
      await api(`/guilds/${guild.id}/members/@me`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  /**
   * Arrastar e soltar: move o canal arrastado para antes de `beforeId` (ou para o fim do grupo)
   * dentro da categoria `categoryId`, salva a nova ordem e já mostra na hora.
   */
  async function moveChannel(categoryId: string | null, beforeId: string | null) {
    if (!guild || !dragId) return;
    const dragged = sorted.find((c) => c.id === dragId);
    setDragId(null);
    setDropTarget(null);
    if (!dragged || dragged.id === beforeId) return;
    // ordem atual exibida: sem categoria (texto, voz) e depois cada categoria
    const groups: Channel[][] = [uncatText, uncatVoice, ...categories.map((cat) => sorted.filter((c) => c.categoryId === cat.id))];
    const order = groups.flat().filter((c) => c.id !== dragged.id);
    const moved = { ...dragged, categoryId };
    let index = beforeId ? order.findIndex((c) => c.id === beforeId) : -1;
    if (index < 0) {
      // fim do grupo de destino
      const last = order.map((c, i) => [c, i] as const).filter(([c]) => (c.categoryId ?? null) === categoryId && (categoryId || c.type === dragged.type)).pop();
      index = last ? last[1] + 1 : order.length;
    }
    order.splice(index, 0, moved);
    updateGuildChannels(guild.id, (list) =>
      list.map((c) => {
        const i = order.findIndex((o) => o.id === c.id);
        return i >= 0 ? { ...c, position: i, categoryId: order[i].categoryId ?? null } : c;
      }),
    );
    try {
      await api(`/guilds/${guild.id}/layout`, {
        method: 'PUT',
        body: { categories: categories.map((c) => c.id), channels: order.map((c) => ({ id: c.id, categoryId: c.categoryId ?? null })) },
      });
    } catch (err) {
      toast((err as Error).message);
      void refreshGuild(guild.id);
    }
  }

  const dnd = (channel: Channel): DragProps | undefined =>
    canManage
      ? {
          draggable: true,
          dragging: dragId === channel.id,
          over: dropTarget === channel.id && dragId !== channel.id,
          onDragStart: () => setDragId(channel.id),
          onDragEnd: () => {
            setDragId(null);
            setDropTarget(null);
          },
          onDragOver: () => setDropTarget(channel.id),
          onDrop: () => void moveChannel(channel.categoryId ?? null, channel.id),
        }
      : undefined;

  const groupDrop = (key: string, categoryId: string | null) =>
    canManage && dragId
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            setDropTarget(key);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            void moveChannel(categoryId, null);
          },
          className: dropTarget === key ? ' drop-into' : '',
        }
      : { className: '' };

  const renderChannel = (c: Channel) =>
    c.type === 'voice' ? (
      <VoiceChannelItem key={c.id} channel={c} canEdit={canManage} drag={dnd(c)} />
    ) : (
      <TextChannelItem key={c.id} channel={c} canEdit={canManage} drag={dnd(c)} />
    );

  const banner = imageUrl(guild?.bannerId);

  return (
    <div className="sidebar">
      {guild ? (
        <div className={`sidebar-header${banner ? ' with-banner' : ''}`} ref={menuRef} style={banner ? { backgroundImage: `url(${banner})` } : undefined}>
          <button className="guild-name" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            <span className="ellipsis">{guild.name}</span>
            <ChevronDown size={18} />
          </button>
          {menuOpen && (
            <div className="menu" onClick={() => setMenuOpen(false)}>
              {canInvite && (
                <button onClick={() => openModal({ kind: 'invite', guildId: guild.id })}>
                  <UserPlus size={16} /> Convidar amigos
                </button>
              )}
              {canSettings && (
                <button onClick={() => openModal({ kind: 'guildSettings', guildId: guild.id })}>
                  <Settings size={16} /> Configurações do servidor
                </button>
              )}
              {canManage && (
                <>
                  <button onClick={() => openModal({ kind: 'createChannel', guildId: guild.id, type: 'text' })}>
                    <Hash size={16} /> Criar canal
                  </button>
                  <button onClick={() => openModal({ kind: 'createCategory', guildId: guild.id })}>
                    <FolderPlus size={16} /> Criar categoria
                  </button>
                </>
              )}
              <button onClick={() => openModal({ kind: 'guildProfile', guildId: guild.id })}>
                <UserPen size={16} /> Meu perfil neste servidor
              </button>
              {!isOwner && (
                <button onClick={() => openModal({ kind: 'report', target: { type: 'guild', id: guild.id, label: guild.name } })}>
                  <Flag size={16} /> Denunciar servidor
                </button>
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
            {guild.description && <p className="guild-description muted small">{guild.description}</p>}
            <EventsButton guild={guild} />
            {(uncatText.length > 0 || canManage) && (
              <div {...groupDrop('__text', null)} className={`channel-group${groupDrop('__text', null).className}`}>
                <Section title="Canais de texto" onAdd={canManage ? () => openModal({ kind: 'createChannel', guildId: guild.id, type: 'text' }) : undefined} />
                {uncatText.map(renderChannel)}
              </div>
            )}
            {(uncatVoice.length > 0 || canManage) && (
              <div {...groupDrop('__voice', null)} className={`channel-group${groupDrop('__voice', null).className}`}>
                <Section title="Canais de voz" onAdd={canManage ? () => openModal({ kind: 'createChannel', guildId: guild.id, type: 'voice' }) : undefined} />
                {uncatVoice.map(renderChannel)}
              </div>
            )}
            {categories.map((cat) => {
              const list = sorted.filter((c) => c.categoryId === cat.id);
              if (!list.length && !canManage) return null;
              const drop = groupDrop(cat.id, cat.id);
              return (
                <div key={cat.id} {...drop} className={`channel-group${drop.className}`}>
                  <Section
                    title={cat.name}
                    onAdd={canManage ? () => openModal({ kind: 'createChannel', guildId: guild.id, type: 'text', categoryId: cat.id }) : undefined}
                    onEdit={canManage ? () => openModal({ kind: 'categorySettings', guildId: guild.id, categoryId: cat.id }) : undefined}
                  />
                  {list.map(renderChannel)}
                  {!list.length && <p className="muted small empty-category">Arraste canais para cá</p>}
                </div>
              );
            })}
          </>
        )}
      </div>

      <VoicePanel />
      <UserPanel onLogout={onLogout} />
    </div>
  );
}

interface DragProps {
  draggable: boolean;
  dragging: boolean;
  over: boolean;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOver(): void;
  onDrop(): void;
}

/** Atributos de arrastar para a linha do canal. */
function dragAttrs(drag?: DragProps) {
  if (!drag) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'canal');
      drag.onDragStart();
    },
    onDragEnd: drag.onDragEnd,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drag.onDragOver();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drag.onDrop();
    },
  };
}

function Section({ title, onAdd, onEdit }: { title: string; onAdd?: () => void; onEdit?: () => void }) {
  return (
    <div className="section-title">
      <span className="ellipsis">{title}</span>
      <span className="section-actions">
        {onEdit && (
          <button className="icon-btn small" onClick={onEdit} aria-label={`Editar categoria ${title}`} title="Editar categoria">
            <Settings size={14} />
          </button>
        )}
        {onAdd && (
          <button className="icon-btn small" onClick={onAdd} aria-label={`Criar em ${title}`} title="Criar canal">
            <Plus size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

function TextChannelItem({ channel, canEdit, drag }: { channel: Channel; canEdit: boolean; drag?: DragProps }) {
  const active = useApp((s) => s.selectedChannelId === channel.id);
  const unread = useApp((s) => !!s.unread[channel.id]);
  const mentions = useApp((s) => s.mentions[channel.id] ?? 0);
  return (
    <div
      className={`channel${active ? ' active' : ''}${unread ? ' unread' : ''}${drag?.dragging ? ' dragging' : ''}${drag?.over ? ' drop-before' : ''}`}
      {...dragAttrs(drag)}
    >
      <button className="channel-main" onClick={() => selectChannel(channel.id)}>
        {channel.allowedRoleIds ? <HashLock /> : <Hash size={18} className="channel-icon" />}
        <span className="ellipsis">{channel.name}</span>
        {mentions > 0 && (
          <span className="count-badge" aria-label={`${mentions} menções`}>
            {mentions}
          </span>
        )}
      </button>
      {canEdit && (
        <button className="icon-btn small channel-edit" aria-label="Editar canal" onClick={() => openModal({ kind: 'channelSettings', channelId: channel.id })}>
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

/** Ícone de canal privado: # (ou alto-falante) com cadeado. */
function HashLock({ voice: isVoice }: { voice?: boolean }) {
  return (
    <span className="channel-icon private-icon" title="Canal privado" aria-label="Canal privado">
      {isVoice ? <Volume2 size={18} /> : <Hash size={18} />}
      <Lock size={10} className="lock-badge" />
    </span>
  );
}

function VoiceChannelItem({ channel, canEdit, drag }: { channel: Channel; canEdit: boolean; drag?: DragProps }) {
  const active = useApp((s) => s.selectedChannelId === channel.id);
  const allStates = useApp((s) => s.voiceStates);
  const participants = Object.values(allStates).filter((v) => v.channelId === channel.id);
  const myChannel = useVoice((s) => s.channelId);
  const limit = channel.userLimit ?? 0;

  return (
    <>
      <div
        className={`channel${active ? ' active' : ''}${myChannel === channel.id ? ' connected' : ''}${drag?.dragging ? ' dragging' : ''}${drag?.over ? ' drop-before' : ''}`}
        {...dragAttrs(drag)}
      >
        <button
          className="channel-main"
          onClick={() => {
            selectChannel(channel.id);
            void voice.join(channel.id);
          }}
        >
          {channel.allowedRoleIds ? <HashLock voice /> : <Volume2 size={18} className="channel-icon" />}
          <span className="ellipsis">{channel.name}</span>
          {limit > 0 && (
            <span className={`voice-limit${participants.length >= limit ? ' full' : ''}`} title="Pessoas / limite">
              {participants.length}/{limit}
            </span>
          )}
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
  const nameColor = useApp((s) => memberColor(s.guilds[state.guildId], state.userId, 'inherit'));
  return (
    <li className="voice-participant">
      <Avatar user={user} size={22} speaking={!!speaking && !state.muted} />
      <span className="ellipsis" style={{ color: nameColor }}>
        {user?.displayName ?? 'Alguém'}
      </span>
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
  const streamAllowed = useApp((s) => {
    const gid = channelId ? findChannel(channelId)?.guildId : null;
    return !gid || has(myPermissions(s.guilds[gid], s.me?.id), Perm.STREAM);
  });
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
            {guildName ? `${channelName} / ${guildName}` : `Chamada com ${channelName}`}
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
        {canShareScreen() && (streamAllowed || screen) && (
          <button
            className={`btn small${screen ? ' on' : ''}`}
            onClick={() => (screen ? voice.stopScreen() : openModal({ kind: 'screenShare' }))}
          >
            <MonitorUp size={16} /> {screen ? 'Parar' : 'Tela'}
          </button>
        )}
        <SoundboardButton className="btn small" small />
      </div>
    </div>
  );
}

function UserPanel({ onLogout: _onLogout }: { onLogout(): void }) {
  const me = useApp((s) => s.me)!;
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const speaking = useVoice((s) => !!s.speaking.me);
  const myLine = useApp((s) => presenceLine(s.me ?? undefined, s.me ? s.activities[s.me.id] : undefined));
  return (
    <div className="user-panel">
      <button className="user-panel-me" aria-label="Meu perfil e status" title="Meu perfil e status" onClick={() => openModal({ kind: 'status' })}>
        <Avatar user={me} size={34} speaking={speaking} />
        <span className="user-panel-name">
          <strong className="ellipsis">{me.displayName}</strong>
          <span className="muted ellipsis">{myLine ?? `@${me.username}`}</span>
        </span>
      </button>
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
      <AdminButton />
      <button className="icon-btn" title="Configurações" aria-label="Configurações" onClick={() => openModal({ kind: 'userSettings' })}>
        <Settings size={20} />
      </button>
    </div>
  );
}

/** Só para a equipe do Resenha: abre a fila de denúncias e os chamados de suporte (com contador). */
function AdminButton() {
  const admin = useApp((s) => s.isPlatformAdmin);
  const open = useApp((s) => s.openReports + s.openSupport);
  if (!admin) return null;
  return (
    <button className="icon-btn admin-btn" title="Denúncias" aria-label={`Denúncias${open ? ` (${open} abertas)` : ''}`} onClick={() => openModal({ kind: 'adminReports' })}>
      <ShieldAlert size={20} />
      {open > 0 && <span className="admin-badge">{open > 99 ? '99+' : open}</span>}
    </button>
  );
}
