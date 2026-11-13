import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useApp } from '../store/app';

/**
 * Painel da equipe → Visão geral: o que importa num olhar só (agora, o que pede atenção, crescimento
 * da semana, qualidade das calls e sistema). Cada cartão leva para a seção com os detalhes.
 * Só junta o que as outras seções já mostram (mesmas rotas), nada de dado novo sobre ninguém.
 */
export type AdminTab = 'overview' | 'stats' | 'health' | 'open' | 'closed' | 'support' | 'waitlist' | 'invites' | 'apoio' | 'official' | 'system';

type Agg = Record<string, { sum: number; count: number }>;
interface Data {
  cap: { cpu: { avgPct: number; peakPct: number; limitPct: number }; memory: { usedMb: number; limitMb: number }; live: { online: number; inVoice: number; calls: number; streaming: number }; warnings: string[] } | null;
  stats: { days: ({ day: string } & Record<string, number>)[]; totals: { users: number; waitlist: number; invited: number; active7: number; active30: number } } | null;
  health: { totals: Agg } | null;
  waitlist: { entries: { invitedAt: string | null }[] } | null;
  auto: { enabled: boolean; today: number; dailyCap: number } | null;
  codes: { totals: { withCode: number; total: number } } | null;
  apoio: { totals: { pending: number } } | null;
  system: {
    storage: { databaseBytes: number; databaseLimitBytes: number; filesBytes: number; filesLimitBytes: number };
    backups: { startedAt: string; ok: boolean | null }[];
    email: { enabled: boolean; lastOkAt: string | null; lastError: { at: string } | null };
  } | null;
}

const nf = new Intl.NumberFormat('pt-BR');
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const ratio = (a: Agg | undefined, k: string, of: string) => (a?.[of]?.count ? (a[k]?.count ?? 0) / a[of].count : null);
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

type Tone = 'ok' | 'warn' | 'bad' | 'info';

function Card({ label, value, hint, tone = 'info', to, go, spark }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: AdminTab; go(t: AdminTab): void; spark?: number[] }) {
  const max = spark ? Math.max(1, ...spark) : 1;
  const body = (
    <>
      <span className="ov-label">{label}</span>
      <strong className="ov-value">{value}</strong>
      {spark && (
        <span className="ov-spark" aria-hidden>
          {spark.map((v, i) => (
            <i key={i} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />
          ))}
        </span>
      )}
      {hint && <span className="ov-hint">{hint}</span>}
    </>
  );
  return to ? (
    <button className={`ov-card ${tone}`} onClick={() => go(to)}>
      {body}
    </button>
  ) : (
    <div className={`ov-card ${tone}`}>{body}</div>
  );
}

