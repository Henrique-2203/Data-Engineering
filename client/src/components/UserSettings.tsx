import { useEffect, useState, type ReactNode } from 'react';
import { Bell, ChevronRight, Database, Keyboard, LogOut, Mic, Shield, User, UserCircle, X } from 'lucide-react';
import { api } from '../lib/api';
import { closeModal, openModal, useApp } from '../store/app';
import { updateSettings, useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { NOISE_MODES, type NoiseMode, keyLabel } from '../voice/settings';
import { isDesktop } from '../lib/desktop';
import { Avatar } from './Avatar';
import { ProfileEditor } from './ProfileEditor';
import { SecuritySettings } from './SecuritySettings';
import { MyFiles } from './MyFiles';
import { DesktopSettingsSection, InputModeSettings, SoundSettings } from './Modals';

export type SettingsSection = 'account' | 'profile' | 'security' | 'privacy' | 'voice' | 'notifications' | 'shortcuts';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode; title: string; description: string }[] = [
  {
    id: 'account',
    label: 'Minha conta',
    icon: <UserCircle size={18} />,
    title: 'Minha conta',
    description: 'Um resumo da sua conta e do que falta para ela ficar protegida.',
  },
  {
    id: 'profile',
    label: 'Perfil',
    icon: <User size={18} />,
    title: 'Perfil',
    description: 'Foto, banner, nome, bio e links: o que seus amigos veem.',
  },
  {
    id: 'security',
    label: 'Segurança',
    icon: <Shield size={18} />,
    title: 'Segurança',
    description: 'Senha, e-mail, verificação em duas etapas, aparelhos conectados e histórico.',
  },
  {
    id: 'privacy',
    label: 'Privacidade e dados',
    icon: <Database size={18} />,
    title: 'Privacidade e dados',
    description: 'Seus arquivos, uma cópia dos seus dados e a exclusão da conta.',
  },
  {
    id: 'voice',
    label: 'Voz e vídeo',
    icon: <Mic size={18} />,
    title: 'Voz e vídeo',
    description: 'Microfone, supressão de ruído e como o microfone é ativado.',
  },
  {
    id: 'notifications',
    label: 'Notificações e sons',
    icon: <Bell size={18} />,
    title: 'Notificações e sons',
    description: 'Avisos de mensagens e os sons do app.',
  },
  {
    id: 'shortcuts',
    label: 'Atalhos e app',
    icon: <Keyboard size={18} />,
    title: 'Atalhos e app para Windows',
    description: 'Teclas de atalho e o app de desktop.',
  },
];

interface SecuritySummary {
  email: string | null;
  emailVerified: boolean;
  emailEnabled: boolean;
  checkup: { key: string; ok: boolean; label: string }[];
}

/** Configurações da conta em tela cheia: menu de categorias à esquerda (abas no celular). */
export function UserSettings({
  onLogout,
  initialSection = 'account',
  securityPanel,
}: {
  onLogout(): void;
  initialSection?: SettingsSection;
  securityPanel?: 'email';
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const current = SECTIONS.find((s) => s.id === section)!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    closeModal();
    onLogout();
  };

  return (
    <div className="settings-page user-settings" role="dialog" aria-modal="true" aria-label="Configurações">
      <nav className="settings-nav" aria-label="Categorias">
        <div className="settings-nav-title">Configurações</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? 'active' : ''}
            aria-current={section === s.id ? 'page' : undefined}
            onClick={() => setSection(s.id)}
          >
            {s.icon}
            <span>{s.label}</span>
          </button>
        ))}
        <div className="settings-nav-sep" />
        <button className="danger-text" onClick={() => void logout()}>
          <LogOut size={18} />
          <span>Sair da conta</span>
        </button>
      </nav>
      <section className="settings-body">
        <button className="icon-btn settings-close" aria-label="Fechar" title="Fechar (Esc)" onClick={closeModal}>
          <X size={22} />
        </button>
        <div className="settings-section">
          <header className="settings-head">
            <h2>{current.title}</h2>
            <p className="muted">{current.description}</p>
          </header>
          {section === 'account' && <AccountOverview go={setSection} onLogout={() => void logout()} />}
          {section === 'profile' && <ProfileEditor />}
          {section === 'security' && (
            <p className="muted small">
              Quer saber tudo o que fazemos para proteger você? Veja a página{' '}
              <a href="/seguranca" target="_blank" rel="noopener">
                Segurança no Resenha
              </a>
              .
            </p>
          )}
          {section === 'security' && <SecuritySettings part="security" initialPanel={securityPanel} onLogout={() => void logout()} />}
          {section === 'privacy' && (
            <>
              <div className="settings-card">
                <MyFiles />
              </div>
              <SecuritySettings part="data" onLogout={() => void logout()} />
            </>
          )}
          {section === 'voice' && <VoiceSection />}
          {section === 'notifications' && (
            <div className="settings-card">
              <SoundSettings />
            </div>
          )}
          {section === 'shortcuts' && <ShortcutsSection />}
        </div>
      </section>
    </div>
  );
}

