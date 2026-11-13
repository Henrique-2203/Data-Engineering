import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/upload';
import { toast } from '../store/app';

interface Backup {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  verified: boolean | null;
  size: number | null;
  tables: number | null;
  rows: number | null;
  error: string | null;
}
interface System {
  storage: { where: 'r2' | 'db'; databaseBytes: number; databaseLimitBytes: number; filesBytes: number; filesLimitBytes: number };
  backupsEnabled: boolean;
  backupTarget: 'r2' | 'local';
  backups: Backup[];
  pendingDeletes: number;
  filesStillInDatabase: number;
  quotas: { userMb: number; guildMb: number; dailyMb: number; fileMb: number };
  email: EmailStatus;
}
interface EmailStatus {
  enabled: boolean;
  provider: string | null;
  from: string | null;
  lastOkAt: string | null;
  lastError: { at: string; status: number; detail: string; hint: string } | null;
}

/** E-mails: está configurado? O último envio funcionou? Se não, o que o provedor disse e o que fazer. */
function EmailCard({ initial }: { initial: EmailStatus }) {
  const [st, setSt] = useState(initial);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const err = st.lastError;
  return (
    <div className={`settings-card email-card${err ? ' bad' : st.lastOkAt ? ' good' : ''}`}>
      <strong>✉️ E-mails {st.enabled ? `(${st.provider}, remetente ${st.from})` : '— desligados'}</strong>
      {!st.enabled && <p className="muted small">Configure EMAIL_PROVIDER, EMAIL_API_KEY e EMAIL_FROM no Render (veja o README).</p>}
      {st.enabled && !err && <p className="muted small">{st.lastOkAt ? `Último envio funcionou em ${when(st.lastOkAt)}.` : 'Nenhum e-mail enviado desde que o servidor ligou.'}</p>}
      {err && (
        <div className="email-error">
          <p>
            <strong>❌ O último envio falhou</strong> ({when(err.at)}, código {err.status || 'rede'}).
          </p>
          <p>
            <strong>O que fazer:</strong> {err.hint}
          </p>
          <code>{err.detail || '(sem resposta)'}</code>
        </div>
      )}
      {st.enabled && (
        <div className="row gap-s email-test">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="enviar teste para (vazio = seu e-mail)" type="email" />
          <button
            className="btn small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              try {
                const r = await api<{ ok: boolean; to: string; status: EmailStatus }>('/admin/email/test', { body: { to: to || undefined } });
                setSt(r.status);
                setResult(r.ok ? `✅ Enviado para ${r.to}. Confira a caixa de entrada (e o spam).` : '❌ Não foi enviado: veja o motivo acima.');
              } catch (e) {
                setResult((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Enviando…' : 'Enviar e-mail de teste'}
          </button>
        </div>
      )}
      {result && <p className="small">{result}</p>}
    </div>
  );
}

const when = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Bar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, (used / Math.max(1, total)) * 100);
  return (
    <div className="quota-bar" aria-hidden>
      <div className={pct > 80 ? 'warn' : ''} style={{ width: `${Math.max(pct, used ? 1 : 0)}%` }} />
    </div>
  );
}

interface Capacity {
  cpu: { avgPct: number; peakPct: number; limitPct: number };
  memory: { usedMb: number; limitMb: number };
  turn: { monthMb: number; quotaMb: number | null; cloudflareLimitMb?: number | null; paused?: boolean };
  live: { online: number; inVoice: number; calls: number; streaming: number };
  warnings: string[];
  embeddedDb: boolean;
}

