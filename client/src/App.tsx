import { useCallback, useEffect, useState } from 'react';
import type { Guild, PublicUser } from '../../shared/types';
import { api, getToken, setToken, setUnauthorizedHandler } from './lib/api';
import { connectSocket, disconnectSocket } from './lib/socket';
import { openModal, selectGuild, setGuilds, useApp } from './store/app';
import { voice } from './voice/engine';
import { AuthScreen } from './components/AuthScreen';
import { Layout } from './components/Layout';

/** Lê /invite/:code da URL (link de convite) e limpa a barra de endereço. */
function takeInviteFromUrl(): string | null {
  const m = /^\/invite\/([\w-]+)/.exec(location.pathname);
  if (!m) return null;
  history.replaceState(null, '', '/');
  return m[1];
}

const pendingInvite = { code: takeInviteFromUrl() };

export function App() {
  const me = useApp((s) => s.me);
  const [booting, setBooting] = useState(!!getToken());

  const logout = useCallback(() => {
    voice.leave();
    disconnectSocket();
    setToken(null);
    useApp.setState({ me: null, guilds: {}, guildOrder: [], messages: {}, selectedGuildId: null, selectedChannelId: null });
  }, []);

  const start = useCallback(async (token: string) => {
    const data = await api<{ user: PublicUser; guilds: Guild[] }>('/bootstrap');
    setGuilds(data.guilds);
    useApp.setState({ me: data.user, mobilePanel: 'nav' });
    if (data.guilds[0]) selectGuild(data.guilds[0].id);
    connectSocket(token);
    if (pendingInvite.code) {
      openModal({ kind: 'joinGuild', code: pendingInvite.code });
      pendingInvite.code = null;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    const onUnauthorized = () => logout();
    window.addEventListener('resenha:unauthorized', onUnauthorized);
    const token = getToken();
    if (token) {
      start(token)
        .catch((err) => {
          if (err.status === 401) logout();
        })
        .finally(() => setBooting(false));
    }
    return () => window.removeEventListener('resenha:unauthorized', onUnauthorized);
  }, [logout, start]);

  if (booting) {
    return (
      <div className="splash">
        <img src="/icon.svg" alt="" width={64} height={64} />
        <p>Conectando…</p>
      </div>
    );
  }

  if (!me) {
    return (
      <AuthScreen
        hasInvite={!!pendingInvite.code}
        onAuthenticated={async (token) => {
          setToken(token);
          await start(token);
        }}
      />
    );
  }

  return <Layout onLogout={logout} />;
}
