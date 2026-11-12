import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Trash2, X } from 'lucide-react';
import type { Ban, Guild, Member } from '../../../shared/types';
import { PERMISSION_INFO, outranks, type Role } from '../../../shared/permissions';
import { api } from '../lib/api';
import { askText } from '../lib/ask';
import { Perm, has, imageUrl, memberColor, myTopPosition, timeoutUntil, usePerms } from '../lib/perms';
import { refreshGuild } from '../lib/socket';
import { formatBytes, uploadGuildImage } from '../lib/upload';
import { closeModal, toast, useApp } from '../store/app';
import { Avatar } from './Avatar';
import { ExpressionSettings } from './ExpressionSettings';
import { AuditLog } from './AuditLog';
import { AutomodPanel } from './Community';

type Tab = 'overview' | 'roles' | 'members' | 'bans' | 'expressions' | 'automod' | 'audit';

const ROLE_COLORS = ['#ed4245', '#f97316', '#faa61a', '#3ba55d', '#14b8a6', '#5865f2', '#9b59b6', '#eb459e', '#99aab5'];

async function run<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast((err as Error).message);
  }
}

export function GuildSettings({ guildId, initialTab }: { guildId: string; initialTab?: Tab }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const perms = usePerms(guildId);
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Visão geral', show: has(perms, Perm.MANAGE_GUILD) },
    { id: 'roles', label: 'Cargos', show: has(perms, Perm.MANAGE_ROLES) },
    { id: 'expressions', label: 'Emojis e sons', show: has(perms, Perm.MANAGE_EXPRESSIONS) },
    { id: 'members', label: 'Membros', show: [Perm.MANAGE_ROLES, Perm.KICK, Perm.BAN, Perm.TIMEOUT, Perm.MANAGE_NICKNAMES].some((p) => has(perms, p)) },
    { id: 'bans', label: 'Banimentos', show: has(perms, Perm.BAN) },
    { id: 'automod', label: 'Moderação automática', show: has(perms, Perm.MANAGE_GUILD) },
    { id: 'audit', label: 'Registro', show: has(perms, Perm.VIEW_AUDIT_LOG) },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(initialTab && visible.some((t) => t.id === initialTab) ? initialTab : (visible[0]?.id ?? 'overview'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!guild) return null;
  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="Configurações do servidor">
      <nav className="settings-nav">
        <div className="settings-nav-title ellipsis">{guild.name}</div>
        {visible.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <section className="settings-body">
        <button className="icon-btn settings-close" aria-label="Fechar" title="Fechar (Esc)" onClick={closeModal}>
          <X size={22} />
        </button>
        {tab === 'overview' && <Overview guild={guild} />}
        {tab === 'roles' && <Roles guild={guild} />}
        {tab === 'members' && <Members guild={guild} />}
        {tab === 'bans' && <Bans guild={guild} />}
        {tab === 'expressions' && <ExpressionSettings guild={guild} />}
        {tab === 'automod' && <AutomodPanel guild={guild} />}
        {tab === 'audit' && <AuditLog guild={guild} />}
      </section>
    </div>
  );
}

// ---------- visão geral ----------

function Overview({ guild }: { guild: Guild }) {
  const me = useApp((s) => s.me)!;
  const [name, setName] = useState(guild.name);
  const [description, setDescription] = useState(guild.description);
  const [busy, setBusy] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usedBytes: number; files: number; quotaBytes: number } | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const loadStorage = () => void api<{ usedBytes: number; files: number; quotaBytes: number }>(`/guilds/${guild.id}/storage`).then(setStorage, () => {});
  useEffect(loadStorage, [guild.id]);

  async function upload(kind: 'icon' | 'banner', file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    const r = await run(() => uploadGuildImage(guild.id, kind, file));
    if (r) {
      toast(`${kind === 'icon' ? 'Ícone' : 'Banner'} atualizado (${Math.max(1, Math.round(r.bytes / 1024))} KB).`);
      await refreshGuild(guild.id);
      loadStorage();
    }
    setBusy(null);
  }

  async function removeImage(kind: 'icon' | 'banner') {
    await run(() => api(`/guilds/${guild.id}/${kind}`, { method: 'DELETE' }));
    await refreshGuild(guild.id);
    loadStorage();
  }

  const pct = storage ? Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100) : 0;
  return (
    <div className="form settings-section">
      <h2>Visão geral</h2>

      <div className="guild-images">
        <div className="field">
          <span>Ícone</span>
          <div className="guild-icon-edit">
            {guild.iconId ? <img src={imageUrl(guild.iconId)!} alt="Ícone do servidor" /> : <span className="guild-icon-placeholder">{guild.name.slice(0, 2).toUpperCase()}</span>}
            <div className="row gap-s">
              <button className="btn small" disabled={!!busy} onClick={() => iconInput.current?.click()}>
                <ImagePlus size={15} /> {busy === 'icon' ? 'Enviando…' : 'Trocar'}
              </button>
              {guild.iconId && (
                <button className="btn small ghost danger" onClick={() => void removeImage('icon')}>
                  Remover
                </button>
              )}
            </div>
          </div>
          <input ref={iconInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload('icon', e.target.files?.[0])} />
        </div>
        <div className="field banner-field">
          <span>Banner (topo da lista de canais)</span>
          <div className="banner-preview" style={guild.bannerId ? { backgroundImage: `url(${imageUrl(guild.bannerId)})` } : undefined}>
            {!guild.bannerId && <span className="muted small">Sem banner</span>}
          </div>
          <div className="row gap-s">
            <button className="btn small" disabled={!!busy} onClick={() => bannerInput.current?.click()}>
              <ImagePlus size={15} /> {busy === 'banner' ? 'Enviando…' : 'Trocar banner'}
            </button>
            {guild.bannerId && (
              <button className="btn small ghost danger" onClick={() => void removeImage('banner')}>
                Remover
              </button>
            )}
          </div>
          <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload('banner', e.target.files?.[0])} />
        </div>
      </div>
      <p className="muted small">As imagens são recortadas e comprimidas no seu navegador antes de enviar, e trocar apaga a anterior.</p>

      <label>
        Nome do servidor
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
      </label>
      <label>
        Descrição <span className="muted">(aparece para quem recebe um convite)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} placeholder="Ex.: a resenha da galera do Valorant 🎮" />
      </label>
      <div className="modal-actions">
        <button
          className="btn primary"
          disabled={!name.trim() || (name === guild.name && description === guild.description)}
          onClick={() => void run(() => api(`/guilds/${guild.id}`, { method: 'PATCH', body: { name, description } }), 'Servidor atualizado.')}
        >
          Salvar
        </button>
      </div>

      {storage && (
        <div className="quota">
          <h3 className="subhead">Espaço de arquivos do servidor</h3>
          <div className="quota-bar" aria-hidden>
            <div className={pct > 85 ? 'warn' : ''} style={{ width: `${Math.max(pct, storage.usedBytes ? 1 : 0)}%` }} />
          </div>
          <p className="muted small">
            {formatBytes(storage.usedBytes)} de {formatBytes(storage.quotaBytes)} · {storage.files} arquivo{storage.files === 1 ? '' : 's'} enviado
            {storage.files === 1 ? '' : 's'} nos canais. Apagar mensagens antigas com arquivos libera espaço.
          </p>
        </div>
      )}

      {guild.ownerId === me.id && <DangerZone guild={guild} />}
    </div>
  );
}

