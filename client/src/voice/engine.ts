import type { Socket } from 'socket.io-client';
import type { PublicUser, RtcSignal } from '../../../shared/types';
import { api } from '../lib/api';
import { playSound } from '../lib/sounds';
import { getSocket, onSocketReady } from '../lib/socket';
import { findChannel, findMember, toast, useApp } from '../store/app';
import { useVoice, type MediaKind, type RemoteMedia } from '../store/voice';
import { Peer, type SenderSlot } from './peer';
import { preferCodec } from './sdp';
import { CODECS, effectiveBitrate, presetById } from './settings';

const CAMERA_BITRATE = 1_200_000;

/**
 * Limites usados quando a conexão passa pelo TURN (cota grátis pequena):
 * tela em ~720p/30 FPS/1 Mbps (≈450 MB/h) e câmera em 15 FPS/250 kbps (≈110 MB/h).
 */
export const TURN_LIMITS = {
  screen: { maxBitrate: 1_000_000, maxFramerate: 30, maxHeight: 720 },
  camera: { maxBitrate: 250_000, maxFramerate: 15 },
};
const SPEAKING_THRESHOLD = 0.015;

type Meter = { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer>; lastLoud: number };

export interface SendStats {
  captureFps: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  /** true = placa de vídeo, false = processador, null = navegador não informa */
  hardware: boolean | null;
  limitedBy: 'none' | 'cpu' | 'bandwidth' | 'other';
  bytes: number;
  ts: number;
}

const setV = useVoice.setState;
const getV = useVoice.getState;

/**
 * Motor de voz/vídeo em malha (P2P): cada participante conecta diretamente com os outros.
 * Grátis (sem servidor de mídia) e com a menor latência possível para grupos pequenos.
 */
