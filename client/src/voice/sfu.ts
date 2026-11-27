import type { StreamQuality } from '../../../shared/types';
import { api } from '../lib/api';

/**
 * Etapa 3 (laboratório 'sfu'): transmissão de tela pelo servidor de mídia da Cloudflare.
 * Quem transmite manda UMA cópia em 3 qualidades (simulcast: a = original, b = ~720p, c = ~360p, todas no
 * FPS escolhido); a Cloudflare entrega a cada pessoa a qualidade que a internet dela aguenta. Assim o FPS
 * fica fixo e a internet de quem transmite não depende de quantos assistem.
 * O servidor do Resenha intermedeia tudo (server/src/sfu.ts): a chave da Cloudflare não fica no navegador.
 */
export interface SfuInfo {
  sessionId: string;
  video: string;
  audio?: string;
}
type Log = (m: string) => void;

let statusCache: { at: number; on: boolean } | null = null;
/** o servidor de mídia está ligado (configurado e dentro do limite do mês)? */
export async function sfuAvailable(): Promise<boolean> {
  if (typeof RTCPeerConnection === 'undefined') return false;
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.on;
  const on = await api<{ enabled: boolean }>('/sfu/status').then((r) => !!r.enabled, () => false);
  statusCache = { at: Date.now(), on };
  return on;
}

function waitConnected(pc: RTCPeerConnection, ms = 12_000) {
  return new Promise<void>((ok, fail) => {
    if (pc.connectionState === 'connected') return ok();
    const t = setTimeout(() => fail(new Error('o servidor de mídia não conectou')), ms);
    pc.addEventListener('connectionstatechange', function on() {
      if (pc.connectionState === 'connected') {
        clearTimeout(t);
        pc.removeEventListener('connectionstatechange', on);
        ok();
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        clearTimeout(t);
        fail(new Error(`servidor de mídia: ${pc.connectionState}`));
      }
    });
  });
}

async function newSession() {
  const s = await api<{ sessionId: string; iceServers: RTCIceServer[] }>('/sfu/sessions', { body: {} });
  const pc = new RTCPeerConnection({ iceServers: s.iceServers, bundlePolicy: 'max-bundle' });
  return { sessionId: s.sessionId, pc };
}

/** 3 qualidades no mesmo FPS: a (original), b (~720p) e c (~360p); a internet de quem assiste escolhe */
export function simulcastLayers(height: number, fps: number, bitrate: number): RTCRtpEncodingParameters[] {
  const h = height || 1080;
  // a original primeiro: se o outro lado não aceitar várias qualidades, o navegador manda só a primeira
  const layers: RTCRtpEncodingParameters[] = [
    { rid: 'a', scaleResolutionDownBy: 1, maxBitrate: bitrate, maxFramerate: fps },
    { rid: 'b', scaleResolutionDownBy: Math.max(1, h / 720), maxBitrate: Math.round(Math.min(bitrate * 0.45, 3_500_000)), maxFramerate: fps },
    { rid: 'c', scaleResolutionDownBy: Math.max(1, h / 360), maxBitrate: Math.round(Math.min(bitrate * 0.15, 1_000_000)), maxFramerate: fps },
  ];
  // tela pequena (até 720p): a e b ficariam iguais; fica só a original e a de ~360p
  return h <= 720 ? layers.filter((l) => l.rid !== 'b') : layers;
}

/** Quem transmite: publica a tela na Cloudflare. */
export class SfuPublisher {
  private constructor(
    readonly pc: RTCPeerConnection,
    readonly sessionId: string,
    readonly info: SfuInfo,
    private mids: string[],
  ) {}

  static async start(video: MediaStreamTrack, audio: MediaStreamTrack | null, o: { fps: number; bitrate: number; codec: string }, log: Log) {
    const { sessionId, pc } = await newSession();
    try {
      const height = video.getSettings().height ?? 1080;
      const tv = pc.addTransceiver(video, { direction: 'sendonly', sendEncodings: simulcastLayers(height, o.fps, o.bitrate) });
      // codec: H.264 usa a placa de vídeo na maioria dos PCs; VP8 é o plano B (todo navegador tem)
      const caps = RTCRtpSender.getCapabilities?.('video')?.codecs ?? [];
      const want = o.codec === 'vp8' ? ['video/VP8', 'video/H264'] : ['video/H264', 'video/VP8'];
      const sorted = [...caps].sort((a, b) => (want.indexOf(a.mimeType) + 1 || 9) - (want.indexOf(b.mimeType) + 1 || 9));
      try {
        if (sorted.length) tv.setCodecPreferences(sorted);
      } catch {
        /* navegador sem setCodecPreferences */
      }
      const ta = audio ? pc.addTransceiver(audio, { direction: 'sendonly' }) : null;
      await pc.setLocalDescription(await pc.createOffer());
      const tracks = [{ mid: tv.mid!, kind: 'video' as const }, ...(ta ? [{ mid: ta.mid!, kind: 'audio' as const }] : [])];
      const r = await api<{ sessionDescription: RTCSessionDescriptionInit; tracks: { mid: string; trackName: string; kind: 'video' | 'audio' }[] }>(`/sfu/sessions/${sessionId}/publish`, {
        body: { sessionDescription: { type: 'offer', sdp: pc.localDescription!.sdp }, tracks },
      });
      await pc.setRemoteDescription(r.sessionDescription);
      await waitConnected(pc);
      // jogo: segura o FPS e baixa a resolução quando apertar (e não o contrário)
      const p = tv.sender.getParameters();
      p.degradationPreference = 'maintain-framerate';
      await tv.sender.setParameters(p).catch(() => {});
      const info: SfuInfo = { sessionId, video: r.tracks.find((t) => t.kind === 'video')!.trackName, audio: r.tracks.find((t) => t.kind === 'audio')?.trackName };
      log(`sfu: publicando ${height}p${o.fps} em ${tv.sender.getParameters().encodings.length} qualidades`);
      return new SfuPublisher(pc, sessionId, info, tracks.map((t) => t.mid));
    } catch (err) {
      pc.close();
      throw err;
    }
  }

