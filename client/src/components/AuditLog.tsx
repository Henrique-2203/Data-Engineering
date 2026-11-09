import { useEffect, useState } from 'react';
import type { AuditEntry, Guild } from '../../../shared/types';
import { PERMISSION_INFO, Perm } from '../../../shared/permissions';
import { api } from '../lib/api';
import { toast } from '../store/app';
import { Avatar } from './Avatar';

/** Filtros do registro (prefixo da ação). */
const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'Tudo' },
  { id: 'member_', label: 'Membros (entrar, sair, banir, castigo…)' },
  { id: 'role_', label: 'Cargos' },
  { id: 'channel_', label: 'Canais' },
  { id: 'category_', label: 'Categorias' },
  { id: 'message_', label: 'Mensagens (apagadas, fixadas)' },
  { id: 'automod_', label: 'Moderação automática' },
  { id: 'event_', label: 'Eventos' },
  { id: 'expression_', label: 'Emojis, figurinhas e sons' },
  { id: 'guild_', label: 'Servidor' },
];

const permNames = (bits: number) => PERMISSION_INFO.filter((p) => (bits & Perm[p.key]) !== 0).map((p) => p.label);

/** Permissões ganhas e perdidas entre dois valores. */
function permDiff(before: number, after: number) {
  const added = permNames(after & ~before);
  const removed = permNames(before & ~after);
  return [added.length ? `deu: ${added.join(', ')}` : '', removed.length ? `tirou: ${removed.join(', ')}` : ''].filter(Boolean).join(' · ');
}