function DangerZone({ guild }: { guild: Guild }) {
  return (
    <>
      <h3 className="subhead danger-text">Zona de perigo</h3>
      <button
        className="btn danger"
        onClick={async () => {
          const typed = await askText({
            title: 'Excluir servidor',
            message: `Isto apaga o servidor, canais e mensagens para sempre. Digite "${guild.name}" para confirmar:`,
            placeholder: guild.name,
            confirmLabel: 'Excluir para sempre',
            danger: true,
            mustMatch: guild.name,
          });
          if (typed?.trim() !== guild.name) return;
          await run(() => api(`/guilds/${guild.id}`, { method: 'DELETE' }));
          closeModal();
        }}
      >
        Excluir servidor
      </button>
    </>
  );
}

// ---------- cargos ----------

function PermissionList({ value, onChange, editable }: { value: number; onChange(v: number): void; editable: (bit: number) => boolean }) {
  return (
    <ul className="perm-list">
      {PERMISSION_INFO.map((p) => {
        const bit = Perm[p.key];
        return (
          <li key={p.key}>
            <label className="perm-row">
              <span>
                <strong>{p.label}</strong>
                <span className="muted small">{p.description}</span>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={has(value, bit)}
                disabled={!editable(bit)}
                onChange={(e) => onChange(e.target.checked ? value | bit : value & ~bit)}
                aria-label={p.label}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function Roles({ guild }: { guild: Guild }) {
  const me = useApp((s) => s.me)!;
  const perms = usePerms(guild.id);
  const isOwner = guild.ownerId === me.id;
  const top = myTopPosition(guild, me.id);
  const roles = [...guild.roles].sort((a, b) => b.position - a.position);
  const [selected, setSelected] = useState<string>('everyone');
  const role = roles.find((r) => r.id === selected);
  const canEditRole = (r: Role) => isOwner || r.position < top;
  // só dá para conceder o que você tem (o dono pode tudo; Administrador só o dono concede a @todos)
  const grantable = (bit: number) => isOwner || has(perms, bit);

  const [draft, setDraft] = useState<{ name: string; color: string; permissions: number }>({ name: '', color: '#99aab5', permissions: 0 });
  useEffect(() => {
    if (role) setDraft({ name: role.name, color: role.color, permissions: role.permissions });
    else setDraft({ name: '@todos', color: '#99aab5', permissions: guild.everyonePermissions });
  }, [selected, role?.name, role?.color, role?.permissions, guild.everyonePermissions]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createRole() {
    const r = await run(() => api<{ roleId: string }>(`/guilds/${guild.id}/roles`, { body: { name: 'Novo cargo', color: ROLE_COLORS[roles.length % ROLE_COLORS.length] } }));
    if (r) {
      await refreshGuild(guild.id);
      setSelected(r.roleId);
    }
  }

  async function save() {
    if (role) await run(() => api(`/roles/${role.id}`, { method: 'PATCH', body: draft }), 'Cargo salvo.');
    else await run(() => api(`/guilds/${guild.id}`, { method: 'PATCH', body: { everyonePermissions: draft.permissions } }), 'Permissões de @todos salvas.');
  }

  const editable = role ? canEditRole(role) : true;
  const dirty = role
    ? draft.name !== role.name || draft.color !== role.color || draft.permissions !== role.permissions
    : draft.permissions !== guild.everyonePermissions;

  return (
    <div className="settings-section roles-layout">
      <div className="roles-list">
        <div className="row spread">
          <h2>Cargos</h2>
          <button className="btn small primary" onClick={() => void createRole()}>
            + Criar
          </button>
        </div>
        <p className="muted small">Mais acima = mais poder. Ninguém mexe em quem está acima dele.</p>
        <ul>
          {roles.map((r, i) => (
            <li key={r.id} className={selected === r.id ? 'active' : ''}>
              <button className="role-item" onClick={() => setSelected(r.id)}>
                <span className="role-dot" style={{ background: r.color }} />
                <span className="ellipsis">{r.name}</span>
                <span className="muted small">{guild.members.filter((m) => m.roleIds.includes(r.id)).length}</span>
              </button>
              {canEditRole(r) && (
                <span className="role-move">
                  <button className="icon-btn small" aria-label={`Subir ${r.name}`} disabled={i === 0 || !canEditRole(roles[i - 1])} onClick={() => void run(() => api(`/roles/${r.id}/move`, { body: { direction: 'up' } }))}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-btn small" aria-label={`Descer ${r.name}`} disabled={i === roles.length - 1} onClick={() => void run(() => api(`/roles/${r.id}/move`, { body: { direction: 'down' } }))}>
                    <ArrowDown size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
          <li className={selected === 'everyone' ? 'active' : ''}>
            <button className="role-item" onClick={() => setSelected('everyone')}>
              <span className="role-dot" style={{ background: '#99aab5' }} />
              <span>@todos</span>
              <span className="muted small">{guild.members.length}</span>
            </button>
          </li>
        </ul>
      </div>

      <div className="role-editor form">
        {role ? (
          <>
            <label>
              Nome do cargo
              <input value={draft.name} disabled={!editable} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div className="field">
              <span>Cor (pinta o nome no chat e na lista de membros)</span>
              <div className="color-row">
                {ROLE_COLORS.map((c) => (
                  <button key={c} type="button" disabled={!editable} className={`color-swatch${draft.color === c ? ' selected' : ''}`} style={{ background: c }} aria-label={`Cor ${c}`} onClick={() => setDraft({ ...draft, color: c })} />
                ))}
                <input type="color" value={draft.color} disabled={!editable} aria-label="Outra cor" onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="color-input" />
              </div>
            </div>
          </>
        ) : (
          <p className="muted">
            <strong>@todos</strong> são as permissões de qualquer membro, mesmo sem cargo.
          </p>
        )}
        {!editable && <p className="warn small">Este cargo está no seu nível ou acima: só dá para ver.</p>}
        <PermissionList
          value={draft.permissions}
          onChange={(permissions) => setDraft({ ...draft, permissions })}
          editable={(bit) => editable && grantable(bit) && (!!role || bit !== Perm.ADMIN || isOwner)}
        />
        <div className="modal-actions spread">
          {role && editable ? (
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (!confirm(`Excluir o cargo "${role.name}"?`)) return;
                if ((await run(() => api(`/roles/${role.id}`, { method: 'DELETE' }), 'Cargo excluído.')) !== undefined) setSelected('everyone');
              }}
            >
              <Trash2 size={15} /> Excluir cargo
            </button>
          ) : (
            <span />
          )}
          <button className="btn primary" disabled={!editable || !dirty || !draft.name.trim()} onClick={() => void save()}>
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- membros ----------

const TIMEOUTS = [
  { label: '5 minutos', minutes: 5 },
  { label: '1 hora', minutes: 60 },
  { label: '1 dia', minutes: 1440 },
  { label: '1 semana', minutes: 10080 },
];

export function MemberModeration({ guild, member, compact }: { guild: Guild; member: Member; compact?: boolean }) {
  const me = useApp((s) => s.me)!;
  const perms = usePerms(guild.id);
  const myRoles = guild.members.find((m) => m.id === me.id)?.roleIds ?? [];
  const isOwner = guild.ownerId === me.id;
  const top = myTopPosition(guild, me.id);
  const above = outranks(guild, me.id, myRoles, member.id, member.roleIds);
  const self = member.id === me.id;
  const timedOut = timeoutUntil(guild, member.id);
  const roles = [...guild.roles].sort((a, b) => b.position - a.position);
  const canRoles = has(perms, Perm.MANAGE_ROLES) && (self || above);

  async function setRoles(roleIds: string[]) {
    await run(() => api(`/guilds/${guild.id}/members/${member.id}/roles`, { method: 'PUT', body: { roleIds } }));
  }

  const actions: ReactNode[] = [];
  if (!self && above && has(perms, Perm.TIMEOUT)) {
    actions.push(
      timedOut ? (
        <button key="untimeout" className="btn small" onClick={() => void run(() => api(`/guilds/${guild.id}/members/${member.id}/timeout`, { body: { minutes: 0 } }), 'Castigo retirado.')}>
          Tirar castigo
        </button>
      ) : (
        <select
          key="timeout"
          className="small-select"
          value=""
          aria-label={`Castigar ${member.displayName}`}
          onChange={(e) => {
            const minutes = Number(e.target.value);
            if (minutes) void run(() => api(`/guilds/${guild.id}/members/${member.id}/timeout`, { body: { minutes } }), `${member.displayName} ficou de castigo.`);
          }}
        >
          <option value="">Castigar…</option>
          {TIMEOUTS.map((t) => (
            <option key={t.minutes} value={t.minutes}>
              {t.label}
            </option>
          ))}
        </select>
      ),
    );
  }
  if (!self && above && has(perms, Perm.MANAGE_NICKNAMES)) {
    actions.push(
      <button
        key="nick"
        className="btn small ghost"
        onClick={async () => {
          const nick = await askText({ title: `Apelido de ${member.username}`, message: 'Só neste servidor. Deixe vazio para tirar o apelido.', initial: member.nick ?? '', maxLength: 32, confirmLabel: 'Salvar apelido' });
          if (nick !== null) void run(() => api(`/guilds/${guild.id}/members/${member.id}/nick`, { method: 'PATCH', body: { nick: nick.trim() || null } }), 'Apelido atualizado.');
        }}
      >
        Mudar apelido
      </button>,
    );
    if (member.guildAvatarId) {
      actions.push(
        <button key="gavatar" className="btn small ghost" onClick={() => void run(() => api(`/guilds/${guild.id}/members/${member.id}/avatar`, { method: 'DELETE' }), 'Foto do servidor removida.')}>
          Tirar foto do servidor
        </button>,
      );
    }
  }
  if (!self && above && has(perms, Perm.KICK)) {
    actions.push(
      <button
        key="kick"
        className="btn small ghost danger"
        onClick={() => confirm(`Expulsar ${member.displayName}? Ela pode voltar com um convite.`) && void run(() => api(`/guilds/${guild.id}/members/${member.id}`, { method: 'DELETE' }), 'Membro expulso.')}
      >
        Expulsar
      </button>,
    );
  }
  if (!self && above && has(perms, Perm.BAN)) {
    actions.push(
      <button
        key="ban"
        className="btn small danger"
        onClick={async () => {
          const reason = await askText({ title: `Banir ${member.displayName}?`, message: 'Essa pessoa não poderá voltar pelo convite. Motivo (opcional):', maxLength: 200, confirmLabel: 'Banir', danger: true });
          if (reason !== null) void run(() => api(`/guilds/${guild.id}/bans`, { body: { userId: member.id, reason } }), 'Membro banido.');
        }}
      >
        Banir
      </button>,
    );
  }

  return (
    <div className={`moderation${compact ? ' compact' : ''}`}>
      {timedOut && <p className="warn small">De castigo até {timedOut.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
      {(canRoles || member.roleIds.length > 0) && (
        <div className="role-pills">
          {roles
            .filter((r) => canRoles || member.roleIds.includes(r.id))
            .map((r) => {
              const hasRole = member.roleIds.includes(r.id);
              const editable = canRoles && (isOwner || r.position < top);
              return (
                <button
                  key={r.id}
                  className={`role-pill${hasRole ? ' on' : ''}`}
                  style={{ '--role': r.color } as React.CSSProperties}
                  disabled={!editable}
                  aria-pressed={hasRole}
                  title={editable ? (hasRole ? 'Clique para tirar' : 'Clique para dar') : undefined}
                  onClick={() => void setRoles(hasRole ? member.roleIds.filter((x) => x !== r.id) : [...member.roleIds, r.id])}
                >
                  <span className="role-dot" style={{ background: r.color }} />
                  {r.name}
                </button>
              );
            })}
        </div>
      )}
      {actions.length > 0 && <div className="row gap-s wrap">{actions}</div>}
    </div>
  );
}

function Members({ guild }: { guild: Guild }) {
  const [q, setQ] = useState('');
  const list = guild.members
    .filter((m) => !q || m.displayName.toLowerCase().includes(q.toLowerCase()) || m.username.includes(q.toLowerCase()))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  return (
    <div className="settings-section form">
      <h2>Membros ({guild.members.length})</h2>
      <input placeholder="Buscar membro…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar membro" />
      <ul className="member-admin">
        {list.map((m) => (
          <li key={m.id} className="member-admin-row">
            <div className="row gap-s">
              <Avatar user={m} size={32} />
              <span className="ellipsis">
                <strong style={{ color: memberColor(guild, m.id, 'inherit') }}>{m.displayName}</strong> <span className="muted">@{m.username}</span>
                {m.id === guild.ownerId && <span className="muted small"> · dono</span>}
              </span>
            </div>
            <MemberModeration guild={guild} member={m} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bans({ guild }: { guild: Guild }) {
  const [bans, setBans] = useState<Ban[] | null>(null);
  const load = () => void api<{ bans: Ban[] }>(`/guilds/${guild.id}/bans`).then((r) => setBans(r.bans), (err) => toast(err.message));
  useEffect(load, [guild.id]);
  return (
    <div className="settings-section form">
      <h2>Banimentos</h2>
      {bans === null ? (
        <p className="muted">Carregando…</p>
      ) : bans.length === 0 ? (
        <p className="muted">Ninguém banido. 🎉</p>
      ) : (
        <ul className="member-admin">
          {bans.map((b) => (
            <li key={b.user.id} className="member-admin-row">
              <div className="row gap-s">
                <Avatar user={b.user} size={32} />
                <span className="ellipsis">
                  <strong>{b.user.displayName}</strong> <span className="muted">@{b.user.username}</span>
                  {b.reason && <span className="muted small"> · {b.reason}</span>}
                </span>
              </div>
              <button
                className="btn small"
                onClick={async () => {
                  if ((await run(() => api(`/guilds/${guild.id}/bans/${b.user.id}`, { method: 'DELETE' }), 'Desbanido.')) !== undefined) load();
                }}
              >
                Desbanir
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
