import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../store/app';
import { Avatar } from './Avatar';

/**
 * Painel da equipe → Novas contas: quantas pessoas entraram (hoje, 7 e 30 dias, total), um gráfico por dia
 * e a lista de quem entrou e quando (com e-mail confirmado, quem convidou e se já entrou num servidor).
 * Também liga/desliga o cadastro aberto (sem código de convite).
 */
interface SignupUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarId: string | null;
  createdAt: string;
  emailVerified: boolean;
  signupCode: string | null;
  invitedBy: string | null;
  lastActiveOn: string | null;
  suspended: boolean;
  guilds: number;
}
interface Data {
  totals: { today: number; week: number; month: number; total: number; verified: number };
  byDay: { day: string; n: number }[];
  users: SignupUser[];
  open: boolean;
  hasEnvCode: boolean;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dayLabel = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export function SignupsAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const load = (query = q, n = limit) => void api<Data>(`/admin/signups?q=${encodeURIComponent(query)}&limit=${n}`).then(setData, (e) => toast(e.message));
  useEffect(() => {
    const t = setTimeout(() => load(q, limit), 250);
    return () => clearTimeout(t);
  }, [q, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => load(), 30_000); // contas novas aparecem sozinhas
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleOpen(open: boolean) {
    if (!open && !confirm('Fechar o cadastro? Quem não tiver código de convite não vai conseguir criar conta.')) return;
    setBusy(true);
    try {
      await api('/admin/signup-open', { method: 'PUT', body: { open } });
      toast(open ? 'Cadastro aberto para todos 🎉' : 'Cadastro fechado: só com código de convite.');
      load();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="muted">Carregando…</p>;
  const t = data.totals;
  // os 30 dias, com zero nos dias sem cadastro (dia no horário de Brasília)
  const counts = new Map(data.byDay.map((d) => [d.day, d.n]));
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 29 + i);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day, n: counts.get(day) ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="signups-admin">
      <label className={`signup-open${data.open ? ' on' : ''}`}>
        <input type="checkbox" checked={data.open} disabled={busy || !data.hasEnvCode} onChange={(e) => void toggleOpen(e.target.checked)} />
        <span>
          <strong>Cadastro aberto para todos</strong>
          <span className="muted small">
            {data.open
              ? 'Qualquer pessoa cria conta, sem código de convite e sem lista de espera. Quem digitar um código ainda fica registrado como convidado por ele.'
              : 'Desligado: o cadastro pede código de convite (ou a lista de espera).'}
            {!data.hasEnvCode && ' Para poder fechar o cadastro, crie a variável REGISTRATION_CODE no Render.'}
          </span>
        </span>
      </label>

      <div className="stat-tiles">
        {[
          ['Hoje', t.today],
          ['Últimos 7 dias', t.week],
          ['Últimos 30 dias', t.month],
          ['Total de contas', t.total],
        ].map(([label, v]) => (
          <div key={String(label)} className="stat-tile">
            <span className="stat-label">{label}</span>
            <strong className="stat-value">{Number(v).toLocaleString('pt-BR')}</strong>
          </div>
        ))}
      </div>
      <p className="muted small">{t.verified.toLocaleString('pt-BR')} com e-mail confirmado.</p>

      <div className="signup-bars" role="img" aria-label={`Contas novas por dia nos últimos 30 dias: ${days.filter((d) => d.n).map((d) => `${dayLabel(d.day)}: ${d.n}`).join(', ') || 'nenhuma'}`}>
        {days.map((d, i) => (
          <span key={d.day} className="signup-bar" title={`${dayLabel(d.day)}: ${d.n} conta${d.n === 1 ? '' : 's'}`}>
            {d.n > 0 && <b>{d.n}</b>}
            <i className={d.n ? '' : 'zero'} style={{ height: d.n ? `${Math.max(6, (d.n / max) * 100)}%` : 2 }} />
            <small>{i % 5 === 4 || i === 29 ? dayLabel(d.day) : ''}</small>
          </span>
        ))}
      </div>

      <div className="signup-search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou @usuário" aria-label="Buscar conta" />
      </div>
      <div className="signup-table-wrap">
        <table className="signup-table">
          <thead>
            <tr>
              <th>Conta</th>
              <th>Entrou em</th>
              <th>E-mail</th>
              <th>Convidada por</th>
              <th>Servidores</th>
              <th>Último uso</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className={u.suspended ? 'suspended' : ''}>
                <td>
                  <span className="signup-user">
                    <Avatar user={{ displayName: u.displayName, avatarColor: u.avatarColor, avatarId: u.avatarId }} size={28} />
                    <span>
                      <strong>{u.displayName}</strong>
                      <span className="muted small">@{u.username}</span>
                    </span>
                    {u.suspended && <span className="muted small"> (suspensa)</span>}
                  </span>
                </td>
                <td>{when(u.createdAt)}</td>
                <td>{u.emailVerified ? '✅ confirmado' : <span className="muted">—</span>}</td>
                <td>{u.invitedBy ? `@${u.invitedBy}` : u.signupCode ? <code>{u.signupCode}</code> : <span className="muted">—</span>}</td>
                <td>{u.guilds}</td>
                <td>{u.lastActiveOn ? dayLabel(u.lastActiveOn) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.users.length >= limit && (
        <button type="button" className="btn ghost small" onClick={() => setLimit((n) => Math.min(500, n + 100))}>
          Mostrar mais
        </button>
      )}
    </div>
  );
}