export function AdminOverview({ go }: { go(t: AdminTab): void }) {
  const [d, setD] = useState<Data | null>(null);
  const openReports = useApp((s) => s.openReports);
  const openSupport = useApp((s) => s.openSupport);
  useEffect(() => {
    let alive = true;
    const get = <T,>(p: string) => api<T>(p).catch(() => null);
    const load = async () => {
      const [cap, stats, health, waitlist, auto, codes, system, apoio] = await Promise.all([
        get<Data['cap']>('/admin/capacity'),
        get<Data['stats']>('/admin/stats?days=7'),
        get<Data['health']>('/admin/call-health?days=7'),
        get<Data['waitlist']>('/admin/waitlist'),
        get<Data['auto']>('/admin/waitlist/auto'),
        get<Data['codes']>('/admin/signup-codes'),
        get<Data['system']>('/admin/system'),
        get<Data['apoio']>('/admin/apoio'),
      ]);
      if (alive) setD({ cap, stats, health, waitlist, auto, codes, system, apoio });
    };
    void load();
    const t = setInterval(load, 30_000); // "agora" atualiza sozinho
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!d) return <p className="muted">Carregando…</p>;

  const days = d.stats?.days ?? [];
  const sum = (k: string) => days.reduce((a, x) => a + (x[k] ?? 0), 0);
  const series = (k: string) => days.map((x) => x[k] ?? 0);
  const waiting = d.waitlist?.entries.filter((e) => !e.invitedAt).length ?? 0;
  const ht = d.health?.totals;
  const connOk = ht?.conn_ok?.count ?? 0;
  const connFail = ht?.conn_fail?.count ?? 0;
  const connRate = connOk + connFail ? connOk / (connOk + connFail) : null;
  const voiceBad = ratio(ht, 'voice_bad', 'voice_samples');
  const ok40 = ratio(ht, 'stream_ok40', 'stream_samples');
  const cpu = d.cap?.cpu;
  const cpuUse = cpu ? cpu.peakPct / cpu.limitPct : null;
  const mem = d.cap?.memory;
  const memUse = mem ? mem.usedMb / mem.limitMb : null;
  const lastBackup = d.system?.backups[0];
  const db = d.system?.storage;
  const dbUse = db ? db.databaseBytes / db.databaseLimitBytes : null;
  const email = d.system?.email;
  const use = (v: number | null): Tone => (v === null ? 'info' : v >= 0.8 ? 'bad' : v >= 0.6 ? 'warn' : 'ok');
  const apoioPending = d.apoio?.totals.pending ?? 0;
  const attention = openReports + openSupport + apoioPending + (d.cap?.warnings.length ?? 0) + (email?.lastError ? 1 : 0);

  return (
    <div className="overview">
      <section>
        <h3 className="ov-title">Agora</h3>
        <div className="ov-grid">
          <Card go={go} to="health" label="Online" value={nf.format(d.cap?.live.online ?? 0)} hint={`${d.cap?.live.inVoice ?? 0} em call · ${d.cap?.live.streaming ?? 0} transmitindo`} />
          <Card go={go} to="system" label="Processador" value={cpu ? `${cpu.avgPct}%` : '—'} hint={cpu ? `pico ${cpu.peakPct}% · o plano dá ${cpu.limitPct}%` : undefined} tone={use(cpuUse)} />
          <Card go={go} to="system" label="Memória" value={mem ? `${mem.usedMb} MB` : '—'} hint={mem ? `de ${mem.limitMb} MB` : undefined} tone={use(memUse)} />
        </div>
      </section>

      <section>
        <h3 className="ov-title">Precisa de atenção</h3>
        {attention === 0 && waiting === 0 ? (
          <p className="ov-allgood">✅ Tudo em dia: nenhuma denúncia, nenhum pedido de suporte e nenhum limite perto de estourar.</p>
        ) : (
          <div className="ov-grid">
            <Card go={go} to="open" label="Denúncias abertas" value={openReports} tone={openReports ? 'bad' : 'ok'} hint={openReports ? 'abra e resolva' : 'nenhuma'} />
            <Card go={go} to="support" label="Suporte aberto" value={openSupport} tone={openSupport ? 'warn' : 'ok'} hint={openSupport ? 'gente esperando resposta' : 'nenhum'} />
            <Card
              go={go}
              to="waitlist"
              label="Esperando convite"
              value={waiting}
              tone={waiting ? 'warn' : 'ok'}
              hint={d.auto?.enabled ? `convite automático ligado (${d.auto.today}/${d.auto.dailyCap} hoje)` : 'convite automático desligado'}
            />
            {apoioPending > 0 && <Card go={go} to="apoio" label="Apoios para conferir" value={apoioPending} tone="warn" hint="confira o Pix no extrato e confirme" />}
            {(d.cap?.warnings ?? []).map((w) => (
              <Card key={w} go={go} to="system" label="Limite do plano" value="⚠️" hint={w} tone="bad" />
            ))}
            {email?.lastError && <Card go={go} to="system" label="E-mail" value="falhou" hint={`último erro ${when(email.lastError.at)}: veja Sistema`} tone="bad" />}
          </div>
        )}
      </section>

      <section>
        <h3 className="ov-title">Últimos 7 dias</h3>
        <div className="ov-grid">
          <Card go={go} to="stats" label="Visitas à página" value={nf.format(sum('landing_view'))} spark={series('landing_view')} />
          <Card go={go} to="waitlist" label="Entraram na lista" value={nf.format(sum('waitlist'))} spark={series('waitlist')} hint={`${nf.format(d.stats?.totals.waitlist ?? 0)} na lista no total`} />
          <Card go={go} to="stats" label="Contas criadas" value={nf.format(sum('signup'))} spark={series('signup')} hint={`${nf.format(d.stats?.totals.users ?? 0)} contas no total`} />
          <Card go={go} to="stats" label="Pessoas que usaram" value={nf.format(d.stats?.totals.active7 ?? 0)} spark={series('active_user')} hint={`${nf.format(d.stats?.totals.active30 ?? 0)} nos últimos 30 dias`} />
          <Card go={go} to="invites" label="Entraram por convite" value={nf.format(d.codes?.totals.withCode ?? 0)} hint={`de ${nf.format(d.codes?.totals.total ?? 0)} contas`} />
          <Card go={go} to="stats" label="Mensagens" value={nf.format(sum('messages'))} spark={series('messages')} />
        </div>
      </section>

      <section>
        <h3 className="ov-title">Qualidade das calls (7 dias)</h3>
        <div className="ov-grid">
          <Card go={go} to="health" label="Conexões que deram certo" value={pct(connRate)} tone={connRate === null ? 'info' : connRate >= 0.95 ? 'ok' : connRate >= 0.85 ? 'warn' : 'bad'} hint={`${nf.format(connOk)} ok · ${nf.format(connFail)} falhas`} />
          <Card go={go} to="health" label="Minutos com voz ruim" value={pct(voiceBad)} tone={voiceBad === null ? 'info' : voiceBad <= 0.05 ? 'ok' : voiceBad <= 0.15 ? 'warn' : 'bad'} hint="perda ou voz remendada acima de 5%" />
          <Card go={go} to="health" label="Transmissões com 40+ FPS" value={pct(ok40)} tone={ok40 === null ? 'info' : ok40 >= 0.8 ? 'ok' : ok40 >= 0.5 ? 'warn' : 'bad'} hint="o objetivo" />
        </div>
      </section>

      <section>
        <h3 className="ov-title">Sistema</h3>
        <div className="ov-grid">
          <Card go={go} to="system" label="Último backup" value={lastBackup ? when(lastBackup.startedAt) : '—'} tone={lastBackup?.ok ? 'ok' : lastBackup ? 'bad' : 'warn'} hint={lastBackup?.ok ? 'criptografado e conferido' : lastBackup ? 'falhou: veja Sistema' : 'nenhum backup ainda'} />
          <Card go={go} to="system" label="E-mails" value={email?.enabled ? (email.lastError ? 'com erro' : 'funcionando') : 'desligado'} tone={!email?.enabled ? 'warn' : email.lastError ? 'bad' : 'ok'} hint={email?.lastOkAt ? `último envio ${when(email.lastOkAt)}` : undefined} />
          <Card go={go} to="system" label="Banco de dados" value={db ? `${(db.databaseBytes / 1024 / 1024).toFixed(1)} MB` : '—'} tone={use(dbUse)} hint={db ? `de ${Math.round(db.databaseLimitBytes / 1024 / 1024)} MB (${pct(dbUse)})` : undefined} />
        </div>
      </section>
    </div>
  );
}
