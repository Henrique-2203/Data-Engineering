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
import { DESKTOP_DOWNLOAD_URL, desktop, isDesktop, type DesktopSettings } from '../lib/desktop';
import { Avatar } from './Avatar';

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
      return <CreateChannel guildId={modal.guildId} type={modal.type} />;
    case 'guildSettings':
      return <GuildSettings guildId={modal.guildId} />;
    case 'channelSettings':
      return <ChannelSettings channelId={modal.channelId} />;
    case 'userSettings':
      return <UserSettings onLogout={onLogout} />;
    case 'screenShare':
      return <ScreenShare />;
    case 'image':
      return <Lightbox src={modal.src} name={modal.name} />;
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
  const me = useApp((s) => s.me)!;
  if (!guild) return null;
  const link = `${location.origin}/invite/${guild.inviteCode}`;
  const isOwner = guild.ownerId === me.id;

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
        {isOwner && (
          <button className="link-btn small" onClick={regenerate}>
            Gerar novo link (invalida o atual)
          </button>
        )}
      </div>
    </Modal>
  );
}

function GuildSettings({ guildId }: { guildId: string }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const me = useApp((s) => s.me)!;
  const [name, setName] = useState(guild?.name ?? '');
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/guilds/${guildId}`, { method: 'PATCH', body: { name } });
    patchGuild(guildId, { name: name.trim() });
    toast('Servidor atualizado.');
  });
  if (!guild) return null;

  async function kick(user: PublicUser) {
    if (!confirm(`Remover ${user.displayName} do servidor?`)) return;
    try {
      await api(`/guilds/${guildId}/members/${user.id}`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    const typed = prompt(`Isto apaga o servidor, canais e mensagens para sempre.\nDigite o nome do servidor para confirmar:`);
    if (typed?.trim() !== guild!.name) return;
    try {
      await api(`/guilds/${guildId}`, { method: 'DELETE' });
      closeModal();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <Modal title="Configurações do servidor">
      <form onSubmit={submit} className="form">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn primary" disabled={busy || !name.trim() || name.trim() === guild.name}>Salvar</button>
        </div>
      </form>
      <h3 className="subhead">Membros ({guild.members.length})</h3>
      <ul className="member-admin">
        {guild.members.map((m) => (
          <li key={m.id}>
            <Avatar user={m} size={28} />
            <span className="ellipsis">
              {m.displayName} <span className="muted">@{m.username}</span>
            </span>
            {m.id !== me.id && (
              <button className="btn small ghost danger" onClick={() => kick(m)}>Remover</button>
            )}
          </li>
        ))}
      </ul>
      <h3 className="subhead danger-text">Zona de perigo</h3>
      <button className="btn danger" onClick={remove}>Excluir servidor</button>
    </Modal>
  );
}

// ---------- canais ----------

function CreateChannel({ guildId, type: initialType }: { guildId: string; type: 'text' | 'voice' }) {
  const [type, setType] = useState(initialType);
  const [name, setName] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const { channel } = await api<{ channel: Channel }>(`/guilds/${guildId}/channels`, { body: { name, type } });
    updateGuildChannels(guildId, (list) => (list.some((c) => c.id === channel.id) ? list : [...list, channel]));
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
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/channels/${channelId}`, { method: 'PATCH', body: { name } });
    closeModal();
  });
  if (!channel) return null;

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
        {error && <p className="error">{error}</p>}
        <div className="modal-actions spread">
          <button type="button" className="btn danger ghost" onClick={remove}>Excluir canal</button>
          <button className="btn primary" disabled={busy || !name.trim()}>Salvar</button>
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
  const [displayName, setDisplayName] = useState(me.displayName);
  const [color, setColor] = useState(me.avatarColor);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId)))
      .catch(() => {});
  }, []);

  const { busy, error, submit } = useSubmit(async () => {
    const { user } = await api<{ user: PublicUser }>('/me', { method: 'PATCH', body: { displayName, avatarColor: color } });
    updateUserEverywhere(user);
    toast('Perfil atualizado.');
  });

  function setMicSetting(patch: Partial<typeof settings>) {
    updateSettings(patch);
    if (inCall) void voice.restartMic();
  }

  return (
    <Modal title="Configurações">
      <form onSubmit={submit} className="form">
        <div className="profile-preview">
          <Avatar user={{ displayName, avatarColor: color }} size={56} />
          <div>
            <strong>{displayName || me.username}</strong>
            <div className="muted">@{me.username}</div>
          </div>
        </div>
        <label>
          Nome de exibição
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required />
        </label>
        <div className="field">
          <span>Cor do avatar</span>
          <div className="color-row">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`color-swatch${c === color ? ' selected' : ''}`}
                style={{ background: c }}
                aria-label={`Cor ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn primary" disabled={busy}>Salvar perfil</button>
        </div>
      </form>

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
