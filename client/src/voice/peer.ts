import type { RtcSignal } from '../../../shared/types';
import type { MediaKind } from '../store/voice';
import { tuneRemoteSdp } from './sdp';

/** Diagnóstico: localStorage['resenha.forceTurn'] = '1' obriga a conexão a passar pelo TURN. */
function forceTurn() {
  try {
    return localStorage.getItem('resenha.forceTurn') === '1';
  } catch {
    return false;
  }
}

export type SenderSlot = 'mic' | 'camera' | 'screenVideo' | 'screenAudio';

export interface PeerCallbacks {
  signal(data: RtcSignal): void;
  onStream(kind: MediaKind, stream: MediaStream | null): void;
  onStreamChanged(): void;
  onConnectionState(state: RTCPeerConnectionState): void;
  onWatch(on: boolean): void;
  /** chamado quando a negociação estabiliza, para reaplicar bitrate/fps nos envios */
  onStable(): void;
  /** diagnóstico */
  log?(msg: string): void;
  /** a rota da conexão mudou entre direta (P2P) e retransmitida pelo TURN */
  onRelayChange(relayed: boolean): void;
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
  /** callbacks à espera da primeira oferta do outro lado (ver afterFirstOffer) */
  private firstOfferWaiters: (() => void)[] = [];
  private gotFirstOffer = false;
  private iceWatchdog: ReturnType<typeof setTimeout> | null = null;
  private iceRestarts = 0;
  /** true quando a mídia passa pelo servidor TURN (consome a cota) */
  relayed = false;
  private relayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly id: string,
    readonly userId: string,
    private readonly polite: boolean,
    iceServers: RTCIceServer[],
    private readonly cb: PeerCallbacks,
    /** qualidade de voz do canal em kbps */
    private readonly opusKbps = 128,
  ) {
    this.pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: forceTurn() ? 'relay' : 'all',
    });

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        this.cb.log?.(`negotiationneeded (state=${this.pc.signalingState})`);
        await this.pc.setLocalDescription();
        this.cb.log?.(`oferta enviada (state=${this.pc.signalingState})`);
        this.sendDescription();
      } catch (err) {
        this.cb.log?.(`falha ao criar oferta: ${err}`);
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
      this.cb.log?.(`connection=${state}`);
      this.cb.onConnectionState(state);
      if (state === 'failed') this.pc.restartIce();
      if (state === 'connected') {
        void this.checkRelay();
        // a rota pode mudar (ex.: Wi-Fi -> 4G), então confere periodicamente
        this.relayTimer ??= setInterval(() => void this.checkRelay(), 5000);
      }
    };

    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState !== 'stable') return;
      this.cb.onStable();
      this.armIceWatchdog();
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
        const description = { ...data.description, sdp: tuneRemoteSdp(data.description.sdp, 4000, this.opusKbps) };
        const readyForOffer =
          !this.makingOffer && (this.pc.signalingState === 'stable' || this.settingRemoteAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && collision;
        this.cb.log?.(`recebeu ${description.type} (state=${this.pc.signalingState} colisão=${collision} ignorar=${this.ignoreOffer})`);
        if (this.ignoreOffer) return;
        this.settingRemoteAnswer = description.type === 'answer';
        await this.pc.setRemoteDescription(description);
        this.settingRemoteAnswer = false;
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendDescription();
          if (!this.gotFirstOffer) {
            this.gotFirstOffer = true;
            this.firstOfferWaiters.splice(0).forEach((fn) => fn());
          }
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
      this.cb.log?.(`erro de sinalização (${data.type}): ${err}`);
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
    opts: {
      maxBitrate?: number;
      maxFramerate?: number;
      scaleDown?: number;
      degradation?: RTCDegradationPreference;
      /** codec preferido (ex.: 'video/H264'); usa a API encodings[].codec do Chrome 126+ */
      codecMime?: string;
    },
  ) {
    const sender = this.senders[slot];
    if (!sender?.track) return;
    if (opts.codecMime) await this.forceCodec(sender, opts.codecMime);
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      if (!params.encodings || params.encodings.length === 0) return; // ainda não negociado
      for (const enc of params.encodings) {
        if (opts.maxBitrate) enc.maxBitrate = opts.maxBitrate;
        if (opts.maxFramerate) enc.maxFramerate = opts.maxFramerate;
        if (sender.track.kind === 'video') enc.scaleResolutionDownBy = Math.max(1, opts.scaleDown ?? 1);
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

  /**
   * Garante o codec de envio escolhido, mesmo quando foi o outro lado quem ofereceu a
   * linha de vídeo. Só age se o codec foi negociado e o navegador suporta a API.
   */
  private async forceCodec(sender: RTCRtpSender, mime: string) {
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { codecs?: RTCRtpCodecParameters[] };
      const enc = params.encodings?.[0] as (RTCRtpEncodingParameters & { codec?: RTCRtpCodec }) | undefined;
      if (!enc || !params.codecs?.length) return;
      const wanted = params.codecs.find((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
      if (!wanted || enc.codec?.mimeType.toLowerCase() === mime.toLowerCase()) return;
      const { payloadType, ...codec } = wanted as RTCRtpCodecParameters & RTCRtpCodec;
      void payloadType;
      for (const e of params.encodings as (RTCRtpEncodingParameters & { codec?: RTCRtpCodec })[]) e.codec = codec;
      await sender.setParameters(params);
    } catch {
      /* navegador antigo: fica com o codec da negociação */
    }
  }

  /** Estatísticas de envio da tela (para quem transmite ver o que está saindo). */
  async screenSendStats(): Promise<RTCStatsReport | null> {
    const sender = this.senders.screenVideo;
    return sender?.track ? sender.getStats() : null;
  }

  /** Estatísticas de recebimento da tela (resolução, FPS, bitrate, codec). */
  async screenStats(): Promise<RTCStatsReport | null> {
    const track = this.remoteStreams.screen?.getVideoTracks()[0];
    if (!track) return null;
    const receiver = this.pc.getReceivers().find((r) => r.track === track);
    return receiver ? receiver.getStats() : null;
  }

  /** Descobre pelo getStats se o par de candidatos ICE escolhido usa TURN ("relay"). */
  private async checkRelay() {
    if (this.closed) return;
    try {
      const stats = await this.pc.getStats();
      let pair: any;
      stats.forEach((s: any) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
      });
      if (!pair) {
        stats.forEach((s: any) => {
          // Firefox não informa o par no "transport"; usa o marcado como selecionado
          if (s.type === 'candidate-pair' && (s.selected || (s.nominated && s.state === 'succeeded'))) pair ??= s;
        });
      }
      if (!pair) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      if (relayed !== this.relayed) {
        this.relayed = relayed;
        this.cb.onRelayChange(relayed);
      }
    } catch {
      /* estatísticas indisponíveis: mantém o estado atual */
    }
  }

  /**
   * Quem acabou de entrar espera a oferta de quem já estava na chamada antes de oferecer a
   * própria mídia: evita que os dois ofereçam ao mesmo tempo (o empate descartava candidatos
   * ICE e a conexão travava). Se nada chegar em `timeoutMs`, segue mesmo assim.
   */
  afterFirstOffer(fn: () => void, timeoutMs: number) {
    let done = false;
    const run = () => {
      if (done || this.closed) return;
      done = true;
      fn();
    };
    if (this.gotFirstOffer) return run();
    this.firstOfferWaiters.push(run);
    setTimeout(run, timeoutMs);
  }

  /**
   * Rede de segurança: se a negociação terminou mas o ICE não conecta em 6 s, reinicia o ICE
   * (novas credenciais e candidatos). Só o lado "impolite" reinicia, até 3 vezes.
   */
  private armIceWatchdog() {
    if (this.iceWatchdog || this.polite || this.closed) return;
    this.iceWatchdog = setTimeout(() => {
      this.iceWatchdog = null;
      if (this.closed) return;
      const ice = this.pc.iceConnectionState;
      const hasMedia = this.pc.getTransceivers().some((t) => t.currentDirection && t.currentDirection !== 'inactive');
      if (hasMedia && (ice === 'new' || ice === 'checking') && this.iceRestarts < 3) {
        this.iceRestarts++;
        this.cb.log?.(`ICE parado em "${ice}": reiniciando (tentativa ${this.iceRestarts})`);
        this.pc.restartIce();
      }
    }, 6000);
  }

  close() {
    this.closed = true;
    if (this.iceWatchdog) clearTimeout(this.iceWatchdog);
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
    this.pc.close();
  }
}
