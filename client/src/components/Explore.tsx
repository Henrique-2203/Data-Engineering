import { useEffect, useState } from 'react';
import { Compass, Flag, Search, Users, X } from 'lucide-react';
import type { ExploreGuild, Guild, VoiceState } from '../../../shared/types';
import { CATEGORY_LABEL, GUILD_CATEGORIES, listingMissing, type GuildCategory } from '../../../shared/explore';
import { api } from '../lib/api';
import { imageUrl } from '../lib/perms';
import { closeModal, openModal, selectGuild, toast, upsertGuild, useApp } from '../store/app';

/**
 * Explorar servidores (públicos), a aba "Comunidade" das configurações do servidor e a lista da equipe.
 * Para aparecer no Explorar: público, com descrição, ícone, categoria e regras com "Aceito".
 */

/** Explorar servidores: página em tela cheia, com categorias à esquerda, busca e ordem. */
export function ExploreModal() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<GuildCategory | ''>('');
  const [sort, setSort] = useState<'members' | 'new'>('members');
  const [list, setList] = useState<ExploreGuild[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [joining, setJoining] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q, category, sort });
      void api<{ guilds: ExploreGuild[]; counts: Record<string, number> }>(`/explore?${p}`).then(
        (r) => {
          setList(r.guilds);
          setCounts(r.counts ?? {});
        },
        (e) => toast(e.message),
      );
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, category, sort]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-backdrop') && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function join(g: ExploreGuild) {
    if (g.isMember) {
      closeModal();
      selectGuild(g.id);
      return;
    }
    setJoining(g.id);
    try {
      const r = await api<{ guild: Guild; voiceStates: VoiceState[] }>(`/explore/${g.id}/join`, { body: {} });
      upsertGuild(r.guild);
      useApp.setState((s) => ({ voiceStates: { ...s.voiceStates, ...Object.fromEntries(r.voiceStates.map((v) => [v.socketId, v])) } }));
      closeModal();
      selectGuild(g.id);
      toast(`Você entrou no ${g.name}! 🎉`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setJoining(null);
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const official = list?.filter((g) => g.official) ?? [];
  const others = list?.filter((g) => !g.official) ?? [];
  const title = category ? CATEGORY_LABEL[category] : 'Todos os servidores';
  return (
    <div className="settings-page explore-page" role="dialog" aria-modal="true" aria-label="Explorar servidores">
      <nav className="settings-nav" aria-label="Categorias" role="tablist">
        <div className="settings-nav-title">
          <Compass size={14} /> Explorar
        </div>
        <button role="tab" aria-selected={category === ''} className={category === '' ? 'active' : ''} onClick={() => setCategory('')}>
          <span>🧭 Todos</span>
          {total > 0 && <b className="nav-count">{total}</b>}
        </button>
        {GUILD_CATEGORIES.map((c) => (
          <button key={c} role="tab" aria-selected={category === c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
            <span>{CATEGORY_LABEL[c]}</span>
            {!!counts[c] && <b className="nav-count">{counts[c]}</b>}
          </button>
        ))}
      </nav>
      <section className="settings-body">
        <button className="icon-btn settings-close" aria-label="Fechar" title="Fechar (Esc)" onClick={closeModal}>
          <X size={22} />
        </button>
        <div className="explore">
          <header className="explore-hero">
            <h2>Encontre sua resenha</h2>
            <p className="muted">Servidores públicos da comunidade: entre sem convite, chame galera pra jogar e faça amigos novos.</p>
            <div className="explore-tools">
              <label className="explore-search">
                <Search size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar servidores por nome ou assunto" aria-label="Buscar servidores" autoFocus />
              </label>
              <select value={sort} onChange={(e) => setSort(e.target.value as 'members' | 'new')} aria-label="Ordenar">
                <option value="members">Mais membros</option>
                <option value="new">Mais novos</option>
              </select>
            </div>
          </header>
          {!list ? (
            <p className="muted">Carregando…</p>
          ) : (
            <>
              {official.length > 0 && !q && (
                <div className="explore-grid">
                  {official.map((g) => (
                    <ExploreCard key={g.id} g={g} joining={joining === g.id} onJoin={() => void join(g)} />
                  ))}
                </div>
              )}
              <h3 className="explore-section">
                {q ? `Resultados para "${q}"` : title} <span className="muted">· {others.length}</span>
              </h3>
              {others.length === 0 ? (
                <p className="muted explore-empty">
                  {q ? 'Nenhum servidor encontrado. Tente outra palavra ou outra categoria.' : 'Nenhum servidor público aqui ainda. Que tal deixar o seu público? (Configurações do servidor → Comunidade)'}
                </p>
              ) : (
                <div className="explore-grid">
                  {others.map((g) => (
                    <ExploreCard key={g.id} g={g} joining={joining === g.id} onJoin={() => void join(g)} />
                  ))}
                </div>
              )}
              {q && official.length > 0 && (
                <div className="explore-grid">
                  {official.map((g) => (
                    <ExploreCard key={g.id} g={g} joining={joining === g.id} onJoin={() => void join(g)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function ExploreCard({ g, joining, onJoin }: { g: ExploreGuild; joining: boolean; onJoin(): void }) {
  return (
    <article className={`explore-card${g.official ? ' official' : ''}`} aria-label={g.name}>
      <div className="explore-banner" style={g.bannerId ? { backgroundImage: `url(${imageUrl(g.bannerId)})` } : undefined} />
      <div className="explore-body">
        <div className="explore-title">
          {g.iconId ? <img src={imageUrl(g.iconId)!} alt="" className="explore-icon" /> : <span className="explore-icon">{g.name.slice(0, 2).toUpperCase()}</span>}
          <div className="explore-name">
            <strong>{g.name}</strong>
            <span className="muted small">{g.official ? '✓ Oficial do Resenha' : g.category ? CATEGORY_LABEL[g.category as GuildCategory] : ''}</span>
          </div>
        </div>
        <p className="explore-desc">{g.description}</p>
        <div className="explore-foot">
          <span className="muted small">
            <Users size={13} /> {g.members.toLocaleString('pt-BR')} membro{g.members === 1 ? '' : 's'}
          </span>
          {!g.official && !g.isMember && (
            <button
              className="icon-btn small"
              aria-label={`Denunciar ${g.name}`}
              title="Denunciar servidor"
              onClick={() => openModal({ kind: 'report', target: { type: 'guild', id: g.id, label: g.name } })}
            >
              <Flag size={14} />
            </button>
          )}
          <button className={`btn small${g.isMember ? '' : ' primary'}`} disabled={joining} onClick={onJoin}>
            {g.isMember ? 'Abrir' : 'Entrar'}
          </button>
        </div>
      </div>
    </article>
  );
}

/** Configurações do servidor → Comunidade (público ou privado). */
export function CommunitySettings({ guild }: { guild: Guild }) {
  const [isPublic, setPublic] = useState(!!guild.public);
  const [category, setCategory] = useState<string>(guild.category ?? '');
  const [busy, setBusy] = useState(false);
  const missing = listingMissing({ ...guild, category });
  async function save() {
    setBusy(true);
    try {
      await api(`/guilds/${guild.id}`, { method: 'PATCH', body: { public: isPublic, category } });
      toast('Salvo.');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form settings-section">
      <h2>Comunidade</h2>
      <div className="visibility-choice" role="radiogroup" aria-label="Quem pode entrar">
        <label className={!isPublic ? 'on' : ''}>
          <input type="radio" name="vis" checked={!isPublic} onChange={() => setPublic(false)} />
          <strong>🔒 Privado</strong>
          <span className="muted small">Só entra quem tiver o convite.</span>
        </label>
        <label className={isPublic ? 'on' : ''}>
          <input type="radio" name="vis" checked={isPublic} onChange={() => setPublic(true)} />
          <strong>🌎 Público</strong>
          <span className="muted small">Aparece em Explorar e qualquer pessoa entra sem convite.</span>
        </label>
      </div>
      <label>
        Categoria
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Escolha…</option>
          {GUILD_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      {isPublic && (
        <div className="listing-status">
          {guild.unlisted ? (
            <p className="warn">⚠️ A equipe do Resenha tirou este servidor do Explorar. Ele continua funcionando com convite. Dúvidas? Fale com o Suporte.</p>
          ) : missing.length ? (
            <p className="warn">Para aparecer no Explorar, falta: {missing.join(', ')}. (Descrição e ícone ficam em Visão geral; regras, na aba Regras.)</p>
          ) : (
            <p className="ok">✅ Tudo certo: depois de salvar, o servidor aparece no Explorar.</p>
          )}
          <ul className="muted small">
            <li>{guild.description?.trim() ? '✅' : '⬜'} Descrição</li>
            <li>{guild.iconId ? '✅' : '⬜'} Ícone</li>
            <li>{category ? '✅' : '⬜'} Categoria</li>
            <li>{guild.rules?.trim() && guild.rulesRequired ? '✅' : '⬜'} Regras com "Aceito"</li>
          </ul>
        </div>
      )}
      <div>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          Salvar
        </button>
      </div>
    </div>
  );
}

/** Painel da equipe → Servidores públicos. */
export function PublicGuildsAdmin() {
  const [list, setList] = useState<
    { id: string; name: string; description: string; iconId: string | null; category: string; unlisted: boolean; listed: boolean; missing: string[]; members: number; openReports: number; owner: string }[] | null
  >(null);
  const load = () => void api<{ guilds: NonNullable<typeof list> }>('/admin/public-guilds').then((r) => setList(r.guilds), (e) => toast(e.message));
  useEffect(load, []);
  async function toggle(id: string, unlisted: boolean) {
    try {
      await api(`/admin/public-guilds/${id}`, { body: { unlisted } });
      toast(unlisted ? 'Tirado do Explorar.' : 'Voltou para o Explorar.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }
  if (!list) return <p className="muted">Carregando…</p>;
  if (!list.length) return <p className="muted">Nenhum servidor público ainda.</p>;
  return (
    <div className="public-admin">
      {list.map((g) => (
        <div key={g.id} className={`public-row${g.unlisted ? ' off' : ''}`}>
          {g.iconId ? <img src={imageUrl(g.iconId)!} alt="" className="explore-icon" /> : <span className="explore-icon">{g.name.slice(0, 2).toUpperCase()}</span>}
          <div className="public-info">
            <strong>{g.name}</strong>
            <span className="muted small">
              @{g.owner} · {g.members} membro{g.members === 1 ? '' : 's'}
              {g.category ? ` · ${CATEGORY_LABEL[g.category as GuildCategory] ?? g.category}` : ''} ·{' '}
              {g.unlisted ? 'tirado da lista' : g.listed ? '✅ aparecendo no Explorar' : `⏳ não aparece: falta ${(g.missing ?? []).join(', ')}`}
              {g.openReports ? ` · ⚠️ ${g.openReports} denúncia(s) aberta(s)` : ''}
            </span>
          </div>
          <button className={`btn small${g.unlisted ? '' : ' danger ghost'}`} onClick={() => void toggle(g.id, !g.unlisted)}>
            {g.unlisted ? 'Devolver ao Explorar' : 'Tirar da lista'}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Denúncia de mensagem: a conversa em volta (só a equipe; cada acesso fica registrado). */
export function ReportContext({ reportId }: { reportId: string }) {
  const [data, setData] = useState<{
    messages: { id: string; content: string; createdAt: string; attachments: number; username: string; displayName: string }[];
    targetId: string;
    views: { username: string | null; at: string }[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  async function load() {
    setOpen(true);
    try {
      setData(await api(`/admin/reports/${reportId}/context`));
    } catch (err) {
      toast((err as Error).message);
    }
  }
  if (!open)
    return (
      <button className="btn small" onClick={() => void load()}>
        Ver conversa em volta
      </button>
    );
  if (!data) return <p className="muted small">Carregando…</p>;
  return (
    <div className="report-context">
      <p className="muted small">
        Só a equipe vê isto, e cada acesso fica registrado. Vistas:{' '}
        {data.views.map((v) => `@${v.username ?? '?'} (${new Date(v.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})`).join(', ')}
      </p>
      <ol>
        {data.messages.map((m) => (
          <li key={m.id} className={m.id === data.targetId ? 'target' : ''}>
            <span className="muted small">
              {new Date(m.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · <strong>{m.displayName}</strong> @{m.username}
            </span>
            <span>
              {m.content || <em className="muted">(sem texto)</em>}
              {m.attachments ? <em className="muted"> · 📎 {m.attachments} arquivo(s)</em> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
