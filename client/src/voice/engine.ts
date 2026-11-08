import type { Socket } from 'socket.io-client';
import type { RtcSignal } from '../../../shared/types';
import { api } from '../lib/api';
import { getSocket, onSocketReady } from '../lib/socket';
import { findChannel, toast, useApp } from '../store/app';
import { useVoice, type MediaKind, type RemoteMedia } from '../store/voice';
import { Peer, type SenderSlot } from './peer';
import { preferCodec } from './sdp';
import { CODECS, effectiveBitrate, presetById } from './settings';

const CAMERA_BITRATE = 1_200_000;
const SPEAKING_THRESHOLD = 0.015;

type Meter = { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer>; lastLoud: number };

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

  constructor() {
    onSocketReady((socket) => {
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
      if (getV().status !== 'idle') this.createPeer(socketId, userId);
    });
    socket.on('voice:peer-left', ({ socketId }: { socketId: string }) => this.closePeer(socketId));
    socket.on('voice:kicked', ({ reason }: { reason: string }) => {
      this.leave(false);
      toast(reason);
    });
    socket.on('rtc:signal', ({ from, data }: { from: string; data: RtcSignal }) => {
      if (getV().status === 'idle') return;
      let peer = this.peers.get(from);
      if (!peer) {
        const state = useApp.getState().voiceStates[from];
        if (!state || state.channelId !== getV().channelId) return;
        peer = this.createPeer(from, state.userId);
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
    setV({ status: 'connecting', channelId, guildId: channel.guildId });
    try {
      // AudioContext precisa nascer de um clique do usuário (regra de autoplay dos navegadores)
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      void this.audioCtx.resume();

      if (!this.iceServers) {
        this.iceServers = await api<{ iceServers: RTCIceServer[] }>('/ice')
          .then((r) => r.iceServers)
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
      if (getV().channelId !== channelId) return; // saiu enquanto conectava

      setV({ status: 'connected' });
      if (getV().camera || getV().screen) {
        socket.emit('voice:update', { camera: !!this.camTrack, screen: !!this.screenStream });
      }
      for (const p of res.peers ?? []) this.createPeer(p.socketId, p.userId);
      this.startMeters();
    } finally {
      this.joining = false;
    }
  }

  leave(notifyServer = true) {
    if (notifyServer) getSocket()?.emit('voice:leave');
    this.resetPeers();
    this.micTrack?.stop();
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
    });
  }

  private resetPeers() {
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
      this.micTrack.enabled = !getV().muted;
      this.monitor('me', new MediaStream([this.micTrack]));
      setV({ noMic: false });
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
    this.micTrack = null;
    setV({ noMic: false });
    await this.acquireMic();
    for (const p of this.peers.values()) await p.setTrack('mic', this.micTrack, this.msid.mic);
  }

  // ---------------- pares ----------------

  private createPeer(socketId: string, userId: string): Peer {
    const existing = this.peers.get(socketId);
    if (existing) return existing;
    const mySocketId = getSocket()?.id ?? '';
    const peer = new Peer(socketId, userId, mySocketId < socketId, this.iceServers ?? [], {
      signal: (data) => getSocket()?.emit('rtc:signal', { to: socketId, data }),
      onStream: (kind, stream) => this.onRemoteStream(socketId, kind, stream),
      onStreamChanged: () => this.patchRemote(socketId, (r) => ({ v: r.v + 1 })),
      onConnectionState: (connection) => this.patchRemote(socketId, () => ({ connection })),
      onWatch: (on) => this.onWatchRequest(socketId, on),
      onStable: () => this.applyEncodings(peer),
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

    if (this.micTrack) void peer.setTrack('mic', this.micTrack, this.msid.mic);
    if (this.camTrack) void this.addCamera(peer);
    // após reconexão, refaz o pedido para continuar assistindo a tela dessa pessoa
    if (getV().watching[socketId]) this.sendWatch(socketId, true);
    return peer;
  }

  private closePeer(socketId: string) {
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
    if (this.micTrack) this.micTrack.enabled = !muted;
    const patch = { muted, ...(muted ? {} : { deafened: false }) };
    setV(patch);
    getSocket()?.emit('voice:update', patch);
  }

  setDeafened(deafened: boolean) {
    // Ensurdecer também silencia o microfone, como de costume
    const patch = deafened ? { deafened: true, muted: true } : { deafened: false, muted: getV().noMic };
    if (this.micTrack) this.micTrack.enabled = !patch.muted;
    setV(patch);
    getSocket()?.emit('voice:update', patch);
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
    await peer.setEncoding('camera', { maxBitrate: CAMERA_BITRATE, maxFramerate: 30 });
  }

  // ---------------- transmissão de tela ----------------

  /** Deve ser chamado diretamente de um clique (exigência do navegador). */
  async startScreen() {
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
    if (peer.isSending('screenVideo')) {
      void peer.setEncoding('screenVideo', {
        maxBitrate: effectiveBitrate(settings),
        maxFramerate: preset.fps,
        degradation: settings.contentType === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
      });
    }
    if (peer.isSending('screenAudio')) void peer.setEncoding('screenAudio', { maxBitrate: 128_000 });
    if (peer.isSending('camera')) void peer.setEncoding('camera', { maxBitrate: CAMERA_BITRATE, maxFramerate: 30 });
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
        if (rms > SPEAKING_THRESHOLD) m.lastLoud = now;
        const speaking = now - m.lastLoud < 300 && !(id === 'me' && getV().muted);
        next[id] = speaking;
        if (!!current[id] !== speaking) changed = true;
      }
      if (changed) setV({ speaking: next });
    }, 100);
  }
}

export const voice = new VoiceEngine();
export type { SenderSlot };
