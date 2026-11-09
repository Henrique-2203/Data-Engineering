import { useCallback, useEffect, useState } from 'react';
import type { DmChannel, Friend, Guild, PublicUser } from '../../shared/types';
import { api, getToken, setToken, setUnauthorizedHandler } from './lib/api';
import { connectSocket, disconnectSocket } from './lib/socket';
import { goHome, openModal, selectGuild, setDms, setFriends, setGuilds, useApp } from './store/app';
import { voice } from './voice/engine';
import { AuthScreen } from './components/AuthScreen';
import { Layout } from './components/Layout';
import { LegalPage } from './components/LegalPage';

/** /privacidade e /termos são páginas públicas (abrem sem login). */
const legalPage = /^\/(privacidade|termos)\/?$/.exec(location.pathname)?.[1] as 'privacidade' | 'termos' | undefined;

/** Lê /invite/:code da URL (link de convite) e limpa a barra de endereço. */
function takeInviteFromUrl(): string | null {
  const m = /^\/invite\/([\w-]+)/.exec(location.pathname);
  if (!m) return null;
  history.replaceState(null, '', '/');
  return m[1];
}

const pendingInvite = { code: takeInviteFromUrl() };

export function App() {
  if (legalPage) return <LegalPage kind={legalPage} />;
  return <MainApp />;
}

function MainApp() {
  const me = useApp((s) => s.me);
  const [booting, setBooting] = useState(!!getToken());
  const [bootError, setBootError] = useState<string | null>(null);

  const logout = useCallback(() => {
    voice.leave();
    disconnectSocket();
    setToken(null);
    useApp.setState({
      me: null,
      guilds: {},
      guildOrder: [],
      dms: {},
      dmOrder: [],
      friends: [],
      messages: {},
      unread: {},
      selectedGuildId: null,
      selectedChannelId: null,
    });
  }, []);

  const start = useCallback(async (token: string) => {
    const [data, dms, friends] = await Promise.all([
      api<{ user: PublicUser; guilds: Guild[] }>('/bootstrap'),
      api<{ dms: DmChannel[] }>('/dms'),
      api<{ friends: Friend[] }>('/friends'),
    ]);
    setGuilds(data.guilds);
    setDms(dms.dms);
    setFriends(friends.friends);
    useApp.setState({ me: data.user, mobilePanel: 'nav' });
    if (data.guilds[0]) selectGuild(data.guilds[0].id);
    else goHome();
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
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Falha passageira (internet oscilando, servidor acordando) não pode virar "tela de login":
    // a sessão continua válida, então tenta de novo com espera crescente.
    const attempt = (n: number) => {
      start(token!)
        .then(() => !cancelled && setBooting(false))
        .catch((err) => {
          if (cancelled) return;
          if (err.status === 401) {
            logout();
            setBooting(false);
            return;
          }
          setBootError(err.status ? `Erro ${err.status} do servidor` : 'Sem conexão com o servidor');
          retry = setTimeout(() => attempt(n + 1), Math.min(1000 * 2 ** n, 10_000));
        });
    };
    if (token) attempt(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      window.removeEventListener('resenha:unauthorized', onUnauthorized);
    };
  }, [logout, start]);

  if (booting) {
    return (
      <div className="splash">
        <img src="/icon.svg" alt="" width={64} height={64} />
        <p>Conectando…</p>
        {bootError && <p className="muted small">{bootError}. Tentando de novo…</p>}
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
