import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AttachmentKind } from '../../../shared/types';
import { api } from '../lib/api';
import { formatBytes } from '../lib/upload';
import { toast } from '../store/app';
import { FileIcon } from './chat/Attachments';

interface MyFile {
  id: string;
  name: string;
  kind: AttachmentKind;
  size: number;
  createdAt: string;
  url: string;
  channelName: string | null;
  guildName: string | null;
}
interface Usage {
  usedBytes: number;
  todayBytes: number;
  files: number;
  quotaBytes: number;
  dailyBytes: number;
}

/** Configurações → Meus arquivos: quanto espaço a pessoa usa e quais arquivos enviou (para apagar). */
export function MyFiles() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [files, setFiles] = useState<MyFile[]>([]);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);

  const load = (before?: string) =>
    api<{ files: MyFile[]; hasMore: boolean; usage: Usage }>(`/me/files${before ? `?before=${before}` : ''}`).then(
      (r) => {
        setUsage(r.usage);
        setFiles((f) => (before ? [...f, ...r.files] : r.files));
        setMore(r.hasMore);
      },
      (e) => toast(e.message),
    );
  useEffect(() => void load(), []);

  if (!usage) return null;
  const pct = Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100);
  return (
    <>
      <h3 className="subhead">Meus arquivos</h3>
      <div className="quota">
        <div className="quota-bar" aria-hidden>
          <div className={pct > 85 ? 'warn' : ''} style={{ width: `${Math.max(pct, usage.usedBytes ? 1 : 0)}%` }} />
        </div>
        <p className="muted small">
          {formatBytes(usage.usedBytes)} de {formatBytes(usage.quotaBytes)} usados · {usage.files} arquivo{usage.files === 1 ? '' : 's'}. Fotos e vídeos são
          enviados sem a localização (GPS) e só abrem para quem está na conversa.
        </p>
      </div>
      {usage.files > 0 && (
        <button className="link-btn small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Esconder arquivos' : 'Ver e apagar arquivos enviados'}
        </button>
      )}
      {open && (
        <>
          <ul className="my-files">
            {files.map((f) => (
              <li key={f.id}>
                {f.kind === 'image' ? (
                  <img className="mf-thumb" src={f.url} alt="" loading="lazy" />
                ) : (
                  <span className="mf-thumb">
                    <FileIcon name={f.name} />
                  </span>
                )}
                <span className="mf-info">
                  <span className="mf-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="muted small">
                    {formatBytes(f.size)} · {f.guildName ? `${f.guildName} #${f.channelName}` : 'Mensagem direta'} ·{' '}
                    {new Date(f.createdAt).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <button
                  className="icon-btn danger"
                  aria-label={`Apagar ${f.name}`}
                  title="Apagar (some da conversa para todos)"
                  onClick={async () => {
                    if (!confirm(`Apagar "${f.name}"? Ele some da conversa para todo mundo.`)) return;
                    try {
                      const r = await api<{ usage: Usage }>(`/me/files/${f.id}`, { method: 'DELETE' });
                      setUsage(r.usage);
                      setFiles((list) => list.filter((x) => x.id !== f.id));
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          {more && (
            <button className="link-btn small" onClick={() => void load(files[files.length - 1]?.id)}>
              Carregar mais
            </button>
          )}
        </>
      )}
    </>
  );
}
