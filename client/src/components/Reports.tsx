import { useEffect, useState, type ReactNode } from 'react';
import { AdminSupport } from './Support';
import { HealthPanel } from './HealthPanel';
import { Activity, Archive, BarChart3, ClipboardList, Flag, Heart, LayoutDashboard, LifeBuoy, Server, ShieldAlert, Ticket, X } from 'lucide-react';
import { ApoioAdmin } from './Apoio';
import { AdminOverview, type AdminTab } from './AdminOverview';
import { api, authHeaders } from '../lib/api';
import { askText } from '../lib/ask';
import { StatsPanel } from './StatsPanel';
import { SystemPanel } from './SystemPanel';
import { InviteCodesAdmin } from './InviteCodes';
import { closeModal, toast, useApp } from '../store/app';
import { fileUrl } from '../lib/expressions';

export type ReportTarget = { type: 'message' | 'user' | 'guild'; id: string; label: string };

const REASONS: { id: string; label: string; hint: string }[] = [
  { id: 'harassment', label: 'Assédio ou ameaça', hint: 'Perseguição, xingamentos repetidos, ameaças.' },
  { id: 'hate', label: 'Discurso de ódio', hint: 'Racismo, homofobia, xenofobia ou outra discriminação.' },
  { id: 'spam', label: 'Spam ou golpe', hint: 'Propaganda em massa, links suspeitos, phishing, pedido de dinheiro.' },
  { id: 'sexual', label: 'Conteúdo sexual sem consentimento', hint: 'Nudes ou conteúdo íntimo de alguém sem permissão, ou conteúdo sexual indesejado.' },
  { id: 'violence', label: 'Violência', hint: 'Conteúdo violento ou incentivo à violência.' },
  { id: 'selfharm', label: 'Alguém pode se machucar', hint: 'Fala sobre suicídio ou autolesão.' },
  { id: 'impersonation', label: 'Se passando por outra pessoa', hint: 'Perfil falso ou fingindo ser alguém.' },
  { id: 'illegal', label: 'Outro conteúdo ilegal', hint: 'Pirataria, venda de coisas proibidas, vazamento de dados pessoais…' },
  { id: 'minors', label: 'Abuso ou exploração de menores', hint: 'Qualquer conteúdo sexual envolvendo crianças ou adolescentes.' },
  { id: 'other', label: 'Outro motivo', hint: 'Conte nos detalhes.' },
];

