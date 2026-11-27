import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { closeModal } from '../store/app';

/**
 * Ver uma imagem do chat em tela cheia, com zoom e arrastar:
 * - rodinha do mouse (ou pinça no touchpad/celular) aproxima onde o cursor está
 * - duplo clique/toque alterna entre caber na tela e 2,5x
 * - arrastar com o mouse ou o dedo move a imagem quando ela está maior que a tela
 * - botões − / + / "Caber na tela", teclas + − 0 e Esc
 */
const MIN = 1;
const MAX = 8;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function ImageViewer({ src, name }: { src: string; name: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; s: number; mid: { x: number; y: number }; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  /** não deixa a imagem sair da tela: só anda o quanto ela passa da borda */
  const limit = useCallback((s: number, x: number, y: number) => {
    const el = img.current;
    const st = stage.current;
    if (!el || !st) return { s, x, y };
    const w = el.offsetWidth * s;
    const h = el.offsetHeight * s;
    const mx = Math.max(0, (w - st.clientWidth) / 2);
    const my = Math.max(0, (h - st.clientHeight) / 2);
    return { s, x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
  }, []);

  /** zoom mantendo parado o ponto (px, py) da tela (relativo ao centro) */
  const zoomAt = useCallback(
    (next: number, px = 0, py = 0) => {
      const v = viewRef.current;
      const s = clamp(next, MIN, MAX);
      const k = s / v.s;
      setView(s === 1 ? { s: 1, x: 0, y: 0 } : limit(s, px - (px - v.x) * k, py - (py - v.y) * k));
    },
    [limit],
  );
  const fromCenter = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
      else if (e.key === '+' || e.key === '=') zoomAt(viewRef.current.s * 1.4);
      else if (e.key === '-') zoomAt(viewRef.current.s / 1.4);
      else if (e.key === '0') setView({ s: 1, x: 0, y: 0 });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [zoomAt]);

  const onWheel = (e: RWheelEvent) => {
    const p = fromCenter(e.clientX, e.clientY);
    // pinça no touchpad chega como ctrl + rodinha, com passos pequenos
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    zoomAt(viewRef.current.s * factor, p.x, p.y);
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length === 2) {
      const mid = fromCenter((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      gesture.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), s: v.s, mid, x: v.x, y: v.y };
    } else {
      gesture.current = { dist: 0, s: v.s, mid: { x: e.clientX, y: e.clientY }, x: v.x, y: v.y };
      setDragging(v.s > 1);
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2 && g.dist) {
      // pinça com dois dedos
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const s = clamp((g.s * dist) / g.dist, MIN, MAX);
      const k = s / g.s;
      moved.current = true;
      setView(s === 1 ? { s: 1, x: 0, y: 0 } : limit(s, g.mid.x - (g.mid.x - g.x) * k, g.mid.y - (g.mid.y - g.y) * k));
    } else if (pts.length === 1 && viewRef.current.s > 1) {
      const dx = e.clientX - g.mid.x;
      const dy = e.clientY - g.mid.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
      setView(limit(viewRef.current.s, g.x + dx, g.y + dy));
    } else if (pts.length === 1 && Math.abs(e.clientX - g.mid.x) + Math.abs(e.clientY - g.mid.y) > 6) moved.current = true;
  };
  const onPointerUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    setDragging(false);
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    // sobrou um dedo depois da pinça: continua arrastando a partir dele
    gesture.current = pts.length === 1 ? { dist: 0, s: v.s, mid: pts[0], x: v.x, y: v.y } : null;
  };

  const lastTap = useRef(0);
  const onClickStage = (e: React.MouseEvent) => {
    if (moved.current) return;
    const now = Date.now();
    const p = fromCenter(e.clientX, e.clientY);
    if (now - lastTap.current < 300) {
      // duplo clique/toque: aproxima onde clicou (ou volta a caber na tela)
      lastTap.current = 0;
      if (viewRef.current.s > 1.05) setView({ s: 1, x: 0, y: 0 });
      else zoomAt(2.5, p.x, p.y);
      return;
    }
    lastTap.current = now;
    // clique fora da imagem (sem zoom) fecha
    if (e.target === e.currentTarget && viewRef.current.s === 1) {
      const t = now;
      setTimeout(() => lastTap.current === t && closeModal(), 300);
    }
  };

  const pct = Math.round(view.s * 100);
  return (
    <div className="lightbox viewer" role="dialog" aria-modal="true" aria-label={name}>
      <div
        ref={stage}
        className={`viewer-stage${view.s > 1 ? ' zoomed' : ''}${dragging ? ' dragging' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClickStage}
      >
        <img
          ref={img}
          src={src}
          alt={name}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          className={dragging || pointers.current.size > 1 ? '' : 'smooth'}
        />
      </div>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis viewer-name">{name}</span>
        <div className="viewer-zoom" role="group" aria-label="Zoom">
          <button className="icon-btn" aria-label="Diminuir" disabled={view.s <= MIN} onClick={() => zoomAt(view.s / 1.4)}>
            <Minus size={18} />
          </button>
          <span className="viewer-pct" aria-live="polite">
            {pct}%
          </span>
          <button className="icon-btn" aria-label="Aumentar" disabled={view.s >= MAX} onClick={() => zoomAt(view.s * 1.4)}>
            <Plus size={18} />
          </button>
          <button className="icon-btn" aria-label="Caber na tela" title="Caber na tela (0)" disabled={view.s === 1} onClick={() => setView({ s: 1, x: 0, y: 0 })}>
            <Maximize2 size={16} />
          </button>
        </div>
        <a href={src} target="_blank" rel="noopener noreferrer" className="btn small">
          Abrir original
        </a>
        <button className="icon-btn" aria-label="Fechar" onClick={closeModal}>
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
