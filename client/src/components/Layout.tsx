import { useEffect } from 'react';
import { findChannel, markRead, openModal, useApp } from '../store/app';
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { ChatView } from './ChatView';
import { VoiceStage } from './VoiceStage';
import { MemberList } from './MemberList';
import { VoiceAudio } from './VoiceAudio';
import { Modals } from './Modals';
import { MobileHeader } from './MobileHeader';
import { Hotkeys } from './Hotkeys';

export function Layout({ onLogout }: { onLogout(): void }) {
  const mobilePanel = useApp((s) => s.mobilePanel);
  const showMembers = useApp((s) => s.showMembers);
  const selectedGuildId = useApp((s) => s.selectedGuildId);
  const selectedChannelId = useApp((s) => s.selectedChannelId);
  const guildCount = useApp((s) => s.guildOrder.length);
  const connected = useApp((s) => s.connected);
  const toastMsg = useApp((s) => s.toast);
  // reavalia quando os canais mudam
  const channel = useApp(() => findChannel(selectedChannelId));

  useEffect(() => {
    const onVisible = () => {
      const id = useApp.getState().selectedChannelId;
      if (document.visibilityState === 'visible' && id) markRead(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  let main;
  if (!selectedGuildId || guildCount === 0) {
    main = <Welcome />;
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

  const membersVisible = showMembers && channel?.type === 'text';

  return (
    <div className={`layout panel-${mobilePanel}${membersVisible ? ' with-members' : ''}`}>
      <nav className="nav-drawer" aria-label="Servidores e canais">
        <ServerRail />
        <ChannelSidebar onLogout={onLogout} />
      </nav>
      <main className="main">{main}</main>
      {membersVisible && selectedGuildId && <MemberList guildId={selectedGuildId} />}
      {mobilePanel === 'members' && (
        <div className="backdrop" onClick={() => useApp.setState({ mobilePanel: 'main' })} />
      )}
      <VoiceAudio />
      <Hotkeys />
      <Modals onLogout={onLogout} />
      {!connected && <div className="offline-bar">Reconectando ao servidor…</div>}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <MobileHeader title="Resenha" />
      <div className="welcome-body">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h2>Bem-vindo à Resenha!</h2>
        <p className="muted">Crie um servidor para você e seus amigos ou entre em um com um link de convite.</p>
        <div className="row gap">
          <button className="btn primary" onClick={() => openModal({ kind: 'createGuild' })}>
            Criar servidor
          </button>
          <button className="btn" onClick={() => openModal({ kind: 'joinGuild' })}>
            Entrar com convite
          </button>
        </div>
      </div>
    </div>
  );
}