export function slowLabel(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${s / 60} min`;
  return `${s / 3600} h`;
}

const KIND: Record<string, string> = { emoji: 'o emoji', sticker: 'a figurinha', sound: 'o som' };

/** Frase em português para cada ação (o nome de quem fez aparece antes). */
function describe(e: AuditEntry): { icon: string; text: string; extra?: string } {
  const t = e.targetLabel ?? '';
  const d = e.details as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.action) {
    case 'guild_update':
      return { icon: '⚙️', text: d.name ? `renomeou o servidor de "${d.name[0]}" para "${d.name[1]}"` : 'mudou a descrição do servidor' };
    case 'guild_icon':
      return { icon: '🖼️', text: d.removed ? 'tirou o ícone do servidor' : 'trocou o ícone do servidor' };
    case 'guild_banner':
      return { icon: '🖼️', text: d.removed ? 'tirou o banner do servidor' : 'trocou o banner do servidor' };
    case 'guild_everyone_perms':
      return { icon: '🔐', text: 'mudou as permissões de @todos', extra: permDiff(d.before ?? 0, d.after ?? 0) };
    case 'guild_invite_reset':
      return { icon: '🔗', text: 'gerou um novo link de convite (o antigo parou de funcionar)' };
    case 'role_create':
      return { icon: '🏷️', text: `criou o cargo ${t}` };
    case 'role_update':
      return {
        icon: '🏷️',
        text: d.name ? `renomeou o cargo "${d.name[0]}" para "${d.name[1]}"` : `editou o cargo ${t}`,
        extra: [d.permissions ? permDiff(d.permissions[0], d.permissions[1]) : '', d.color ? 'mudou a cor' : ''].filter(Boolean).join(' · '),
      };
    case 'role_delete':
      return { icon: '🗑️', text: `apagou o cargo ${t}` };
    case 'role_move':
      return { icon: '↕️', text: `${d.direction === 'up' ? 'subiu' : 'desceu'} o cargo ${t} na hierarquia` };
    case 'member_join':
      return { icon: '👋', text: 'entrou no servidor pelo convite' };
    case 'member_leave':
      return { icon: '🚪', text: 'saiu do servidor' };
    case 'member_kick':
      return { icon: '👢', text: `expulsou ${t}` };
    case 'member_ban':
      return { icon: '🔨', text: `baniu ${t}`, extra: d.reason ? `motivo: ${d.reason}` : undefined };
    case 'member_unban':
      return { icon: '🕊️', text: `desbaniu ${t}` };
    case 'member_timeout': {
      const m = Number(d.minutes) || 0;
      const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
      const dur = m >= 1440 ? n(Math.round(m / 1440), 'dia', 'dias') : m >= 60 ? n(Math.round(m / 60), 'hora', 'horas') : n(m, 'minuto', 'minutos');
      return { icon: '⏳', text: `pôs ${t} de castigo por ${dur}` };
    }
    case 'member_timeout_clear':
      return { icon: '⏳', text: `tirou o castigo de ${t}` };
    case 'member_roles':
      return {
        icon: '🏷️',
        text: `mudou os cargos de ${t}`,
        extra: [d.added?.length ? `deu: ${d.added.join(', ')}` : '', d.removed?.length ? `tirou: ${d.removed.join(', ')}` : ''].filter(Boolean).join(' · '),
      };
    case 'member_nick':
      return { icon: '✏️', text: d.nick ? `mudou o apelido de ${t} para "${d.nick}"` : `tirou o apelido de ${t}` };
    case 'member_avatar_remove':
      return { icon: '🖼️', text: `tirou a foto de servidor de ${t}` };
    case 'category_create':
      return { icon: '📁', text: `criou a categoria ${t}` };
    case 'category_update':
      return { icon: '📁', text: `renomeou a categoria "${d.name?.[0]}" para "${d.name?.[1]}"` };
    case 'category_delete':
      return { icon: '🗑️', text: `apagou a categoria ${t}` };
    case 'channel_create':
      return { icon: d.type === 'voice' ? '🔊' : '#️⃣', text: `criou o canal ${d.type === 'voice' ? '' : '#'}${t}${d.private ? ' (privado)' : ''}` };
    case 'channel_update': {
      const parts = [
        d.name ? `nome: "${d.name[0]}" → "${d.name[1]}"` : '',
        d.privacy ? `agora ${d.privacy}` : '',
        d.bitrate ? `qualidade de voz: ${d.bitrate[1]} kbps` : '',
        d.userLimit ? `limite: ${d.userLimit[1] || 'sem limite'}` : '',
        d.category ? 'mudou de categoria' : '',
        d.slowmode ? `modo lento: ${d.slowmode[1] ? slowLabel(d.slowmode[1]) : 'desligado'}` : '',
      ].filter(Boolean);
      return { icon: '🛠️', text: `editou o canal ${t}`, extra: parts.join(' · ') };
    }
    case 'channel_delete':
      return { icon: '🗑️', text: `apagou o canal ${d.type === 'voice' ? '' : '#'}${t}` };
    case 'channel_layout':
      return { icon: '↕️', text: 'reorganizou os canais' };
    case 'message_delete':
      return { icon: '🗑️', text: `apagou uma mensagem de ${t}`, extra: d.channel ? `em #${d.channel}` : undefined };
    case 'message_pin':
      return { icon: '📌', text: `fixou uma mensagem de ${t}`, extra: d.channel ? `em #${d.channel}` : undefined };
    case 'message_unpin':
      return { icon: '📌', text: `desafixou uma mensagem de ${t}`, extra: d.channel ? `em #${d.channel}` : undefined };
    case 'automod_update': {
      const on = (v: boolean) => (v ? 'ligou' : 'desligou');
      const parts = [
        d.words !== undefined ? `${d.words} palavra${d.words === 1 ? '' : 's'} proibida${d.words === 1 ? '' : 's'}` : '',
        d.blockLinks !== undefined ? `${on(d.blockLinks)} o bloqueio de links` : '',
        d.blockInvites !== undefined ? `${on(d.blockInvites)} o bloqueio de convites` : '',
        d.antiSpam !== undefined ? `${on(d.antiSpam)} o anti-spam` : '',
        d.exempt !== undefined ? `${d.exempt} cargo${d.exempt === 1 ? '' : 's'} isento${d.exempt === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      return { icon: '🛡️', text: 'mudou a moderação automática', extra: parts.join(' · ') };
    }
    case 'automod_block': {
      const why: Record<string, string> = {
        words: `palavra proibida${d.word ? ` ("${d.word}")` : ''}`,
        links: 'link',
        invites: 'convite de outro servidor',
        spam: 'spam',
      };
      return { icon: '🛡️', text: 'teve uma mensagem bloqueada pela moderação automática', extra: [why[d.rule] ?? d.rule, d.channel ? `em #${d.channel}` : ''].filter(Boolean).join(' · ') };
    }
    case 'event_create':
      return { icon: '📅', text: `marcou o evento "${t}"`, extra: d.startsAt ? when(d.startsAt) : undefined };
    case 'event_update':
      return { icon: '📅', text: `editou o evento "${t}"`, extra: d.startsAt ? `nova data: ${when(d.startsAt)}` : undefined };
    case 'event_delete':
      return { icon: '📅', text: `cancelou o evento "${t}"` };
    case 'expression_create':
      return { icon: '😀', text: `adicionou ${KIND[d.kind] ?? ''} ${t}` };
    case 'expression_update':
      return { icon: '😀', text: `renomeou ${KIND[d.kind] ?? ''} "${d.name?.[0]}" para "${d.name?.[1]}"` };
    case 'expression_delete':
      return { icon: '🗑️', text: `apagou ${KIND[d.kind] ?? ''} ${t}` };
    default:
      return { icon: '•', text: e.action };
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Configurações do servidor → Registro: quem fez o quê (90 dias). */
export function AuditLog({ guild }: { guild: Guild }) {
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);

  const load = (before?: string) =>
    api<{ entries: AuditEntry[]; hasMore: boolean }>(
      `/guilds/${guild.id}/audit?${new URLSearchParams({ ...(filter ? { action: filter } : {}), ...(before ? { before } : {}) })}`,
    ).then(
      (r) => {
        setEntries((old) => (before ? [...(old ?? []), ...r.entries] : r.entries));
        setMore(r.hasMore);
      },
      (e) => toast(e.message),
    );
  useEffect(() => {
    setEntries(null);
    void load();
  }, [filter, guild.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="settings-section audit">
      <h2>Registro de auditoria</h2>
      <p className="muted small">
        Quem fez o quê no servidor nos últimos 90 dias. O conteúdo de mensagens apagadas não é guardado. Só quem tem "Ver o registro de
        auditoria" (ou é administrador) vê esta lista.
      </p>
      <label className="audit-filter">
        Mostrar
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {entries === null && <p className="muted">Carregando…</p>}
      {entries?.length === 0 && <p className="muted">Nada registrado ainda.</p>}
      <ul className="audit-list">
        {entries?.map((e) => {
          const { icon, text, extra } = describe(e);
          return (
            <li key={e.id}>
              <span className="audit-icon" aria-hidden>
                {icon}
              </span>
              <Avatar user={e.actor ?? undefined} size={28} />
              <span className="audit-text">
                <span>
                  <strong>{e.actor?.displayName ?? 'Conta excluída'}</strong> {text}
                </span>
                {extra && <span className="muted small">{extra}</span>}
              </span>
              <time className="muted small" dateTime={e.createdAt}>
                {when(e.createdAt)}
              </time>
            </li>
          );
        })}
      </ul>
      {more && (
        <button className="btn small" onClick={() => void load(entries?.[entries.length - 1]?.id)}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
