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
import { CODECS, SCREEN_PRESETS, effectiveBitrate, presetById } from '../voice/settings';
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
  }
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
      </div>

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

  function update(patch: Partial<typeof settings>) {
    updateSettings(patch);
    if (sharing) voice.refreshEncodings();
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
