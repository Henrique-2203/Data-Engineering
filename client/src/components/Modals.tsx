import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, Share2, X } from 'lucide-react';
import type { Channel, Guild, InvitePreview, PublicUser } from '../../../shared/types';
import { api } from '../lib/api';
import {
  closeModal,
  findChannel,
  patchGuild,
  selectChannel,
  selectGuild,
  toast,
  updateGuildChannels,
  updateUserEverywhere,
  upsertGuild,
  useApp,
} from '../store/app';
import { updateSettings, useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { CODECS, SCREEN_PRESETS, effectiveBitrate, keyLabel, presetById } from '../voice/settings';
import { notificationsSupported, requestNotificationPermission } from '../lib/notify';
import { playSound } from '../lib/sounds';
import { mouseCode } from './Hotkeys';
import { GuildSettings } from './GuildSettings';
import { ProfileCard } from './ProfileCard';
import { ProfileEditor, StatusModal, GuildProfileModal } from './ProfileEditor';
import { Perm, useCan } from '../lib/perms';
import { refreshGuild } from '../lib/socket';
import { DESKTOP_DOWNLOAD_URL, desktop, isDesktop, type DesktopSettings } from '../lib/desktop';
import { Avatar } from './Avatar';
import { SecuritySettings } from './SecuritySettings';
import { MyFiles } from './MyFiles';
import { AdminReports, ReportModal } from './Reports';

export function Modals({ onLogout }: { onLogout(): void }) {
  const modal = useApp((s) => s.modal);
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);
  if (!modal) return null;

  switch (modal.kind) {
    case 'createGuild':
      return <CreateGuild />;
    case 'joinGuild':
      return <JoinGuild initialCode={modal.code} />;
    case 'invite':
      return <Invite guildId={modal.guildId} />;
    case 'createChannel':
      return <CreateChannel guildId={modal.guildId} type={modal.type} categoryId={modal.categoryId ?? null} />;
    case 'guildSettings':
      return <GuildSettings guildId={modal.guildId} initialTab={modal.tab} />;
    case 'createCategory':
      return <CategoryModal guildId={modal.guildId} />;
    case 'categorySettings':
      return <CategoryModal guildId={modal.guildId} categoryId={modal.categoryId} />;
    case 'channelSettings':
      return <ChannelSettings channelId={modal.channelId} />;
    case 'userSettings':
      return <UserSettings onLogout={onLogout} />;
    case 'screenShare':
      return <ScreenShare />;
    case 'image':
      return <Lightbox src={modal.src} name={modal.name} />;
    case 'profile':
      return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="modal profile-modal" role="dialog" aria-modal="true" aria-label="Perfil">
            <ProfileCard userId={modal.userId} guildId={modal.guildId} onAction={closeModal} />
          </div>
        </div>
      );
    case 'status':
      return <StatusModal />;
    case 'guildProfile':
      return <GuildProfileModal guildId={modal.guildId} />;
    case 'report':
      return <ReportModal target={modal.target} />;
    case 'adminReports':
      return <AdminReports />;
  }
}

