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

  // ---------- sincronia ----------
  // O que o MEU player fez sem eu (o Resenha) pedir = a pessoa mexeu nele: pausou, tocou ou pulou pela
  // barra/teclas do YouTube ou clicando no vídeo. Isso vale para todos NA HORA. O que o Resenha pediu
  // (seguindo os outros ou corrigindo a posição) não conta. E enquanto o servidor confirma, o meu player
  // segue a MINHA ação: antes, a correção automática desfazia o pause e puxava o pulo de volta.
  const mine = useRef({ play: Date.now(), seek: Date.now() }); // quando o Resenha pediu play/pause e seek/load
  const loadAt = useRef(Date.now()); // player (re)carregando: espera ele se acertar antes de ler ações
  const intent = useRef<{ playing: boolean; position: number; at: number } | null>(null);
  const sample = useRef<{ time: number; at: number; state: number } | null>(null);
  const sharedAt = useRef(0);
  /** o que o meu player deve fazer agora: a minha ação ainda não confirmada, ou o estado de todos */
  const target = (s: TogetherState) => {
    const i = intent.current;
    if (i && Date.now() - i.at < 4000) return { playing: i.playing, want: i.playing ? i.position + (Date.now() - i.at) / 1000 : i.position };
    intent.current = null;
    return { playing: s.playing, want: together.expected(s) };
  };
  /** pausar, tocar ou pular para todos (pelos botões do Resenha ou pelo próprio player) */
  const act = (kind: 'pause' | 'resume' | 'seek', position: number) => {
    const cur = target(stateRef.current);
    intent.current = { playing: kind === 'pause' ? false : kind === 'resume' ? true : cur.playing, position, at: Date.now() };
    if (kind === 'pause') together.pause(position);
    else if (kind === 'resume') together.resume(position);
    else together.seek(position);
  };
  useEffect(() => {
    sharedAt.current = Date.now();
    // o servidor confirmou a minha ação: volta a seguir o estado de todos
    const i = intent.current;
    if (i && i.playing === state.playing) {
      const mineNow = i.playing ? i.position + (Date.now() - i.at) / 1000 : i.position;
      if (Math.abs(together.expected(state) - mineNow) < 3) intent.current = null;
    }
  }, [state.at, state.playing, state.videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // monta o controlador uma vez por iframe; cada mensagem do player passa por observe()
  useEffect(() => {
    if (!frame.current) return;
    const c = new YtController(frame.current);
    ctl.current = c;
    loadAt.current = Date.now();
    sample.current = null;
    const observe = () => {
      const s = stateRef.current;
      if (!c.ready || !s) return;
      const now = Date.now();
      const prev = sample.current;
      sample.current = { time: c.time, at: now, state: c.state };
      // só com leituras seguidas, o vídeo certo e a tela visível (um PC que dormiu não puxa os outros)
      if (!prev || loaded.current !== s.videoId || document.visibilityState !== 'visible') return;
      if (now - loadAt.current < 4000) return;
      const t = target(s);
      if (now - mine.current.play > 1200) {
        if (c.state === 2 && prev.state !== 2 && t.playing) return act('pause', c.time);
        if (c.state === 1 && prev.state !== 1 && !t.playing) return act('resume', c.time);
      }
      // pulo: o tempo andou bem diferente do relógio (vale mesmo passando por "carregando")
      if (now - mine.current.seek > 2500) {
        const expectedLocal = prev.state === 1 ? prev.time + (now - prev.at) / 1000 : prev.time;
        if (Math.abs(c.time - expectedLocal) > 2 && Math.abs(c.time - t.want) > 2) return act('seek', c.time);
      }
    };
    c.onChange = () => {
      observe();
      redraw((n) => n + 1);
    };
    const hello = setInterval(() => !c.ready && c.listen(), 500);
    return () => {
      clearInterval(hello);
      c.destroy();
      ctl.current = null;
    };
  }, [native]); // eslint-disable-line react-hooks/exhaustive-deps

  // a cada segundo: confere vídeo, play/pause e posição (seguindo os outros ou a minha última ação)
  useEffect(() => {
    const t = setInterval(() => {
      const c = ctl.current;
      const s = stateRef.current;
      if (!c?.ready || !s) return;
      const now = Date.now();
      if (loaded.current !== s.videoId) {
        loaded.current = s.videoId;
        sample.current = null;
        intent.current = null;
        loadAt.current = now;
        mine.current = { play: now, seek: now };
        c.cmd('loadVideoById', [{ videoId: s.videoId, startSeconds: Math.floor(together.expected(s)) }]);
        return;
      }
      if (c.state === 0 && s.playing) {
        together.ended(s.videoId, c.time, c.duration);
        return;
      }
      const tg = target(s);
      if (tg.playing && c.state !== 1 && c.state !== 3) {
        mine.current.play = now;
        c.cmd('playVideo');
      }
      if (!tg.playing && c.state === 1) {
        mine.current.play = now;
        c.cmd('pauseVideo');
      }
      // fora de sincronia por mais de 2 s: corrige
      if (c.state !== 3 && Math.abs(c.time - tg.want) > 2) {
        mine.current.seek = now;
        c.cmd('seekTo', [tg.want, true]);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [native]); // eslint-disable-line react-hooks/exhaustive-deps

  // barra de tempo do Resenha: mostra onde a pessoa está arrastando e só manda o pulo quando ela solta
  const [drag, setDrag] = useState<number | null>(null);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragTo = (v: number) => {
    setDrag(v);
    if (dragTimer.current) clearTimeout(dragTimer.current);
    dragTimer.current = setTimeout(() => {
      act('seek', v);
      setDrag(null);
    }, 350);
  };

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
  // o que mostrar: a minha ação ainda não confirmada, ou o estado de todos
  const view = target(state);
  const now = view.want;
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
            aria-label={view.playing ? 'Pausar para todos' : 'Tocar para todos'}
            title={view.playing ? 'Pausar para todos' : 'Tocar para todos'}
            onClick={() => (view.playing ? act('pause', now) : act('resume', now))}
          >
            {view.playing ? <Pause size={16} /> : <Play size={16} />}
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
            value={Math.floor(drag ?? now)}
            aria-label="Posição do vídeo (para todos)"
            onChange={(e) => dragTo(Number(e.target.value))}
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
