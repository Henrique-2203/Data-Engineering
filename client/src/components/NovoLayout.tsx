import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { create } from 'zustand';
import { Bell, ChevronLeft, ChevronRight, Compass, Hash, Home, LayoutGrid, MessageSquare, Mic, MicOff, PhoneOff, Pin, Plus, Volume2, X } from 'lucide-react';
import { findChannel, goHome, openModal, selectChannel, selectGuild, toast, useApp } from '../store/app';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { Avatar } from './Avatar';
import type { DmChannel } from '../../../shared/types';
import { Happening } from './HomeSidebar';

/**
 * Layout novo (em teste, ver lib/layoutMode.ts):
 * - computador: cada conversa aberta (canal, mensagem direta ou call) vira uma aba no topo, e a call fica
 *   sempre à mão numa pílula ao lado das abas;
 * - celular: barra de baixo com Início, Servidores, Mensagens, Avisos e Você (some dentro de uma conversa).
 * As telas de dentro (chat, call, canais) são as mesmas do layout clássico.
 */

// ---------------- estado (fica guardado neste aparelho) ----------------

// v2: as abas agora só existem se a pessoa arrastar para fixar (as abertas automaticamente da 1ª versão ficam para trás)
const TABS_KEY = 'resenha.tabs2';
/** tipo do arraste de "fixar em aba" (canal, conversa direta ou servidor) */
export const TAB_DRAG = 'application/x-resenha-tab';
/** id de aba de um servidor inteiro (abre o último canal dele) */
const GUILD_TAB = 'g:';
const MAX_TABS = 12;
export type MobileSection = 'inicio' | 'servidores' | 'mensagens' | 'avisos' | 'voce';
interface NovoState {
  /** abas fixadas: id de canal/conversa ou "g:<servidor>" (o Início é fixo e não entra aqui) */
  tabs: string[];
  /** algo que pode virar aba está sendo arrastado */
  dragging: boolean;
  section: MobileSection;
  /** em Servidores: a grade ou os canais do servidor escolhido */
  serversView: 'grid' | 'guild';
}
const loadTabs = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_TABS) : [];
  } catch {
    return [];
  }
};
export const useNovo = create<NovoState>(() => ({ tabs: loadTabs(), dragging: false, section: 'inicio', serversView: 'grid' }));
useNovo.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(s.tabs));
  } catch {
    /* sem armazenamento */
  }
});

/** atributos para algo da lista poder ser arrastado para a barra de abas (só no layout novo) */
export const tabDrag = (id: string, novo: boolean) => (novo ? { 'data-tab': id, draggable: true } : {});
export const guildTabId = (guildId: string) => GUILD_TAB + guildId;

const tabExists = (id: string) => (id.startsWith(GUILD_TAB) ? !!useApp.getState().guilds[id.slice(GUILD_TAB.length)] : !!findChannel(id));

/** fixa (ou move para antes de `before`) */
function pinTab(id: string, before?: string) {
  if (!tabExists(id)) return;
  const tabs = useNovo.getState().tabs.filter((t) => t !== id);
  const at = before ? tabs.indexOf(before) : -1;
  if (at >= 0) tabs.splice(at, 0, id);
  else tabs.push(id);
  if (tabs.length > MAX_TABS) {
    toast(`Dá para fixar até ${MAX_TABS} abas. Feche uma para fixar outra.`);
    return;
  }
  useNovo.setState({ tabs });
}

function openTabTarget(id: string) {
  if (id.startsWith(GUILD_TAB)) selectGuild(id.slice(GUILD_TAB.length));
  else selectChannel(id);
}

function closeTab(channelId: string) {
  const { tabs } = useNovo.getState();
  const i = tabs.indexOf(channelId);
  if (i < 0) return;
  // desafixar não muda a tela: a conversa continua aberta, só sai da barra
  useNovo.setState({ tabs: tabs.filter((id) => id !== channelId) });
}

// ---------------- computador: abas no topo ----------------

/** a call em que estou, para a pílula (computador) e a barra (celular) */
function useCurrentCall() {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const muted = useVoice((s) => s.muted);
  const count = useApp((s) => (channelId ? Object.values(s.voiceStates).filter((v) => v.channelId === channelId).length : 0));
  const channel = useApp(() => (channelId ? findChannel(channelId) : undefined));
  if (status === 'idle' || !channelId) return null;
  const name = channel?.type === 'dm' ? `Call com ${(channel as DmChannel).recipient.displayName}` : channel?.name ?? 'Call';
  return { channelId, name, count, muted, connecting: status === 'connecting' };
}

