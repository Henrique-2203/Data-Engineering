import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import type { Profile, ProfileLink, ProfileLinkType, PublicUser } from '../../../shared/types';
import { api } from '../lib/api';
import { LINK_INFO, activeStatus } from '../lib/presence';
import { uploadGuildAvatar, uploadProfileImage } from '../lib/upload';
import { refreshGuild } from '../lib/socket';
import { Perm, has, myPermissions } from '../lib/perms';
import { closeModal, toast, updateUserEverywhere, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';

const COLORS = ['#f97316', '#ef4444', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '30 minutos', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '4 horas', minutes: 240 },
  { label: 'Hoje (até meia-noite)', minutes: -1 },
  { label: 'Sem prazo', minutes: null },
];

const minutesUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.round((midnight.getTime() - now.getTime()) / 60_000));
};

async function saveMe(body: Record<string, unknown>) {
  const { user } = await api<{ user: PublicUser }>('/me', { method: 'PATCH', body });
  updateUserEverywhere(user);
  return user;
}

/** Edição de perfil: foto, banner, nome, cor, pronomes, bio e links (nas Configurações). */
export function ProfileEditor() {
  const me = useApp((s) => s.me)!;
  const [extra, setExtra] = useState<Pick<Profile, 'bannerId' | 'bio' | 'pronouns' | 'links'> | null>(null);
  const [displayName, setDisplayName] = useState(me.displayName);
  const [color, setColor] = useState(me.avatarColor);
  const [bio, setBio] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const load = () =>
    api<{ profile: Profile }>(`/users/${me.id}/profile`).then(({ profile }) => {
      setExtra(profile);
      setBio(profile.bio);
      setPronouns(profile.pronouns);
      setLinks(profile.links);
    });
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(kind: 'avatar' | 'banner', file?: File) {
    if (!file) return;
    setBusy(kind);
    try {
      const r = await uploadProfileImage(kind, file);
      toast(`${kind === 'avatar' ? 'Foto' : 'Banner'} atualizado (${Math.max(1, Math.round(r.bytes / 1024))} KB).`);
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(null);
  }

  async function remove(kind: 'avatar' | 'banner') {
    try {
      await api(`/me/${kind}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function save() {
    setBusy('save');
    try {
      await saveMe({ displayName, avatarColor: color, bio, pronouns, links: links.filter((l) => l.url.trim()) });
      toast('Perfil salvo.');
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(null);
  }

  const banner = extra?.bannerId ? `/api/images/${extra.bannerId}` : null;
  return (
    <div className="form">
      <div className="profile-editor-preview">
        <div className="profile-banner" style={banner ? { backgroundImage: `url(${banner})` } : { background: color }} />
        <span className="profile-avatar">
          <Avatar user={{ ...me, displayName, avatarColor: color }} size={80} />
        </span>
        <div className="profile-editor-buttons">
          <button type="button" className="btn small" disabled={!!busy} onClick={() => avatarInput.current?.click()}>
            <ImagePlus size={15} /> {busy === 'avatar' ? 'Enviando…' : 'Foto (aceita GIF)'}
          </button>
          {me.avatarId && (
            <button type="button" className="btn small ghost" onClick={() => void remove('avatar')}>
              Remover foto
            </button>
          )}
          <button type="button" className="btn small" disabled={!!busy} onClick={() => bannerInput.current?.click()}>
            <ImagePlus size={15} /> {busy === 'banner' ? 'Enviando…' : 'Banner'}
          </button>
          {extra?.bannerId && (
            <button type="button" className="btn small ghost" onClick={() => void remove('banner')}>
              Remover banner
            </button>
          )}
        </div>
        <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload('avatar', e.target.files?.[0])} />
        <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload('banner', e.target.files?.[0])} />
      </div>
      <p className="muted small">As imagens são recortadas e comprimidas antes de enviar (GIF até 1,5 MB), e trocar apaga a anterior.</p>

      <label>
        Nome de exibição
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required />
      </label>
      <div className="field">
        <span>Cor (sem foto, aparece no lugar dela; também é o fundo do perfil sem banner)</span>
        <div className="color-row">
          {COLORS.map((c) => (
            <button type="button" key={c} className={`color-swatch${c === color ? ' selected' : ''}`} style={{ background: c }} aria-label={`Cor ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <label>
        <span>
          Pronomes <span className="muted">(opcional)</span>
        </span>
        <input value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} placeholder="ex.: ele/dele" />
      </label>
      <label>
        <span>
          Bio <span className="muted">({190 - bio.length})</span>
        </span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} rows={3} placeholder="Conte um pouco sobre você, seus jogos favoritos…" />
      </label>

      <div className="field">
        <span>Links</span>
        {links.map((l, i) => (
          <div key={i} className="link-row">
            <select
              value={l.type}
              aria-label="Tipo de link"
              onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, type: e.target.value as ProfileLinkType } : x)))}
            >
              {Object.entries(LINK_INFO).map(([type, info]) => (
                <option key={type} value={type}>
                  {info.icon} {info.label}
                </option>
              ))}
            </select>
            <input
              value={l.url}
              aria-label="Endereço do link"
              placeholder={LINK_INFO[l.type].placeholder}
              onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            />
            <button type="button" className="icon-btn" aria-label="Remover link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {links.length < 6 && (
          <button type="button" className="btn small ghost add-link" onClick={() => setLinks([...links, { type: 'steam', url: '' }])}>
            <Plus size={15} /> Adicionar link
          </button>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn primary" disabled={busy === 'save' || !displayName.trim()} onClick={() => void save()}>
          Salvar perfil
        </button>
      </div>
    </div>
  );
}

