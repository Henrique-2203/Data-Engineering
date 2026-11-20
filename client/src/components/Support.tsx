import { useEffect, useState } from 'react';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import type { SupportCategory, SupportTicket } from '../../../shared/types';
import { api } from '../lib/api';
import { desktop } from '../lib/desktop';
import { closeModal, toast, useApp } from '../store/app';
import { Modal, useSubmit } from './Modals';
import { Avatar } from './Avatar';
import { DiagnosticsView, FindingsList } from './CallReport';
import { type CallDiagnostics, explain } from '../voice/diagnostics';

const isDiagnostics = (d: unknown): d is CallDiagnostics => !!d && typeof d === 'object' && (d as { v?: number }).v === 1 && Array.isArray((d as CallDiagnostics).peers);

export const SUPPORT_CATEGORIES: { id: SupportCategory; label: string }[] = [
  { id: 'call', label: 'Voz, call ou transmissão' },
  { id: 'bug', label: 'Algo quebrou / deu erro' },
  { id: 'account', label: 'Minha conta (senha, e-mail, segurança)' },
  { id: 'question', label: 'Dúvida de como usar' },
  { id: 'idea', label: 'Sugestão' },
  { id: 'other', label: 'Outro assunto' },
];
const catLabel = (id: string) => SUPPORT_CATEGORIES.find((c) => c.id === id)?.label ?? id;
const STATUS: Record<SupportTicket['status'], string> = { open: 'Aguardando a equipe', answered: 'Respondido', closed: 'Encerrado' };
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Informação técnica básica (só com a permissão da pessoa): ajuda a entender problemas de call e transmissão. */
async function deviceInfo() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'outro';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'outro';
  let app = 'navegador';
  if (desktop) app = `app de Windows ${(await desktop.getSettings().catch(() => null))?.version ?? ''}`.trim();
  return `${app} · ${browser} · ${os}`;
}