function CallControls({ compact }: { compact?: boolean }) {
  const call = useCurrentCall();
  if (!call) return null;
  return (
    <div className={`novo-call${compact ? ' compact' : ''}`} role="group" aria-label="Call em andamento">
      <span className={`novo-call-dot${call.connecting ? ' connecting' : ''}`} aria-hidden />
      <button type="button" className="novo-call-name" onClick={() => selectChannel(call.channelId)} title="Abrir a call">
        <span className="ellipsis">{call.name}</span>
        {call.count > 0 && <span className="novo-call-count">· {call.count}</span>}
      </button>
      <button type="button" className={`novo-call-btn${call.muted ? ' on' : ''}`} aria-label={call.muted ? 'Ligar microfone' : 'Silenciar microfone'} aria-pressed={call.muted} onClick={() => voice.setMuted(!call.muted)}>
        {call.muted ? <MicOff size={16} /> : <Mic size={16} />}
      </button>
      <button type="button" className="novo-call-btn leave" aria-label="Sair da call" onClick={() => voice.leave()}>
        <PhoneOff size={16} />
      </button>
    </div>
  );
}

function TabIcon({ id }: { id: string }) {
  const c = useApp(() => (id.startsWith(GUILD_TAB) ? undefined : findChannel(id)));
  const g = useApp((s) => (id.startsWith(GUILD_TAB) ? s.guilds[id.slice(GUILD_TAB.length)] : undefined));
  if (g) return <span className="novo-tab-guild">{g.iconId ? <img src={`/api/images/${g.iconId}`} alt="" /> : g.name.slice(0, 1).toUpperCase()}</span>;
  if (!c) return null;
  if (c.type === 'dm') return <Avatar user={(c as DmChannel).recipient} size={20} />;
  if (c.type === 'voice') return <Volume2 size={16} className="novo-tab-voice" />;
  return <Hash size={16} />;
}

