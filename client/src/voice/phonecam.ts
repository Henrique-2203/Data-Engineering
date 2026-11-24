import type { Socket } from 'socket.io-client';
import type { RtcSignal } from '../../../shared/types';

/**
 * Ligação direta entre o celular e o computador da MESMA conta (câmera do celular como câmera do
 * computador). A negociação passa pelo servidor (phonecam:signal), a imagem vai direto entre os
 * aparelhos. O celular oferece; o computador responde. Só vídeo, sem som (o som continua no
 * microfone do computador).
 */
export class PhoneLink {
  readonly pc: RTCPeerConnection;
  private queue: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private closed = false;

  constructor(
    private socket: Socket,
    /** socket do outro aparelho */
    readonly to: string,
    iceServers: RTCIceServer[],
    private cb: { onStream?(stream: MediaStream): void; onState?(state: RTCPeerConnectionState): void } = {},
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'candidate', candidate: e.candidate.toJSON() });
    };
    this.pc.ontrack = (e) => cb.onStream?.(e.streams[0] ?? new MediaStream([e.track]));
    this.pc.onconnectionstatechange = () => !this.closed && cb.onState?.(this.pc.connectionState);
  }

  private send(data: RtcSignal) {
    this.socket.emit('phonecam:signal', { to: this.to, data });
  }

  /** celular: manda a imagem para o computador */
  async offer(track: MediaStreamTrack, stream: MediaStream) {
    const sender = this.pc.addTrack(track, stream);
    // até ~2 Mbps e 30 FPS bastam para uma câmera 720p
    try {
      const p = sender.getParameters();
      p.encodings = p.encodings?.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = 2_000_000;
      p.encodings[0].maxFramerate = 30;
      await sender.setParameters(p);
    } catch {
      /* navegador sem esse ajuste */
    }
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.send({ type: 'description', description: { type: 'offer', sdp: this.pc.localDescription!.sdp } });
    return sender;
  }

  async handle(data: RtcSignal) {
    if (this.closed) return;
    if (data.type === 'description') {
      await this.pc.setRemoteDescription(data.description);
      this.remoteSet = true;
      for (const c of this.queue.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
      if (data.description.type === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.send({ type: 'description', description: { type: 'answer', sdp: this.pc.localDescription!.sdp } });
      }
    } else if (data.type === 'candidate') {
      const c = data.candidate as RTCIceCandidateInit;
      if (this.remoteSet) await this.pc.addIceCandidate(c).catch(() => {});
      else this.queue.push(c);
    }
  }

  close() {
    this.closed = true;
    this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}
