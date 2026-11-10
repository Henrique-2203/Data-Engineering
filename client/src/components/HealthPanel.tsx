import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../store/app';

type Agg = Record<string, { sum: number; count: number }>;
interface HealthData {
  days: number;
  totals: Agg;
  byDay: Record<string, Agg>;
  turnMonthMb: number;
  errors: { message: string; total: number; version: string | null; last: string }[];
  live: { online: number; inVoice: number; calls: number; streaming: number };
}

const avg = (a: Agg, k: string) => (a[k]?.count ? a[k].sum / a[k].count : null);
const ratio = (a: Agg, k: string, of: string) => (a[of]?.count ? (a[k]?.count ?? 0) / a[of].count : null);
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number | null, unit = '', d = 0) => (v === null ? '—' : `${v.toFixed(d)}${unit}`);

type Level = 'ok' | 'warn' | 'bad' | 'none';
const level = (v: number | null, good: (v: number) => boolean, bad: (v: number) => boolean): Level =>
  v === null ? 'none' : good(v) ? 'ok' : bad(v) ? 'bad' : 'warn';

function Tile({ label, value, hint, lv }: { label: string; value: string; hint?: string; lv: Level }) {
  return (
    <div className={`health-tile ${lv}`} title={hint}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

/** Barrinhas por dia de um indicador (0-1). */
function DailyBars({ data, metric, label }: { data: HealthData; metric: (a: Agg) => number | null; label: string }) {
  if (!Object.keys(data.byDay).length) return null;
  // todos os dias do período (dia sem call fica vazio), terminando no dia mais recente com dados
  const last = Object.keys(data.byDay).sort().pop()!;
  const days = Array.from({ length: Math.min(data.days, 30) }, (_, i) => {
    const d = new Date(`${last}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (Math.min(data.days, 30) - 1 - i));
    return d.toISOString().slice(0, 10);
  });
  return (
    <div className="health-bars" aria-label={label}>
      <span className="muted small">{label}</span>
      <div className="health-bars-row">
        {days.map((d) => {
          const v = data.byDay[d] ? metric(data.byDay[d]) : null;
          return (
            <span key={d} className="health-bar" title={`${d.slice(8, 10)}/${d.slice(5, 7)}: ${v === null ? 'sem dados' : pct(v)}`}>
              <span style={{ height: `${v === null ? 0 : Math.max(4, v * 100)}%` }} className={v === null ? '' : v >= 0.9 ? 'ok' : v >= 0.7 ? 'warn' : 'bad'} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Painel da equipe → Saúde: como as calls estão (números somados por dia, sem identificar ninguém). */
export function HealthPanel() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<HealthData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<HealthData>(`/admin/call-health?days=${days}`).then(
        (r) => alive && setData(r),
        (e) => toast(e.message),
      );
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [days]);
  if (!data) return <p className="muted">Carregando…</p>;
  const t = data.totals;
  const ok = t.conn_ok?.count ?? 0;
  const fail = t.conn_fail?.count ?? 0;
  const connRate = ok + fail ? ok / (ok + fail) : null;
  const connMs = avg(t, 'conn_ms');
  const rtt = avg(t, 'voice_rtt');
  const loss = avg(t, 'voice_loss');
  const voiceBad = ratio(t, 'voice_bad', 'voice_samples');
  const relayed = ratio(t, 'relayed_samples', 'voice_samples');
  const sent = avg(t, 'stream_sent');
  const viewer = avg(t, 'stream_viewer');
  const capture = avg(t, 'stream_capture');
  const ok40 = ratio(t, 'stream_ok40', 'stream_samples');
  const turbo = ratio(t, 'stream_turbo', 'stream_samples');
  const light = ratio(t, 'stream_light', 'stream_samples');
  const encodeMs = avg(t, 'stream_encode_ms');
  const watchFps = avg(t, 'watch_fps');
  const watchLow = ratio(t, 'watch_low', 'watch_samples');
  const empty = !Object.keys(t).length;

  return (
    <div className="health">
      <div className="health-head">
        <div className="health-live" aria-label="Agora">
          <span>
            🟢 <strong>{data.live.online}</strong> online
          </span>
          <span>
            🎙️ <strong>{data.live.inVoice}</strong> em call ({data.live.calls} call{data.live.calls === 1 ? '' : 's'})
          </span>
          <span>
            🖥️ <strong>{data.live.streaming}</strong> transmitindo
          </span>
        </div>
        <select aria-label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>
      {empty && <p className="muted">Ainda sem números neste período. Eles aparecem conforme o pessoal usa as calls (1 amostra por minuto de call).</p>}

      <h4>Conexões</h4>
      <div className="health-grid">
        <Tile label="Conexões que deram certo" value={pct(connRate)} hint={`${ok} ok · ${fail} falhas`} lv={level(connRate, (v) => v >= 0.97, (v) => v < 0.9)} />
        <Tile label="Tempo para conectar" value={num(connMs !== null ? connMs / 1000 : null, ' s', 1)} lv={level(connMs, (v) => v < 3000, (v) => v > 8000)} />
        <Tile label="Minutos via TURN" value={pct(relayed)} hint="sem conexão direta (4G/5G, CGNAT)" lv={level(relayed, (v) => v < 0.2, (v) => v > 0.5)} />
        <Tile label="Atualizações sem derrubar a call" value={String(t.resume?.count ?? 0)} lv="none" />
      </div>
      <DailyBars data={data} label="Conexões que deram certo, por dia" metric={(a) => ((a.conn_ok?.count ?? 0) + (a.conn_fail?.count ?? 0) ? (a.conn_ok?.count ?? 0) / ((a.conn_ok?.count ?? 0) + (a.conn_fail?.count ?? 0)) : null)} />

      <h4>Voz</h4>
      <div className="health-grid">
        <Tile label="Atraso médio" value={num(rtt, ' ms')} lv={level(rtt, (v) => v < 150, (v) => v > 250)} />
        <Tile label="Perda média" value={num(loss, '%', 1)} lv={level(loss, (v) => v < 1, (v) => v >= 5)} />
        <Tile label="Minutos com voz ruim" value={pct(voiceBad)} hint="perda ou voz remendada acima de 5%" lv={level(voiceBad, (v) => v < 0.05, (v) => v > 0.15)} />
      </div>

      <h4>Transmissões</h4>
      <div className="health-grid">
        <Tile label="Minutos com 40+ FPS" value={pct(ok40)} hint="o objetivo" lv={level(ok40, (v) => v >= 0.9, (v) => v < 0.7)} />
        <Tile label="FPS na tela de quem assiste" value={num(viewer)} lv={level(viewer, (v) => v >= 45, (v) => v < 35)} />
        <Tile label="Captura / envio" value={capture === null ? '—' : `${num(capture)} / ${num(sent)} FPS`} hint="captura baixa = jogo em tela cheia; envio baixo = codificador" lv="none" />
        <Tile label="Tempo por quadro" value={num(encodeMs, ' ms', 1)} hint="acima de 14 ms: provavelmente processador" lv={level(encodeMs, (v) => v < 10, (v) => v > 16)} />
        <Tile label="Em modo turbo" value={pct(turbo)} lv={level(turbo, (v) => v >= 0.8, (v) => v < 0.4)} />
        <Tile label="Em versão leve" value={pct(light)} hint="resolução reduzida pelo modo desempenho" lv="none" />
      </div>
      <DailyBars data={data} label="Minutos de transmissão com 40+ FPS, por dia" metric={(a) => (a.stream_samples?.count ? (a.stream_ok40?.count ?? 0) / a.stream_samples.count : null)} />

      <h4>Assistindo</h4>
      <div className="health-grid">
        <Tile label="FPS recebido" value={num(watchFps)} lv={level(watchFps, (v) => v >= 45, (v) => v < 30)} />
        <Tile label="Minutos abaixo de 30 FPS" value={pct(watchLow)} lv={level(watchLow, (v) => v < 0.05, (v) => v > 0.2)} />
      </div>

      <h4>TURN (cota)</h4>
      <p className="small">
        Este mês passaram <strong>{data.turnMonthMb} MB</strong> pelo servidor TURN. Compare com a cota do seu plano no painel do Metered.
      </p>

      <h4>Erros do site</h4>
      {data.errors.length === 0 ? (
        <p className="muted small">Nenhum erro registrado neste período. 🎉</p>
      ) : (
        <table className="health-errors">
          <thead>
            <tr>
              <th>Vezes</th>
              <th>Erro</th>
              <th>Versão</th>
            </tr>
          </thead>
          <tbody>
            {data.errors.map((e) => (
              <tr key={e.message}>
                <td>{e.total}</td>
                <td>
                  <code>{e.message}</code>
                </td>
                <td className="muted small">{e.version ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Números somados por dia, sem identificar ninguém nem a call. Quem desligou em Privacidade e dados não entra.</p>
    </div>
  );
}