/** Janela "Denunciar" (mensagem, perfil ou servidor). */
export function ReportModal({ target }: { target: ReportTarget }) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!reason) return;
    setBusy(true);
    try {
      await api('/reports', { body: { type: target.type, id: target.id, reason, details } });
      setSent(true);
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Denunciar">
        <div className="modal-head">
          <h2>
            <Flag size={20} /> Denunciar {target.type === 'message' ? 'mensagem' : target.type === 'user' ? 'perfil' : 'servidor'}
          </h2>
          <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body form">
          {sent ? (
            <>
              <p>
                <strong>Denúncia enviada. Obrigado por ajudar a manter o Resenha seguro.</strong>
              </p>
              <p className="muted">A equipe do Resenha vai analisar. Quem você denunciou não fica sabendo que foi você.</p>
              {reason === 'selfharm' && <SelfHarmHelp />}
              <div className="modal-actions">
                <button className="btn primary" onClick={closeModal}>
                  Fechar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small report-target ellipsis">{target.label}</p>
              <fieldset className="reasons">
                <legend>Qual o problema?</legend>
                {REASONS.map((r) => (
                  <label key={r.id} className={`reason${reason === r.id ? ' selected' : ''}${r.id === 'minors' ? ' severe' : ''}`}>
                    <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
                    <span>
                      <strong>{r.label}</strong>
                      <span className="muted small">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {reason === 'selfharm' && <SelfHarmHelp />}
              {reason === 'minors' && (
                <p className="warn small">
                  Obrigado por avisar. Não compartilhe nem salve o conteúdo. Você também pode denunciar direto na SaferNet:{' '}
                  <a href="https://new.safernet.org.br/denuncie" target="_blank" rel="noopener noreferrer">
                    safernet.org.br/denuncie
                  </a>
                  .
                </p>
              )}
              <label>
                <span>
                  Detalhes <span className="muted">(opcional)</span>
                </span>
                <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} placeholder="O que aconteceu? Ajuda a equipe a entender o contexto." />
              </label>
              <p className="muted small">🔒 A denúncia é anônima para quem foi denunciado. Uma cópia do conteúdo fica guardada para a análise, mesmo se for apagado.</p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={closeModal}>
                  Cancelar
                </button>
                <button className="btn danger" disabled={!reason || busy} onClick={() => void send()}>
                  Enviar denúncia
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SelfHarmHelp() {
  return (
    <div className="help-box" role="note">
      💚 Se você ou alguém está em risco, procure ajuda agora: <strong>CVV, ligue 188</strong> (grátis, 24 horas) ou{' '}
      <a href="https://cvv.org.br" target="_blank" rel="noopener noreferrer">
        cvv.org.br
      </a>
      . Em emergência, <strong>SAMU 192</strong> ou <strong>Polícia 190</strong>.
    </div>
  );
}

// ---------- fila da equipe do Resenha ----------

interface AdminReport {
  id: string;
  type: 'message' | 'user' | 'guild';
  targetId: string;
  reason: string;
  details: string;
  snapshot: Record<string, any>;
  status: string;
  resolution: string | null;
  createdAt: string;
  handledAt: string | null;
  reporter: string | null;
  handledBy: string | null;
  targetUsername: string | null;
  targetSuspended: boolean;
  sameTarget: number;
  againstUser: number;
  targetExists: boolean;
}

const reasonLabel = (id: string) => REASONS.find((r) => r.id === id)?.label ?? id;

/** seções do painel, em grupos (o menu lateral mostra o contador do que está pendente) */
const ADMIN_GROUPS: { title?: string; items: { id: AdminTab; label: string; icon: ReactNode; description: string }[] }[] = [
  { items: [{ id: 'overview', label: 'Visão geral', icon: <LayoutDashboard size={18} />, description: 'O que importa num olhar só. Clique em um cartão para ver os detalhes.' }] },
  {
    title: 'Comunidade',
    items: [
      { id: 'open', label: 'Denúncias', icon: <Flag size={18} />, description: 'Denúncias abertas, com a cópia do que foi denunciado e o histórico da conta.' },
      { id: 'closed', label: 'Encerradas', icon: <Archive size={18} />, description: 'Denúncias já resolvidas ou descartadas, e o que foi feito.' },
      { id: 'support', label: 'Suporte', icon: <LifeBuoy size={18} />, description: 'Pedidos de ajuda das pessoas. Responda por aqui.' },
    ],
  },
  {
    title: 'Crescimento',
    items: [
      { id: 'stats', label: 'Números', icon: <BarChart3 size={18} />, description: 'Visitas, inscrições, contas e uso por dia (somados, sem identificar ninguém).' },
      { id: 'waitlist', label: 'Lista de espera', icon: <ClipboardList size={18} />, description: 'Quem pediu convite. Mande o código por e-mail ou deixe o convite automático ligado.' },
      { id: 'invites', label: 'Convites', icon: <Ticket size={18} />, description: 'Códigos de convite, limites e quem trouxe quem.' },
      { id: 'apoio', label: 'Apoios', icon: <Heart size={18} />, description: 'Apoie o Resenha: confira os Pix, entregue o selo de Apoiador Fundador e acompanhe a meta (só a equipe vê valores).' },
    ],
  },
  {
    title: 'Plataforma',
    items: [
      { id: 'health', label: 'Saúde', icon: <Activity size={18} />, description: 'Conexões, voz e transmissões das calls (somados por dia).' },
      { id: 'system', label: 'Sistema', icon: <Server size={18} />, description: 'Limites do plano, espaço, backups e e-mails.' },
    ],
  },
];

export function AdminReports() {
  const [tab, setTab] = useState<AdminTab>(useApp.getState().openReports > 0 ? 'open' : useApp.getState().openSupport > 0 ? 'support' : 'overview');
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    void api<{ entries: { invitedAt: string | null }[] }>('/admin/waitlist').then((r) => setWaiting(r.entries.filter((e) => !e.invitedAt).length), () => {});
    void api<{ totals: { pending: number } }>('/admin/apoio').then((r) => useApp.setState({ pendingApoio: r.totals.pending }), () => {});
  }, [tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.ask-backdrop') && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const supportCount = useApp((s) => s.openSupport);
  const apoioCount = useApp((s) => s.pendingApoio);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const openCount = useApp((s) => s.openReports);
  const load = () => {
    if (tab === 'open' || tab === 'closed') void api<{ reports: AdminReport[] }>(`/admin/reports?status=${tab}`).then((r) => setReports(r.reports), (e) => toast(e.message));
  };
  useEffect(load, [tab, openCount]);

  async function act(r: AdminReport, action: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const note =
      action === 'suspend_user'
        ? await askText({ title: 'Suspender conta', message: 'Motivo da suspensão (a pessoa vai ver ao tentar entrar):', initial: reasonLabel(r.reason), maxLength: 300, confirmLabel: 'Suspender', danger: true })
        : '';
    if (note === null) return;
    try {
      await api(`/admin/reports/${r.id}/action`, { body: { action, note } });
      toast('Feito.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const badge: Partial<Record<AdminTab, number>> = { open: openCount, support: supportCount, waitlist: waiting, apoio: apoioCount };
  const current = ADMIN_GROUPS.flatMap((g) => g.items).find((x) => x.id === tab)!;
  return (
    <div className="settings-page admin-panel" role="dialog" aria-modal="true" aria-label="Painel da equipe">
      <nav className="settings-nav" aria-label="Seções do painel" role="tablist">
        <div className="settings-nav-title">
          <ShieldAlert size={14} /> Painel da equipe
        </div>
        {ADMIN_GROUPS.map((g, gi) => (
          <div key={gi} className="admin-nav-group">
            {g.title && <div className="admin-nav-label">{g.title}</div>}
            {g.items.map((it) => (
              <button key={it.id} role="tab" aria-selected={tab === it.id} className={tab === it.id ? 'active' : ''} onClick={() => setTab(it.id)}>
                {it.icon}
                <span>{it.label}</span>
                {!!badge[it.id] && <b className={`nav-count${it.id === 'open' ? ' bad' : ''}`}>{badge[it.id]}</b>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section className="settings-body">
        <button className="icon-btn settings-close" aria-label="Fechar" title="Fechar (Esc)" onClick={closeModal}>
          <X size={22} />
        </button>
        <div className="settings-section admin-section">
          <header className="settings-head">
            <h2>{current.label}</h2>
            <p className="muted">{current.description}</p>
          </header>
          {tab === 'overview' && <AdminOverview go={setTab} />}
          {tab === 'waitlist' && <WaitlistAdmin />}
          {tab === 'invites' && <InviteCodesAdmin />}
          {tab === 'support' && <AdminSupport />}
          {tab === 'apoio' && <ApoioAdmin />}
          {tab === 'health' && <HealthPanel />}
          {tab === 'stats' && <StatsPanel />}
          {tab === 'system' && <SystemPanel />}
          {(tab === 'open' || tab === 'closed') && reports === null && <p className="muted">Carregando…</p>}
          {(tab === 'open' || tab === 'closed') && reports?.length === 0 && <p className="muted center">{tab === 'open' ? '🎉 Nenhuma denúncia aberta.' : 'Nada por aqui ainda.'}</p>}
          <ul className="report-list" hidden={tab !== 'open' && tab !== 'closed'}>
            {reports?.map((r) => (
              <li key={r.id} className={`report-item${r.reason === 'minors' || r.reason === 'selfharm' ? ' urgent' : ''}`}>
                <div className="report-head">
                  <span className="report-reason">{reasonLabel(r.reason)}</span>
                  <span className="muted small">
                    {r.type === 'message' ? 'Mensagem' : r.type === 'user' ? 'Perfil' : 'Servidor'} · {new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · por @{r.reporter ?? 'conta excluída'}
                    {r.sameTarget > 1 && <strong className="report-multi"> · {r.sameTarget} denúncias sobre isso</strong>}
                  </span>
                </div>
                <Evidence r={r} />
                {r.details && <p className="report-details">“{r.details}”</p>}
                {r.targetUsername && (
                  <p className="muted small">
                    Conta: @{r.targetUsername}
                    {r.againstUser > 1 && ` · ${r.againstUser} denúncias contra esta conta no total`}
                    {r.targetSuspended && ' · suspensa'}
                  </p>
                )}
                {r.reason === 'minors' && (
                  <p className="warn small">
                    Abuso de menores: remova o conteúdo, suspenda a conta e denuncie à SaferNet (new.safernet.org.br/denuncie) e à Polícia Federal.
                    Não baixe nem compartilhe o material.
                  </p>
                )}
                {r.status === 'open' ? (
                  <div className="report-actions">
                    {r.type === 'message' && r.targetExists && (
                      <button className="btn small danger" onClick={() => void act(r, 'delete_message', 'Apagar esta mensagem para todos?')}>
                        Apagar mensagem
                      </button>
                    )}
                    {r.type === 'guild' && r.targetExists && (
                      <button className="btn small danger" onClick={() => void act(r, 'delete_guild', `Excluir o servidor "${r.snapshot.name}" para todos os membros?`)}>
                        Excluir servidor
                      </button>
                    )}
                    {r.targetUsername && !r.targetSuspended && (
                      <button className="btn small danger" onClick={() => void act(r, 'suspend_user', `Suspender a conta @${r.targetUsername}? Ela é desconectada na hora e não consegue entrar.`)}>
                        Suspender conta
                      </button>
                    )}
                    <button className="btn small" onClick={() => void act(r, 'resolve')}>
                      Marcar como resolvida
                    </button>
                    <button className="btn small ghost" onClick={() => void act(r, 'dismiss')}>
                      Descartar
                    </button>
                  </div>
                ) : (
                  <p className="muted small">
                    ✔ {r.resolution} {r.handledBy && `· por @${r.handledBy}`} {r.handledAt && `· ${new Date(r.handledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
                  </p>
                )}
                {r.targetSuspended && r.targetUsername && (
                  <button
                    className="link-btn small"
                    onClick={async () => {
                      if (!confirm(`Reativar a conta @${r.targetUsername}?`)) return;
                      await api(`/admin/users/${r.targetUsername}/unsuspend`, { method: 'POST', body: {} }).then(() => (toast('Conta reativada.'), load()), (e) => toast(e.message));
                    }}
                  >
                    Reativar conta
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Evidence({ r }: { r: AdminReport }) {
  const s = r.snapshot;
  if (r.type === 'message') {
    return (
      <div className="evidence">
        <div className="muted small">
          @{s.author?.username} em {s.where} · {s.sentAt ? new Date(s.sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
          {!r.targetExists && ' · (a mensagem já foi apagada; esta é a cópia guardada)'}
        </div>
        {s.content && <p className="evidence-text">{s.content}</p>}
        {s.attachments?.length > 0 && (
          <p className="muted small">
            📎 {s.attachments.length} anexo(s){' '}
            {r.targetExists &&
              r.reason !== 'minors' &&
              s.attachments.map((a: { id: string; name: string; url?: string }) => (
                <a key={a.id} href={a.url ?? '#'} target="_blank" rel="noopener noreferrer">
                  ver
                </a>
              ))}
          </p>
        )}
        {s.sticker && <p className="muted small">Figurinha</p>}
      </div>
    );
  }
  if (r.type === 'user') {
    return (
      <div className="evidence row gap-s">
        {s.avatarId && <img className="evidence-avatar" src={fileUrl(s.avatarId)} alt="" />}
        <div>
          <strong>{s.displayName}</strong> <span className="muted small">@{s.username}</span>
          {s.bio && <p className="evidence-text">{s.bio}</p>}
          {s.status && <p className="muted small">Status: {s.status}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="evidence">
      <strong>{s.name}</strong> <span className="muted small">dono: @{s.owner}</span>
      {s.description && <p className="evidence-text">{s.description}</p>}
    </div>
  );
}

interface WaitEntry {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  platforms: string[];
  source: string | null;
  createdAt: string;
  invitedAt: string | null;
  inviteCode: string | null;
  invitedBy: string | null;
  codeUses: number | null;
  codeMax: number | null;
  /** usuário que ela criou com o código (quando já entrou) */
  joined: string | null;
}

/** Convite automático: quem entra na lista recebe o código na hora (com teto por dia). */
function AutoInvite({ onChange }: { onChange(): void }) {
  const [cfg, setCfg] = useState<{ enabled: boolean; maxUses: number; dailyCap: number; today: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<NonNullable<typeof cfg>>('/admin/waitlist/auto').then(setCfg, (e) => toast(e.message));
  }, []);
  if (!cfg) return null;
  async function save(next: typeof cfg, before?: typeof cfg) {
    setBusy(true);
    try {
      setCfg(await api<NonNullable<typeof cfg>>('/admin/waitlist/auto', { method: 'PUT', body: { enabled: next!.enabled, maxUses: next!.maxUses, dailyCap: next!.dailyCap } }));
      toast(next!.enabled ? 'Convite automático ligado: quem entrar na lista recebe o código na hora.' : 'Convite automático desligado.');
      onChange();
    } catch (err) {
      if (before) setCfg(before);
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`wait-auto${cfg.enabled ? ' on' : ''}`}>
      <label className="check">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => {
          const next = { ...cfg, enabled: e.target.checked };
          setCfg(next); // muda na hora; volta se o servidor recusar
          void save(next, cfg);
        }} />
        <strong>Convite automático</strong>
      </label>
      <p className="muted small">
        Quem entrar na lista recebe na hora, por e-mail, o próprio código de convite. Funciona sozinho, mesmo de madrugada. Quem já tem conta com o e-mail não recebe.
      </p>
      <div className="wait-auto-row">
        <label className="small">
          Limite de cada código
          <input type="number" min={1} max={50} value={cfg.maxUses} aria-label="Limite de contas de cada código automático" onChange={(e) => setCfg({ ...cfg, maxUses: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
        </label>
        <label className="small">
          Máximo por dia
          <input type="number" min={1} max={250} value={cfg.dailyCap} aria-label="Máximo de convites automáticos por dia" onChange={(e) => setCfg({ ...cfg, dailyCap: Math.max(1, Math.min(250, Number(e.target.value) || 1)) })} />
        </label>
        <button className="btn small" disabled={busy} onClick={() => void save(cfg)}>
          Salvar
        </button>
      </div>
      <p className="muted small">
        Hoje: <strong>{cfg.today}</strong> de {cfg.dailyCap} enviados automaticamente. Passou do máximo, a pessoa fica na lista e você convida depois. (A Brevo grátis manda 300 e-mails por dia, e
        cada pessoa nova gasta 2: o convite e o código do cadastro.)
      </p>
    </div>
  );
}

/** Convite de uma pessoa da lista: código (opcional) + limite → e-mail com o código. */
function WaitInvite({ entry: e, emailOn, onDone }: { entry: WaitEntry; emailOn: boolean; onDone(): void }) {
  const [code, setCode] = useState('');
  const [max, setMax] = useState(3);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const r = await api<{ code: string; emailed: boolean; sentTo: string }>(`/admin/waitlist/${e.id}/invite`, { body: { code: code.trim() || undefined, maxUses: e.inviteCode ? (e.codeMax ?? max) : max } });
      if (r.emailed) toast(`Convite ${r.code} enviado para ${r.sentTo}.`);
      else {
        await navigator.clipboard?.writeText(r.code).catch(() => {});
        toast(`Código ${r.code} criado e copiado, mas o e-mail não saiu: veja Sistema → E-mail.`);
      }
      onDone();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (e.inviteCode)
    return (
      <div className="wait-invite">
        <span className="small">
          Código <strong className="invite-code">{e.inviteCode}</strong> · {e.codeUses ?? 0} de {e.codeMax ?? '∞'} {(e.codeMax ?? 2) === 1 ? 'conta' : 'contas'}
          {e.invitedBy === 'automático' && ' · enviado automaticamente'}
          {e.joined ? (
            <>
              {' · '}
              <span className="pill ok">entrou como @{e.joined}</span>
            </>
          ) : (
            ' · ainda não criou a conta'
          )}
        </span>
        {emailOn && !e.joined && (
          <button className="btn small ghost" disabled={busy} onClick={() => void send()}>
            Reenviar e-mail
          </button>
        )}
      </div>
    );
  return (
    <div className="wait-invite">
      <input value={code} onChange={(ev) => setCode(ev.target.value.toUpperCase())} placeholder="Código (gerado sozinho)" maxLength={24} aria-label={`Código de convite para ${e.name}`} spellCheck={false} />
      <label className="small">
        Limite
        <input type="number" min={1} max={1000} value={max} onChange={(ev) => setMax(Math.max(1, Math.min(1000, Number(ev.target.value) || 1)))} aria-label={`Limite de contas para ${e.name}`} />
      </label>
      <button className="btn small primary" disabled={busy} onClick={() => void send()}>
        {emailOn ? 'Enviar convite por e-mail' : 'Criar código'}
      </button>
      <span className="muted small">O limite conta a própria pessoa (3 = ela + 2 amigos).</span>
    </div>
  );
}

/** Lista de espera da página inicial: quem pediu convite, com exportação para planilha. */
function WaitlistAdmin() {
  const [entries, setEntries] = useState<WaitEntry[] | null>(null);
  const [emailOn, setEmailOn] = useState(true);
  const load = () =>
    void api<{ entries: WaitEntry[]; emailEnabled: boolean }>('/admin/waitlist').then(
      (r) => {
        setEntries(r.entries);
        setEmailOn(r.emailEnabled);
      },
      (e) => toast(e.message),
    );
  useEffect(load, []);

  async function exportCsv() {
    const res = await fetch('/api/admin/waitlist?format=csv', { headers: authHeaders() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'resenha-lista-de-espera.csv';
    a.click();
  }

  const pending = entries?.filter((e) => !e.invitedAt).length ?? 0;
  const [bulkMax, setBulkMax] = useState(3);
  const [bulkBusy, setBulkBusy] = useState(false);

  /** convida todo mundo que ainda espera (um e-mail por pessoa, cada uma com o seu código) */
  async function inviteAll() {
    const waiting = entries?.filter((e) => !e.invitedAt) ?? [];
    if (!waiting.length || !confirm(`Mandar o convite por e-mail para ${waiting.length} ${waiting.length === 1 ? 'pessoa' : 'pessoas'}, cada uma com o seu código (limite de ${bulkMax} ${bulkMax === 1 ? 'conta' : 'contas'})?`)) return;
    setBulkBusy(true);
    let ok = 0;
    for (const e of waiting) {
      try {
        const r = await api<{ emailed: boolean }>(`/admin/waitlist/${e.id}/invite`, { body: { maxUses: bulkMax } });
        if (r.emailed) ok++;
      } catch (err) {
        toast(`${e.name}: ${(err as Error).message}`);
      }
    }
    setBulkBusy(false);
    toast(`${ok} de ${waiting.length} convites enviados por e-mail.`);
    load();
  }
  return (
    <div className="waitlist-admin">
      <div className="row spread">
        <p className="muted small">
          {entries ? `${entries.length} inscritos · ${pending} esperando convite` : 'Carregando…'}
        </p>
        <button className="btn small" onClick={() => void exportCsv()}>
          Exportar planilha (.csv)
        </button>
      </div>
      {emailOn && <AutoInvite onChange={load} />}
      {!emailOn && (
        <p className="notice warn small">
          O envio de e-mails está desligado no servidor: o código é criado e copiado, mas você precisa mandar para a pessoa por conta própria.
        </p>
      )}
      {emailOn && pending > 0 && (
        <div className="wait-bulk">
          <span className="small">
            Convidar os {pending} que esperam, cada um com o seu código, com limite de
          </span>
          <input type="number" min={1} max={50} value={bulkMax} aria-label="Limite de contas por código" onChange={(e) => setBulkMax(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          <span className="small">{bulkMax === 1 ? 'conta' : 'contas'}</span>
          <button className="btn small primary" disabled={bulkBusy} onClick={() => void inviteAll()}>
            {bulkBusy ? 'Enviando…' : 'Enviar para todos'}
          </button>
        </div>
      )}
      <ul className="report-list">
        {entries?.map((e, i) => (
          <li key={e.id} className={`report-item wait-item${e.invitedAt ? ' invited' : ''}`}>
            <div className="report-head">
              <span className="report-reason">
                nº {i + 1} · {e.name}
              </span>
              <span className="muted small">
                {new Date(e.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                {e.source && ` · veio por ${e.source}`}
              </span>
            </div>
            <p className="small">
              <a href={`mailto:${e.email}`}>{e.email}</a>
              {e.whatsapp && (
                <>
                  {' · '}
                  <a href={`https://wa.me/${e.whatsapp.replace(/^\+/, '').replace(/^(?!55)/, '55')}`} target="_blank" rel="noopener noreferrer">
                    WhatsApp {e.whatsapp}
                  </a>
                </>
              )}
              {' · '}
              {e.platforms.join(', ')}
            </p>
            <WaitInvite entry={e} emailOn={emailOn} onDone={load} />
            <div className="report-actions">
              <label className="check small">
                <input
                  type="checkbox"
                  checked={!!e.invitedAt}
                  onChange={async (ev) => {
                    await api(`/admin/waitlist/${e.id}/invited`, { body: { invited: ev.target.checked } }).catch((err) => toast(err.message));
                    load();
                  }}
                />
                Convite enviado
              </label>
              <button
                className="btn small ghost"
                onClick={async () => {
                  if (!confirm(`Remover ${e.name} da lista?`)) return;
                  await api(`/admin/waitlist/${e.id}`, { method: 'DELETE' }).catch((err) => toast(err.message));
                  load();
                }}
              >
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