  /** troca o som da transmissão (ligou/desligou o áudio do PC) */
  async replaceAudio(track: MediaStreamTrack | null) {
    const t = this.pc.getTransceivers().find((x) => x.sender.track?.kind === 'audio' || x.mid === this.mids[1]);
    await t?.sender.replaceTrack(track).catch(() => {});
  }

  /** bytes enviados e FPS de cada qualidade (diagnóstico) */
  async stats() {
    const out: { rid: string; fps: number; height: number }[] = [];
    let bytes = 0;
    (await this.pc.getStats()).forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'video') out.push({ rid: r.rid ?? '?', fps: Math.round(r.framesPerSecond ?? 0), height: r.frameHeight ?? 0 });
      if (r.type === 'transport') bytes += r.bytesSent ?? 0;
    });
    return { layers: out, bytes };
  }

  close() {
    void api(`/sfu/sessions/${this.sessionId}/close`, { method: 'PUT', body: { mids: this.mids } }).catch(() => {});
    this.pc.close();
  }
}

const QUALITY: Record<StreamQuality, { rid: 'a' | 'b' | 'c'; auto: boolean }> = {
  auto: { rid: 'a', auto: true },
  source: { rid: 'a', auto: false },
  '720': { rid: 'b', auto: false },
  '480': { rid: 'c', auto: false },
};

/** Quem assiste: puxa a transmissão de alguém pela Cloudflare. */
export class SfuViewer {
  readonly stream = new MediaStream();
  private videoMid: string | null = null;
  private constructor(
    readonly pc: RTCPeerConnection,
    readonly sessionId: string,
    readonly remote: SfuInfo,
    private mids: string[],
  ) {}

  static async pull(remote: SfuInfo, quality: StreamQuality, log: Log) {
    const { sessionId, pc } = await newSession();
    try {
      const got = new Map<string, MediaStreamTrack>();
      pc.ontrack = (e) => e.transceiver.mid && got.set(e.transceiver.mid, e.track);
      const q = QUALITY[quality] ?? QUALITY.auto;
      const names = [remote.video, ...(remote.audio ? [remote.audio] : [])];
      const r = await api<{ sessionDescription?: RTCSessionDescriptionInit; requiresImmediateRenegotiation: boolean; tracks: { mid?: string; trackName: string }[] }>(`/sfu/sessions/${sessionId}/pull`, {
        body: { remoteSessionId: remote.sessionId, tracks: names, preferredRid: q.rid, auto: q.auto },
      });
      if (r.requiresImmediateRenegotiation && r.sessionDescription) {
        await pc.setRemoteDescription(r.sessionDescription);
        await pc.setLocalDescription(await pc.createAnswer());
        await api(`/sfu/sessions/${sessionId}/renegotiate`, { method: 'PUT', body: { sessionDescription: { type: 'answer', sdp: pc.localDescription!.sdp } } });
      }
      await waitConnected(pc);
      const v = new SfuViewer(pc, sessionId, remote, r.tracks.map((t) => t.mid).filter((m): m is string => !!m));
      for (const t of r.tracks) {
        const track = t.mid ? got.get(t.mid) ?? pc.getTransceivers().find((x) => x.mid === t.mid)?.receiver.track : undefined;
        if (!track) continue;
        v.stream.addTrack(track);
        if (t.trackName === remote.video) v.videoMid = t.mid ?? null;
      }
      if (!v.stream.getVideoTracks().length) throw new Error('o vídeo da transmissão não chegou');
      log(`sfu: assistindo (${quality})`);
      return v;
    } catch (err) {
      pc.close();
      throw err;
    }
  }

  async setQuality(quality: StreamQuality) {
    const q = QUALITY[quality] ?? QUALITY.auto;
    if (!this.videoMid) return;
    await api(`/sfu/sessions/${this.sessionId}/quality`, {
      method: 'PUT',
      body: { mid: this.videoMid, remoteSessionId: this.remote.sessionId, trackName: this.remote.video, preferredRid: q.rid, auto: q.auto },
    }).catch(() => {});
  }

  /** bytes recebidos e FPS/altura do vídeo (para o painel de saúde e o limite do mês) */
  async stats() {
    let bytes = 0;
    let fps = 0;
    let height = 0;
    (await this.pc.getStats()).forEach((r) => {
      if (r.type === 'transport') bytes += r.bytesReceived ?? 0;
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        fps = Math.round(r.framesPerSecond ?? 0);
        height = r.frameHeight ?? 0;
      }
    });
    return { bytes, fps, height };
  }

  close() {
    void api(`/sfu/sessions/${this.sessionId}/close`, { method: 'PUT', body: { mids: this.mids } }).catch(() => {});
    this.stream.getTracks().forEach((t) => t.stop());
    this.pc.close();
  }
}
