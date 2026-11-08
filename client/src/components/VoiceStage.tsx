import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Maximize,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import type { VoiceState } from '../../../shared/types';
import { findChannel, findMember, openModal, useApp } from '../store/app';
import { setUserVolume, useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { CODECS, canShareScreen, keyLabel, presetById } from '../voice/settings';
import type { SendStats } from '../voice/engine';
import { Avatar } from './Avatar';
import { MobileHeader } from './MobileHeader';

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

  return (
    <div className={`voice-stage${embedded ? ' embedded' : ''}`}>
      {!embedded && <MobileHeader title={channel?.name ?? 'Voz'} icon={<Volume2 size={20} className="muted" />} />}

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
          <div className={`stage${focused ? ' focused' : ''}`}>
            {focused && (
              <div className="stage-main">
                <TileView tile={focused} big />
              </div>
            )}
            <div className={`tiles count-${Math.min(tiles.length, 9)}`}>
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
  const ref = useRef<HTMLDivElement>(null);

  const toggleFocus = () => useVoice.setState({ focus: focus === tile.id ? null : tile.id });

  const name = user?.displayName ?? 'Alguém';

  if (tile.kind === 'screen') {
    const stream = tile.isMe ? localScreen : remote?.screen;
    const canWatch = !tile.isMe;
    return (
      <div ref={ref} className={`tile screen${big ? ' big' : ''}`} onDoubleClick={tile.isMe ? undefined : () => fullscreen(ref.current)}>
        {tile.isMe || watching ? (
          stream && stream.getVideoTracks().length > 0 ? (
            <VideoEl stream={stream} version={remote?.v} contain />
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
        </div>
        <div className="tile-actions">
          {canWatch && watching && (
            <button className="icon-btn overlay" title="Parar de assistir" aria-label="Parar de assistir" onClick={() => voice.watch(sid, false)}>
              <EyeOff size={18} />
            </button>
          )}
          {/* Sem tela cheia/destaque na própria transmissão: ela capturaria a si mesma (efeito espelho). */}
          {!tile.isMe && watching && (
            <>
              <button className="icon-btn overlay" title="Destacar" aria-label="Destacar" onClick={toggleFocus}>
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
      className={`tile user${big ? ' big' : ''}${speaking && !tile.state.muted ? ' speaking' : ''}`}
      onClick={showCam ? toggleFocus : undefined}
    >
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

function VideoEl({ stream, version, mirror, contain }: { stream: MediaStream; version?: number; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream, version]);
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

/**
 * Para quem transmite: o que está saindo de verdade (captura, envio, codec, se usa a placa de vídeo
 * e o que limita a qualidade), com dicas quando algo está atrapalhando.
 */
function SendStatsView() {
  const chosen = useVoice((s) => s.settings.codec);
  const targetFps = useVoice((s) => presetById(s.settings.screenPreset).fps);
  const [st, setSt] = useState<SendStats | null>(null);
  const [mbps, setMbps] = useState<number | null>(null);
  useEffect(() => {
    let last: SendStats | null = null;
    const t = setInterval(async () => {
      const s = await voice.screenSendStats();
      setSt(s);
      if (s && last && s.ts > last.ts && s.bytes >= last.bytes) {
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
  if (fallback) {
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
  if (st.limitedBy === 'bandwidth') tips.push('Sua internet (upload) está limitando a qualidade. Diminua o bitrate ou a resolução.');
  // O navegador só captura quando a imagem muda: tela parada = FPS baixo, e isso é normal.
  if (st.captureFps > 0 && st.captureFps < targetFps * 0.75 && st.limitedBy === 'none') {
    tips.push(
      `A captura está abaixo de ${targetFps} FPS. Se for durante o jogo (e não uma tela parada), deixe o jogo em "janela sem bordas" (tela cheia em janela) em vez de tela cheia exclusiva.`,
    );
  }

  const enc = st.hardware === null ? '' : st.hardware ? ' (placa de vídeo)' : ' (processador)';
  const limited = { none: '', cpu: ' · limitado: processador', bandwidth: ' · limitado: internet', other: '' }[st.limitedBy];
  return (
    <div className="send-stats">
      <div>
        Captura {Math.round(st.captureFps)} FPS · Envio {st.width}×{st.height} {Math.round(st.fps)} FPS
        {mbps !== null ? ` · ${mbps.toFixed(1)} Mbps` : ''} · {st.codec}
        {enc}
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

function VoiceControls() {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  const shareSupported = canShareScreen();
  return (
    <div className="voice-controls">
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
        title={shareSupported ? (screen ? 'Parar transmissão' : 'Transmitir tela') : 'Transmitir tela só funciona no computador'}
        disabled={!shareSupported}
        onClick={() => (screen ? voice.stopScreen() : openModal({ kind: 'screenShare' }))}
      >
        {screen ? <MonitorX /> : <MonitorUp />}
      </button>
      <button className="round-btn danger" aria-label="Sair da chamada" title="Sair da chamada" onClick={() => voice.leave()}>
        <PhoneOff />
      </button>
    </div>
  );
}