/** Limites do plano (processador, memória, TURN) com aviso antes de estourar. */
function CapacityCard() {
  const [c, setC] = useState<Capacity | null>(null);
  useEffect(() => {
    const load = () => api<Capacity>('/admin/capacity').then(setC, () => {});
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  if (!c) return null;
  return (
    <>
      <h3 className="subhead">Limites do plano (agora)</h3>
      {c.embeddedDb && (
        <p className="muted small">
          Banco embutido (sem DATABASE_URL): ele roda dentro do servidor, então processador e memória aparecem maiores do que no site
          com o Neon. Avisos desligados.
        </p>
      )}
      {c.warnings.map((w) => (
        <p key={w} className="notice warn">
          ⚠️ Perto do limite: {w}
        </p>
      ))}
      <div className="stat-tiles capacity-tiles">
        <div className="stat-tile">
          <span className="stat-label">Processador do servidor</span>
          <strong className="stat-value">{c.cpu.avgPct}%</strong>
          <Bar used={c.cpu.avgPct} total={c.cpu.limitPct} />
          <span className="stat-note">
            de 1 núcleo, média do último minuto (pico {c.cpu.peakPct}%) · o plano dá {c.cpu.limitPct}%
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Memória do servidor</span>
          <strong className="stat-value">{c.memory.usedMb} MB</strong>
          <Bar used={c.memory.usedMb} total={c.memory.limitMb} />
          <span className="stat-note">de {c.memory.limitMb} MB</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">TURN este mês</span>
          <strong className="stat-value">{c.turn.monthMb} MB</strong>
          {c.turn.quotaMb ? <Bar used={c.turn.monthMb} total={c.turn.quotaMb} /> : null}
          <span className="stat-note">
            {c.turn.quotaMb ? `de ${c.turn.quotaMb} MB` : 'defina TURN_QUOTA_MB no Render com a cota do seu plano para ver a barra'}
          </span>
          {c.turn.cloudflareLimitMb ? (
            <span className={`stat-note${c.turn.paused ? ' danger-text' : ''}`}>
              {c.turn.paused
                ? `⏸️ TURN da Cloudflare pausado até o mês virar (limite de segurança de ${Math.round(c.turn.cloudflareLimitMb / 1000)} GB)`
                : `Limite de segurança da Cloudflare: ${Math.round(c.turn.cloudflareLimitMb / 1000)} GB (pausa ao chegar, sem cobrança)`}
            </span>
          ) : null}
        </div>
        <div className="stat-tile">
          <span className="stat-label">Conectados agora</span>
          <strong className="stat-value">{c.live.online}</strong>
          <span className="stat-note">
            {c.live.inVoice} em call ({c.live.calls} call{c.live.calls === 1 ? '' : 's'}) · {c.live.streaming} transmitindo
          </span>
        </div>
      </div>
      <p className="muted small">Passou de 80% em algum limite: a equipe recebe um e-mail (no máximo um por dia). Veja o guia em docs/CAPACIDADE.md.</p>
    </>
  );
}

/** Painel da equipe → Sistema: onde estão os arquivos, quanto espaço sobra e se os backups estão em dia. */
export function SystemPanel() {
  const [sys, setSys] = useState<System | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<System>('/admin/system').then(setSys, (e) => toast(e.message));
  useEffect(() => void load(), []);
  if (!sys) return <p className="muted">Carregando…</p>;

  const s = sys.storage;
  const lastOk = sys.backups.find((b) => b.ok);
  const stale = !lastOk || Date.now() - new Date(lastOk.startedAt).getTime() > 36 * 3600_000;
  const warnings: string[] = [];
  if (s.where === 'db') warnings.push('Os arquivos estão no banco de dados. Configure o Cloudflare R2 (veja o README) para ter 10 GB grátis e deixar o banco só com texto.');
  if (!sys.backupsEnabled) warnings.push('Backups DESLIGADOS: configure a variável BACKUP_KEY no Render (e guarde uma cópia dela fora do Render).');
  else if (sys.backupTarget === 'local') warnings.push('Sem R2, os backups ficam no próprio servidor e somem a cada atualização do Render.');
  else if (stale) warnings.push('O último backup que deu certo tem mais de 36 horas.');

  return (
    <div className="stats">
      {warnings.map((w) => (
        <p key={w} className="notice warn">
          ⚠️ {w}
        </p>
      ))}
      <CapacityCard />
      <h3 className="subhead">Espaço e backups</h3>
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-label">Arquivos ({s.where === 'r2' ? 'Cloudflare R2' : 'no banco'})</span>
          <strong className="stat-value">{formatBytes(s.filesBytes)}</strong>
          <Bar used={s.filesBytes} total={s.filesLimitBytes} />
          <span className="stat-note">trava em {formatBytes(s.filesLimitBytes)} para nunca gerar cobrança</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Banco de dados</span>
          <strong className="stat-value">{formatBytes(s.databaseBytes)}</strong>
          <Bar used={s.databaseBytes} total={s.databaseLimitBytes} />
          <span className="stat-note">de {formatBytes(s.databaseLimitBytes)} (mensagens, contas, servidores)</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Último backup</span>
          <strong className="stat-value">{lastOk ? when(lastOk.startedAt) : '—'}</strong>
          <span className="stat-note">
            {lastOk ? `${formatBytes(lastOk.size ?? 0)} · criptografado · ${lastOk.verified ? 'conferido ✅' : 'não conferido'}` : 'nenhum ainda'}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Cotas</span>
          <strong className="stat-value">{sys.quotas.userMb} MB</strong>
          <span className="stat-note">
            por pessoa · {sys.quotas.guildMb} MB por servidor · {sys.quotas.dailyMb} MB/dia · até {sys.quotas.fileMb} MB por arquivo
          </span>
        </div>
      </div>
      {(sys.filesStillInDatabase > 0 && s.where === 'r2') || sys.pendingDeletes > 0 ? (
        <p className="muted small">
          {sys.filesStillInDatabase > 0 && s.where === 'r2' && `Levando ${sys.filesStillInDatabase} arquivo(s) antigo(s) do banco para o R2… `}
          {sys.pendingDeletes > 0 && `${sys.pendingDeletes} arquivo(s) apagado(s) aguardando limpeza.`}
        </p>
      ) : null}

      <EmailCard initial={sys.email} />

      <h4>Backups recentes</h4>
      {sys.backups.length === 0 && <p className="muted small">Nenhum backup ainda.</p>}
      <ul className="my-files">
        {sys.backups.map((b) => (
          <li key={b.id}>
            <span className="mf-info">
              <span className="mf-name">
                {b.ok ? '✅' : b.ok === false ? '❌' : '⏳'} {when(b.startedAt)}
              </span>
              <span className="muted small">
                {b.ok
                  ? `${formatBytes(b.size ?? 0)} · ${b.tables} tabelas · ${(b.rows ?? 0).toLocaleString('pt-BR')} linhas · ${b.verified ? 'aberto e conferido' : 'sem conferência'}`
                  : b.ok === false
                    ? `Falhou: ${b.error}`
                    : 'em andamento'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <button
        className="btn"
        disabled={busy || !sys.backupsEnabled}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/admin/backups/run', { method: 'POST' });
            toast('Backup feito e conferido.');
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
            void load();
          }
        }}
      >
        {busy ? 'Fazendo backup…' : 'Fazer backup agora'}
      </button>
    </div>
  );
}
