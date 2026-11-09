import { useEffect, useState } from 'react';
import { Flag, ShieldAlert, X } from 'lucide-react';
import { api, authHeaders } from '../lib/api';
import { StatsPanel } from './StatsPanel';
import { SystemPanel } from './SystemPanel';
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

export function AdminReports() {
  const [tab, setTab] = useState<'stats' | 'open' | 'closed' | 'waitlist' | 'system'>(useApp.getState().openReports > 0 ? 'open' : 'stats');
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const openCount = useApp((s) => s.openReports);
  const load = () => {
    if (tab === 'open' || tab === 'closed') void api<{ reports: AdminReport[] }>(`/admin/reports?status=${tab}`).then((r) => setReports(r.reports), (e) => toast(e.message));
  };
  useEffect(load, [tab, openCount]);

  async function act(r: AdminReport, action: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const note = action === 'suspend_user' ? (prompt('Motivo da suspensão (a pessoa vai ver ao tentar entrar):', reasonLabel(r.reason)) ?? null) : '';
    if (note === null) return;
    try {
      await api(`/admin/reports/${r.id}/action`, { body: { action, note } });
      toast('Feito.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Painel da equipe">
        <div className="modal-head">
          <h2>
            <ShieldAlert size={20} /> Painel da equipe
          </h2>
          <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'stats'} onClick={() => setTab('stats')}>
              Números
            </button>
            <button role="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
              Denúncias {openCount > 0 && `(${openCount})`}
            </button>
            <button role="tab" aria-selected={tab === 'closed'} onClick={() => setTab('closed')}>
              Encerradas
            </button>
            <button role="tab" aria-selected={tab === 'waitlist'} onClick={() => setTab('waitlist')}>
              Lista de espera
            </button>
            <button role="tab" aria-selected={tab === 'system'} onClick={() => setTab('system')}>
              Sistema
            </button>
          </div>
          {tab === 'waitlist' && <WaitlistAdmin />}
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
      </div>
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
}

/** Lista de espera da página inicial: quem pediu convite, com exportação para planilha. */
function WaitlistAdmin() {
  const [entries, setEntries] = useState<WaitEntry[] | null>(null);
  const load = () => void api<{ entries: WaitEntry[] }>('/admin/waitlist').then((r) => setEntries(r.entries), (e) => toast(e.message));
  useEffect(load, []);

  async function exportCsv() {
    const res = await fetch('/api/admin/waitlist?format=csv', { headers: authHeaders() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'resenha-lista-de-espera.csv';
    a.click();
  }

  const pending = entries?.filter((e) => !e.invitedAt).length ?? 0;
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
