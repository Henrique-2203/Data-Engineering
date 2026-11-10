import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Maximize,
  Maximize2,
  Mic,
  Minimize2,
  PanelBottom,
  PanelRight,
  PictureInPicture2,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  MessageSquare,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { VoiceState } from '../../../shared/types';
import { channelMessages, findChannel, findMember, openModal, useApp } from '../store/app';

const channelMessagesLoaded = (id: string) => channelMessages(id).loaded;
import { SoundBurstBadge, SoundboardButton } from './Soundboard';
import { setStreamVolume, setUserVolume, updateSettings, useVoice } from '../store/voice';
import { voice, type CallSecurity } from '../voice/engine';
import { CODECS, canShareScreen, keyLabel, screenCodecFor, screenPresetFor } from '../voice/settings';
import { CallBannerBackground } from '../lib/callBanners';
import { CallReportButton } from './CallReport';
import { TogetherButton, TogetherTile } from './Together';
import { Perm, has, myPermissions } from '../lib/perms';
import type { SendStats } from '../voice/engine';
import { Avatar } from './Avatar';
import { MobileHeader } from './MobileHeader';
import { loadMessages } from './ChatView';
import { CallChatPanel } from './CallChat';

interface Tile {
  id: string; // `${socketId|me}:${user|screen}`
  kind: 'user' | 'screen';
  state: VoiceState;
  isMe: boolean;
}

