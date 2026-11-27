import { useState } from 'react';
import { Download, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, ShieldAlert } from 'lucide-react';
import type { Attachment } from '../../../../shared/types';
import { attachmentUrl, formatBytes, refreshAttachmentUrl, refreshedUrl } from '../../lib/upload';
import { openModal, toast } from '../../store/app';

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
const ARCHIVE = /^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/;
/** documentos do Office com macros: o golpe clássico de "abre essa planilha" */
const MACRO = /^(docm|xlsm|pptm|xlam|dotm)$/;

export function FileIcon({ name, size = 20 }: { name: string; size?: number }) {
  const e = ext(name);
  if (ARCHIVE.test(e)) return <FileArchive size={size} />;
  if (/^(mp3|ogg|wav|flac|m4a|opus|aac)$/.test(e)) return <FileAudio size={size} />;
  if (/^(mp4|mov|webm|mkv|avi)$/.test(e)) return <FileVideo size={size} />;
  if (/^(png|jpe?g|gif|webp|avif|heic|svg|bmp)$/.test(e)) return <FileImage size={size} />;
  if (/^(xlsx?|xlsm|csv|ods)$/.test(e)) return <FileSpreadsheet size={size} />;
  if (/^(pdf|docx?|docm|txt|md|odt|rtf|pptx?)$/.test(e)) return <FileText size={size} />;
  return <File size={size} />;
}

/**
 * Link do anexo que se renova sozinho: o link assinado vale de 12 a 24 h; se a aba ficou aberta
 * mais que isso, ao falhar pede um novo ao servidor (que confere se você ainda tem acesso).
 */
function useAttachmentSrc(a: Attachment) {
  const [src, setSrc] = useState(() => refreshedUrl(a.id) ?? attachmentUrl(a));
  const [tried, setTried] = useState(false);
  const onError = () => {
    if (tried) return;
    setTried(true);
    void refreshAttachmentUrl(a.id).then((u) => u && setSrc(u));
  };
  return [src, onError] as const;
}

async function download(a: Attachment) {
  // pede sempre um link novo: o da mensagem pode ter expirado
  const url = (await refreshAttachmentUrl(a.id)) ?? attachmentUrl(a);
  if (!url) return toast('Não foi possível baixar o arquivo.');
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function ImageItem({ a }: { a: Attachment }) {
  const [src, onError] = useAttachmentSrc(a);
  return (
    <button
      className="attachment"
      onClick={() => openModal({ kind: 'image', src, name: a.name })}
      aria-label={`Ampliar ${a.name}`}
      style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
    >
      <img src={src} alt={a.name} loading="lazy" width={a.width ?? undefined} height={a.height ?? undefined} onError={onError} />
    </button>
  );
}

function VideoItem({ a }: { a: Attachment }) {
  const [src, onError] = useAttachmentSrc(a);
  return (
    <div className="att-video" style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}>
      <video src={src} controls preload="metadata" playsInline onError={onError} aria-label={a.name} />
    </div>
  );
}

function FileCard({ a }: { a: Attachment }) {
  const e = ext(a.name);
  const risky = ARCHIVE.test(e) || MACRO.test(e);
  const [src, onError] = useAttachmentSrc(a);
  return (
    <div className={`att-file${a.kind === 'audio' ? ' audio' : ''}`}>
      <div className="att-file-row">
        <span className="att-file-icon">
          <FileIcon name={a.name} size={28} />
        </span>
        <span className="att-file-info">
          <button className="att-file-name link-btn" onClick={() => void download(a)} title={`Baixar ${a.name}`}>
            {a.name}
          </button>
          <span className="muted small">{formatBytes(a.size)}</span>
        </span>
        <button className="icon-btn" aria-label={`Baixar ${a.name}`} title="Baixar" onClick={() => void download(a)}>
          <Download size={18} />
        </button>
      </div>
      {a.kind === 'audio' && <audio src={src} controls preload="none" onError={onError} aria-label={a.name} />}
      {risky && (
        <p className="att-warn">
          <ShieldAlert size={14} /> {MACRO.test(e) ? 'Documento com macros: só abra se confiar em quem enviou.' : 'Arquivo compactado: só abra o que tem dentro se confiar em quem enviou.'}
        </p>
      )}
    </div>
  );
}

/** Anexos de uma mensagem: fotos em grade, vídeos com player, áudios e arquivos em cartões. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => (a.kind ?? 'image') === 'image');
  const videos = attachments.filter((a) => a.kind === 'video');
  const others = attachments.filter((a) => a.kind === 'audio' || a.kind === 'file');
  return (
    <>
      {images.length > 0 && (
        <div className={`attachments count-${Math.min(images.length, 4)}`}>
          {images.map((a) => (
            <ImageItem key={a.id} a={a} />
          ))}
        </div>
      )}
      {videos.map((a) => (
        <VideoItem key={a.id} a={a} />
      ))}
      {others.map((a) => (
        <FileCard key={a.id} a={a} />
      ))}
    </>
  );
}