/** "Minha conta": cartão de perfil, e-mail, checkup e atalhos para o que mais se usa. */
function AccountOverview({ go, onLogout }: { go(s: SettingsSection): void; onLogout(): void }) {
  const me = useApp((s) => s.me)!;
  const [sec, setSec] = useState<SecuritySummary | null>(null);
  useEffect(() => {
    void api<SecuritySummary>('/me/security').then(setSec, () => {});
  }, []);
  const done = sec?.checkup.filter((c) => c.ok).length ?? 0;
  const total = sec?.checkup.length ?? 0;
  const row = (label: string, value: ReactNode, to: SettingsSection, action = 'Editar') => (
    <button className="account-row" onClick={() => go(to)}>
      <span className="account-row-label">{label}</span>
      <span className="account-row-value">{value}</span>
      <span className="account-row-action">
        {action} <ChevronRight size={16} />
      </span>
    </button>
  );
  return (
    <>
      <div className="account-card">
        <div className="account-card-banner" style={{ background: `linear-gradient(135deg, ${me.avatarColor}, var(--bg-3))` }} />
        <div className="account-card-head">
          <Avatar user={me} size={84} />
          <div>
            <strong className="account-card-name">{me.displayName}</strong>
            <span className="muted">@{me.username}</span>
          </div>
          <button className="btn small primary" onClick={() => go('profile')}>
            Editar perfil
          </button>
        </div>
        <div className="account-rows">
          {row('Nome de exibição', me.displayName, 'profile')}
          {row('Nome de usuário', `@${me.username}`, 'profile', 'Ver')}
          {sec?.emailEnabled &&
            row(
              'E-mail',
              sec.email && sec.emailVerified ? (
                <>
                  {sec.email} <span className="pill ok">confirmado</span>
                </>
              ) : (
                <span className="pill warn">não adicionado</span>
              ),
              'security',
              sec.email && sec.emailVerified ? 'Gerenciar' : 'Adicionar',
            )}
        </div>
      </div>

      {sec && (
        <button className={`settings-card checkup-mini${done === total ? ' all-good' : ''}`} onClick={() => go('security')}>
          <Shield size={28} />
          <span>
            <strong>
              Checkup de segurança: {done} de {total}
            </strong>
            <span className="muted small">
              {done === total ? 'Sua conta está com todas as proteções. 💪' : 'Veja o que falta para proteger sua conta.'}
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
      )}

      <div className="settings-card">
        <button className="btn danger ghost" onClick={onLogout}>
          <LogOut size={16} /> Sair da conta neste aparelho
        </button>
      </div>
    </>
  );
}

function VoiceSection() {
  const settings = useVoice((s) => s.settings);
  const inCall = useVoice((s) => s.status !== 'idle');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId)))
      .catch(() => {});
  }, []);
  const setMic = (patch: Partial<typeof settings>) => {
    updateSettings(patch);
    if (inCall) void voice.restartMic();
  };
  return (
    <div className="settings-card form">
      {mics.length > 0 && (
        <label>
          Microfone
          <select value={settings.micDeviceId ?? ''} onChange={(e) => setMic({ micDeviceId: e.target.value || null })}>
            <option value="">Padrão do sistema</option>
            {mics.map((m, i) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Microfone ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Supressão de ruído
        <select value={settings.noiseMode} onChange={(e) => setMic({ noiseMode: e.target.value as NoiseMode })}>
          {NOISE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="muted small">
          {NOISE_MODES.find((m) => m.id === settings.noiseMode)?.hint} As opções de IA rodam no seu aparelho: o som não vai para
          nenhum servidor. Com o filtro, a ativação por voz também ignora o teclado.
        </span>
        <NoiseStatus />
      </label>
      <InputModeSettings />
      <p className="muted small">
        A qualidade da transmissão de tela fica no botão de transmitir, dentro da chamada.{' '}
        <button className="link-btn small" onClick={() => openModal({ kind: 'screenShare' })}>
          Ver opções de transmissão
        </button>
      </p>
    </div>
  );
}

/** Na chamada: qual filtro está de fato ligado agora. */
function NoiseStatus() {
  const active = useVoice((s) => s.noiseActive);
  if (!active) return null;
  const label = { gtcrn: 'Forte (IA)', rnnoise: 'Leve (IA)', browser: 'Básica (do navegador)', off: 'Desligada' }[active];
  return (
    <span className="small noise-status" role="status">
      Na chamada agora: <strong>{label}</strong>
    </span>
  );
}

function ShortcutsSection() {
  const settings = useVoice((s) => s.settings);
  return (
    <>
      <div className="settings-card">
        <ul className="shortcut-list">
          <li>
            <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> <span>Silenciar / ativar microfone</span>
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> <span>Desativar / ativar áudio</span>
          </li>
          {settings.inputMode === 'ptt' && (
            <li>
              <kbd>{keyLabel(settings.pttKey)}</kbd> <span>Segure para falar</span>
            </li>
          )}
        </ul>
        <p className="muted small">
          {isDesktop
            ? '✅ No app, os atalhos e o push-to-talk funcionam mesmo com o jogo em primeiro plano.'
            : 'No site, os atalhos funcionam com a janela do Resenha em foco. Para usar com o jogo em primeiro plano, use a ativação por voz ou o app de desktop.'}
        </p>
      </div>
      <div className="settings-card">
        <DesktopSettingsSection />
      </div>
    </>
  );
}