/** `embedded`: versão compacta usada no topo de uma conversa direta durante a ligação. */
export function VoiceStage({ channelId, embedded = false }: { channelId: string; embedded?: boolean }) {
  const channel = useApp(() => findChannel(channelId));
  const voiceStates = useApp((s) => s.voiceStates);
  const mySocket = useApp((s) => s.socketId);
  const status = useVoice((s) => s.status);
  const myChannel = useVoice((s) => s.channelId);
  const focus = useVoice((s) => s.focus);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const maxPeers = useApp((s) => s.maxVoicePeers);
  const ringing = useApp((s) => s.outgoingRing === channelId);

  const participants = Object.values(voiceStates).filter((v) => v.channelId === channelId);
  const joined = myChannel === channelId && status !== 'idle';

  const tiles: Tile[] = [];
  for (const p of participants) {
    const isMe = p.socketId === mySocket;
    if (p.screen) tiles.push({ id: `${isMe ? 'me' : p.socketId}:screen`, kind: 'screen', state: p, isMe });
  }
  for (const p of participants) {
    const isMe = p.socketId === mySocket;
    tiles.push({ id: `${isMe ? 'me' : p.socketId}:user`, kind: 'user', state: p, isMe });
  }
  const focused = joined ? tiles.find((t) => t.id === focus) : undefined;
  const togetherOn = useVoice((s) => !!s.together) && joined;
  const togetherBig = togetherOn && focus === 'together';
  const side = useVoice((s) => s.settings.stageLayout === 'side');
  const mainPct = useVoice((s) => (s.settings.stageLayout === 'side' ? s.settings.stageSidePct : s.settings.stageMainPct));
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      return localStorage.getItem('resenha.callChat') === '1';
    } catch {
      return false;
    }
  });
  const toggleChat = () =>
    setChatOpen((v) => {
      try {
        localStorage.setItem('resenha.callChat', v ? '0' : '1');
      } catch {
        /* sem armazenamento local */
      }
      return !v;
    });
  // a busca/fixadas levam a uma mensagem do chat da call: abre o painel
  useEffect(() => {
    const open = () => setChatOpen(true);
    window.addEventListener('resenha:open-call-chat', open);
    return () => window.removeEventListener('resenha:open-call-chat', open);
  }, []);
  const stageRef = useRef<HTMLDivElement>(null);

  const stage = (
    <div className={`voice-stage${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <MobileHeader
          title={channel?.name ?? 'Voz'}
          icon={<Volume2 size={20} className="muted" />}
          actions={channel && channel.type === 'voice' ? <CallChatToggle channelId={channelId} open={chatOpen} onToggle={toggleChat} /> : undefined}
        />
      )}

      {!joined && embedded ? (
        <div className="call-bar">
          <div className="avatar-row">
            {participants.map((p) => (
              <Avatar key={p.socketId} user={findMember(p.guildId, p.userId)} size={36} />
            ))}
          </div>
          <span className="ellipsis">
            <strong>{participants.map((p) => findMember(p.guildId, p.userId)?.displayName ?? 'Alguém').join(', ')}</strong> está na
            chamada
          </span>
          <button className="btn primary" disabled={status === 'connecting'} onClick={() => void voice.join(channelId)}>
            {status === 'connecting' ? 'Conectando…' : 'Entrar'}
          </button>
        </div>
      ) : !joined ? (
        <div className="voice-join">
          <h3>{channel?.name}</h3>
          <p className="muted">
            {participants.length === 0
              ? 'Ninguém está aqui ainda.'
              : `${participants.length} pessoa${participants.length > 1 ? 's' : ''} na chamada.`}
          </p>
          <div className="avatar-row">
            {participants.map((p) => (
              <Avatar key={p.socketId} user={findMember(p.guildId, p.userId)} size={48} />
            ))}
          </div>
          <button className="btn primary" disabled={status === 'connecting'} onClick={() => void voice.join(channelId)}>
            {status === 'connecting' ? 'Conectando…' : 'Entrar na chamada'}
          </button>
          <p className="muted small">Até {maxPeers} pessoas por canal.</p>
        </div>
      ) : (
        <>
          {audioBlocked && (
            <button className="audio-blocked" onClick={() => window.dispatchEvent(new Event('resenha:unlock-audio'))}>
              <Volume2 size={18} /> Toque aqui para ativar o áudio
            </button>
          )}
          {ringing && (
            <div className="calling-hint" role="status">
              Chamando {channel?.name}…
            </div>
          )}
          <div className={`stage${focused || togetherBig ? ' focused' : ''}${(focused || togetherBig) && side ? ' side' : ''}`} ref={stageRef}>
            {(focused || togetherBig) && (
              <>
                <div className="stage-main" style={{ flex: `0 0 ${mainPct}%` }}>
                  {togetherBig ? <TogetherTile big /> : <TileView tile={focused!} big />}
                </div>
                <StageResizer stageRef={stageRef} />
              </>
            )}
            <div className={`tiles count-${Math.min(tiles.length + (togetherOn && !togetherBig ? 1 : 0), 9)}`}>
              {togetherOn && !togetherBig && <TogetherTile />}
              {tiles
                .filter((t) => t !== focused)
                .map((t) => (
                  <TileView key={t.id} tile={t} />
                ))}
            </div>
          </div>
          <PttHint />
          <VoiceControls />
        </>
      )}
    </div>
  );
  if (embedded || !chatOpen || !channel || channel.type !== 'voice') return stage;
  return (
    <div className="voice-layout with-chat">
      {stage}
      <aside className="call-chat-aside" aria-label="Chat da call">
        <CallChatPanel channel={channel} onClose={toggleChat} />
      </aside>
    </div>
  );
}

/** Botão do chat da call, com quantas mensagens chegaram enquanto ele estava fechado. */
function CallChatToggle({ channelId, open, onToggle }: { channelId: string; open: boolean; onToggle(): void }) {
  // mensagens do canal + do chat privado da call
  const saved = useApp((s) => s.messages[channelId]?.items.length ?? 0);
  const priv = useVoice((s) => (s.channelId === channelId ? s.callChat.length : 0));
  const count = saved + priv;
  const [seen, setSeen] = useState(count);
  useEffect(() => {
    if (!channelMessagesLoaded(channelId)) void loadMessages(channelId);
  }, [channelId]);
  useEffect(() => {
    if (open) setSeen(count);
  }, [open, count]);
  const fresh = open ? 0 : Math.max(0, count - seen);
  return (
    <button
      className={`icon-btn call-chat-btn${open ? ' active' : ''}`}
      aria-label={open ? 'Fechar o chat da call' : `Abrir o chat da call${fresh ? ` (${fresh} nova${fresh > 1 ? 's' : ''})` : ''}`}
      aria-pressed={open}
      title="Chat da call"
      onClick={onToggle}
    >
      <MessageSquare size={20} />
      {fresh > 0 && <span className="badge-count">{fresh > 9 ? '9+' : fresh}</span>}
    </button>
  );
}

/**
 * Divisória arrastável do modo destaque: cada pessoa escolhe o tamanho da transmissão em destaque
 * na própria tela (não muda nada para os outros). Também funciona pelo teclado (setas).
 */
function StageResizer({ stageRef }: { stageRef: React.RefObject<HTMLDivElement | null> }) {
  const side = useVoice((s) => s.settings.stageLayout === 'side');
  const pct = useVoice((s) => (side ? s.settings.stageSidePct : s.settings.stageMainPct));
  const min = side ? 40 : 35;
  const set = (v: number) => {
    const n = Math.round(Math.min(92, Math.max(min, v)));
    updateSettings(side ? { stageSidePct: n } : { stageMainPct: n });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = stage.getBoundingClientRect();
    const move = (ev: PointerEvent) => set(side ? ((ev.clientX - rect.left) / rect.width) * 100 : ((ev.clientY - rect.top) / rect.height) * 100);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="stage-resizer-wrap">
      <div
        className="stage-resizer"
        role="separator"
        aria-orientation={side ? 'vertical' : 'horizontal'}
        aria-label="Tamanho da transmissão em destaque"
        aria-valuemin={min}
        aria-valuemax={92}
        aria-valuenow={pct}
        tabIndex={0}
        title="Arraste para mudar o tamanho (só na sua tela). Duplo clique volta ao padrão."
        onPointerDown={onPointerDown}
        onDoubleClick={() => set(side ? 80 : 78)}
        onKeyDown={(e) => {
          const less = side ? 'ArrowLeft' : 'ArrowUp';
          const more = side ? 'ArrowRight' : 'ArrowDown';
          if (e.key === less) set(pct - 5);
          else if (e.key === more) set(pct + 5);
        }}
      >
        <span />
      </div>
      <button
        className="stage-layout-btn"
        title={side ? 'Pessoas embaixo da transmissão' : 'Pessoas ao lado da transmissão'}
        aria-label={side ? 'Pessoas embaixo da transmissão' : 'Pessoas ao lado da transmissão'}
        onClick={() => updateSettings({ stageLayout: side ? 'bottom' : 'side' })}
      >
        {side ? <PanelBottom size={15} /> : <PanelRight size={15} />}
      </button>
    </div>
  );
}

/** Janela flutuante (picture-in-picture): a transmissão fica por cima de tudo, redimensionável. */
const canPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
async function togglePip(container: HTMLElement | null) {
  const video = container?.querySelector('video');
  if (!video) return;
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch {
    /* o navegador recusou (ex.: vídeo ainda carregando) */
  }
}

function TileView({ tile, big }: { tile: Tile; big?: boolean }) {
  const user = useApp(() => findMember(tile.state.guildId, tile.state.userId));
  const sid = tile.state.socketId;
  const remote = useVoice((s) => (tile.isMe ? undefined : s.remotes[sid]));
  const localCamera = useVoice((s) => (tile.isMe ? s.localCamera : null));
  const localScreen = useVoice((s) => (tile.isMe ? s.localScreen : null));
  const speaking = useVoice((s) => (tile.isMe ? s.speaking.me : s.speaking[sid]));
  const watching = useVoice((s) => !!s.watching[sid]);
  const focus = useVoice((s) => s.focus);
  const enlarged = useVoice((s) => !!s.bigTiles[tile.id]);
  const ref = useRef<HTMLDivElement>(null);

  const toggleFocus = () => useVoice.setState({ focus: focus === tile.id ? null : tile.id });
  const toggleBig = () =>
    useVoice.setState((s) => {
      const bigTiles = { ...s.bigTiles };
      if (bigTiles[tile.id]) delete bigTiles[tile.id];
      else bigTiles[tile.id] = true;
      return { bigTiles };
    });
  const sizeClass = !big && enlarged ? ' enlarged' : '';

  const name = user?.displayName ?? 'Alguém';

  if (tile.kind === 'screen') {
    // turbo: o vídeo vem decodificado aqui (screenTurbo); o som continua no `screen`
    const stream = tile.isMe ? localScreen : (remote?.screenTurbo ?? remote?.screen);
    const canWatch = !tile.isMe;
    return (
      <div ref={ref} className={`tile screen${big ? ' big' : ''}${sizeClass}`} onDoubleClick={tile.isMe ? undefined : () => fullscreen(ref.current)}>
        {tile.isMe || watching ? (
          stream && stream.getVideoTracks().length > 0 ? (
            <VideoEl stream={stream} version={remote?.v} contain pauseWhenAway={tile.isMe} />
          ) : (
            <div className="tile-center muted">Carregando transmissão…</div>
          )
        ) : (
          <div className="tile-center">
            <MonitorUp size={36} />
            <p>{name} está transmitindo</p>
            <button className="btn primary" onClick={() => voice.watch(sid, true)}>
              <Eye size={16} /> Assistir transmissão
            </button>
          </div>
        )}
        <div className="tile-label">
          <span className="live-badge">AO VIVO</span>
          <span className="ellipsis">{tile.isMe ? 'Sua tela' : `Tela de ${name}`}</span>
          {tile.state.screenAudioOff && (
            <span className="muted-stream" title={tile.isMe ? 'Você desligou o áudio da transmissão' : `${name} desligou o áudio da transmissão`}>
              <VolumeX size={14} /> sem áudio
            </span>
          )}
        </div>
        {!tile.isMe && watching && <StreamVolume userId={tile.state.userId} name={name} />}
        {tile.isMe && <MyStreamAudioToggle />}
        <div className="tile-actions">
          {canWatch && watching && (
            <button className="icon-btn overlay" title="Parar de assistir" aria-label="Parar de assistir" onClick={() => voice.watch(sid, false)}>
              <EyeOff size={18} />
            </button>
          )}
          {/* Sem tela cheia/destaque na própria transmissão: ela capturaria a si mesma (efeito espelho). */}
          {!tile.isMe && watching && (
            <>
              {!big && (
                <button
                  className="icon-btn overlay"
                  title={enlarged ? 'Diminuir (só na sua tela)' : 'Aumentar (só na sua tela)'}
                  aria-label={enlarged ? 'Diminuir transmissão' : 'Aumentar transmissão'}
                  aria-pressed={enlarged}
                  onClick={toggleBig}
                >
                  {enlarged ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              )}
              {canPip && (
                <button
                  className="icon-btn overlay"
                  title="Janela flutuante: fica por cima do jogo e você muda o tamanho"
                  aria-label="Abrir em janela flutuante"
                  onClick={() => void togglePip(ref.current)}
                >
                  <PictureInPicture2 size={18} />
                </button>
              )}
              <button className="icon-btn overlay" title={big ? 'Tirar do destaque' : 'Destacar'} aria-label={big ? 'Tirar do destaque' : 'Destacar'} onClick={toggleFocus}>
                <MonitorUp size={18} />
              </button>
              <button className="icon-btn overlay" title="Tela cheia" aria-label="Tela cheia" onClick={() => fullscreen(ref.current)}>
                <Maximize size={18} />
              </button>
            </>
          )}
        </div>
        {!tile.isMe && watching && <StreamStats socketId={sid} relayed={!!remote?.relayed} />}
        {tile.isMe && <SendStatsView />}
      </div>
    );
  }

  const camStream = tile.isMe ? localCamera : remote?.camera;
  const showCam = tile.state.camera && camStream && camStream.getVideoTracks().length > 0;
  const connecting = !tile.isMe && remote && remote.connection !== 'connected' && remote.connection !== 'new';
  return (
    <div
      ref={ref}
      className={`tile user${big ? ' big' : ''}${sizeClass}${speaking && !tile.state.muted ? ' speaking' : ''}${!showCam && user?.callBanner ? ' has-banner' : ''}`}
      onClick={showCam ? toggleFocus : undefined}
    >
      {!showCam && <CallBannerBackground banner={user?.callBanner} pos={user?.callBannerPos} />}
      {showCam ? (
        <VideoEl stream={camStream!} version={remote?.v} mirror={tile.isMe} />
      ) : (
        <div className="tile-center">
          <Avatar user={user} size={big ? 96 : 64} />
        </div>
      )}
      <div className="tile-label">
        {tile.state.deafened ? <HeadphoneOff size={14} className="danger-icon" /> : tile.state.muted && <MicOff size={14} className="danger-icon" />}
        <span className="ellipsis">
          {name}
          {tile.isMe ? ' (você)' : ''}
        </span>
      </div>
      <SoundBurstBadge socketId={sid} />
      {connecting && <ConnectingBadge failed={remote!.connection === 'failed'} />}
      {!connecting && remote?.relayed && (
        <div className="tile-badge turn" title="Sem conexão direta com esta pessoa: áudio e vídeo passam pelo servidor TURN (cota grátis limitada), então câmera e tela vão em qualidade reduzida.">
          via TURN
        </div>
      )}
      {!tile.isMe && <VolumeSlider userId={tile.state.userId} />}
    </div>
  );
}

/** Depois de alguns segundos sem conectar, explica o provável motivo. */
function ConnectingBadge({ failed }: { failed: boolean }) {
  const hasTurn = useVoice((s) => s.hasTurn);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, []);
  if (!slow && !failed) return <div className="tile-badge">Conectando…</div>;
  return (
    <div className="tile-badge warn-box">
      {hasTurn
        ? 'Não foi possível conectar com esta pessoa. Tente sair e entrar de novo.'
        : 'Sem conexão direta (comum no 4G/5G). O dono do site precisa configurar um servidor TURN — veja o README.'}
    </div>
  );
}

function VideoEl({
  stream,
  version,
  mirror,
  contain,
  pauseWhenAway,
}: {
  stream: MediaStream;
  version?: number;
  mirror?: boolean;
  contain?: boolean;
  /** prévia da minha própria tela: pausa enquanto você está no jogo (desenhar a prévia também gasta a placa de vídeo) */
  pauseWhenAway?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (!pauseWhenAway || (document.visibilityState === 'visible' && document.hasFocus())) v.play().catch(() => {});
  }, [stream, version, pauseWhenAway]);
  useEffect(() => {
    if (!pauseWhenAway) return;
    const sync = () => {
      const v = ref.current;
      if (!v) return;
      if (document.visibilityState === 'visible' && document.hasFocus()) v.play().catch(() => {});
      else v.pause();
    };
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [pauseWhenAway]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted // o áudio toca pelos elementos <audio> do VoiceAudio
      className={`${mirror ? 'mirror' : ''} ${contain ? 'contain' : ''}`}
    />
  );
}

function fullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
    return;
  }
  // iPhone: só o próprio <video> pode ir para tela cheia
  const video = el.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  video?.webkitEnterFullscreen?.();
}

function VolumeSlider({ userId }: { userId: string }) {
  const volume = useVoice((s) => s.settings.volumes[userId] ?? 1);
  const [open, setOpen] = useState(false);
  return (
    <div className="tile-volume" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn overlay" aria-label="Volume" title="Volume" onClick={() => setOpen((v) => !v)}>
        <Volume2 size={16} />
      </button>
      {open && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume deste usuário"
          onChange={(e) => setUserVolume(userId, Number(e.target.value))}
        />
      )}
    </div>
  );
}

/** Volume da transmissão que estou assistindo (som do jogo/vídeo), só para mim. */
function StreamVolume({ userId, name }: { userId: string; name: string }) {
  const volume = useVoice((s) => s.settings.streamVolumes?.[userId] ?? 1);
  const [last, setLast] = useState(1);
  return (
    <div className="stream-volume" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        className="icon-btn overlay"
        aria-label={volume === 0 ? `Ativar o som da transmissão de ${name}` : `Silenciar a transmissão de ${name}`}
        title={volume === 0 ? 'Ativar o som da transmissão' : 'Silenciar a transmissão'}
        onClick={() => {
          if (volume > 0) setLast(volume);
          setStreamVolume(userId, volume > 0 ? 0 : last || 1);
        }}
      >
        {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        aria-label={`Volume da transmissão de ${name}`}
        title={`Volume da transmissão: ${Math.round(volume * 100)}%`}
        onChange={(e) => setStreamVolume(userId, Number(e.target.value))}
      />
    </div>
  );
}

/** Para quem transmite: liga/desliga o som da transmissão sem parar a imagem. */
function MyStreamAudioToggle() {
  const off = useVoice((s) => s.screenAudioOff);
  const [hasAudio, setHasAudio] = useState(voice.screenHasAudio);
  useEffect(() => {
    const t = setInterval(() => setHasAudio(voice.screenHasAudio), 1000);
    return () => clearInterval(t);
  }, []);
  if (!hasAudio) return null;
  return (
    <button
      className={`stream-audio-toggle${off ? ' off' : ''}`}
      aria-pressed={off}
      aria-label={off ? 'Ligar o áudio da transmissão' : 'Desligar o áudio da transmissão'}
      title={off ? 'As pessoas não estão ouvindo o som da sua transmissão' : 'As pessoas estão ouvindo o som da sua transmissão'}
      onClick={(e) => {
        e.stopPropagation();
        voice.setScreenAudioOff(!off);
      }}
    >
      {off ? <VolumeX size={15} /> : <Volume2 size={15} />} {off ? 'Áudio da transmissão desligado' : 'Áudio da transmissão ligado'}
    </button>
  );
}

/**
 * Para quem transmite: o que está saindo de verdade (captura, envio, codec, se usa a placa de vídeo
 * e o que limita a qualidade), com dicas quando algo está atrapalhando.
 */
function SendStatsView() {
  const chosen = useVoice((s) => screenCodecFor(s.settings));
  const light = useVoice((s) => s.screenLight);
  const targetFps = useVoice((s) => Math.max(40, screenPresetFor(s.settings).fps));
  const [st, setSt] = useState<SendStats | null>(null);
  const [mbps, setMbps] = useState<number | null>(null);
  useEffect(() => {
    let last: SendStats | null = null;
    const t = setInterval(async () => {
      const s = await voice.screenSendStats();
      setSt(s);
      if (s?.mbps !== undefined) setMbps(s.mbps);
      else if (s && last && s.ts > last.ts && s.bytes >= last.bytes) {
        setMbps(((s.bytes - last.bytes) * 8) / ((s.ts - last.ts) / 1000) / 1e6);
      }
      last = s;
    }, 1000);
    return () => clearInterval(t);
  }, []);
  if (!st) return <div className="send-stats muted">Ninguém assistindo ainda</div>;

  const wanted = CODECS.find((c) => c.id === chosen)?.mime.replace('video/', '') ?? '';
  const fallback = st.codec && wanted && st.codec.toUpperCase() !== wanted.toUpperCase();
  const tips: string[] = [];
  if (light) tips.push(`Modo desempenho: a resolução baixou para manter ${targetFps} FPS sem pesar no jogo.`);
  if (fallback && !st.turbo) {
    tips.push(
      `O ${wanted} não está disponível (no seu navegador ou no de quem assiste), então está indo em ${st.codec}. Use Chrome ou Edge atualizados dos dois lados — Opera/Opera GX e Brave podem vir sem H.264.`,
    );
  }
  if (st.limitedBy === 'cpu') {
    tips.push(
      st.hardware === false
        ? 'Processador sobrecarregado: a codificação está no processador. Use H.264 no Chrome/Edge para usar a placa de vídeo, ou baixe para 720p.'
        : 'Processador sobrecarregado: baixe para 720p · 60 FPS ou feche programas pesados.',
    );
  }
  if (st.limitedBy === 'bandwidth')
    tips.push(
      st.turbo
        ? 'A internet de alguém que assiste não está acompanhando: só essa pessoa perde quadros (os outros continuam lisos). Se for o seu upload, diminua o bitrate.'
        : 'Sua internet (upload) está limitando a qualidade. Diminua o bitrate ou a resolução.',
    );
  // O navegador só captura quando a imagem muda: tela parada = FPS baixo, e isso é normal.
  if (st.captureFps > 0 && st.captureFps < targetFps * 0.75 && st.limitedBy === 'none') {
    tips.push(
      `A captura está abaixo de ${targetFps} FPS. Se for durante o jogo (e não uma tela parada), deixe o jogo em "janela sem bordas" (tela cheia em janela) em vez de tela cheia exclusiva, e use o app de Windows (ele dá prioridade de placa de vídeo para a captura).`,
    );
  }

  const enc =
    st.encodeMs !== undefined
      ? ` · ${st.encodeMs} ms por quadro${st.hardware === false ? ' (processador)' : ''}`
      : st.hardware === null
        ? ''
        : st.hardware
          ? ' (placa de vídeo)'
          : ' (processador)';
  const limited = { none: '', cpu: ' · limitado: processador', bandwidth: ' · limitado: internet', other: '' }[st.limitedBy];
  return (
    <div className="send-stats">
      <div>
        {st.turbo && <span className="turbo-chip" title="Codificada uma vez só para todo mundo (mais leve e estável)">⚡ Turbo</span>}
        Captura {Math.round(st.captureFps)} FPS · Envio {st.width}×{st.height} {Math.round(st.fps)} FPS
        {mbps !== null ? ` · ${mbps.toFixed(1)} Mbps` : ''} · {st.codec}
        {enc}
        {st.viewerFps !== undefined ? ` · na tela de quem assiste: ${st.viewerFps} FPS` : ''}
        {limited}
      </div>
      {tips.map((t) => (
        <div key={t} className="send-tip">
          ⚠️ {t}
        </div>
      ))}
    </div>
  );
}

/** Mostra resolução, FPS e bitrate reais da transmissão recebida. */
function StreamStats({ socketId, relayed }: { socketId: string; relayed: boolean }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let last: { bytes: number; ts: number } | null = null;
    const t = setInterval(async () => {
      // transmissão turbo: números do próprio decodificador
      const turbo = voice.turboRecvStats(socketId);
      if (turbo) {
        const res = turbo.width ? `${turbo.width}×${turbo.height}` : '';
        setText(['⚡ Turbo', res, `${turbo.fps} FPS`, `${turbo.mbps.toFixed(1)} Mbps`, turbo.codec].filter(Boolean).join(' · '));
        return;
      }
      const report = await voice.screenStats(socketId);
      if (!report) return;
      report.forEach((s) => {
        if (s.type !== 'inbound-rtp' || s.kind !== 'video') return;
        const codec = s.codecId ? report.get(s.codecId)?.mimeType?.replace('video/', '') : '';
        let mbps = '';
        if (last && s.timestamp > last.ts) {
          mbps = `${(((s.bytesReceived - last.bytes) * 8) / ((s.timestamp - last.ts) / 1000) / 1e6).toFixed(1)} Mbps`;
        }
        last = { bytes: s.bytesReceived, ts: s.timestamp };
        const fps = s.framesPerSecond ? `${Math.round(s.framesPerSecond)} FPS` : '';
        const res = s.frameWidth ? `${s.frameWidth}×${s.frameHeight}` : '';
        setText([res, fps, mbps, codec].filter(Boolean).join(' · '));
      });
    }, 1000);
    return () => clearInterval(t);
  }, [socketId]);
  if (!text) return null;
  return (
    <div className="stream-stats">
      {text}
      {relayed && (
        <span className="turn-chip" title="Sem conexão direta: a transmissão passa pelo servidor TURN e pode vir com qualidade reduzida para economizar a cota grátis.">
          via TURN
        </span>
      )}
    </div>
  );
}

function PttHint() {
  const mode = useVoice((s) => s.settings.inputMode);
  const key = useVoice((s) => s.settings.pttKey);
  const active = useVoice((s) => s.pttActive);
  const muted = useVoice((s) => s.muted);
  if (mode !== 'ptt' || muted) return null;
  return (
    <div className={`ptt-hint${active ? ' on' : ''}`}>
      {active ? '🎙️ Transmitindo…' : `Segure ${keyLabel(key)} para falar`}
    </div>
  );
}

/** 🔒 Segurança da chamada: criptografia, tipo de conexão e código de segurança de cada pessoa. */
function CallSecurityButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="call-lock" title="Chamada criptografada: toque para ver os detalhes" aria-label="Segurança da chamada" onClick={() => setOpen(true)}>
        <Lock size={15} /> <span>Criptografada</span>
      </button>
      {open && <CallSecurityPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function CallSecurityPanel({ onClose }: { onClose(): void }) {
  const [info, setInfo] = useState<Record<string, CallSecurity> | null>(null);
  const voiceStates = useApp((s) => s.voiceStates);
  useEffect(() => {
    let alive = true;
    const tick = () => void voice.securityInfo().then((i) => alive && setInfo(i));
    tick();
    const t = setInterval(tick, 3000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const people = Object.entries(info ?? {});
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal call-security" role="dialog" aria-modal="true" aria-label="Segurança da chamada">
        <div className="modal-head">
          <h2>
            <ShieldCheck size={20} /> Segurança da chamada
          </h2>
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p>
            Voz, câmera e tela vão <strong>criptografados de ponta a ponta</strong> (DTLS-SRTP) direto entre vocês. Nada é gravado. Quando a
            conexão direta não é possível (ex.: 4G), tudo passa por um servidor de retransmissão <strong>ainda criptografado</strong>: ele não
            consegue ouvir nem ver.
          </p>
          {info === null && <p className="muted">Lendo as conexões…</p>}
          {info && people.length === 0 && <p className="muted">Ninguém mais na chamada ainda.</p>}
          <ul className="call-security-list">
            {people.map(([sid, sec]) => {
              const st = voiceStates[sid];
              const member = st ? findMember(st.guildId, st.userId) : undefined;
              return (
                <li key={sid}>
                  <Avatar user={member} size={32} />
                  <span className="cs-info">
                    <strong>{member?.displayName ?? 'Alguém'}</strong>
                    <span className="muted small">
                      {sec.state !== 'connected'
                        ? 'Conectando…'
                        : sec.relayed
                          ? '🛰️ Via servidor de retransmissão (continua criptografada)'
                          : '⚡ Conexão direta'}
                      {sec.cipher ? ` · ${sec.cipher}` : ''}
                    </span>
                  </span>
                  <span className="cs-code" title="Código de segurança: compare com essa pessoa">
                    {sec.code ?? '··· ··· ··· ···'}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            <strong>Quer ter certeza?</strong> Peça para a pessoa abrir esta janela e ler o código que aparece ao lado do <em>seu</em> nome. Se for
            igual ao que você vê ao lado do nome dela, ninguém está interceptando a chamada, nem o próprio Resenha. O código muda a cada
            chamada.
          </p>
        </div>
      </div>
    </div>
  );
}

function VoiceControls() {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  const shareSupported = canShareScreen();
  const streamAllowed = useApp((s) => {
    const gid = useVoice.getState().guildId;
    return !gid || has(myPermissions(s.guilds[gid], s.me?.id), Perm.STREAM);
  });
  return (
    <div className="voice-controls">
      <CallSecurityButton />
      <CallReportButton />
      <button className={`round-btn${muted ? ' off' : ''}`} aria-label={muted ? 'Ativar microfone' : 'Silenciar'} title={muted ? 'Ativar microfone' : 'Silenciar'} onClick={() => voice.setMuted(!muted)}>
        {muted ? <MicOff /> : <Mic />}
      </button>
      <button className={`round-btn${deafened ? ' off' : ''}`} aria-label={deafened ? 'Ativar áudio' : 'Desativar áudio'} title={deafened ? 'Ativar áudio' : 'Desativar áudio'} onClick={() => voice.setDeafened(!deafened)}>
        {deafened ? <HeadphoneOff /> : <Headphones />}
      </button>
      <button className={`round-btn${camera ? ' on' : ''}`} aria-label={camera ? 'Desligar câmera' : 'Ligar câmera'} title={camera ? 'Desligar câmera' : 'Ligar câmera'} onClick={() => void voice.toggleCamera()}>
        {camera ? <Video /> : <VideoOff />}
      </button>
      <button
        className={`round-btn${screen ? ' on' : ''}`}
        aria-label={screen ? 'Parar transmissão' : 'Transmitir tela'}
        title={
          !shareSupported
            ? 'Transmitir tela só funciona no computador'
            : !streamAllowed && !screen
              ? 'Seu cargo não tem permissão para transmitir neste servidor'
              : screen
                ? 'Parar transmissão'
                : 'Transmitir tela'
        }
        disabled={!shareSupported || (!streamAllowed && !screen)}
        onClick={() => (screen ? voice.stopScreen() : openModal({ kind: 'screenShare' }))}
      >
        {screen ? <MonitorX /> : <MonitorUp />}
      </button>
      <SoundboardButton className="round-btn" />
      <TogetherButton />
      <button className="round-btn danger" aria-label="Sair da chamada" title="Sair da chamada" onClick={() => voice.leave()}>
        <PhoneOff />
      </button>
    </div>
  );
}
