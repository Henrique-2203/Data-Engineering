import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Captions, CaptionsOff, ListPlus, Maximize2, Minimize2, Pause, Play, Settings, SkipForward, Square, Trash2, Tv, Volume2, VolumeX, X } from 'lucide-react';
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

const pref = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const savePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento */
  }
};

/** Quadro do "Assistir juntos" na call (fica em destaque quando um vídeo começa). */
export function TogetherTile({ big }: { big?: boolean }) {
  const state = useVoice((s) => s.together)!;
  const focus = useVoice((s) => s.focus);
  const frame = useRef<HTMLIFrameElement>(null);
  const ctl = useRef<YtController | null>(null);
  // controles do YouTube (qualidade, legendas, idioma): escolha de cada um, recarrega o player
  const [native, setNative] = useState(() => pref('resenha.togetherYtControls') === '1');
  // legendas: escolha de cada um (null = o padrão do YouTube)
  const [captions, setCaptions] = useState<boolean | null>(() => {
    const v = pref('resenha.togetherCaptions');
    return v === '1' ? true : v === '0' ? false : null;
  });
  // o primeiro vídeo vai no endereço do iframe; os próximos entram por loadVideoById (sem recarregar)
  const loaded = useRef<string | null>(state.videoId);
  const src = useMemo(() => {
    loaded.current = stateNow().videoId;
    const s = stateNow();
    const cc = captions === null ? '' : `&cc_load_policy=${captions ? 1 : 0}`;
    return `${YT_ORIGIN}/embed/${s.videoId}?enablejsapi=1&controls=${native ? 1 : 0}&rel=0&playsinline=1&autoplay=1&disablekb=${native ? 0 : 1}&iv_load_policy=3&hl=pt-BR&cc_lang_pref=pt${cc}&start=${Math.floor(together.expected(s))}&origin=${encodeURIComponent(location.origin)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);
  const [, redraw] = useState(0);
  const [volume, setVolume] = useState(() => Number(pref('resenha.togetherVolume') ?? 80));
  const [muted, setMuted] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  // barras somem sozinhas depois de 3 s sem mexer o mouse (continuam com o vídeo pausado)
  const [awake, setAwake] = useState(true);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setAwake(true);
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => setAwake(false), 3000);
  };
  useEffect(() => {
    wake();
    return () => {
      if (sleepTimer.current) clearTimeout(sleepTimer.current);
    };
  }, []);
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
  }, [native]);

  // sincronia: a cada segundo confere vídeo, play/pause e posição
  const cmdAt = useRef(0);
  const last = useRef<{ time: number; at: number; state: number } | null>(null);
  // quando chegou a última mudança dos outros (o meu player ainda está indo atrás dela)
  const sharedAt = useRef(0);
  useEffect(() => {
    sharedAt.current = Date.now();
  }, [state.at, state.playing, state.videoId]);
  useEffect(() => {
    const t = setInterval(() => {
      const c = ctl.current;
      const s = stateRef.current;
      if (!c?.ready || !s) return;
      const now = Date.now();
      const cmd = (func: string, args?: unknown[]) => {
        cmdAt.current = now;
        c.cmd(func, args);
      };
      const want = together.expected(s);
      if (loaded.current !== s.videoId) {
        loaded.current = s.videoId;
        last.current = null;
        cmd('loadVideoById', [{ videoId: s.videoId, startSeconds: Math.floor(want) }]);
        return;
      }
      const prev = last.current;
      last.current = { time: c.time, at: now, state: c.state };
      if (c.state === 0 && s.playing) {
        together.ended(s.videoId, c.time, c.duration);
        return;
      }
      // alguém mexeu pelo próprio player (controles do YouTube, teclas de mídia): vale para todos.
      // Só com leituras seguidas e a tela visível: um PC que dormiu e acordou não puxa os outros.
      const quiet =
        now - cmdAt.current > 2500 && now - sharedAt.current > 2500 && !!prev && now - prev.at < 2500 && document.visibilityState === 'visible';
      // só quando o MEU player mudou de estado sozinho (não quando está indo atrás de uma mudança dos outros)
      if (quiet && s.playing && c.state === 2 && prev.state === 1) {
        cmdAt.current = now;
        together.pause(c.time);
        return;
      }
      if (quiet && !s.playing && c.state === 1 && prev.state === 2) {
        cmdAt.current = now;
        together.resume(c.time);
        return;
      }
      // pulou pela barra do YouTube: o tempo andou bem diferente do relógio
      if (native && quiet && c.state === 1 && prev.state === 1 && Math.abs(c.time - prev.time - (now - prev.at) / 1000) > 3 && Math.abs(c.time - want) > 3) {
        cmdAt.current = now;
        together.seek(c.time);
        return;
      }
      if (s.playing && c.state !== 1 && c.state !== 3) cmd('playVideo');
      if (!s.playing && c.state === 1) cmd('pauseVideo');
      // fora de sincronia por mais de 2 s: corrige
      if (c.state !== 3 && Math.abs(c.time - want) > 2) cmd('seekTo', [want, true]);
    }, 1000);
    return () => clearInterval(t);
  }, [native]);

  // volume e legendas só aqui (não mudam para os outros)
  const ready = !!ctl.current?.ready;
  useEffect(() => {
    const c = ctl.current;
    if (!c?.ready) return;
    c.cmd('setVolume', [volume]);
    c.cmd(muted ? 'mute' : 'unMute');
    savePref('resenha.togetherVolume', String(volume));
  }, [volume, muted, ready]);
  useEffect(() => {
    const c = ctl.current;
    if (!c?.ready || captions === null) return;
    if (captions) {
      c.cmd('loadModule', ['captions']);
      c.cmd('setOption', ['captions', 'reload', true]);
    } else c.cmd('unloadModule', ['captions']);
  }, [captions, ready, state.videoId]);

  const c = ctl.current;
  const now = together.expected(state);
  const duration = c?.duration ?? 0;
  // com os controles do YouTube a faixa fica fora do vídeo: não precisa sumir
  const showBars = native || awake || !state.playing || showQueue;

  const toggleNative = () => {
    savePref('resenha.togetherYtControls', native ? '0' : '1');
    setNative((v) => !v);
  };
  const toggleCaptions = () => {
    const next = !(captions ?? false);
    savePref('resenha.togetherCaptions', next ? '1' : '0');
    setCaptions(next);
  };
  const ytBtn = (
    <button
      className={`icon-btn overlay${native ? ' active' : ''}`}
      aria-label={native ? 'Usar os controles do Resenha' : 'Qualidade e legendas (controles do YouTube)'}
      aria-pressed={native}
      title={
        native
          ? 'Voltar para os controles do Resenha'
          : 'Qualidade, legendas e idioma pelo menu ⚙ do YouTube (só para você). Pausar e pular por ele vale para todos.'
      }
      onClick={toggleNative}
    >
      <Settings size={15} />
    </button>
  );
  const stopBtn = (
    <button className="icon-btn overlay" aria-label="Parar para todos" title="Parar o vídeo para todo mundo da call" onClick={() => together.stop()}>
      <Square size={14} />
    </button>
  );
  const queueBtn = (
    <button className="icon-btn overlay" aria-label="Fila" title="Fila e adicionar vídeos" aria-expanded={showQueue} onClick={() => setShowQueue((v) => !v)}>
      <ListPlus size={16} />
      {state.queue.length > 0 && <span className="together-count">{state.queue.length}</span>}
    </button>
  );
  const nextBtn = (
    <button className="icon-btn overlay" aria-label="Próximo da fila" title="Próximo da fila" disabled={!state.queue.length} onClick={() => together.next()}>
      <SkipForward size={16} />
    </button>
  );

  return (
    <div
      className={`tile together${big ? ' big' : ''}${native ? ' native' : ''}${showBars ? '' : ' bars-hidden'}`}
      onMouseMove={wake}
      onMouseEnter={wake}
      onTouchStart={wake}
      onFocus={wake}
    >
      <iframe
        key={native ? 'yt' : 'resenha'}
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
          {native && (
            <>
              {nextBtn}
              {queueBtn}
              {stopBtn}
            </>
          )}
          {ytBtn}
          <button
            className="icon-btn overlay"
            aria-label={focus === 'together' ? 'Tirar do destaque' : 'Destacar'}
            title={focus === 'together' ? 'Tirar do destaque' : 'Destacar'}
            onClick={() => useVoice.setState({ focus: focus === 'together' ? null : 'together' })}
          >
            {focus === 'together' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            className="icon-btn overlay"
            aria-label="Fechar só para mim"
            title="Fechar só para mim (o vídeo continua para os outros; dá para voltar pelo botão da TV)"
            onClick={() => together.hide()}
          >
            <X size={15} />
          </button>
        </span>
      </div>
      {!native && (
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
          {nextBtn}
          {queueBtn}
          {stopBtn}
          <button
            className={`icon-btn overlay${captions ? ' active' : ''}`}
            aria-label={captions ? 'Desligar legendas (só para você)' : 'Ligar legendas (só para você)'}
            aria-pressed={!!captions}
            title={captions ? 'Desligar legendas (só para você)' : 'Ligar legendas (só para você)'}
            onClick={toggleCaptions}
          >
            {captions ? <Captions size={16} /> : <CaptionsOff size={16} />}
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
      )}
      {showQueue && <TogetherQueue state={state} />}
    </div>
  );
}

const stateNow = () => useVoice.getState().together!;

/** Fechou o vídeo só para si: um aviso na call para voltar a assistir. */
export function TogetherHiddenChip() {
  const t = useVoice((s) => (s.togetherHidden ? s.together : null));
  if (!t) return null;
  return (
    <div className="together-hidden-chip" role="status">
      <Tv size={14} />
      <span className="ellipsis">
        Assistindo juntos: <strong>{t.title ?? 'vídeo do YouTube'}</strong>
      </span>
      <button className="btn small" onClick={() => together.show()}>
        Voltar a assistir
      </button>
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
  const hidden = useVoice((s) => !!s.together && s.togetherHidden);
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
          {hidden && (
            <button
              className="btn small primary"
              onClick={() => {
                together.show();
                setOpen(false);
              }}
            >
              Voltar a assistir
            </button>
          )}
          <AddVideo onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
