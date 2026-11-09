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
