import { useEffect, useRef, type MouseEvent } from 'react';
import { create } from 'zustand';
import { Bell, ChevronLeft, ChevronRight, Compass, Hash, Home, LayoutGrid, MessageSquare, Mic, MicOff, PhoneOff, Plus, Volume2, X } from 'lucide-react';
import { findChannel, goHome, openModal, selectChannel, selectGuild, useApp } from '../store/app';
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

const TABS_KEY = 'resenha.tabs';
const MAX_TABS = 12;
export type MobileSection = 'inicio' | 'servidores' | 'mensagens' | 'avisos' | 'voce';
interface NovoState {
  /** canais abertos em abas (o Início é fixo e não entra aqui) */
  tabs: string[];
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
export const useNovo = create<NovoState>(() => ({ tabs: loadTabs(), section: 'inicio', serversView: 'grid' }));
useNovo.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(s.tabs));
  } catch {
    /* sem armazenamento */
  }
});

function openTab(channelId: string) {
  const { tabs } = useNovo.getState();
  if (tabs.includes(channelId)) return;
  // passou do limite: sai a aba mais antiga que não é a aberta agora
  const next = [...tabs, channelId];
  if (next.length > MAX_TABS) next.splice(next.findIndex((id) => id !== channelId), 1);
  useNovo.setState({ tabs: next });
}

function closeTab(channelId: string) {
  const { tabs } = useNovo.getState();
  const i = tabs.indexOf(channelId);
  if (i < 0) return;
  const next = tabs.filter((id) => id !== channelId);
  useNovo.setState({ tabs: next });
  // fechou a aba aberta: vai para a vizinha (ou o Início)
  if (useApp.getState().selectedChannelId === channelId) {
    const neighbor = next[i] ?? next[i - 1];
    if (neighbor && findChannel(neighbor)) selectChannel(neighbor);
    else goHome(null);
  }
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

function TabIcon({ channelId }: { channelId: string }) {
  const c = useApp(() => findChannel(channelId));
  if (!c) return null;
  if (c.type === 'dm') return <Avatar user={(c as DmChannel).recipient} size={20} />;
  if (c.type === 'voice') return <Volume2 size={16} className="novo-tab-voice" />;
  return <Hash size={16} />;
}

function Tab({ channelId, active }: { channelId: string; active: boolean }) {
  const c = useApp(() => findChannel(channelId));
  const guildName = useApp((s) => (c && c.type !== 'dm' ? s.guilds[c.guildId]?.name : undefined));
  const unread = useApp((s) => s.unread[channelId] ?? 0);
  const mention = useApp((s) => s.mentions[channelId] ?? 0);
  if (!c) return null;
  const label = c.type === 'dm' ? (c as DmChannel).recipient.displayName : c.name;
  const onAux = (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(channelId);
    }
  };
  return (
    <div className={`novo-tab${active ? ' active' : ''}`} onAuxClick={onAux} onMouseDown={(e) => e.button === 1 && e.preventDefault()}>
      <button type="button" className="novo-tab-btn" aria-current={active ? 'page' : undefined} onClick={() => selectChannel(channelId)} title={guildName ? `${label} · ${guildName}` : label}>
        <TabIcon channelId={channelId} />
        <span className="novo-tab-label ellipsis">{label}</span>
        {guildName && <span className="novo-tab-where ellipsis">{guildName}</span>}
        {!active && (mention > 0 || unread > 0) && <span className={`novo-badge${mention ? ' mention' : ''}`}>{mention || (unread > 99 ? '99+' : unread)}</span>}
      </button>
      <button type="button" className="novo-tab-x" aria-label={`Fechar aba ${label}`} onClick={() => closeTab(channelId)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function TabsBar() {
  const tabs = useNovo((s) => s.tabs);
  const selectedGuildId = useApp((s) => s.selectedGuildId);
  const selectedChannelId = useApp((s) => s.selectedChannelId);
  const channelsKey = useApp((s) => s.guildOrder.join() + Object.keys(s.dms).length);
  const homeAlerts = useApp((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const stripRef = useRef<HTMLDivElement>(null);
  const selected = selectedChannelId ? findChannel(selectedChannelId) : undefined;
  const homeActive = !selectedGuildId && selected?.type !== 'dm';

  // abriu uma conversa (pela lista, pela busca, por uma notificação…): vira aba
  useEffect(() => {
    if (selectedChannelId && selected) openTab(selectedChannelId);
  }, [selectedChannelId, selected]);
  // canais apagados ou sem acesso somem das abas
  useEffect(() => {
    const valid = useNovo.getState().tabs.filter((id) => !!findChannel(id));
    if (valid.length !== useNovo.getState().tabs.length) useNovo.setState({ tabs: valid });
  }, [channelsKey]);
  // a aba aberta fica à vista
  useEffect(() => {
    stripRef.current?.querySelector('.novo-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedChannelId]);

  return (
    <header className="novo-tabsbar">
      <nav className="novo-tabs" aria-label="Abas abertas" ref={stripRef}>
        <div className={`novo-tab home${homeActive ? ' active' : ''}`}>
          <button type="button" className="novo-tab-btn" aria-current={homeActive ? 'page' : undefined} onClick={() => goHome(null)}>
            <Home size={16} />
            <span className="novo-tab-label">Início</span>
            {!homeActive && homeAlerts > 0 && <span className="novo-badge mention">{homeAlerts}</span>}
          </button>
        </div>
        {tabs.map((id) => (
          <Tab key={id} channelId={id} active={id === selectedChannelId && !homeActive} />
        ))}
      </nav>
      <CallControls />
    </header>
  );
}

// ---------------- celular: barra de baixo e as seções ----------------

function goSection(section: MobileSection) {
  const st = useNovo.getState();
  if (section === 'inicio') {
    useApp.setState({ selectedGuildId: null, selectedChannelId: null, mobilePanel: 'nav' });
  } else if (section === 'servidores') {
    // tocou de novo em Servidores (já dentro de um): volta para a grade
    useNovo.setState({ serversView: st.section === 'servidores' ? 'grid' : st.serversView });
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