function Lightbox({ src, name }: { src: string; name: string }) {
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={closeModal}>
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis">{name}</span>
        <a href={src} target="_blank" rel="noopener noreferrer" className="btn small">
          Abrir original
        </a>
        <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

function Modal({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

// ---------- servidores ----------

function CreateGuild() {
  const me = useApp((s) => s.me)!;
  const [name, setName] = useState(`Servidor de ${me.displayName}`);
  const { busy, error, submit } = useSubmit(async () => {
    const { guild } = await api<{ guild: Guild }>('/guilds', { body: { name } });
    upsertGuild(guild);
    selectGuild(guild.id);
    closeModal();
    useApp.setState({ modal: { kind: 'invite', guildId: guild.id } });
  });
  return (
    <Modal title="Criar servidor">
      <form onSubmit={submit} className="form">
        <p className="muted">Seu espaço para conversar, entrar em chamadas e transmitir a tela com os amigos.</p>
        <label>
          Nome do servidor
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={closeModal}>Cancelar</button>
          <button className="btn primary" disabled={busy || !name.trim()}>Criar</button>
        </div>
      </form>
    </Modal>
  );
}

function parseInviteCode(input: string) {
  const trimmed = input.trim();
  const m = /invite\/([\w-]+)/.exec(trimmed);
  return m ? m[1] : trimmed;
}

function JoinGuild({ initialCode }: { initialCode?: string }) {
  const [input, setInput] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const code = parseInviteCode(input);

  useEffect(() => {
    setPreview(null);
    if (code.length < 4) return;
    const t = setTimeout(() => {
      api<InvitePreview>(`/invites/${encodeURIComponent(code)}`).then(setPreview, () => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [code]);

  const { busy, error, submit } = useSubmit(async () => {
    const { guild } = await api<{ guild: Guild }>(`/invites/${encodeURIComponent(code)}/join`, { method: 'POST' });
    upsertGuild(guild);
    selectGuild(guild.id);
    closeModal();
    toast(`Você entrou em ${guild.name}!`);
  });

  return (
    <Modal title="Entrar em um servidor">
      <form onSubmit={submit} className="form">
        <label>
          Link ou código do convite
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://…/invite/AbC123" required autoFocus={!initialCode} />
        </label>
        {preview && (
          <div className="invite-preview">
            <strong>{preview.guildName}</strong>
            <span className="muted">
              {preview.memberCount} membro{preview.memberCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={closeModal}>Cancelar</button>
          <button className="btn primary" disabled={busy || !code}>Entrar</button>
        </div>
      </form>
    </Modal>
  );
}

function Invite({ guildId }: { guildId: string }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const canRegenerate = useCan(guildId, Perm.MANAGE_GUILD);
  if (!guild) return null;
  const link = `${location.origin}/invite/${guild.inviteCode}`;
  if (!guild.inviteCode) {
    return (
      <Modal title="Convidar amigos">
        <p className="muted">Você não tem permissão para convidar pessoas neste servidor. Peça para alguém com cargo.</p>
      </Modal>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado!');
    } catch {
      toast('Não deu para copiar. Selecione o link e copie manualmente.');
    }
  }

  async function regenerate() {
    if (!confirm('Gerar um novo link? O link atual deixará de funcionar.')) return;
    try {
      const { inviteCode } = await api<{ inviteCode: string }>(`/guilds/${guildId}/invite`, { method: 'POST' });
      patchGuild(guildId, { inviteCode });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <Modal title={`Convidar amigos para ${guild.name}`}>
      <div className="form">
        <p className="muted">Mande este link para seus amigos. Quem abrir pode criar uma conta e entrar no servidor.</p>
        <div className="copy-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de convite" />
          <button className="btn primary" onClick={copy}>
            <Copy size={16} /> Copiar
          </button>
        </div>
        {'share' in navigator && (
          <button className="btn block" onClick={() => navigator.share({ title: guild.name, text: `Entra na resenha: ${guild.name}`, url: link }).catch(() => {})}>
            <Share2 size={16} /> Compartilhar
          </button>
        )}
        {canRegenerate && (
          <button className="link-btn small" onClick={regenerate}>
            Gerar novo link (invalida o atual)
          </button>
        )}
      </div>
    </Modal>
  );
}

const BITRATE_OPTIONS = [
  { value: 64, label: '64 kbps (leve, bom para internet ruim)' },
  { value: 96, label: '96 kbps' },
  { value: 128, label: '128 kbps (padrão)' },
  { value: 192, label: '192 kbps' },
  { value: 256, label: '256 kbps (alta)' },
  { value: 384, label: '384 kbps' },
  { value: 510, label: '510 kbps (máxima, estúdio)' },
];

/** Campos comuns de canal: categoria, privacidade por cargo e (voz) qualidade e limite. */
function ChannelFields({
  guildId,
  type,
  value,
  onChange,
}: {
  guildId: string;
  type: 'text' | 'voice';
  value: { categoryId: string | null; allowedRoleIds: string[] | null; bitrate: number; userLimit: number };
  onChange(v: Partial<typeof value>): void;
}) {
  const guild = useApp((s) => s.guilds[guildId]);
  const roles = [...(guild?.roles ?? [])].sort((a, b) => b.position - a.position);
  const isPrivate = value.allowedRoleIds !== null;
  return (
    <>
      {(guild?.categories.length ?? 0) > 0 && (
        <label>
          Categoria
          <select value={value.categoryId ?? ''} onChange={(e) => onChange({ categoryId: e.target.value || null })}>
            <option value="">Sem categoria</option>
            {guild!.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={isPrivate} onChange={(e) => onChange({ allowedRoleIds: e.target.checked ? [] : null })} />
        🔒 Canal privado (só cargos escolhidos veem)
      </label>
      {isPrivate && (
        <div className="field">
          {roles.length === 0 ? (
            <p className="muted small">Crie cargos em Configurações do servidor → Cargos. Sem cargos marcados, só o dono e administradores veem.</p>
          ) : (
            <div className="role-pills">
              {roles.map((r) => {
                const on = value.allowedRoleIds!.includes(r.id);
                return (
                  <button
                    type="button"
                    key={r.id}
                    className={`role-pill${on ? ' on' : ''}`}
                    style={{ '--role': r.color } as React.CSSProperties}
                    aria-pressed={on}
                    onClick={() =>
                      onChange({ allowedRoleIds: on ? value.allowedRoleIds!.filter((x) => x !== r.id) : [...value.allowedRoleIds!, r.id] })
                    }
                  >
                    <span className="role-dot" style={{ background: r.color }} />
                    {r.name}
                  </button>
                );
              })}
            </div>
          )}
          <span className="muted small">O dono e quem tem Administrador sempre veem.</span>
        </div>
      )}
      {type === 'voice' && (
        <>
          <label>
            Qualidade do áudio
            <select value={value.bitrate} onChange={(e) => onChange({ bitrate: Number(e.target.value) })}>
              {BITRATE_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <span className="muted small">No Discord sem boost, o máximo é 96 kbps. Aqui é grátis até 510.</span>
          </label>
          <label>
            Limite de pessoas: <strong>{value.userLimit === 0 ? 'sem limite' : value.userLimit}</strong>
            <input type="range" min={0} max={25} value={value.userLimit} onChange={(e) => onChange({ userLimit: Number(e.target.value) })} aria-label="Limite de pessoas" />
          </label>
        </>
      )}
    </>
  );
}

function CreateChannel({ guildId, type: initialType, categoryId }: { guildId: string; type: 'text' | 'voice'; categoryId: string | null }) {
  const [type, setType] = useState(initialType);
  const [name, setName] = useState('');
  const [fields, setFields] = useState({ categoryId, allowedRoleIds: null as string[] | null, bitrate: 128, userLimit: 0 });
  const { busy, error, submit } = useSubmit(async () => {
    const { channel } = await api<{ channel: Channel }>(`/guilds/${guildId}/channels`, {
      body: { name, type, ...fields, ...(type === 'text' ? { bitrate: undefined, userLimit: undefined } : {}) },
    });
    await refreshGuild(guildId);
    closeModal();
    if (channel.type === 'text') selectChannel(channel.id);
  });
  return (
    <Modal title="Criar canal">
      <form onSubmit={submit} className="form">
        <div className="radio-cards">
          <label className={type === 'text' ? 'selected' : ''}>
            <input type="radio" checked={type === 'text'} onChange={() => setType('text')} />
            <strong># Texto</strong>
            <span className="muted small">Mensagens, links e imagens</span>
          </label>
          <label className={type === 'voice' ? 'selected' : ''}>
            <input type="radio" checked={type === 'voice'} onChange={() => setType('voice')} />
            <strong>🔊 Voz</strong>
            <span className="muted small">Voz, câmera e transmissão de tela</span>
          </label>
        </div>
        <label>
          Nome do canal
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder={type === 'text' ? 'novo-canal' : 'Jogatina'} />
        </label>
        <ChannelFields guildId={guildId} type={type} value={fields} onChange={(v) => setFields({ ...fields, ...v })} />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={closeModal}>Cancelar</button>
          <button className="btn primary" disabled={busy || !name.trim()}>Criar canal</button>
        </div>
      </form>
    </Modal>
  );
}

function ChannelSettings({ channelId }: { channelId: string }) {
  const channel = useApp(() => findChannel(channelId));
  const [name, setName] = useState(channel?.name ?? '');
  const [fields, setFields] = useState({
    categoryId: channel?.categoryId ?? null,
    allowedRoleIds: channel?.allowedRoleIds ?? null,
    bitrate: channel?.bitrate ?? 128,
    userLimit: channel?.userLimit ?? 0,
  });
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/channels/${channelId}`, {
      method: 'PATCH',
      body: { name, ...fields, ...(channel?.type === 'text' ? { bitrate: undefined, userLimit: undefined } : {}) },
    });
    closeModal();
    toast('Canal salvo.');
  });
  if (!channel || channel.type === 'dm') return null;

  async function remove() {
    if (!confirm(`Excluir o canal "${channel!.name}"? ${channel!.type === 'text' ? 'Todas as mensagens serão apagadas.' : ''}`)) return;
    try {
      await api(`/channels/${channelId}`, { method: 'DELETE' });
      closeModal();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <Modal title="Editar canal">
      <form onSubmit={submit} className="form">
        <label>
          Nome do canal
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus />
        </label>
        <ChannelFields guildId={channel.guildId} type={channel.type} value={fields} onChange={(v) => setFields({ ...fields, ...v })} />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions spread">
          <button type="button" className="btn danger ghost" onClick={remove}>Excluir canal</button>
          <button className="btn primary" disabled={busy || !name.trim()}>Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryModal({ guildId, categoryId }: { guildId: string; categoryId?: string }) {
  const category = useApp((s) => s.guilds[guildId]?.categories.find((c) => c.id === categoryId));
  const [name, setName] = useState(category?.name ?? '');
  const { busy, error, submit } = useSubmit(async () => {
    if (categoryId) await api(`/categories/${categoryId}`, { method: 'PATCH', body: { name } });
    else await api(`/guilds/${guildId}/categories`, { body: { name } });
    await refreshGuild(guildId);
    closeModal();
  });
  return (
    <Modal title={categoryId ? 'Editar categoria' : 'Criar categoria'}>
      <form onSubmit={submit} className="form">
        <p className="muted small">Categorias agrupam canais na barra lateral (ex.: "Jogos", "Papo"). Arraste canais para dentro delas.</p>
        <label>
          Nome da categoria
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="Jogos" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions spread">
          {categoryId ? (
            <button
              type="button"
              className="btn danger ghost"
              onClick={async () => {
                if (!confirm(`Excluir a categoria "${category?.name}"? Os canais dela continuam, só ficam sem categoria.`)) return;
                try {
                  await api(`/categories/${categoryId}`, { method: 'DELETE' });
                  await refreshGuild(guildId);
                  closeModal();
                } catch (err) {
                  toast((err as Error).message);
                }
              }}
            >
              Excluir categoria
            </button>
          ) : (
            <span />
          )}
          <button className="btn primary" disabled={busy || !name.trim()}>
            {categoryId ? 'Salvar' : 'Criar categoria'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- usuário ----------

const COLORS = ['#f97316', '#ef4444', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

function UserSettings({ onLogout }: { onLogout(): void }) {
  const me = useApp((s) => s.me)!;
  const settings = useVoice((s) => s.settings);
  const inCall = useVoice((s) => s.status !== 'idle');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId)))
      .catch(() => {});
  }, []);

  function setMicSetting(patch: Partial<typeof settings>) {
    updateSettings(patch);
    if (inCall) void voice.restartMic();
  }

  return (
    <Modal title="Configurações">
      <ProfileEditor />

      <h3 className="subhead">Voz</h3>
      <div className="form">
        {mics.length > 0 && (
          <label>
            Microfone
            <select value={settings.micDeviceId ?? ''} onChange={(e) => setMicSetting({ micDeviceId: e.target.value || null })}>
              <option value="">Padrão do sistema</option>
              {mics.map((m, i) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || `Microfone ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={settings.noiseSuppression} onChange={(e) => setMicSetting({ noiseSuppression: e.target.checked })} />
          Supressão de ruído
        </label>
        <InputModeSettings />
      </div>

      <SoundSettings />

      <h3 className="subhead">Atalhos</h3>
      <ul className="shortcut-list">
        <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> <span>Silenciar / ativar microfone</span></li>
        <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> <span>Desativar / ativar áudio</span></li>
        {settings.inputMode === 'ptt' && (
          <li><kbd>{keyLabel(settings.pttKey)}</kbd> <span>Segure para falar</span></li>
        )}
      </ul>
      <p className="muted small">
        {isDesktop
          ? '✅ No app, os atalhos e o push-to-talk funcionam mesmo com o jogo em primeiro plano.'
          : 'No site, os atalhos funcionam com a janela do Resenha em foco. Para usar com o jogo em primeiro plano, use a ativação por voz ou o app de desktop.'}
      </p>

      <DesktopSettingsSection />

      <MyFiles />

      <SecuritySettings
        onLogout={async () => {
          await api('/auth/logout', { method: 'POST' }).catch(() => {});
          closeModal();
          onLogout();
        }}
      />

      <h3 className="subhead">Conta</h3>
      <button
        className="btn danger ghost"
        onClick={async () => {
          await api('/auth/logout', { method: 'POST' }).catch(() => {});
          closeModal();
          onLogout();
        }}
      >
        Sair da conta
      </button>
    </Modal>
  );
}

function InputModeSettings() {
  const settings = useVoice((s) => s.settings);
  const inCall = useVoice((s) => s.status !== 'idle');
  const level = useVoice((s) => s.micLevelDb);
  const pttActive = useVoice((s) => s.pttActive);
  const [binding, setBinding] = useState(false);

  function set(patch: Partial<typeof settings>) {
    updateSettings(patch);
    voice.setPtt(false);
    voice.updateGate();
  }

  // grava a próxima tecla ou botão do mouse como tecla do push-to-talk
  useEffect(() => {
    if (!binding) return;
    document.body.dataset.bindingKey = '1';
    const done = (code: string | null) => {
      if (code) set({ pttKey: code });
      setBinding(false);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      done(e.code === 'Escape' ? null : e.code);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) return; // botões principal e direito não servem
      e.preventDefault();
      done(mouseCode(e.button));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      delete document.body.dataset.bindingKey;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [binding]);

  // medidor: -80 dB à esquerda, 0 dB à direita
  const pct = (db: number) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));

  return (
    <>
      <div className="field">
        <span>Modo de entrada</span>
        <div className="radio-cards">
          <label className={settings.inputMode === 'voice' ? 'selected' : ''}>
            <input type="radio" checked={settings.inputMode === 'voice'} onChange={() => set({ inputMode: 'voice' })} />
            <strong>🎙️ Ativação por voz</strong>
            <span className="muted small">Transmite quando você fala. Funciona com o jogo em primeiro plano.</span>
          </label>
          <label className={settings.inputMode === 'ptt' ? 'selected' : ''}>
            <input type="radio" checked={settings.inputMode === 'ptt'} onChange={() => set({ inputMode: 'ptt' })} />
            <strong>⌨️ Aperte para falar</strong>
            <span className="muted small">
              {isDesktop ? 'Funciona com o jogo em primeiro plano.' : 'No site, só com a janela do Resenha em foco (no app, funciona sempre).'}
            </span>
          </label>
        </div>
      </div>

      {settings.inputMode === 'voice' ? (
        <label>
          Sensibilidade: {settings.vadThresholdDb} dB
          <div className="vad-meter" aria-hidden>
            <div className={`vad-level${level > settings.vadThresholdDb ? ' open' : ''}`} style={{ width: `${pct(level)}%` }} />
            <div className="vad-threshold" style={{ left: `${pct(settings.vadThresholdDb)}%` }} />
          </div>
          <input
            type="range"
            min={-80}
            max={-10}
            step={1}
            value={settings.vadThresholdDb}
            onChange={(e) => set({ vadThresholdDb: Number(e.target.value) })}
            aria-label="Sensibilidade da ativação por voz"
          />
          <span className="muted small">
            {inCall
              ? 'Fale normalmente: a barra fica verde quando o microfone está transmitindo. Arraste para a direita se ruídos (teclado, ventilador) estiverem passando.'
              : 'Entre em uma chamada para ver o medidor e testar a sensibilidade.'}
          </span>
        </label>
      ) : (
        <div className="field">
          <span>Tecla do push-to-talk</span>
          <div className="row ptt-row">
            <button type="button" className={`btn${binding ? ' on' : ''}`} onClick={() => setBinding(true)}>
              {binding ? 'Aperte uma tecla ou botão lateral do mouse…' : keyLabel(settings.pttKey)}
            </button>
            {inCall && <span className={`ptt-state${pttActive ? ' on' : ''}`}>{pttActive ? 'Transmitindo' : 'Solto'}</span>}
          </div>
          <span className="muted small">Clique e aperte a tecla desejada (Esc cancela).</span>
        </div>
      )}
    </>
  );
}

/** App de desktop: no app, opções de bandeja/inicialização e atualização; no site, link de download. */
function DesktopSettingsSection() {
  const [ds, setDs] = useState<DesktopSettings | null>(null);
  const shareActivity = useVoice((s) => s.settings.shareActivity);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    void desktop.getSettings().then(setDs);
    return desktop.onUpdate((update) => setDs((d) => (d ? { ...d, update } : d)));
  }, []);

  if (!desktop) {
    return (
      <>
        <h3 className="subhead">App para Windows</h3>
        <p className="muted small">
          Com o app, o push-to-talk e os atalhos funcionam por cima do jogo e a transmissão roda sem os limites do navegador.
        </p>
        <a className="btn" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
          📥 Baixar o app para Windows
        </a>
      </>
    );
  }
  if (!ds) return null;
  const u = ds.update;
  const status =
    u.state === 'ready'
      ? `Versão ${u.version} pronta para instalar.`
      : u.state === 'downloading'
        ? `Baixando atualização${u.version ? ` ${u.version}` : ''}… ${u.percent ?? 0}%`
        : u.state === 'checking'
          ? 'Procurando atualizações…'
          : u.state === 'error'
            ? `Não foi possível procurar atualizações${u.message ? ` (${u.message})` : ''}.`
            : u.state === 'dev'
              ? 'Modo de desenvolvimento (sem atualização automática).'
              : 'Você está na versão mais recente.';
  const set = async (patch: Partial<Pick<DesktopSettings, 'closeToTray' | 'openAtLogin'>>) => setDs(await desktop!.setSettings(patch));
  return (
    <>
      <h3 className="subhead">App de desktop</h3>
      <div className="form">
        <label className="check">
          <input type="checkbox" checked={ds.openAtLogin} onChange={(e) => void set({ openAtLogin: e.target.checked })} />
          Abrir junto com o Windows (minimizado na bandeja)
        </label>
        <label className="check">
          <input type="checkbox" checked={ds.closeToTray} onChange={(e) => void set({ closeToTray: e.target.checked })} />
          Ao fechar a janela, continuar na bandeja (a chamada não cai)
        </label>
        <label className="check">
          <input type="checkbox" checked={shareActivity} onChange={(e) => updateSettings({ shareActivity: e.target.checked })} />
          Mostrar no meu perfil o jogo que estou jogando ("Jogando agora")
        </label>
        <div className="desktop-version">
          <span className="muted small">
            Resenha v{ds.version} · {status}
          </span>
          {u.state === 'ready' ? (
            <button className="btn small primary" onClick={() => desktop!.installUpdate()}>
              Reiniciar e atualizar
            </button>
          ) : (
            <button
              className="btn small"
              disabled={checking || u.state === 'dev' || u.state === 'downloading'}
              onClick={async () => {
                setChecking(true);
                const update = await desktop!.checkForUpdates();
                setDs((d) => (d ? { ...d, update } : d));
                setChecking(false);
              }}
            >
              Procurar atualizações
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function SoundSettings() {
  const settings = useVoice((s) => s.settings);
  const [permission, setPermission] = useState(notificationsSupported() ? Notification.permission : 'denied');
  return (
    <>
      <h3 className="subhead">Sons e notificações</h3>
      <div className="form">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.sounds}
            onChange={(e) => {
              updateSettings({ sounds: e.target.checked });
              if (e.target.checked) playSound('join');
            }}
          />
          Sons (entrar/sair da chamada, silenciar, mensagem nova, transmissão iniciada)
        </label>
        {notificationsSupported() && (
          <label className="check">
            <input
              type="checkbox"
              checked={settings.notifications && permission === 'granted'}
              disabled={permission === 'denied'}
              onChange={async (e) => {
                if (e.target.checked) {
                  const ok = await requestNotificationPermission();
                  setPermission(Notification.permission);
                  updateSettings({ notifications: ok });
                } else {
                  updateSettings({ notifications: false });
                }
              }}
            />
            Notificações de mensagens quando o Resenha estiver em segundo plano
          </label>
        )}
        {permission === 'denied' && notificationsSupported() && (
          <p className="muted small">As notificações estão bloqueadas no navegador. Libere nas permissões do site (ícone ao lado do endereço).</p>
        )}
      </div>
    </>
  );
}

// ---------- transmissão de tela ----------

function ScreenShare() {
  const settings = useVoice((s) => s.settings);
  const sharing = useVoice((s) => s.screen);
  const channelId = useVoice((s) => s.channelId);
  const viewers = useApp((s) => Object.values(s.voiceStates).filter((v) => v.channelId === channelId).length - 1);
  const preset = presetById(settings.screenPreset);
  const bitrate = effectiveBitrate(settings);
  const mbps = bitrate / 1e6;
  const [starting, setStarting] = useState(false);
  const relayedPeers = useVoice((s) => Object.values(s.remotes).filter((r) => r.relayed).length);

  function update(patch: Partial<typeof settings>) {
    updateSettings(patch);
    if (sharing || 'turnSaver' in patch) voice.refreshEncodings();
  }

  async function start() {
    setStarting(true);
    const ok = await voice.startScreen();
    setStarting(false);
    if (ok) closeModal();
  }

  return (
    <Modal title="Transmitir tela" wide>
      <div className="form">
        <label>
          Qualidade
          <select
            value={settings.screenPreset}
            disabled={sharing}
            title={sharing ? 'Pare e reinicie a transmissão para trocar a resolução' : undefined}
            onChange={(e) => update({ screenPreset: e.target.value, bitrateMbps: null })}
          >
            {SCREEN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} (≈{p.bitrate / 1e6} Mbps)
              </option>
            ))}
          </select>
        </label>

        <label>
          Bitrate máximo: <strong>{mbps.toFixed(1)} Mbps</strong>
          <input
            type="range"
            min={1}
            max={40}
            step={0.5}
            value={mbps}
            onChange={(e) => update({ bitrateMbps: Number(e.target.value) })}
          />
          <span className="muted small">
            Mais bitrate = imagem mais nítida em cenas rápidas. Cada pessoa assistindo recebe uma cópia, então seu upload precisa
            de ≈{(mbps * Math.max(1, viewers)).toFixed(0)} Mbps com {Math.max(1, viewers)} espectador{viewers > 1 ? 'es' : ''}.
          </span>
        </label>

        <div className="field">
          <span>Tipo de conteúdo</span>
          <div className="radio-cards">
            <label className={settings.contentType === 'motion' ? 'selected' : ''}>
              <input type="radio" checked={settings.contentType === 'motion'} onChange={() => update({ contentType: 'motion' })} />
              <strong>🎮 Jogo / vídeo</strong>
              <span className="muted small">Prioriza fluidez ({preset.fps} FPS)</span>
            </label>
            <label className={settings.contentType === 'detail' ? 'selected' : ''}>
              <input type="radio" checked={settings.contentType === 'detail'} onChange={() => update({ contentType: 'detail' })} />
              <strong>📝 Texto / código</strong>
              <span className="muted small">Prioriza nitidez</span>
            </label>
          </div>
        </div>

        <label>
          Codec
          <select value={settings.codec} onChange={(e) => update({ codec: e.target.value as typeof settings.codec })} disabled={sharing}>
            {CODECS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={settings.screenAudio} onChange={(e) => update({ screenAudio: e.target.checked })} disabled={sharing} />
          Transmitir o som do computador/aba
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.turnSaver} onChange={(e) => update({ turnSaver: e.target.checked })} />
          Economizar a cota do TURN
        </label>
        <p className="muted small">
          Quem não consegue conexão direta com você (comum no 4G/5G) recebe pelo servidor TURN, que tem cota grátis pequena.
          Para essas pessoas a tela vai em 720p · 30 FPS · 1 Mbps; quem tem conexão direta continua em qualidade máxima.
          {relayedPeers > 0 && (
            <strong className="warn"> Agora: {relayedPeers} pessoa{relayedPeers > 1 ? 's' : ''} via TURN.</strong>
          )}
        </p>

        <p className="muted small">
          Dica: no Chrome/Edge do Windows, escolha “Tela inteira” e marque “Compartilhar áudio do sistema”. Em uma aba, marque
          “Compartilhar áudio da aba”.
        </p>

        <div className="modal-actions">
          <button className="btn ghost" onClick={closeModal}>{sharing ? 'Fechar' : 'Cancelar'}</button>
          {!sharing && (
            <button className="btn primary" onClick={start} disabled={starting}>
              {starting ? 'Escolha a tela…' : 'Escolher tela e transmitir'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
