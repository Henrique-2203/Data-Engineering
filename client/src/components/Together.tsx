import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ListPlus, Maximize2, Minimize2, Pause, Play, SkipForward, Trash2, Tv, Volume2, VolumeX, X } from 'lucide-react';
import type { TogetherState } from '../../../shared/types';
import { parseEmbedUrl } from '../../../shared/embedUrl';
import { findMember, toast, useApp } from '../store/app';
import { useVoice } from '../store/voice';
import { together } from '../voice/together';
import { loadEmbed } from './chat/LinkEmbed';

const YT_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * Controla o player oficial do YouTube por mensagens (o mesmo protocolo que a biblioteca do YouTube
 * usa por dentro). Assim nenhum script do Google roda dentro do Resenha: o player fica isolado no
 * iframe dele.
 */
class YtController {
  time = 0;
  duration = 0;
  /** -1 não começou, 0 acabou, 1 tocando, 2 pausado, 3 carregando, 5 pronto */
  state = -1;
  ready = false;
  private onMsg = (e: MessageEvent) => {
    if (e.origin !== YT_ORIGIN || e.source !== this.frame.contentWindow) return;
    let d: { event?: string; info?: unknown };
    try {
      d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (d.event === 'onReady' || d.event === 'initialDelivery') this.ready = true;
    if (d.event === 'onStateChange' && typeof d.info === 'number') this.state = d.info;
    if (d.event === 'infoDelivery' && d.info && typeof d.info === 'object') {
      const i = d.info as { currentTime?: number; playerState?: number; duration?: number };
      if (typeof i.currentTime === 'number') this.time = i.currentTime;
      if (typeof i.playerState === 'number') this.state = i.playerState;
      if (typeof i.duration === 'number' && i.duration > 0) this.duration = i.duration;
      this.ready = true;
    }
    this.onChange?.();
  };
  onChange?: () => void;
  constructor(private frame: HTMLIFrameElement) {
    window.addEventListener('message', this.onMsg);
  }
  /** pede para o player mandar eventos (repete até ele responder) */
  listen() {
    this.frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'resenha', channel: 'widget' }), YT_ORIGIN);
  }
  cmd(func: string, args: unknown[] = []) {
    this.frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 'resenha', channel: 'widget' }), YT_ORIGIN);
  }
  destroy() {
    window.removeEventListener('message', this.onMsg);
  }
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** Quadro do "Assistir juntos" na call (fica em destaque quando um vídeo começa). */
export function TogetherTile({ big }: { big?: boolean }) {
  const state = useVoice((s) => s.together)!;
  const focus = useVoice((s) => s.focus);
  const frame = useRef<HTMLIFrameElement>(null);
  const ctl = useRef<YtController | null>(null);
  // o primeiro vídeo vai no endereço do iframe; os próximos entram por loadVideoById (sem recarregar)
  const loaded = useRef<string | null>(state.videoId);
  const [src] = useState(
    () =>
      `${YT_ORIGIN}/embed/${state.videoId}?enablejsapi=1&controls=0&rel=0&playsinline=1&autoplay=1&disablekb=1&iv_load_policy=3&start=${Math.floor(together.expected(state))}&origin=${encodeURIComponent(location.origin)}`,
  );
  const [, redraw] = useState(0);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('resenha.togetherVolume') ?? 80));
  const [muted, setMuted] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const stateRef = useRef<TogetherState>(state);
  stateRef.current = state;
  const by = useApp(() => {
    const g = useVoice.getState().guildId;
    return findMember(g, state.by)?.displayName ?? 'alguém';
  });

  // monta o controlador uma vez por iframe
  useEffect(() => {
    if (!frame.current) return;
    const c = new YtController(frame.current);
    ctl.current = c;
    c.onChange = () => redraw((n) => n + 1);
    const hello = setInterval(() => !c.ready && c.listen(), 500);
    return () => {
      clearInterval(hello);
      c.destroy();
      ctl.current = null;
    };
  }, []);

  // sincronia: a cada segundo confere vídeo, play/pause e posição
  useEffect(() => {
    const t = setInterval(() => {
      const c = ctl.current;
      const s = stateRef.current;
      if (!c?.ready || !s) return;
      const want = together.expected(s);
      if (loaded.current !== s.videoId) {
        loaded.current = s.videoId;
        c.cmd('loadVideoById', [{ videoId: s.videoId, startSeconds: Math.floor(want) }]);
        return;
      }
      if (c.state === 0 && s.playing) {
        together.ended(s.videoId);
        return;
      }
      if (s.playing && c.state !== 1 && c.state !== 3) c.cmd('playVideo');
      if (!s.playing && c.state === 1) c.cmd('pauseVideo');
      // fora de sincronia por mais de 2 s: corrige
      if (c.state !== 3 && Math.abs(c.time - want) > 2) c.cmd('seekTo', [want, true]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // volume só aqui (não muda para os outros)
  useEffect(() => {
    const c = ctl.current;
    if (!c?.ready) return;
    c.cmd('setVolume', [volume]);
    c.cmd(muted ? 'mute' : 'unMute');
    try {
      localStorage.setItem('resenha.togetherVolume', String(volume));
    } catch {
      /* sem armazenamento */
    }
  }, [volume, muted, ctl.current?.ready]);

  const c = ctl.current;
  const now = together.expected(state);
  const duration = c?.duration ?? 0;

  return (
    <div className={`tile together${big ? ' big' : ''}`}>
      <iframe
        ref={frame}
        title={state.title ?? 'YouTube'}
        src={src}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="together-top">
        <span className="together-badge">
          <Tv size={13} /> Assistindo juntos
        </span>
        <span className="ellipsis together-title">{state.title ?? 'Vídeo do YouTube'}</span>
        <span className="muted small ellipsis">por {by}</span>
        <span className="together-top-actions">
          <button
            className="icon-btn overlay"
            aria-label={focus === 'together' ? 'Tirar do destaque' : 'Destacar'}
            title={focus === 'together' ? 'Tirar do destaque' : 'Destacar'}
            onClick={() => useVoice.setState({ focus: focus === 'together' ? null : 'together' })}
          >
            {focus === 'together' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button className="icon-btn overlay" aria-label="Parar para todos" title="Parar para todos" onClick={() => together.stop()}>
            <X size={15} />
          </button>
        </span>
      </div>
      <div className="together-controls">
        <button
          className="icon-btn overlay"
          aria-label={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
          title={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
          onClick={() => (state.playing ? together.pause(now) : together.resume(now))}
        >
          {state.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="small together-time">
          {fmt(now)}
          {duration ? ` / ${fmt(duration)}` : ''}
        </span>
        <input
          type="range"
          className="together-seek"
          min={0}
          max={Math.max(1, Math.floor(duration || now + 1))}
          value={Math.floor(now)}
          aria-label="Posição do vídeo (para todos)"
          onChange={(e) => together.seek(Number(e.target.value))}
        />
        <button className="icon-btn overlay" aria-label="Próximo da fila" title="Próximo da fila" disabled={!state.queue.length} onClick={() => together.next()}>
          <SkipForward size={16} />
        </button>
        <button className="icon-btn overlay" aria-label="Fila" title="Fila e adicionar vídeos" aria-expanded={showQueue} onClick={() => setShowQueue((v) => !v)}>
          <ListPlus size={16} />
          {state.queue.length > 0 && <span className="together-count">{state.queue.length}</span>}
        </button>
        <button className="icon-btn overlay" aria-label={muted ? 'Ativar o som (só para você)' : 'Silenciar (só para você)'} onClick={() => setMuted((m) => !m)}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          className="together-volume"
          min={0}
          max={100}
          value={volume}
          aria-label="Volume do vídeo (só para você)"
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
      {showQueue && <TogetherQueue state={state} />}
    </div>
  );
}

function TogetherQueue({ state }: { state: TogetherState }) {
  const guildId = useVoice((s) => s.guildId);
  return (
    <div className="together-queue">
      <AddVideo compact />
      {state.queue.length === 0 ? (
        <p className="muted small">A fila está vazia. Cole um link acima para tocar depois deste.</p>
      ) : (
        <ol>
          {state.queue.map((q, i) => (
            <li key={`${q.videoId}-${i}`}>
              <span className="ellipsis">{q.title ?? q.videoId}</span>
              <span className="muted small">{findMember(guildId, q.by)?.displayName ?? ''}</span>
              <button className="icon-btn small" aria-label={`Tirar da fila: ${q.title ?? q.videoId}`} onClick={() => together.remove(i)}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Campo "cole um link do YouTube": toca agora (ou entra na fila se já tiver vídeo). */
export function AddVideo({ compact, onDone }: { compact?: boolean; onDone?(): void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useVoice((s) => s.together);
  async function submit(e: FormEvent, now = false) {
    e.preventDefault();
    const p = parseEmbedUrl(url.trim());
    if (!p || p.provider !== 'youtube') return toast('Cole um link de vídeo do YouTube.');
    setBusy(true);
    const embed = await loadEmbed(url.trim());
    setBusy(false);
    if (now || !current) together.play(p.id, embed?.title ?? null, p.start ?? 0);
    else together.enqueue(p.id, embed?.title ?? null);
    setUrl('');
    onDone?.();
  }
  return (
    <form className={`together-add${compact ? ' compact' : ''}`} onSubmit={(e) => void submit(e)}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Cole um link do YouTube" aria-label="Link do YouTube" autoFocus={!compact} />
      {current ? (
        <>
          <button className="btn small" disabled={busy || !url.trim()}>
            Adicionar à fila
          </button>
          <button type="button" className="btn small ghost" disabled={busy || !url.trim()} onClick={(e) => void submit(e, true)}>
            Tocar agora
          </button>
        </>
      ) : (
        <button className="btn small primary" disabled={busy || !url.trim()}>
          Assistir juntos
        </button>
      )}
    </form>
  );
}

/** Botão na barra da call: abre o campo para colar o link. */
export function TogetherButton() {
  const [open, setOpen] = useState(false);
  const active = useVoice((s) => !!s.together);
  return (
    <div className="together-btn-wrap">
      <button
        className={`round-btn${active ? ' on' : ''}`}
        aria-label="Assistir juntos (YouTube)"
        title="Assistir juntos: um vídeo do YouTube para todo mundo da call"
        onClick={() => setOpen((v) => !v)}
      >
        <Tv />
      </button>
      {open && (
        <div className="together-pop" role="dialog" aria-label="Assistir juntos">
          <strong>Assistir juntos</strong>
          <p className="muted small">Todo mundo da call vê o mesmo vídeo do YouTube, sincronizado. Qualquer um pode pausar, pular e pôr na fila.</p>
          <AddVideo onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