class VoiceEngine {
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] | null = null;
  private micTrack: MediaStreamTrack | null = null;
  /** cópia do microfone só para medir o volume (o original é ligado/desligado pelo portão) */
  private micMonitor: MediaStreamTrack | null = null;
  private pttDown = false;
  private vadOpen = false;
  private meLastLoud = 0;
  private camTrack: MediaStreamTrack | null = null;
  private screenStream: MediaStream | null = null;
  /** MediaStreams "rótulo": o id delas vai na SDP e diz ao outro lado o que é cada faixa. */
  private msid = { mic: new MediaStream(), camera: new MediaStream(), screen: new MediaStream() };
  private screenWatchers = new Set<string>();
  private audioCtx: AudioContext | null = null;
  private meters = new Map<string, Meter>();
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private boundSockets = new WeakSet<Socket>();
  private joining = false;
  /** últimos eventos internos (diagnóstico: __resenhaVoice.debugLog no console) */
  readonly debugLog: string[] = [];
  private dbg(msg: string) {
    this.debugLog.push(`${new Date().toISOString().slice(11, 23)} ${msg}`);
    if (this.debugLog.length > 200) this.debugLog.shift();
  }

  constructor() {
    onSocketReady((socket) => {
      this.dbg(`ready socket=${socket.id} status=${getV().status} channel=${getV().channelId} joining=${this.joining}`);
      this.bind(socket);
      // reconexão: o servidor esqueceu nosso estado de voz, então entramos de novo
      const { channelId, status } = getV();
      if (channelId && status !== 'idle' && !this.joining) {
        this.resetPeers();
        void this.join(channelId, true);
      }
    });
  }

  private bind(socket: Socket) {
    if (this.boundSockets.has(socket)) return;
    this.boundSockets.add(socket);

    socket.on('voice:peer-joined', ({ socketId, userId }: { socketId: string; userId: string }) => {
      this.dbg(`peer-joined ${socketId} status=${getV().status}`);
      if (getV().status === 'idle') return;
      // eu já estava na chamada: eu inicio a negociação com quem chegou
      this.createPeer(socketId, userId, true);
      playSound('peerJoin');
      useApp.setState({ outgoingRing: null }); // atenderam
    });
    socket.on('voice:peer-left', ({ socketId }: { socketId: string }) => {
      this.dbg(`peer-left ${socketId}`);
      if (this.peers.has(socketId)) playSound('peerLeave');
      this.closePeer(socketId);
    });
    // ---- ligações em conversas diretas ----
    socket.on('call:ring', ({ channelId, from }: { channelId: string; from: PublicUser }) => {
      if (getV().channelId === channelId && getV().status !== 'idle') return; // já estou nessa chamada
      useApp.setState({ incomingCall: { channelId, from } });
    });
    socket.on('call:end-ring', ({ channelId, missed, from }: { channelId: string; missed?: boolean; from?: PublicUser }) => {
      if (useApp.getState().incomingCall?.channelId !== channelId) return;
      useApp.setState({ incomingCall: null });
      if (missed && from) toast(`Chamada perdida de ${from.displayName}`);
    });
    const endOutgoing = (channelId: string, message: string) => {
      if (getV().channelId !== channelId) return;
      useApp.setState({ outgoingRing: null });
      // ninguém entrou: encerra a chamada vazia
      if (this.peers.size === 0) this.leave();
      toast(message);
    };
    socket.on('call:declined', ({ channelId, by }: { channelId: string; by: PublicUser }) =>
      endOutgoing(channelId, `${by.displayName} recusou a chamada.`),
    );
    socket.on('call:missed', ({ channelId, userId }: { channelId: string; userId: string }) =>
      endOutgoing(channelId, `${findMember(null, userId)?.displayName ?? 'A pessoa'} não atendeu.`),
    );
    socket.on('call:unavailable', ({ channelId, userId }: { channelId: string; userId: string }) =>
      endOutgoing(channelId, `${findMember(null, userId)?.displayName ?? 'A pessoa'} está offline agora.`),
    );

    socket.on('voice:kicked', ({ reason }: { reason: string }) => {
      this.leave(false);
      toast(reason);
    });
    socket.on('rtc:signal', ({ from, data }: { from: string; data: RtcSignal }) => {
      if (getV().status === 'idle') {
        this.dbg(`signal ${data.type} de ${from} ignorado (idle)`);
        return;
      }
      let peer = this.peers.get(from);
      if (!peer) {
        const state = useApp.getState().voiceStates[from];
        if (!state || state.channelId !== getV().channelId) {
          this.dbg(`signal ${data.type} de ${from} ignorado (estado=${state?.channelId ?? 'nenhum'})`);
          return;
        }
        peer = this.createPeer(from, state.userId, false);
      }
      void peer.handle(data);
    });
  }

  // ---------------- entrar / sair ----------------

  async join(channelId: string, rejoin = false) {
    const socket = getSocket();
    const channel = findChannel(channelId);
    if (!socket || !channel) return;
    if (!rejoin && getV().channelId === channelId && getV().status !== 'idle') return;
    if (!rejoin && getV().status !== 'idle') this.leave(true);

    this.joining = true;
    this.dbg(`join ${channelId} rejoin=${rejoin}`);
    setV({ status: 'connecting', channelId, guildId: channel.guildId });
    try {
      // AudioContext precisa nascer de um clique do usuário (regra de autoplay dos navegadores)
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      void this.audioCtx.resume();

      if (!this.iceServers) {
        this.iceServers = await api<{ iceServers: RTCIceServer[]; hasTurn: boolean }>('/ice')
          .then((r) => {
            setV({ hasTurn: r.hasTurn });
            return r.iceServers;
          })
          .catch(() => [{ urls: 'stun:stun.l.google.com:19302' }]);
      }

      if (!this.micTrack && !getV().noMic) await this.acquireMic();

      const { muted, deafened } = getV();
      const res = await new Promise<{ ok: boolean; error?: string; peers?: { socketId: string; userId: string }[] }>(
        (resolve) => socket.timeout(10000).emit('voice:join', { channelId, muted, deafened }, (err: unknown, r: any) =>
          resolve(err ? { ok: false, error: 'O servidor não respondeu.' } : r),
        ),
      );
      if (!res.ok) {
        toast(res.error ?? 'Não foi possível entrar no canal de voz.');
        this.leave(false);
        return;
      }
      this.dbg(`join ack ok=${res.ok} peers=${(res.peers ?? []).map((p) => p.socketId).join(',')}`);
      if (getV().channelId !== channelId) return; // saiu enquanto conectava

      setV({ status: 'connected' });
      if (!rejoin) playSound('join');
      // ligando numa DM sem ninguém do outro lado: fica "chamando…" até atenderem
      if (channel.type === 'dm' && !res.peers?.length && !rejoin) useApp.setState({ outgoingRing: channelId });
      if (useApp.getState().incomingCall?.channelId === channelId) useApp.setState({ incomingCall: null });
      if (getV().camera || getV().screen) {
        socket.emit('voice:update', { camera: !!this.camTrack, screen: !!this.screenStream });
      }
      // acabei de chegar: espero quem já estava oferecer primeiro
      for (const p of res.peers ?? []) this.createPeer(p.socketId, p.userId, false);
      this.startMeters();
    } finally {
      this.joining = false;
    }
  }

  leave(notifyServer = true) {
    this.dbg(`leave notify=${notifyServer}`);
    if (getV().status !== 'idle') playSound('leave');
    useApp.setState({ outgoingRing: null });
    if (notifyServer) getSocket()?.emit('voice:leave');
    this.resetPeers();
    this.micTrack?.stop();
    this.micMonitor?.stop();
    this.micMonitor = null;
    this.pttDown = this.vadOpen = false;
    this.camTrack?.stop();
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.micTrack = this.camTrack = this.screenStream = null;
    this.screenWatchers.clear();
    for (const m of this.meters.values()) m.source.disconnect();
    this.meters.clear();
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    setV({
      status: 'idle',
      channelId: null,
      guildId: null,
      camera: false,
      screen: false,
      noMic: false,
      localCamera: null,
      localScreen: null,
      remotes: {},
      speaking: {},
      watching: {},
      focus: null,
      audioBlocked: false,
      pttActive: false,
      micLevelDb: -100,
    });
  }

  private resetPeers() {
    this.dbg(`resetPeers (${this.peers.size})`);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    setV({ remotes: {} });
  }

  private async acquireMic() {
    const { settings } = getV();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.micDeviceId ? { ideal: settings.micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: true,
        },
      });
      this.micTrack = stream.getAudioTracks()[0];
      this.micMonitor = this.micTrack.clone();
      this.micMonitor.enabled = true;
      this.monitor('me', new MediaStream([this.micMonitor]));
      setV({ noMic: false });
      this.updateGate();
    } catch (err) {
      console.warn('microfone indisponível', err);
      setV({ noMic: true, muted: true });
      toast('Sem acesso ao microfone. Você entrou só para ouvir.');
    }
  }

  /** Troca o microfone (ou reaplica supressão de ruído) sem sair da chamada. */
  async restartMic() {
    if (getV().status === 'idle') return;
    this.micTrack?.stop();
    this.micMonitor?.stop();
    this.micTrack = this.micMonitor = null;
    setV({ noMic: false });
    await this.acquireMic();
    for (const p of this.peers.values()) await p.setTrack('mic', this.micTrack, this.msid.mic);
  }

  // ---------------- pares ----------------

  /** `initiator`: eu ofereço minha mídia já; senão, espero a primeira oferta do outro lado. */
  private createPeer(socketId: string, userId: string, initiator: boolean): Peer {
    const existing = this.peers.get(socketId);
    if (existing) return existing;
    this.dbg(`createPeer ${socketId}`);
    const mySocketId = getSocket()?.id ?? '';
    const peer = new Peer(socketId, userId, mySocketId < socketId, this.iceServers ?? [], {
      signal: (data) => getSocket()?.emit('rtc:signal', { to: socketId, data }),
      onStream: (kind, stream) => this.onRemoteStream(socketId, kind, stream),
      onStreamChanged: () => this.patchRemote(socketId, (r) => ({ v: r.v + 1 })),
      onConnectionState: (connection) => this.patchRemote(socketId, () => ({ connection })),
      onWatch: (on) => this.onWatchRequest(socketId, on),
      onStable: () => this.applyEncodings(peer),
      log: (msg) => this.dbg(`[${socketId.slice(0, 6)}] ${msg}`),
      onRelayChange: (relayed) => {
        this.patchRemote(socketId, () => ({ relayed }));
        this.applyEncodings(peer);
      },
    });
    this.peers.set(socketId, peer);
    setV((s) => ({ remotes: { ...s.remotes, [socketId]: { userId, connection: 'new', v: 0 } } }));

    // diz ao outro lado o que significa cada stream antes de mandar mídia
    getSocket()?.emit('rtc:signal', {
      to: socketId,
      data: {
        type: 'meta',
        streams: { [this.msid.mic.id]: 'mic', [this.msid.camera.id]: 'camera', [this.msid.screen.id]: 'screen' },
      } satisfies RtcSignal,
    });

    const addLocalMedia = () => {
      if (this.micTrack) void peer.setTrack('mic', this.micTrack, this.msid.mic);
      if (this.camTrack) void this.addCamera(peer);
    };
    if (initiator) addLocalMedia();
    else peer.afterFirstOffer(addLocalMedia, 1500);
    // após reconexão, refaz o pedido para continuar assistindo a tela dessa pessoa
    if (getV().watching[socketId]) this.sendWatch(socketId, true);
    return peer;
  }

  private closePeer(socketId: string) {
    this.dbg(`closePeer ${socketId}`);
    this.peers.get(socketId)?.close();
    this.peers.delete(socketId);
    this.screenWatchers.delete(socketId);
    const m = this.meters.get(socketId);
    if (m) {
      m.source.disconnect();
      this.meters.delete(socketId);
    }
    setV((s) => {
      const remotes = { ...s.remotes };
      delete remotes[socketId];
      const watching = { ...s.watching };
      delete watching[socketId];
      const focus = s.focus?.startsWith(socketId) ? null : s.focus;
      return { remotes, watching, focus };
    });
  }

  private patchRemote(socketId: string, fn: (r: RemoteMedia) => Partial<RemoteMedia>) {
    setV((s) => {
      const r = s.remotes[socketId];
      return r ? { remotes: { ...s.remotes, [socketId]: { ...r, ...fn(r) } } } : {};
    });
  }

  private onRemoteStream(socketId: string, kind: MediaKind, stream: MediaStream | null) {
    this.patchRemote(socketId, (r) => ({ [kind]: stream ?? undefined, v: r.v + 1 }));
    if (kind === 'mic' && stream) this.monitor(socketId, stream);
  }

  // ---------------- microfone / fone ----------------

  setMuted(muted: boolean) {
    if (getV().noMic && !muted) {
      void this.restartMic().then(() => {
        if (!getV().noMic) this.setMuted(false);
      });
      return;
    }
    const patch = { muted, ...(muted ? {} : { deafened: false }) };
    setV(patch);
    this.updateGate();
    getSocket()?.emit('voice:update', patch);
    playSound(muted ? 'mute' : 'unmute');
  }

  setDeafened(deafened: boolean) {
    // Ensurdecer também silencia o microfone, como de costume
    const patch = deafened ? { deafened: true, muted: true } : { deafened: false, muted: getV().noMic };
    setV(patch);
    this.updateGate();
    getSocket()?.emit('voice:update', patch);
    playSound(deafened ? 'mute' : 'unmute');
  }

  /** Push-to-talk: chamado pelos atalhos ao apertar/soltar a tecla. */
  setPtt(down: boolean) {
    if (this.pttDown === down) return;
    this.pttDown = down;
    setV({ pttActive: down });
    this.updateGate();
  }

  /**
   * Decide se o microfone transmite agora: nunca se silenciado; no push-to-talk só com a
   * tecla apertada; na ativação por voz só quando o volume passa da sensibilidade.
   * Desligar a faixa (enabled=false) faz o navegador mandar silêncio, sem renegociar.
   */
  updateGate() {
    const { muted, settings } = getV();
    const open = !muted && (settings.inputMode === 'ptt' ? this.pttDown : this.vadOpen);
    if (this.micTrack && this.micTrack.enabled !== open) this.micTrack.enabled = open;
  }

  // ---------------- câmera ----------------

  async toggleCamera() {
    if (this.camTrack) {
      this.camTrack.stop();
      this.camTrack = null;
      for (const p of this.peers.values()) await p.setTrack('camera', null, this.msid.camera);
      setV({ camera: false, localCamera: null });
      getSocket()?.emit('voice:update', { camera: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      });
      this.camTrack = stream.getVideoTracks()[0];
      this.camTrack.onended = () => {
        if (this.camTrack) void this.toggleCamera();
      };
      for (const p of this.peers.values()) await this.addCamera(p);
      setV({ camera: true, localCamera: stream });
      getSocket()?.emit('voice:update', { camera: true });
    } catch (err) {
      console.warn(err);
      toast('Não foi possível acessar a câmera.');
    }
  }

  private async addCamera(peer: Peer) {
    await peer.setTrack('camera', this.camTrack, this.msid.camera);
    this.applyEncodings(peer);
  }

  // ---------------- transmissão de tela ----------------

  /** Deve ser chamado diretamente de um clique (exigência do navegador). */
  async startScreen() {
    if (getV().focus === 'me:screen') setV({ focus: null });
    const { settings } = getV();
    const preset = presetById(settings.screenPreset);
    const video: MediaTrackConstraints = {
      frameRate: { ideal: preset.fps, max: preset.fps },
      ...(preset.width ? { width: { ideal: preset.width, max: preset.width } } : {}),
      ...(preset.height ? { height: { ideal: preset.height, max: preset.height } } : {}),
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video,
        audio: settings.screenAudio
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
        // opções extras do Chrome/Edge
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
        surfaceSwitching: 'include',
        preferCurrentTab: false,
      } as DisplayMediaStreamOptions);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotAllowedError') toast('Não foi possível transmitir a tela.');
      return false;
    }

    this.stopScreenTracks();
    this.screenStream = stream;
    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.contentHint = settings.contentType === 'motion' ? 'motion' : 'detail';
    videoTrack.onended = () => this.stopScreen();
    for (const t of stream.getAudioTracks()) t.contentHint = 'music';

    for (const id of this.screenWatchers) {
      const p = this.peers.get(id);
      if (p) await this.addScreen(p);
    }
    setV({ screen: true, localScreen: stream });
    getSocket()?.emit('voice:update', { screen: true });
    return true;
  }

  stopScreen() {
    if (!this.screenStream) return;
    this.stopScreenTracks();
    for (const id of this.screenWatchers) {
      const p = this.peers.get(id);
      if (p) {
        void p.setTrack('screenVideo', null, this.msid.screen);
        void p.setTrack('screenAudio', null, this.msid.screen);
      }
    }
    setV((s) => ({ screen: false, localScreen: null, focus: s.focus === 'me:screen' ? null : s.focus }));
    getSocket()?.emit('voice:update', { screen: false });
  }

  private stopScreenTracks() {
    this.screenStream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.screenStream = null;
  }

  private async addScreen(peer: Peer) {
    if (!this.screenStream) return;
    const { settings } = getV();
    const video = this.screenStream.getVideoTracks()[0];
    const audio = this.screenStream.getAudioTracks()[0] ?? null;
    const transceiver = await peer.setTrack('screenVideo', video, this.msid.screen);
    if (transceiver) {
      const codec = CODECS.find((c) => c.id === settings.codec);
      if (codec) preferCodec(transceiver, codec.mime);
    }
    if (audio) await peer.setTrack('screenAudio', audio, this.msid.screen);
    this.applyEncodings(peer);
  }

  /** Aplica bitrate/FPS nos envios (repetido a cada renegociação). */
  private applyEncodings(peer: Peer) {
    const { settings } = getV();
    const preset = presetById(settings.screenPreset);
    // Via TURN cada byte conta na cota: envia uma versão mais leve só para essa pessoa.
    const save = peer.relayed && settings.turnSaver;
    if (peer.isSending('screenVideo')) {
      const height = this.screenStream?.getVideoTracks()[0]?.getSettings().height ?? 0;
      void peer.setEncoding('screenVideo', save
        ? {
            maxBitrate: Math.min(TURN_LIMITS.screen.maxBitrate, effectiveBitrate(settings)),
            maxFramerate: Math.min(TURN_LIMITS.screen.maxFramerate, preset.fps),
            scaleDown: height > TURN_LIMITS.screen.maxHeight ? height / TURN_LIMITS.screen.maxHeight : 1,
            degradation: 'balanced',
          }
        : {
            maxBitrate: effectiveBitrate(settings),
            maxFramerate: preset.fps,
            degradation: settings.contentType === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
            codecMime: CODECS.find((c) => c.id === settings.codec)?.mime,
          });
    }
    if (peer.isSending('screenAudio')) void peer.setEncoding('screenAudio', { maxBitrate: save ? 64_000 : 128_000 });
    if (peer.isSending('camera')) {
      void peer.setEncoding('camera', save ? TURN_LIMITS.camera : { maxBitrate: CAMERA_BITRATE, maxFramerate: 30 });
    }
  }

  /**
   * Estatísticas do envio da minha tela: pega o espectador com pior FPS (o gargalo).
   * Retorna null se ninguém está assistindo.
   */
  async screenSendStats(): Promise<SendStats | null> {
    let worst: SendStats | null = null;
    for (const id of this.screenWatchers) {
      const report = await this.peers.get(id)?.screenSendStats();
      if (!report) continue;
      const s: SendStats = { captureFps: 0, fps: 0, width: 0, height: 0, codec: '', hardware: null, limitedBy: 'none', bytes: 0, ts: 0 };
      report.forEach((r: any) => {
        if (r.type === 'media-source' && r.kind === 'video') s.captureFps = r.framesPerSecond ?? 0;
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          s.fps = Math.max(s.fps, r.framesPerSecond ?? 0);
          s.width = Math.max(s.width, r.frameWidth ?? 0);
          s.height = Math.max(s.height, r.frameHeight ?? 0);
          s.codec = r.codecId ? (report.get(r.codecId)?.mimeType ?? '').replace('video/', '') : s.codec;
          if (typeof r.powerEfficientEncoder === 'boolean') s.hardware = r.powerEfficientEncoder;
          if (r.qualityLimitationReason) s.limitedBy = r.qualityLimitationReason;
          s.bytes += r.bytesSent ?? 0;
          s.ts = r.timestamp;
        }
      });
      if (!worst || s.fps < worst.fps) worst = s;
    }
    return worst;
  }

  /** Quantas pessoas estão recebendo minha tela via TURN agora. */
  relayedWatchers() {
    return [...this.screenWatchers].filter((id) => this.peers.get(id)?.relayed).length;
  }

  private onWatchRequest(socketId: string, on: boolean) {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    if (on) {
      this.screenWatchers.add(socketId);
      void this.addScreen(peer);
    } else {
      this.screenWatchers.delete(socketId);
      void peer.setTrack('screenVideo', null, this.msid.screen);
      void peer.setTrack('screenAudio', null, this.msid.screen);
    }
  }

  // ---------------- assistir transmissões ----------------

  watch(socketId: string, on: boolean) {
    void this.audioCtx?.resume();
    setV((s) => {
      const watching = { ...s.watching };
      if (on) watching[socketId] = true;
      else delete watching[socketId];
      return { watching, focus: on ? `${socketId}:screen` : s.focus === `${socketId}:screen` ? null : s.focus };
    });
    this.sendWatch(socketId, on);
  }

  private sendWatch(socketId: string, on: boolean) {
    getSocket()?.emit('rtc:signal', { to: socketId, data: { type: 'watch', on } satisfies RtcSignal });
  }

  /** Diagnóstico: nível do áudio recebido de cada participante (0..1, via getStats). */
  async inboundAudioLevels(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [id, p] of this.peers) {
      const report = await p.pc.getStats();
      report.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') out[id] = Math.max(out[id] ?? 0, r.audioLevel ?? 0);
      });
    }
    return out;
  }

  async screenStats(socketId: string) {
    return this.peers.get(socketId)?.screenStats() ?? null;
  }

  /** Reaplica bitrate quando o usuário muda a qualidade durante a transmissão. */
  refreshEncodings() {
    for (const p of this.peers.values()) this.applyEncodings(p);
  }

  get uploadPeers() {
    return this.screenWatchers.size;
  }

  // ---------------- indicador de quem está falando ----------------

  private monitor(id: string, stream: MediaStream) {
    if (!this.audioCtx) return;
    const existing = this.meters.get(id);
    if (existing?.stream === stream) return;
    existing?.source.disconnect();
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.meters.set(id, { stream, source, analyser, data: new Float32Array(analyser.fftSize), lastLoud: 0 });
    } catch (err) {
      console.warn('medidor de áudio falhou', err);
    }
  }

  private startMeters() {
    if (this.meterTimer) return;
    this.meterTimer = setInterval(() => {
      const now = performance.now();
      const current = getV().speaking;
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, m] of this.meters) {
        m.analyser.getFloatTimeDomainData(m.data);
        let sum = 0;
        for (const x of m.data) sum += x * x;
        const rms = Math.sqrt(sum / m.data.length);
        let speaking: boolean;
        if (id === 'me') {
          speaking = this.meterSelf(rms, now);
        } else {
          if (rms > SPEAKING_THRESHOLD) m.lastLoud = now;
          speaking = now - m.lastLoud < 300;
        }
        next[id] = speaking;
        if (!!current[id] !== speaking) changed = true;
      }
      if (changed) setV({ speaking: next });
    }, 50);
  }

  /** Mede o próprio microfone: alimenta o medidor, a ativação por voz e o indicador de fala. */
  private meterSelf(rms: number, now: number): boolean {
    const { settings, micLevelDb } = getV();
    const db = rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
    if (Math.abs(db - micLevelDb) >= 1.5) setV({ micLevelDb: Math.round(db) });
    const threshold = settings.inputMode === 'voice' ? settings.vadThresholdDb : -50;
    if (db > threshold) this.meLastLoud = now;
    // segura aberto por 400 ms para não cortar o fim das palavras
    const loud = now - this.meLastLoud < 400;
    if (settings.inputMode === 'voice' && loud !== this.vadOpen) {
      this.vadOpen = loud;
      this.updateGate();
    }
    return !!this.micTrack?.enabled && loud;
  }
}

export const voice = new VoiceEngine();
// acesso para diagnóstico no console do navegador (e para os testes automáticos)
(globalThis as { __resenhaVoice?: VoiceEngine }).__resenhaVoice = voice;
export type { SenderSlot };
