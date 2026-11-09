import { useCallback, useEffect, useState } from 'react';
import type { DmChannel, Friend, Guild, PublicUser } from '../../shared/types';
import { api, hasSession, markSession, migrateLegacySession, setUnauthorizedHandler } from './lib/api';
import { connectSocket, disconnectSocket } from './lib/socket';
import { goHome, openModal, selectGuild, setDms, setFriends, setGuilds, useApp } from './store/app';
import { voice } from './voice/engine';
import { AuthScreen } from './components/AuthScreen';
import { Layout } from './components/Layout';
import { LegalPage } from './components/LegalPage';
import { Landing } from './components/Landing';
import { isDesktop } from './lib/desktop';

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

/**
 * Página inicial (apresentação, download e lista de espera) para quem chega sem estar logado.
 * O app de desktop e o app instalado na tela inicial vão direto para o login.
 */
const showLanding =
  !pendingInvite.code &&
  location.pathname === '/' &&
  !hasSession() &&
  !isDesktop &&
  !window.matchMedia?.('(display-mode: standalone)').matches;
if (location.pathname === '/entrar') history.replaceState(null, '', '/');

export function App() {
  if (legalPage) return <LegalPage kind={legalPage} />;
  if (showLanding) return <Landing />;
  return <MainApp />;
}

function MainApp() {
  const me = useApp((s) => s.me);
  const [booting, setBooting] = useState(hasSession());
  const [bootError, setBootError] = useState<string | null>(null);

  const logout = useCallback(() => {
    voice.leave();
    disconnectSocket();
    markSession(false);
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
      isPlatformAdmin: false,
      openReports: 0,
    });
  }, []);

  const start = useCallback(async () => {
    const [data, dms, friends] = await Promise.all([
      api<{ user: PublicUser; guilds: Guild[]; isPlatformAdmin?: boolean }>('/bootstrap'),
      api<{ dms: DmChannel[] }>('/dms'),
      api<{ friends: Friend[] }>('/friends'),
    ]);
    setGuilds(data.guilds);
    setDms(dms.dms);
    setFriends(friends.friends);
    useApp.setState({ me: data.user, mobilePanel: 'nav', isPlatformAdmin: !!data.isPlatformAdmin });
    if (data.isPlatformAdmin) {
      // as visitas da própria equipe não entram no painel de números
      try {
        if (localStorage.getItem('resenha.noStats') === null) localStorage.setItem('resenha.noStats', '1');
      } catch {
        /* sem armazenamento local */
      }
    }
    if (data.isPlatformAdmin) void api<{ open: number }>('/admin/reports/count').then((r) => useApp.setState({ openReports: r.open }), () => {});
    if (data.guilds[0]) selectGuild(data.guilds[0].id);
    else goHome();
    connectSocket();
    if (pendingInvite.code) {
      openModal({ kind: 'joinGuild', code: pendingInvite.code });
      pendingInvite.code = null;
    }
  }, []);

  useEffect(() => {
    // sessão expirou no meio do uso: volta para o login (durante a abertura, quem decide é o attempt abaixo)
    setUnauthorizedHandler(() => useApp.getState().me && logout());
    const onUnauthorized = () => logout();
    window.addEventListener('resenha:unauthorized', onUnauthorized);
    const had = hasSession();
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Falha passageira (internet oscilando, servidor acordando) não pode virar "tela de login":
    // a sessão continua válida, então tenta de novo com espera crescente.
    const attempt = (n: number) => {
      migrateLegacySession()
        .then(() => start())
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
    if (had) attempt(0);
    // sem o aviso local (ex.: dados do site limpos), mas o cookie de sessão pode continuar valendo
    else
      start().then(
        () => !cancelled && markSession(true),
        () => {},
      );
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
        onAuthenticated={async () => {
          markSession(true);
          await start();
        }}
      />
    );
  }

  return <Layout onLogout={logout} />;
}