function Tab({ id, active }: { id: string; active: boolean }) {
  const isGuild = id.startsWith(GUILD_TAB);
  const gid = isGuild ? id.slice(GUILD_TAB.length) : null;
  const c = useApp(() => (isGuild ? undefined : findChannel(id)));
  const guild = useApp((s) => (gid ? s.guilds[gid] : c && c.type !== 'dm' ? s.guilds[c.guildId] : undefined));
  const unread = useApp((s) => (gid ? (s.guilds[gid]?.channels ?? []).reduce((n, x) => n + (s.unread[x.id] ?? 0), 0) : s.unread[id] ?? 0));
  const mention = useApp((s) => (gid ? (s.guilds[gid]?.channels ?? []).reduce((n, x) => n + (s.mentions[x.id] ?? 0), 0) : s.mentions[id] ?? 0));
  const [over, setOver] = useState(false);
  if (!c && !isGuild) return null;
  if (isGuild && !guild) return null;
  const label = isGuild ? guild!.name : c!.type === 'dm' ? (c as DmChannel).recipient.displayName : c!.name;
  const where = !isGuild && c!.type !== 'dm' ? guild?.name : undefined;
  const onAux = (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(id);
    }
  };
  return (
    <div
      className={`novo-tab${active ? ' active' : ''}${over ? ' drop-before' : ''}`}
      onAuxClick={onAux}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_DRAG, id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData(TAB_DRAG);
        setOver(false);
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
        useNovo.setState({ dragging: false });
        if (dragged !== id) pinTab(dragged, id);
      }}
    >
      <button type="button" className="novo-tab-btn" aria-current={active ? 'page' : undefined} onClick={() => openTabTarget(id)} title={where ? `${label} · ${where}` : label}>
        <TabIcon id={id} />
        <span className="novo-tab-label ellipsis">{label}</span>
        {where && <span className="novo-tab-where ellipsis">{where}</span>}
        {!active && (mention > 0 || unread > 0) && <span className={`novo-badge${mention ? ' mention' : ''}`}>{mention || (unread > 99 ? '99+' : unread)}</span>}
      </button>
      <button type="button" className="novo-tab-x" aria-label={`Desafixar aba ${label}`} title="Desafixar" onClick={() => closeTab(id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function TabsBar() {
  const tabs = useNovo((s) => s.tabs);
  const dragging = useNovo((s) => s.dragging);
  const selectedGuildId = useApp((s) => s.selectedGuildId);
  const selectedChannelId = useApp((s) => s.selectedChannelId);
  const channelsKey = useApp((s) => s.guildOrder.join() + Object.keys(s.dms).length);
  const homeAlerts = useApp((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const stripRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const selected = selectedChannelId ? findChannel(selectedChannelId) : undefined;
  const homeActive = !selectedGuildId && selected?.type !== 'dm';
  // aba acesa: o canal aberto, se fixado; senão o servidor dele, se fixado
  const activeId = homeActive ? null : selectedChannelId && tabs.includes(selectedChannelId) ? selectedChannelId : selectedGuildId && tabs.includes(guildTabId(selectedGuildId)) ? guildTabId(selectedGuildId) : null;

  // qualquer coisa da lista marcada com data-tab pode ser arrastada para cá (servidor, canal, call, conversa)
  useEffect(() => {
    const start = (e: DragEvent) => {
      // começou a arrastar na foto/ícone de dentro (o navegador arrasta a imagem): vale o item que tem data-tab.
      // Algo arrastável sem data-tab no caminho (ex.: pessoa na call, para mover) não vira aba.
      const t = e.target instanceof Element ? e.target : null;
      const src = t?.closest<HTMLElement>('[data-tab], [draggable="true"]');
      const id = src?.dataset.tab;
      if (!id || !e.dataTransfer) return;
      e.dataTransfer.setData(TAB_DRAG, id);
      useNovo.setState({ dragging: true });
    };
    const end = () => useNovo.setState({ dragging: false });
    document.addEventListener('dragstart', start, true);
    document.addEventListener('dragend', end, true);
    return () => {
      document.removeEventListener('dragstart', start, true);
      document.removeEventListener('dragend', end, true);
    };
  }, []);
  // canais apagados, sem acesso, ou servidores que saí: somem das abas
  useEffect(() => {
    const valid = useNovo.getState().tabs.filter(tabExists);
    if (valid.length !== useNovo.getState().tabs.length) useNovo.setState({ tabs: valid });
  }, [channelsKey]);
  useEffect(() => {
    stripRef.current?.querySelector('.novo-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  return (
    <header
      className={`novo-tabsbar${dragging ? ' dragging' : ''}${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
        e.preventDefault();
        // o canal pode vir com "mover" (reordenar canais): aceita o que o arraste permitir
        e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(TAB_DRAG);
        setOver(false);
        useNovo.setState({ dragging: false });
        if (!id) return;
        e.preventDefault();
        pinTab(id);
      }}
    >
      <nav className="novo-tabs" aria-label="Abas fixadas" ref={stripRef}>
        <div className={`novo-tab home${homeActive ? ' active' : ''}`}>
          <button type="button" className="novo-tab-btn" aria-current={homeActive ? 'page' : undefined} onClick={() => goHome(null)}>
            <Home size={16} />
            <span className="novo-tab-label">Início</span>
            {!homeActive && homeAlerts > 0 && <span className="novo-badge mention">{homeAlerts}</span>}
          </button>
        </div>
        {tabs.map((id) => (
          <Tab key={id} id={id} active={id === activeId} />
        ))}
        {(dragging || tabs.length === 0) && (
          <span className={`novo-tabs-hint${dragging ? ' live' : ''}`} aria-live="polite">
            <Pin size={14} /> {dragging ? 'Solte aqui para fixar em aba' : 'Arraste um servidor, canal, call ou conversa para cá para fixar'}
          </span>
        )}
      </nav>
      <CallControls />
    </header>
  );
}

// ---------------- celular: barra de baixo e as seções ----------------

function goSection(section: MobileSection) {
  if (section === 'inicio') {
    useApp.setState({ selectedGuildId: null, selectedChannelId: null, mobilePanel: 'nav' });
  } else if (section === 'servidores') {
    // Servidores sempre abre a lista de servidores (tocar num cartão entra no servidor)
    useNovo.setState({ serversView: 'grid' });
    useApp.setState({ mobilePanel: 'nav' });
  } else {
    useApp.setState({ mobilePanel: 'nav' });
  }
  useNovo.setState({ section });
}

export function backToServers() {
  useNovo.setState({ section: 'servidores', serversView: 'grid' });
  useApp.setState({ mobilePanel: 'nav' });
}

export function BottomNav() {
  const section = useNovo((s) => s.section);
  const dmUnread = useApp((s) => s.dmOrder.filter((id) => s.unread[id]).length);
  const avisos = useApp((s) => s.friends.filter((f) => f.status === 'incoming').length + Object.values(s.mentions).reduce((n, m) => n + (m > 0 ? 1 : 0), 0));
  const serverUnread = useApp((s) => s.guildOrder.some((gid) => s.guilds[gid]?.channels.some((c) => s.unread[c.id])));
  const me = useApp((s) => s.me);
  const items: { id: MobileSection; label: string; icon: React.ReactNode; badge?: number; dot?: boolean }[] = [
    { id: 'inicio', label: 'Início', icon: <Home size={22} /> },
    { id: 'servidores', label: 'Servidores', icon: <LayoutGrid size={22} />, dot: serverUnread },
    { id: 'mensagens', label: 'Mensagens', icon: <MessageSquare size={22} />, badge: dmUnread },
    { id: 'avisos', label: 'Avisos', icon: <Bell size={22} />, badge: avisos },
    { id: 'voce', label: 'Você', icon: me ? <Avatar user={me} size={24} /> : <Home size={22} /> },
  ];
  return (
    <div className="novo-bottom">
      <CallControls compact />
      <nav className="novo-bottomnav" aria-label="Seções do Resenha">
        {items.map((it) => (
          <button key={it.id} type="button" className={section === it.id ? 'active' : ''} aria-current={section === it.id ? 'page' : undefined} onClick={() => goSection(it.id)}>
            <span className="novo-bn-icon">
              {it.icon}
              {!!it.badge && <span className="novo-badge mention">{it.badge > 99 ? '99+' : it.badge}</span>}
              {!it.badge && it.dot && <span className="novo-dot" aria-label="novidades" />}
            </span>
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function ServersGrid() {
  const guildOrder = useApp((s) => s.guildOrder);
  const guilds = useApp((s) => s.guilds);
  const unread = useApp((s) => s.unread);
  const voiceStates = useApp((s) => s.voiceStates);
  return (
    <div className="novo-screen" aria-label="Servidores">
      <div className="novo-screen-head">
        <h1>Servidores</h1>
        <button type="button" className="novo-head-btn primary" aria-label="Criar ou entrar num servidor" onClick={() => openModal({ kind: 'createGuild' })}>
          <Plus size={22} />
        </button>
      </div>
      <div className="novo-server-grid">
        {guildOrder.map((gid) => {
          const g = guilds[gid];
          if (!g) return null;
          const inCall = Object.values(voiceStates).filter((v) => v.guildId === gid).length;
          const hasUnread = g.channels.some((c) => unread[c.id]);
          return (
            <button
              key={gid}
              type="button"
              className="novo-server-card"
              onClick={() => {
                selectGuild(gid);
                useNovo.setState({ serversView: 'guild' });
                useApp.setState({ mobilePanel: 'nav' });
              }}
            >
              <span className="novo-server-icon">{g.iconId ? <img src={`/api/images/${g.iconId}`} alt="" /> : g.name.slice(0, 2).toUpperCase()}</span>
              <strong className="ellipsis2">{g.name}</strong>
              {inCall > 0 ? <span className="novo-live">● {inCall} na call agora</span> : <span className="muted small">{g.members.length} membros</span>}
              {hasUnread && <span className="novo-dot corner" aria-label="mensagens novas" />}
            </button>
          );
        })}
      </div>
      <button type="button" className="novo-explore" onClick={() => openModal({ kind: 'explore' })}>
        <Compass size={20} /> Explorar comunidades públicas
      </button>
    </div>
  );
}

function MessagesScreen() {
  const dmOrder = useApp((s) => s.dmOrder);
  const dms = useApp((s) => s.dms);
  const unread = useApp((s) => s.unread);
  const online = useApp((s) => s.online);
  return (
    <div className="novo-screen" aria-label="Mensagens">
      <div className="novo-screen-head">
        <h1>Mensagens</h1>
        <button type="button" className="novo-head-btn" onClick={() => goHome(null)}>
          Amigos
        </button>
      </div>
      {dmOrder.length === 0 && <p className="muted">Nenhuma conversa ainda. Toque em Amigos para chamar alguém.</p>}
      <ul className="novo-list">
        {dmOrder.map((id) => {
          const d = dms[id];
          if (!d) return null;
          const n = unread[id] ?? 0;
          return (
            <li key={id}>
              <button type="button" className={`novo-row${n ? ' unread' : ''}`} onClick={() => selectChannel(id)}>
                <Avatar user={d.recipient} size={46} online={!!online[d.recipient.id]} />
                <span className="novo-row-text">
                  <strong className="ellipsis">{d.recipient.displayName}</strong>
                  <span className="muted small ellipsis">@{d.recipient.username}</span>
                </span>
                {n > 0 && <span className="novo-badge mention">{n > 99 ? '99+' : n}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AvisosScreen() {
  return (
    <div className="novo-screen" aria-label="Avisos">
      <div className="novo-screen-head">
        <h1>Avisos</h1>
      </div>
      <Happening empty={<p className="muted">Tudo tranquilo por aqui: sem menções, pedidos de amizade ou calls agora.</p>} />
    </div>
  );
}

function VoceScreen({ onLogout }: { onLogout(): void }) {
  const me = useApp((s) => s.me);
  if (!me) return null;
  const rows: { label: string; onClick(): void; tone?: 'accent' | 'danger' }[] = [
    { label: 'Conta e segurança', onClick: () => openModal({ kind: 'userSettings', section: 'account' }) },
    { label: 'Aparência e layout', onClick: () => openModal({ kind: 'userSettings', section: 'appearance' }) },
    { label: 'Voz, vídeo e transmissão', onClick: () => openModal({ kind: 'userSettings', section: 'voice' }) },
    { label: 'Notificações', onClick: () => openModal({ kind: 'userSettings', section: 'notifications' }) },
    { label: 'Suporte', onClick: () => openModal({ kind: 'support' }) },
    { label: 'Apoie o Resenha', onClick: () => openModal({ kind: 'apoio' }), tone: 'accent' },
    { label: 'Sair', onClick: onLogout, tone: 'danger' },
  ];
  return (
    <div className="novo-screen voce" aria-label="Você">
      <div className="novo-voce-banner" style={{ background: me.avatarColor }} />
      <div className="novo-voce-head">
        <Avatar user={me} size={84} online />
        <h1>{me.displayName}</h1>
        <span className="muted">@{me.username}</span>
        <div className="novo-voce-btns">
          <button type="button" className="btn primary" onClick={() => openModal({ kind: 'userSettings', section: 'profile' })}>
            Editar perfil
          </button>
          <button type="button" className="btn" onClick={() => openModal({ kind: 'status' })}>
            Mudar status
          </button>
        </div>
      </div>
      <ul className="novo-settings">
        {rows.map((r) => (
          <li key={r.label}>
            <button type="button" className={r.tone ?? ''} onClick={r.onClick}>
              <span>{r.label}</span>
              <ChevronRight size={18} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** a seção do celular por cima da gaveta (Início e os canais de um servidor usam a gaveta de sempre) */
export function MobileSectionScreen({ onLogout }: { onLogout(): void }) {
  const section = useNovo((s) => s.section);
  const serversView = useNovo((s) => s.serversView);
  const mobilePanel = useApp((s) => s.mobilePanel);
  const guildId = useApp((s) => s.selectedGuildId);
  // no celular, a seção Início mostra o Início (o app abre no primeiro servidor; aqui ele fica em Servidores)
  useEffect(() => {
    if (mobilePanel !== 'nav' || !guildId || !window.matchMedia('(max-width: 900px)').matches) return;
    if (section === 'inicio') useNovo.setState({ section: 'servidores', serversView: 'guild' });
  }, [mobilePanel, guildId, section]);
  if (mobilePanel !== 'nav') return null;
  let screen = null;
  if (section === 'servidores' && serversView === 'grid') screen = <ServersGrid />;
  else if (section === 'mensagens') screen = <MessagesScreen />;
  else if (section === 'avisos') screen = <AvisosScreen />;
  else if (section === 'voce') screen = <VoceScreen onLogout={onLogout} />;
  if (!screen) return null;
  return <div className="novo-section">{screen}</div>;
}

/** no celular, dentro de um servidor (layout novo): volta para a grade de servidores */
export function BackToServersButton() {
  return (
    <button type="button" className="novo-back mobile-only" aria-label="Voltar para os servidores" onClick={backToServers}>
      <ChevronLeft size={22} />
    </button>
  );
}
