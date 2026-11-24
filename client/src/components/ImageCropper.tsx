import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut } from 'lucide-react';

/**
 * Ajustar uma imagem antes de enviar (foto de perfil, banner, ícone e banner do servidor): arrastar para
 * escolher a parte que aparece e aproximar com a barra ou a rodinha. Aceita qualquer tamanho (1920×1080
 * também): o corte é feito aqui, no aparelho, e depois a imagem segue o caminho normal (reduzida em WebP).
 * Sugestões da comunidade: ajustar a posição da foto, e banner em 1920×1080.
 */
export interface CropOptions {
  /** largura ÷ altura do corte (1 = quadrado) */
  aspect: number;
  /** como a imagem aparece no app: círculo (foto), quadrado arredondado (ícone) ou faixa (banner) */
  shape: 'circle' | 'rounded' | 'rect';
  title: string;
  /** largura da imagem cortada (a altura sai do formato) */
  outWidth: number;
}
interface Job extends CropOptions {
  file: File;
  resolve(f: File | null): void;
}

let openJob: ((j: Job) => void) | null = null;

/** Abre a janela de ajuste; resolve com a imagem cortada (ou null se a pessoa cancelar). */
export function cropImage(file: File, o: CropOptions): Promise<File | null> {
  // GIF animado não é cortado aqui (perderia a animação): segue como está
  if (file.type === 'image/gif' || !openJob) return Promise.resolve(file);
  return new Promise((resolve) => openJob!({ ...o, file, resolve }));
}

export function ImageCropHost() {
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    openJob = setJob;
    return () => {
      openJob = null;
    };
  }, []);
  if (!job) return null;
  return createPortal(
    <Cropper
      key={job.file.name + job.file.size + job.file.lastModified}
      job={job}
      done={(f) => {
        job.resolve(f);
        setJob(null);
      }}
    />,
    document.body,
  );
}

const MAX_ZOOM = 4;

function Cropper({ job, done }: { job: Job; done(f: File | null): void }) {
  const [url] = useState(() => URL.createObjectURL(job.file));
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // o quadro: até 520 px de largura e 52% da altura da tela
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let fw = Math.min(520, vw - 64);
  let fh = fw / job.aspect;
  if (fh > vh * 0.52) {
    fh = vh * 0.52;
    fw = fh * job.aspect;
  }
  const base = nat ? Math.max(fw / nat.w, fh / nat.h) : 1;
  const k = base * view.z;
  const clampView = (z: number, x: number, y: number) => {
    if (!nat) return { z, x, y };
    const kk = base * z;
    const mx = Math.max(0, (nat.w * kk - fw) / 2);
    const my = Math.max(0, (nat.h * kk - fh) / 2);
    return { z, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };
  const setZoom = (z: number) => {
    const v = viewRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    setView(clampView(nz, v.x * (nz / v.z), v.y * (nz / v.z)));
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [done]);

  const down = (e: RPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView(clampView(viewRef.current.z, d.vx + e.clientX - d.x, d.vy + e.clientY - d.y));
  };
  const up = () => {
    drag.current = null;
  };

  async function apply() {
    if (!nat || !imgRef.current) return;
    setBusy(true);
    try {
      const left = fw / 2 - (nat.w * k) / 2 + view.x;
      const top = fh / 2 - (nat.h * k) / 2 + view.y;
      const outW = Math.round(Math.min(job.outWidth, nat.w / view.z));
      const outH = Math.round(outW / job.aspect);
      const c = document.createElement('canvas');
      c.width = outW;
      c.height = outH;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(imgRef.current, -left / k, -top / k, fw / k, fh / k, 0, 0, outW, outH);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Não foi possível preparar a imagem.');
      done(new File([blob], job.file.name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const radius = job.shape === 'circle' ? '50%' : job.shape === 'rounded' ? '22%' : '12px';
  return (
    <div className="modal-backdrop cropper-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="modal cropper" role="dialog" aria-modal="true" aria-label={job.title}>
        <div className="modal-head">
          <h2>{job.title}</h2>
        </div>
        <div className="modal-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            Arraste a imagem para escolher a parte que aparece. Use a barra (ou a rodinha do mouse) para aproximar.
          </p>
          <div className="cropper-stage" style={{ width: fw + 48, height: fh + 48 }}>
            <div
              className="cropper-frame"
              style={{ width: fw, height: fh, borderRadius: radius }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onWheel={(e) => setZoom(viewRef.current.z * Math.exp(-e.deltaY * 0.0015))}
              role="img"
              aria-label="Prévia do corte"
            >
              <img
                ref={imgRef}
                src={url}
                alt=""
                draggable={false}
                onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setError('Não foi possível abrir essa imagem.')}
                style={
                  nat
                    ? { width: nat.w * k, height: nat.h * k, left: fw / 2 - (nat.w * k) / 2 + view.x, top: fh / 2 - (nat.h * k) / 2 + view.y }
                    : { opacity: 0 }
                }
              />
            </div>
          </div>
          <label className="cropper-zoom">
            <ZoomOut size={18} aria-hidden />
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.z} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
            <ZoomIn size={18} aria-hidden />
          </label>
          {nat && (
            <p className="muted small">
              Sua imagem: {nat.w} × {nat.h}. Qualquer tamanho serve: o que fica fora do quadro é cortado.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => done(null)}>
              Cancelar
            </button>
            <button type="button" className="btn primary" disabled={!nat || busy} onClick={() => void apply()}>
              {busy ? 'Preparando…' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