export function SupportModal() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const load = () =>
    api<{ tickets: SupportTicket[] }>('/support').then(
      (r) => {
        setTickets(r.tickets);
        if (!r.tickets.length) setView((v) => (v === 'list' ? 'new' : v));
      },
      (e) => toast(e.message),
    );
  useEffect(() => {
    void load();
    const onUpdate = () => void load();
    window.addEventListener('resenha:support-update', onUpdate);
    return () => window.removeEventListener('resenha:support-update', onUpdate);
  }, []);

  const open = tickets?.find((t) => t.id === view);
  if (open) return <TicketThread ticket={open} onBack={() => setView('list')} onChange={load} />;
  if (view === 'new')
    return (
      <NewTicket
        canGoBack={!!tickets?.length}
        onBack={() => setView('list')}
        onCreated={(t) => {
          void load();
          setView(t.id);
        }}
      />
    );

  return (
    <Modal title="Suporte" wide>
      <p className="muted">Fale direto com a equipe do Resenha. A resposta aparece aqui, no celular (se ligou as notificações) e no seu e-mail.</p>
      {!tickets && <p className="muted">Carregando…</p>}
      <ul className="ticket-list">
        {tickets?.map((t) => (
          <li key={t.id}>
            <button className={`ticket-item${t.unread ? ' unread' : ''}`} onClick={() => setView(t.id)}>
              <span className="ticket-subject ellipsis">
                {t.unread && <span className="dot" aria-label="Resposta nova" />} {t.subject}
              </span>
              <span className={`ticket-status ${t.status}`}>{STATUS[t.status]}</span>
              <span className="muted small">
                {catLabel(t.category)} · {when(t.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <a className="btn ghost" href="/suporte" target="_blank" rel="noopener">
          Dúvidas comuns
        </a>
        <button className="btn primary" onClick={() => setView('new')}>
          Novo chamado
        </button>
      </div>
    </Modal>
  );
}

function NewTicket({ canGoBack, onBack, onCreated }: { canGoBack: boolean; onBack(): void; onCreated(t: SupportTicket): void }) {
  const [category, setCategory] = useState<SupportCategory>('call');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sendDevice, setSendDevice] = useState(true);
  const { busy, error, submit } = useSubmit(async () => {
    const r = await api<{ ticket: SupportTicket }>('/support', {
      body: { category, subject: subject.trim(), message: message.trim(), device: sendDevice ? await deviceInfo() : undefined },
    });
    toast('Chamado aberto! A equipe vai responder por aqui.');
    onCreated(r.ticket);
  });
  return (
    <Modal title="Novo chamado">
      <form className="form" onSubmit={submit}>
        <label>
          Assunto
          <select value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)}>
            {SUPPORT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Título
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} required placeholder="Ex.: minha transmissão trava no Valorant" />
        </label>
        <label>
          O que aconteceu?
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            maxLength={4000}
            required
            placeholder="Conte o que você fez, o que esperava e o que aconteceu. Se tiver, diga o horário."
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={sendDevice} onChange={(e) => setSendDevice(e.target.checked)} />
          Mandar junto o tipo de aparelho (navegador ou versão do app). Ajuda a resolver problemas de call.
        </label>
        <p className="muted small">Nunca mande senha nem códigos de verificação: a equipe do Resenha nunca pede isso.</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          {canGoBack ? (
            <button type="button" className="btn ghost" onClick={onBack}>
              Voltar
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={closeModal}>
              Cancelar
            </button>
          )}
          <button className="btn primary" disabled={busy || subject.trim().length < 3 || message.trim().length < 3}>
            Enviar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TicketThread({ ticket, onBack, onChange }: { ticket: SupportTicket; onBack(): void; onChange(): void }) {
  const [reply, setReply] = useState('');
  useEffect(() => {
    if (!ticket.unread) return;
    void api(`/support/${ticket.id}/read`, { body: {} }).then(() => {
      useApp.setState((s) => ({ supportUnread: Math.max(0, s.supportUnread - 1) }));
      onChange();
    });
  }, [ticket.id, ticket.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/support/${ticket.id}/messages`, { body: { message: reply.trim() } });
    setReply('');
    onChange();
  });
  return (
    <Modal title={ticket.subject} wide>
      <button className="link-btn small" onClick={onBack}>
        <ArrowLeft size={14} /> Meus chamados
      </button>
      <TicketMessages ticket={ticket} />
      {isDiagnostics(ticket.diagnostics) && (
        <details className="diag-details">
          <summary>Diagnóstico da call anexado</summary>
          <FindingsList findings={explain(ticket.diagnostics)} />
        </details>
      )}
      {ticket.status !== 'closed' ? (
        <form className="form" onSubmit={submit}>
          <label>
            Responder
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={4000} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void api(`/support/${ticket.id}/close`, { body: {} }).then(onChange, (e) => toast(e.message))}
            >
              Resolvido, encerrar
            </button>
            <button className="btn primary" disabled={busy || reply.trim().length < 3}>
              Enviar
            </button>
          </div>
        </form>
      ) : (
        <p className="muted small">Chamado encerrado. Se o problema voltar, abra um novo.</p>
      )}
    </Modal>
  );
}

export function TicketMessages({ ticket }: { ticket: SupportTicket }) {
  return (
    <div className="ticket-thread">
      {ticket.messages.map((m) => (
        <div key={m.id} className={`ticket-msg${m.fromTeam ? ' team' : ''}`}>
          <div className="ticket-msg-head">
            {m.fromTeam ? (
              <>
                <LifeBuoy size={16} /> <strong>Equipe do Resenha</strong>
              </>
            ) : (
              <>
                <Avatar user={ticket.user} size={18} /> <strong>{ticket.user.displayName}</strong>
              </>
            )}
            <span className="muted small">{when(m.createdAt)}</span>
          </div>
          <p>{m.body}</p>
        </div>
      ))}
    </div>
  );
}

/** Painel da equipe → Suporte: chamados abertos primeiro (os mais antigos em cima). */
export function AdminSupport() {
  const [status, setStatus] = useState<'open' | 'answered' | 'closed'>('open');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const load = () =>
    api<{ tickets: SupportTicket[] }>(`/admin/support?status=${status}`).then(
      (r) => setTickets(r.tickets),
      (e) => toast(e.message),
    );
  useEffect(() => {
    setTickets(null);
    void load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = useApp((s) => s.openSupport);
  useEffect(() => {
    void load();
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(t: SupportTicket) {
    try {
      await api(`/support/${t.id}/messages`, { body: { message: reply.trim() } });
      setReply('');
      toast('Resposta enviada.');
      void load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="admin-support">
      <div className="search-selects">
        <select aria-label="Situação dos chamados" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Aguardando resposta</option>
          <option value="answered">Respondidos</option>
          <option value="closed">Encerrados</option>
        </select>
      </div>
      {tickets?.length === 0 && <p className="muted center">{status === 'open' ? '🎉 Nenhum chamado esperando.' : 'Nada por aqui.'}</p>}
      <ul className="ticket-list">
        {tickets?.map((t) => (
          <li key={t.id} className="admin-ticket">
            <button className="ticket-item" onClick={() => setOpenId(openId === t.id ? null : t.id)} aria-expanded={openId === t.id}>
              <span className="ticket-subject ellipsis">{t.subject}</span>
              <span className="muted small">
                @{t.user.username} · {catLabel(t.category)} · {when(t.updatedAt)}
              </span>
            </button>
            {openId === t.id && (
              <div className="admin-ticket-body">
                <TicketMessages ticket={t} />
                {isDiagnostics(t.diagnostics) && (
                  <div className="admin-diag">
                    <strong>Diagnóstico da call</strong>
                    <FindingsList findings={explain(t.diagnostics)} />
                    <DiagnosticsView diag={t.diagnostics} />
                  </div>
                )}
                {t.status !== 'closed' && (
                  <div className="form">
                    <textarea aria-label="Resposta da equipe" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={4000} />
                    <div className="modal-actions">
                      <button
                        className="btn ghost small"
                        onClick={() => void api(`/support/${t.id}/close`, { body: {} }).then(load, (e) => toast(e.message))}
                      >
                        Encerrar
                      </button>
                      <button className="btn primary small" disabled={reply.trim().length < 3} onClick={() => void send(t)}>
                        Responder
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
