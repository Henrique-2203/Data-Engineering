import type { RtcSignal } from '../../../shared/types';
import type { MediaKind } from '../store/voice';
import { tuneRemoteSdp } from './sdp';

export type SenderSlot = 'mic' | 'camera' | 'screenVideo' | 'screenAudio';

export interface PeerCallbacks {
  signal(data: RtcSignal): void;
  onStream(kind: MediaKind, stream: MediaStream | null): void;
  onStreamChanged(): void;
  onConnectionState(state: RTCPeerConnectionState): void;
  onWatch(on: boolean): void;
  /** chamado quando a negociação estabiliza, para reaplicar bitrate/fps nos envios */
  onStable(): void;
}

/**
 * Uma conexão WebRTC com outro participante, usando o padrão "perfect negotiation"
 * (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example): os dois lados podem
 * adicionar/remover mídia a qualquer momento sem conflito de ofertas.
 */
export class Peer {
  readonly pc: RTCPeerConnection;
  readonly senders: Partial<Record<SenderSlot, RTCRtpSender>> = {};
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private remoteMeta: Record<string, MediaKind> = {};
  private remoteStreams: Partial<Record<MediaKind, MediaStream>> = {};
  private closed = false;

  constructor(
    readonly id: string,
    readonly userId: string,
    private readonly polite: boolean,
    iceServers: RTCIceServer[],
    private readonly cb: PeerCallbacks,
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.sendDescription();
      } catch (err) {
        console.warn('[rtc] falha ao criar oferta', err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.cb.signal({ type: 'candidate', candidate: candidate.toJSON() });
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.cb.onConnectionState(state);
      if (state === 'failed') this.pc.restartIce();
    };

    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable') this.cb.onStable();
    };

    this.pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      const kind = this.remoteMeta[stream.id] ?? (e.track.kind === 'audio' ? 'mic' : 'camera');
      this.remoteStreams[kind] = stream;
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0 && this.remoteStreams[kind] === stream) {
          delete this.remoteStreams[kind];
          this.cb.onStream(kind, null);
        } else {
          this.cb.onStreamChanged();
        }
      };
      stream.onaddtrack = () => this.cb.onStreamChanged();
      e.track.onunmute = () => this.cb.onStreamChanged();
      this.cb.onStream(kind, stream);
    };
  }

  private sendDescription() {
    const d = this.pc.localDescription;
    if (d && (d.type === 'offer' || d.type === 'answer')) {
      this.cb.signal({ type: 'description', description: { type: d.type, sdp: d.sdp } });
    }
  }

  async handle(data: RtcSignal) {
    if (this.closed) return;
    try {
      if (data.type === 'description') {
        const description = { ...data.description, sdp: tuneRemoteSdp(data.description.sdp) };
        const readyForOffer =
          !this.makingOffer && (this.pc.signalingState === 'stable' || this.settingRemoteAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        this.settingRemoteAnswer = description.type === 'answer';
        await this.pc.setRemoteDescription(description);
        this.settingRemoteAnswer = false;
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendDescription();
        }
      } else if (data.type === 'candidate') {
        try {
          await this.pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      } else if (data.type === 'meta') {
        this.remoteMeta = data.streams;
      } else if (data.type === 'watch') {
        this.cb.onWatch(data.on);
      }
    } catch (err) {
      console.warn('[rtc] erro de sinalização', err);
    }
  }

  transceiverOf(sender: RTCRtpSender) {
    return this.pc.getTransceivers().find((t) => t.sender === sender);
  }

  /**
   * Liga/desliga uma faixa de mídia neste par. Reaproveita o mesmo transceiver
   * (só troca a faixa e a direção), evitando acumular linhas na SDP.
   */
  async setTrack(slot: SenderSlot, track: MediaStreamTrack | null, stream: MediaStream): Promise<RTCRtpTransceiver | null> {
    if (this.closed) return null;
    const sender = this.senders[slot];
    if (track) {
      if (sender) {
        await sender.replaceTrack(track);
        const t = this.transceiverOf(sender);
        if (t && t.direction !== 'sendrecv') t.direction = 'sendrecv';
        return t ?? null;
      }
      const s = this.pc.addTrack(track, stream);
      this.senders[slot] = s;
      return this.transceiverOf(s) ?? null;
    }
    if (sender) {
      await sender.replaceTrack(null);
      const t = this.transceiverOf(sender);
      if (t && t.direction === 'sendrecv') t.direction = 'recvonly';
    }
    return null;
  }

  isSending(slot: SenderSlot) {
    const s = this.senders[slot];
    return !!s?.track;
  }

  async setEncoding(
    slot: SenderSlot,
    opts: { maxBitrate?: number; maxFramerate?: number; degradation?: RTCDegradationPreference },
  ) {
    const sender = this.senders[slot];
    if (!sender?.track) return;
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      if (!params.encodings || params.encodings.length === 0) return; // ainda não negociado
      for (const enc of params.encodings) {
        if (opts.maxBitrate) enc.maxBitrate = opts.maxBitrate;
        if (opts.maxFramerate) enc.maxFramerate = opts.maxFramerate;
        if (sender.track.kind === 'video') enc.scaleResolutionDownBy = 1;
        enc.priority = slot === 'mic' ? 'high' : slot === 'screenVideo' ? 'high' : 'medium';
        enc.networkPriority = enc.priority;
      }
      if (opts.degradation) params.degradationPreference = opts.degradation;
      await sender.setParameters(params);
    } catch (err) {
      // alguns navegadores não aceitam todos os campos; tenta só o essencial
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) return;
        if (opts.maxBitrate) params.encodings[0].maxBitrate = opts.maxBitrate;
        await sender.setParameters(params);
      } catch {
        console.warn('[rtc] setParameters falhou', err);
      }
    }
  }

  /** Estatísticas de recebimento da tela (resolução, FPS, bitrate, codec). */
  async screenStats(): Promise<RTCStatsReport | null> {
    const track = this.remoteStreams.screen?.getVideoTracks()[0];
    if (!track) return null;
    const receiver = this.pc.getReceivers().find((r) => r.track === track);
    return receiver ? receiver.getStats() : null;
  }

  close() {
    this.closed = true;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
    this.pc.close();
  }
}
