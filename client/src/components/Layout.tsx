import { useEffect } from 'react';
import { findChannel, markRead, useApp } from '../store/app';
import { ServerRail } from './ServerRail';
import { ApoioCard } from './Apoio';
import { ChannelSidebar } from './ChannelSidebar';
import { ChatView } from './ChatView';
import { VoiceStage } from './VoiceStage';
import { MemberList } from './MemberList';
import { VoiceAudio } from './VoiceAudio';
import { Modals } from './Modals';
import { MobileHeader } from './MobileHeader';
import { Hotkeys } from './Hotkeys';
import { FriendsView } from './FriendsView';
import { CallOverlay } from './CallOverlay';
import { DesktopBridge } from './DesktopBridge';
import { UpdateNotice } from './UpdateNotice';
import { SidePanel } from './Community';
import { ChangelogWatcher } from './Changelog';
import { useMobileSwipe } from '../lib/swipe';
import { CallUserMenuHost } from './CallUserMenu';
import { BottomNav, MobileSectionScreen, NovoHome, SplitDropZone, SplitView, TabsBar, useNovo } from './NovoLayout';
import { useIsDesktop, useNovoLayout } from '../lib/layoutMode';

export function Layout({ onLogout }: { onLogout(): void }) {
  const mobilePanel = useApp((s) => s.mobilePanel);
  const showMembers = useApp((s) => s.showMembers);
  const selectedGuildId = useApp((s) => s.selectedGuildId);
  const selectedChannelId = useApp((s) => s.selectedChannelId);
  const connected = useApp((s) => s.connected);
  const updating = useApp((s) => s.updating);
  const toastMsg = useApp((s) => s.toast);
  // reavalia quando os canais mudam
  const channel = useApp(() => findChannel(selectedChannelId));
  useMobileSwipe();
  const novo = useNovoLayout();
  const desktop = useIsDesktop((s) => s.desktop);
  const split = useNovo((s) => s.split);

  useEffect(() => {
    const onVisible = () => {
      const id = useApp.getState().selectedChannelId;
      if (document.visibilityState === 'visible' && id) markRead(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  let main;
  if (!selectedGuildId) {
    // Início: conversa direta aberta ou a lista de amigos
    main = channel?.type === 'dm' ? <ChatView channel={channel} /> : novo && desktop ? <NovoHome /> : <FriendsView />;
  } else if (channel?.type === 'voice') {
    main = <VoiceStage channelId={channel.id} />;
  } else if (channel) {
    main = <ChatView channel={channel} />;
  } else {
    main = (
      <div className="empty-main">
        <MobileHeader title="Sem canais" />
        <p className="muted">Este servidor ainda não tem canais de texto.</p>
      </div>
    );
  }

  // layout novo no computador: outra conversa aberta ao lado
  const splitOn = novo && desktop && !!split && split !== selectedChannelId && !!findChannel(split);
  const sidePanel = useApp((s) => s.sidePanel);
  const panelVisible = !splitOn && !!sidePanel && !!channel && channel.type !== 'voice';
  const membersVisible = !splitOn && !panelVisible && showMembers && channel?.type === 'text';

  return (
    <div className={`layout panel-${mobilePanel}${membersVisible ? ' with-members' : ''}${panelVisible ? ' with-panel' : ''}${novo ? ' layout-novo' : ''}`}>
      {novo && <TabsBar />}
      <nav className="nav-drawer" aria-label="Servidores e canais">
        <ServerRail />
        <ChannelSidebar onLogout={onLogout} />
      </nav>
      <main className="main">
        {splitOn ? <SplitView primary={main} channelId={split!} /> : main}
        {novo && desktop && <SplitDropZone />}
      </main>
      {membersVisible && selectedGuildId && <MemberList guildId={selectedGuildId} />}
      {panelVisible && <SidePanel />}
      {mobilePanel === 'members' && (
        <div className="backdrop" onClick={() => useApp.setState({ mobilePanel: 'main' })} />
      )}
      {novo && <MobileSectionScreen onLogout={onLogout} />}
      {novo && mobilePanel === 'nav' && <BottomNav />}
      <VoiceAudio />
      <Hotkeys />
      <CallOverlay />
      <DesktopBridge />
      <UpdateNotice />
      <ChangelogWatcher />
      <CallUserMenuHost />
      <ApoioCard />
      <Modals onLogout={onLogout} />
      {!connected && (
        <div className="offline-bar">
          {updating ? 'O Resenha está se atualizando. A call continua; o resto volta em alguns segundos…' : 'Reconectando ao servidor…'}
        </div>
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

