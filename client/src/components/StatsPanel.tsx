import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../store/app';

type Metric = 'landing_view' | 'download_windows' | 'waitlist' | 'signup' | 'active_user' | 'messages' | 'voice_join' | 'screen_share';
type Day = { day: string } & Record<Metric, number>;
interface Stats {
  days: Day[];
  sources: { landing_view: { key: string; total: number }[]; waitlist: { key: string; total: number }[] };
  totals: { users: number; waitlist: number; invited: number; active7: number; active30: number };
}

const LABEL: Record<Metric, string> = {
  landing_view: 'Visitas à página',
  download_windows: 'Downloads do Windows',
  waitlist: 'Inscritos na lista',
  signup: 'Contas criadas',
  active_user: 'Pessoas que usaram',
  messages: 'Mensagens enviadas',
  voice_join: 'Entradas em call',
  screen_share: 'Transmissões de tela',
};
const SOURCE_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  x: 'X / Twitter',
  discord: 'Discord',
  google: 'Google',
  amigo: 'Um amigo',
  direto: 'Direto (digitou ou link sem origem)',
  outro: 'Outro',
  nao_informado: 'Não informou',
};
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const nf = new Intl.NumberFormat('pt-BR');

/** Painel de números da equipe: tudo somado por dia, sem identificar ninguém. */
export function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState<Metric>('landing_view');
  const [table, setTable] = useState(false);
  useEffect(() => {
    api<Stats>(`/admin/stats?days=${range}`).then(setStats, (e) => toast(e.message));
  }, [range]);

  if (!stats) return <p className="muted">Carregando números…</p>;
  const d = stats.days;
  const sum = (m: Metric, from: number, to: number) => d.slice(Math.max(0, d.length - to), d.length - from).reduce((a, x) => a + x[m], 0);
  const last7 = (m: Metric) => sum(m, 0, 7);
  const prev7 = (m: Metric) => sum(m, 7, 14);
  const views7 = last7('landing_view');
  // com poucas visitas a porcentagem engana (ex.: 2 inscritos e 1 visita contada = 200%)
  const conv = views7 >= 20 ? Math.min(100, Math.round((last7('waitlist') / views7) * 1000) / 10) : null;

  return (
    <div className="stats">
      <p className="muted small">
        Últimos 7 dias, comparados com os 7 anteriores. Só contamos totais por dia: nenhum visitante é identificado (sem cookies, sem IP guardado).
      </p>
      <div className="stat-tiles">
        {(['landing_view', 'download_windows', 'waitlist', 'signup'] as Metric[]).map((m) => (
          <Tile key={m} label={LABEL[m]} value={last7(m)} prev={prev7(m)} />
        ))}
        <div className="stat-tile">
          <span className="stat-label">Pessoas ativas</span>
          <strong className="stat-value">{nf.format(stats.totals.active7)}</strong>
          <span className="stat-note">usaram nos últimos 7 dias · {nf.format(stats.totals.active30)} em 30 dias</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Visitas → lista de espera</span>
          <strong className="stat-value">{conv === null ? '—' : `${String(conv).replace('.', ',')}%`}</strong>
          <span className="stat-note">{conv === null ? 'aparece a partir de 20 visitas na semana' : 'de quem visitou, quantos se inscreveram'}</span>
        </div>
        {(['voice_join', 'screen_share', 'messages'] as Metric[]).map((m) => (
          <Tile key={m} label={LABEL[m]} value={last7(m)} prev={prev7(m)} />
        ))}
        <div className="stat-tile">
          <span className="stat-label">No total</span>
          <strong className="stat-value">{nf.format(stats.totals.users)}</strong>
          <span className="stat-note">
            contas · {nf.format(stats.totals.waitlist)} na lista ({nf.format(stats.totals.invited)} convidados)
          </span>
        </div>
      </div>

      <div className="stat-chart-card">
        <div className="stat-filters">
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="O que mostrar no gráfico">
            {(Object.keys(LABEL) as Metric[]).map((m) => (
              <option key={m} value={m}>
                {LABEL[m]}
              </option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="Período">
            {[7, 30, 90].map((n) => (
              <button key={n} className={range === n ? 'on' : ''} aria-pressed={range === n} onClick={() => setRange(n)}>
                {n} dias
              </button>
            ))}
          </div>
          <button className="link-btn small" onClick={() => setTable((v) => !v)}>
            {table ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
        <h4 className="stat-chart-title">
          {LABEL[metric]} por dia <span className="muted">· {nf.format(d.reduce((a, x) => a + x[metric], 0))} no período</span>
        </h4>
        {table ? <DayTable days={d} metric={metric} /> : <DayBars days={d} metric={metric} />}
      </div>

      <div className="stat-sources">
        <Sources title="De onde vêm as visitas" rows={stats.sources.landing_view} empty="Ninguém visitou a página no período ainda." />
        <Sources title="Como os inscritos conheceram" rows={stats.sources.waitlist} empty="Ninguém entrou na lista no período ainda." />
      </div>
      <OwnVisitsToggle />
      <p className="muted small">
        💡 Dica: use links com origem para saber qual post funcionou, por exemplo <code>?src=ig_bio</code> na bio do Instagram e{' '}
        <code>?src=tiktok</code> no TikTok.
      </p>
    </div>
  );
}

/** As visitas deste aparelho entram ou não na conta (a equipe começa fora). */
function OwnVisitsToggle() {
  const read = () => {
    try {
      return localStorage.getItem('resenha.noStats') === '1';
    } catch {
      return false;
    }
  };
  const [off, setOff] = useState(read);
  return (
    <label className="check small">
      <input
        type="checkbox"
        checked={off}
        onChange={(e) => {
          try {
            localStorage.setItem('resenha.noStats', e.target.checked ? '1' : '0');
          } catch {
            /* sem armazenamento local */
          }
          setOff(read());
        }}
      />
      Não contar as visitas deste aparelho (marcado sozinho quando você entra com a conta da equipe)
    </label>
  );
}

function Tile({ label, value, prev }: { label: string; value: number; prev: number }) {
  const diff = value - prev;
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{nf.format(value)}</strong>
      <span className={`stat-note${diff > 0 ? ' up' : diff < 0 ? ' down' : ''}`}>
        {diff === 0 ? 'igual à semana anterior' : `${diff > 0 ? '▲' : '▼'} ${nf.format(Math.abs(diff))} vs. semana anterior`}
      </span>
    </div>
  );
}

/** Barras por dia (uma série, uma cor), com dica ao passar o mouse e eixo discreto. */
function DayBars({ days, metric }: { days: Day[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((x) => x[metric]));
  const nice = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const W = 640, H = 180, padL = 30, padB = 22, gap = 2;
  const bw = (W - padL) / days.length;
  const y = (v: number) => H - padB - (v / nice) * (H - padB - 8);
  const ticks = [0, nice / 2, nice].map((v) => Math.round(v));
  const every = Math.ceil(days.length / 8);
  return (
    <div className="stat-bars" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${LABEL[metric]} por dia`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {days.map((x, i) => {
          const v = x[metric];
          const top = y(v);
          const h = H - padB - top;
          return (
            <g key={x.day}>
              {/* área de toque maior que a barra */}
              <rect x={padL + i * bw} y={0} width={bw} height={H - padB} fill="transparent" onMouseEnter={() => setHover(i)} />
              {v > 0 && <rect x={padL + i * bw + gap / 2} y={top} width={Math.max(1, bw - gap)} height={h} rx={Math.min(4, bw / 3)} className={`bar${hover === i ? ' hot' : ''}`} pointerEvents="none" />}
              {i % every === 0 && (
                <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="axis">
                  {fmtDay(x.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="stat-tip" style={{ left: `${((padL + (hover + 0.5) * bw) / W) * 100}%` }}>
          <strong>{nf.format(days[hover][metric])}</strong> {LABEL[metric].toLowerCase()}
          <span>{new Date(`${days[hover].day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
        </div>
      )}
    </div>
  );
}

function DayTable({ days, metric }: { days: Day[]; metric: Metric }) {
  return (
    <div className="stat-table-wrap">
      <table className="stat-table">
        <thead>
          <tr>
            <th>Dia</th>
            <th>{LABEL[metric]}</th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((x) => (
            <tr key={x.day}>
              <td>{fmtDay(x.day)}</td>
              <td>{nf.format(x[metric])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sources({ title, rows, empty }: { title: string; rows: { key: string; total: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  const total = rows.reduce((a, r) => a + r.total, 0);
  return (
    <div className="stat-source">
      <h4>{title}</h4>
      {rows.length === 0 && <p className="muted small">{empty}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.key} title={`${r.total} (${Math.round((r.total / total) * 100)}%)`}>
            <span className="src-name">{SOURCE_LABEL[r.key] ?? r.key}</span>
            <span className="src-bar">
              <i style={{ width: `${(r.total / max) * 100}%` }} />
            </span>
            <span className="src-val">
              {nf.format(r.total)} <span className="muted">· {Math.round((r.total / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
