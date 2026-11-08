import type { ReactNode } from 'react';
import { Menu, Users } from 'lucide-react';
import { useApp } from '../store/app';

interface Props {
  title: ReactNode;
  icon?: ReactNode;
  showMembersButton?: boolean;
  actions?: ReactNode;
}

/** Cabeçalho do conteúdo principal (no celular ganha o botão de menu). */
export function MobileHeader({ title, icon, showMembersButton, actions }: Props) {
  const unreadElsewhere = useApp((s) => Object.keys(s.unread).some((id) => id !== s.selectedChannelId));
  return (
    <header className="main-header">
      <button
        className="icon-btn mobile-only menu-btn"
        aria-label="Abrir menu"
        onClick={() => useApp.setState({ mobilePanel: 'nav' })}
      >
        <Menu size={22} />
        {unreadElsewhere && <span className="dot" />}
      </button>
      <h2 className="main-title">
        {icon}
        <span className="ellipsis">{title}</span>
      </h2>
      <div className="header-actions">
        {actions}
        {showMembersButton && (
          <button
            className="icon-btn"
            aria-label="Membros"
            title="Membros"
            onClick={() => {
              const s = useApp.getState();
              if (window.matchMedia('(max-width: 900px)').matches) useApp.setState({ mobilePanel: 'members', showMembers: true });
              else useApp.setState({ showMembers: !s.showMembers });
            }}
          >
            <Users size={20} />
          </button>
        )}
      </div>
    </header>
  );
}