/** Janela rápida de status (ao clicar no seu nome, no canto inferior esquerdo). */
export function StatusModal() {
  const me = useApp((s) => s.me)!;
  const current = activeStatus(me);
  const [emoji, setEmoji] = useState<string | null>(current?.emoji ?? null);
  const [text, setText] = useState(current?.text ?? '');
  const [duration, setDuration] = useState<number | null>(240);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(clear = false) {
    setBusy(true);
    try {
      const minutes = duration === -1 ? minutesUntilMidnight() : duration;
      await saveMe({ status: clear ? null : { text: text.trim(), emoji, expiresInMinutes: minutes } });
      toast(clear ? 'Status removido.' : 'Status salvo.');
      closeModal();
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Definir status">
        <div className="modal-head">
          <h2>Definir status</h2>
          <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body form">
          <div className="status-input">
            <button type="button" className="status-emoji" aria-label="Escolher emoji do status" onClick={() => setPicker((v) => !v)}>
              {emoji ?? '🙂'}
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} placeholder="O que você está fazendo? Ex.: rankeando até 23h" autoFocus aria-label="Texto do status" />
            {(emoji || text) && (
              <button type="button" className="icon-btn" aria-label="Limpar" onClick={() => { setEmoji(null); setText(''); }}>
                <X size={16} />
              </button>
            )}
          </div>
          {picker && (
            <div className="status-picker">
              <EmojiPicker custom={false} onPick={(e) => setEmoji(e)} onClose={() => setPicker(false)} />
            </div>
          )}
          <label>
            Some depois de
            <select value={duration ?? 'none'} onChange={(e) => setDuration(e.target.value === 'none' ? null : Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d.label} value={d.minutes ?? 'none'}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions spread">
            {current ? (
              <button className="btn ghost danger" disabled={busy} onClick={() => void save(true)}>
                Remover status
              </button>
            ) : (
              <span />
            )}
            <button className="btn primary" disabled={busy || (!text.trim() && !emoji)} onClick={() => void save()}>
              Salvar status
            </button>
          </div>
          <p className="muted small">
            O "Jogando agora" aparece sozinho pelo app de desktop quando você abre um jogo (dá para desligar nas Configurações).
          </p>
        </div>
      </div>
    </div>
  );
}

/** Perfil só deste servidor: apelido e foto (no Discord, a foto por servidor é paga). */
export function GuildProfileModal({ guildId }: { guildId: string }) {
  const me = useApp((s) => s.me)!;
  const guild = useApp((s) => s.guilds[guildId]);
  const member = guild?.members.find((m) => m.id === me.id);
  const [nick, setNick] = useState(member?.nick ?? '');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const perms = myPermissions(guild, me.id);
  const canChange = has(perms, Perm.CHANGE_NICKNAME) || has(perms, Perm.MANAGE_NICKNAMES);
  if (!guild || !member) return null;
  const preview = { ...me, displayName: nick.trim() || me.displayName, avatarId: member.guildAvatarId ?? me.avatarId };

  async function saveNick() {
    setBusy(true);
    try {
      await api(`/guilds/${guildId}/members/@me/nick`, { method: 'PATCH', body: { nick: nick.trim() || null } });
      await refreshGuild(guildId);
      toast('Perfil do servidor salvo.');
      closeModal();
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadGuildAvatar(guildId, file);
      await refreshGuild(guildId);
      toast(`Foto do servidor atualizada (${Math.max(1, Math.round(r.bytes / 1024))} KB).`);
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  async function removeAvatar() {
    try {
      await api(`/guilds/${guildId}/members/@me/avatar`, { method: 'DELETE' });
      await refreshGuild(guildId);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Meu perfil neste servidor">
        <div className="modal-head">
          <h2>Meu perfil em {guild.name}</h2>
          <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body form">
          <p className="muted small">Só vale neste servidor. Nos outros e nas mensagens diretas continua o seu perfil normal.</p>
          <div className="guild-profile-preview">
            <Avatar user={preview} size={64} />
            <div>
              <strong>{preview.displayName}</strong>
              <div className="muted small">@{me.username}</div>
            </div>
          </div>
          {!canChange && <p className="warn small">Seu cargo não pode mudar apelido nem foto neste servidor.</p>}
          <label>
            Apelido neste servidor
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={me.displayName} disabled={!canChange} />
          </label>
          <div className="row gap-s">
            <button type="button" className="btn small" disabled={busy || !canChange} onClick={() => input.current?.click()}>
              <ImagePlus size={15} /> Foto só deste servidor
            </button>
            {member.guildAvatarId && (
              <button type="button" className="btn small ghost" onClick={() => void removeAvatar()}>
                Usar minha foto normal
              </button>
            )}
          </div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
          <div className="modal-actions">
            <button className="btn primary" disabled={busy || !canChange || nick.trim() === (member.nick ?? '')} onClick={() => void saveNick()}>
              Salvar apelido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
