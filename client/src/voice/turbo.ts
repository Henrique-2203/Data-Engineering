/**
 * Transmissão turbo: o vídeo da tela é codificado UMA vez (WebCodecs, pela placa de vídeo quando dá)
 * e os mesmos pacotes vão para cada pessoa assistindo por um canal de dados direto (RTCDataChannel).
 *
 * Por que é mais estável que mandar a tela como faixa de vídeo do WebRTC:
 *  - no WebRTC cada espectador ganha um codificador próprio (3 amigos = 3 codificações no seu PC);
 *  - o controle interno do WebRTC derruba o FPS sozinho quando acha que o processador está ocupado;
 *  - aqui NÓS decidimos o ritmo: sob pressão a resolução cai, o FPS não; e quem tem internet mais
 *    lenta perde quadros só para ele, sem piorar a transmissão de todo mundo.
 * Quem não suporta (navegador antigo, Firefox/Safari transmitindo) usa a transmissão normal do WebRTC.
 */

import type { StreamQuality } from '../../../shared/types';

export const TURBO_LABEL = 'resenha-screen';

/** ordem de preferência: H.264 (placa de vídeo em quase todo PC), depois VP9/VP8 */
const CODECS = ['avc1.64002A', 'avc1.4D402A', 'avc1.42E02A', 'vp09.00.41.08', 'vp8'];
const PART = 60_000; // tamanho de cada pedaço enviado (o limite do canal é 256 KB)
const HEADER = 20;
const HIGH_WATER = 1_500_000; // fila de envio acima disso: a internet desse espectador não está dando conta

type Log = (msg: string) => void;

declare global {
  // APIs do Chrome/Edge/Electron que ainda não estão nos tipos do TypeScript
  class MediaStreamTrackProcessor<T = VideoFrame> {
    constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
    readonly readable: ReadableStream<T>;
  }
  class MediaStreamTrackGenerator extends MediaStreamTrack {
    constructor(init: { kind: 'video' | 'audio' });
    readonly writable: WritableStream<VideoFrame>;
  }
}

export const turboCanSend = () =>
  typeof window !== 'undefined' && 'MediaStreamTrackProcessor' in window && 'VideoEncoder' in window && 'VideoFrame' in window;
export const turboCanReceive = () => typeof window !== 'undefined' && 'VideoDecoder' in window && 'EncodedVideoChunk' in window;

let decodable: Promise<string[]> | null = null;
/** Codecs que este aparelho consegue decodificar (vai junto do pedido para assistir). */
export function decodableCodecs(): Promise<string[]> {
  if (!turboCanReceive()) return Promise.resolve([]);
  decodable ??= (async () => {
    const out: string[] = [];
    for (const codec of CODECS) {
      try {
        if ((await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })).supported) out.push(codec);
      } catch {
        /* não suportado */
      }
    }
    return out;
  })();
  return decodable;
}

const codecName = (c: string) => (c.startsWith('avc1') ? 'H.264' : c.startsWith('vp09') ? 'VP9' : c.toUpperCase());
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// ======================================================================
// Quem transmite
// ======================================================================

/**
 * Qualidade que cada pessoa escolhe para assistir. 'auto' (padrão): o Resenha desce para 720p/480p
 * quando a internet DELA não dá conta e sobe de novo quando melhora. As versões menores só são
 * codificadas enquanto alguém está nelas (e são as primeiras a parar se o PC de quem transmite apertar).
 */
export type { StreamQuality };
export const QUALITY_HEIGHTS = [720, 480] as const;

/** bitrate de cada versão menor (nunca acima do da transmissão original) */
const layerBitrate = (h: number, fps: number, max: number) => Math.min(max, h >= 720 ? (fps >= 50 ? 4_000_000 : 2_500_000) : fps >= 50 ? 2_000_000 : 1_200_000);

interface Layer {
  h: number;
  encoder: VideoEncoder;
  config: VideoEncoderConfig;
  forceKey: boolean;
  frameNo: number;
  lastKeyReq: number;
}

interface Viewer {
  id: string;
  dc: RTCDataChannel;
  /** o que a pessoa escolheu */
  want: StreamQuality;
  /** no automático: a altura que o Resenha escolheu (0 = original) */
  autoH: number;
  /** versão que ela está recebendo agora (0 = original) */
  layerH: number;
  /** segundos seguidos com problema / sem problema (para o automático e a sugestão) */
  bad: number;
  good: number;
  /** quanto esperar (s) sem problema antes de tentar subir a qualidade de novo */
  upWait: number;
  lastUp: number;
  lastHint: number;
  /** quadros pulados porque a fila de envio dela encheu (internet dela) neste segundo */
  netSkips: number;
  /** perdeu quadros por fila cheia: só volta a receber no próximo quadro-chave */
  waitKey: boolean;
  needCfg: boolean;
  sentFrames: number;
  skipped: number;
  bytes: number;
  /** FPS que ele está conseguindo mostrar (ele avisa a cada segundo) */
  shownFps: number;
}

export interface TurboSendStats {
  captureFps: number;
  encodeFps: number;
  width: number;
  height: number;
  codec: string;
  /** o navegador não diz se é placa de vídeo; o que importa é o tempo por quadro (encodeMs) */
  hardware: boolean | null;
  /** tempo médio para codificar um quadro (ms) */
  encodeMs: number;
  /** quadros que o codificador não conseguiu acompanhar (por segundo) */
  encoderDrops: number;
  viewers: { id: string; fps: number; shownFps: number; skipped: number; mbps: number; height: number; want: StreamQuality }[];
  /** versões menores sendo codificadas agora (alturas) */
  layers: number[];
}

export class TurboSender {
  private viewers = new Map<string, Viewer>();
  private encoder: VideoEncoder | null = null;
  private config: VideoEncoderConfig | null = null;
  /** pedimos a placa de vídeo ("prefer-hardware")? O navegador pode cair no software sem avisar. */
  private hardware: boolean | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private stopped = false;
  private lastTs = -Infinity;
  private frameNo = 0;
  private seq = 0;
  private forceKey = true;
  private lastKeyReq = 0;
  private srcW = 0;
  private srcH = 0;
  /** alvo atual (muda com o modo leve) */
  private target: { fps: number; bitrate: number; maxHeight: number };
  // contadores para as estatísticas (zerados a cada leitura)
  private counters = { captured: 0, encoded: 0, encoderDrops: 0, layerDrops: 0, encodeMsSum: 0, at: performance.now() };
  private lastStats: TurboSendStats | null = null;
  /** quando cada quadro entrou no codificador (para medir o tempo de codificação) */
  private inFlight = new Map<number, number>();
  /** versões menores (720p/480p), só enquanto alguém assiste nelas */
  private layers = new Map<number, Layer>();

  constructor(
    private track: MediaStreamTrack,
    target: { fps: number; bitrate: number; maxHeight: number },
    private log: Log = () => {},
  ) {
    this.target = target;
    void this.pump();
  }

  get active() {
    return this.viewers.size > 0;
  }

  /** Começa a mandar para esta pessoa. Retorna false se ela não consegue decodificar o que estamos codificando. */
  async addViewer(id: string, dc: RTCDataChannel, decoders: string[], want: StreamQuality = 'auto'): Promise<boolean> {
    if (this.stopped) return false;
    if (!this.encoder) {
      const ok = await this.openEncoder(decoders);
      if (!ok) return false;
    } else if (!decoders.includes(this.config!.codec)) {
      return false;
    }
    dc.binaryType = 'arraybuffer';
    const v: Viewer = {
      id,
      dc,
      want,
      autoH: 0,
      layerH: 0,
      bad: 0,
      good: 0,
      upWait: 30,
      lastUp: -Infinity,
      lastHint: -Infinity,
      netSkips: 0,
      waitKey: true,
      needCfg: true,
      sentFrames: 0,
      skipped: 0,
      bytes: 0,
      shownFps: 0,
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const m = JSON.parse(e.data) as { t: string; fps?: number };
        if (m.t === 'key') this.requestKey(this.viewers.get(id)?.layerH ?? 0);
        if (m.t === 'st' && typeof m.fps === 'number') v.shownFps = m.fps;
      } catch {
        /* mensagem inválida */
      }
    };
    dc.onclose = () => {
      if (this.viewers.get(id)?.dc !== dc) return;
      this.viewers.delete(id);
      this.rebind();
    };
    this.viewers.set(id, v);
    this.forceKey = true;
    this.rebind();
    this.log(`turbo: +${id.slice(0, 6)} (${this.config!.codec}${this.hardware === false ? ', processador' : ''})`);
    return true;
  }

  removeViewer(id: string) {
    const v = this.viewers.get(id);
    if (!v) return;
    this.viewers.delete(id);
    try {
      v.dc.close();
    } catch {
      /* já fechado */
    }
    this.rebind();
  }

  /** A pessoa escolheu outra qualidade para assistir. */
  setWant(id: string, want: StreamQuality) {
    const v = this.viewers.get(id);
    if (!v || v.want === want) return;
    v.want = want;
    v.autoH = 0;
    v.bad = 0;
    v.good = 0;
    v.upWait = 30;
    this.rebind();
  }

  /** altura da versão original sendo codificada agora */
  private get mainH() {
    return this.config?.height ?? 0;
  }

  /** versão que a pessoa deve receber: 0 (original) ou uma versão menor que a original */
  private effective(v: Viewer) {
    const req = v.want === 'auto' ? v.autoH : v.want === 'source' ? 0 : Number(v.want);
    return req && req < this.mainH ? req : 0;
  }

  /** Liga cada pessoa à versão certa; cria as versões que alguém precisa e fecha as que ninguém usa. */
  private rebind() {
    const used = new Set<number>();
    for (const v of this.viewers.values()) {
      const h = this.effective(v);
      used.add(h);
      if (h && !this.layers.has(h)) this.openLayer(h);
      if (h && !this.layers.has(h)) {
        // não deu para criar a versão menor: fica na original
        v.layerH = 0;
        continue;
      }
      if (v.layerH !== h) {
        v.layerH = h;
        v.waitKey = true;
        v.needCfg = true;
        this.requestKey(h, true);
      }
    }
    for (const [h, L] of this.layers) {
      if (used.has(h)) continue;
      this.layers.delete(h);
      try {
        if (L.encoder.state !== 'closed') L.encoder.close();
      } catch {
        /* já fechado */
      }
      this.log(`turbo: parou a versão ${h}p (ninguém assistindo nela)`);
    }
  }

  private layerConfig(h: number): VideoEncoderConfig | null {
    if (!this.config || !this.srcW || !this.srcH) return null;
    const k = this.srcH > h ? h / this.srcH : 1;
    return {
      ...this.config,
      width: even(this.srcW * k),
      height: even(this.srcH * k),
      bitrate: layerBitrate(h, this.target.fps, this.target.bitrate),
      framerate: this.target.fps,
    };
  }

  private openLayer(h: number) {
    const config = this.layerConfig(h);
    if (!config) return;
    try {
      const L: Layer = {
        h,
        config,
        forceKey: true,
        frameNo: 0,
        lastKeyReq: 0,
        encoder: new VideoEncoder({
          output: (chunk) => this.onChunk(chunk, h),
          error: (e) => {
            this.log(`turbo: erro na versão ${h}p: ${e}`);
            // a versão menor quebrou: quem estava nela volta para a original
            this.layers.delete(h);
            for (const v of this.viewers.values()) {
              if (v.layerH !== h) continue;
              v.layerH = 0;
              v.waitKey = true;
              v.needCfg = true;
            }
            this.requestKey(0, true);
          },
        }),
      };
      L.encoder.configure(config);
      this.layers.set(h, L);
      this.log(`turbo: começou a versão ${h}p (${config.width}x${config.height})`);
    } catch (e) {
      this.log(`turbo: não deu para criar a versão ${h}p: ${e}`);
    }
  }

  has(id: string) {
    return this.viewers.has(id);
  }

  /** Modo leve / qualidade mudou: aplica no codificador (o FPS é mantido; cai a resolução). */
  setTarget(target: { fps: number; bitrate: number; maxHeight: number }) {
    this.target = target;
    if (this.encoder && this.srcW) this.configure(this.srcW, this.srcH);
  }

  /** pede um quadro-chave na versão `h` (0 = original) */
  private requestKey(h = 0, force = false) {
    const now = performance.now();
    if (h) {
      const L = this.layers.get(h);
      if (!L || (!force && now - L.lastKeyReq < 300)) return;
      L.lastKeyReq = now;
      L.forceKey = true;
      return;
    }
    if (!force && now - this.lastKeyReq < 300) return;
    this.lastKeyReq = now;
    this.forceKey = true;
  }

  /** Escolhe o codec: o primeiro que a placa de vídeo codifica e o espectador decodifica; senão, por software. */
  private async openEncoder(decoders: string[]) {
    const s = this.track.getSettings();
    const { width, height } = this.scaled(s.width ?? 1280, s.height ?? 720);
    const base = { width, height, bitrate: this.target.bitrate, framerate: this.target.fps, latencyMode: 'realtime' as const };
    const candidates = CODECS.filter((c) => decoders.includes(c));
    let chosen: { codec: string; hw: boolean } | null = null;
    for (const hw of [true, false]) {
      for (const codec of candidates) {
        const cfg: VideoEncoderConfig = {
          ...base,
          codec,
          hardwareAcceleration: hw ? 'prefer-hardware' : 'prefer-software',
          ...(codec.startsWith('avc1') ? { avc: { format: 'annexb' } } : {}),
        };
        try {
          const r = await VideoEncoder.isConfigSupported(cfg);
          if (r.supported) {
            chosen = { codec, hw };
            break;
          }
        } catch {
          /* config inválida neste aparelho */
        }
      }
      if (chosen) break;
    }
    if (!chosen) return false;
    // só sabemos que NÃO é placa de vídeo quando pedimos software
    this.hardware = chosen.hw ? null : false;
    this.encoder = new VideoEncoder({
      output: (chunk) => this.onChunk(chunk),
      error: (e) => {
        this.log(`turbo: erro no codificador: ${e}`);
        // recomeça com um codificador novo no próximo quadro
        this.encoder = null;
        this.config = null;
        this.closeLayers();
        const ids = [...this.viewers.keys()];
        void this.openEncoder(decoders).then((ok) => {
          if (!ok) ids.forEach((id) => this.removeViewer(id));
          else {
            this.viewers.forEach((v) => {
              v.needCfg = true;
              v.layerH = 0;
              v.waitKey = true;
            });
            this.rebind();
          }
        });
      },
    });
    this.config = {
      ...base,
      codec: chosen.codec,
      hardwareAcceleration: chosen.hw ? 'prefer-hardware' : 'prefer-software',
      ...(chosen.codec.startsWith('avc1') ? { avc: { format: 'annexb' } } : {}),
    };
    this.srcW = s.width ?? width;
    this.srcH = s.height ?? height;
    this.encoder.configure(this.config);
    return true;
  }

  private scaled(w: number, h: number) {
    const k = h > this.target.maxHeight ? this.target.maxHeight / h : 1;
    return { width: even(w * k), height: even(h * k) };
  }

  private configure(srcW: number, srcH: number) {
    if (!this.encoder || !this.config) return;
    this.srcW = srcW;
    this.srcH = srcH;
    const { width, height } = this.scaled(srcW, srcH);
    this.config = { ...this.config, width, height, bitrate: this.target.bitrate, framerate: this.target.fps };
    try {
      this.encoder.configure(this.config);
    } catch (e) {
      this.log(`turbo: reconfigurar falhou: ${e}`);
    }
    this.forceKey = true;
    this.viewers.forEach((v) => (v.needCfg = true));
    // as versões menores acompanham o tamanho da captura (e somem se a original ficou menor que elas)
    for (const L of this.layers.values()) {
      const cfg = this.layerConfig(L.h);
      if (!cfg) continue;
      L.config = cfg;
      try {
        L.encoder.configure(cfg);
      } catch (e) {
        this.log(`turbo: reconfigurar ${L.h}p falhou: ${e}`);
      }
      L.forceKey = true;
    }
    this.rebind();
  }

  private closeLayers() {
    for (const L of this.layers.values()) {
      try {
        if (L.encoder.state !== 'closed') L.encoder.close();
      } catch {
        /* já fechado */
      }
    }
    this.layers.clear();
  }

  /** Lê os quadros capturados e codifica no ritmo certo. */
  private async pump() {
    const processor = new MediaStreamTrackProcessor({ track: this.track, maxBufferSize: 2 });
    this.reader = processor.readable.getReader();
    while (!this.stopped) {
      let frame: VideoFrame | undefined;
      try {
        const r = await this.reader.read();
        if (r.done) break;
        frame = r.value;
      } catch {
        break;
      }
      this.counters.captured++;
      try {
        if (!this.encoder || !this.config || !this.viewers.size) continue;
        // ritmo: no máximo o FPS alvo (a captura pode mandar mais)
        const minGap = 1e6 / this.target.fps;
        if (frame.timestamp - this.lastTs < minGap * 0.85) continue;
        // o codificador não está dando conta: pula o quadro (sem acumular atraso)
        if (this.encoder.encodeQueueSize > 2) {
          this.counters.encoderDrops++;
          continue;
        }
        if (frame.displayWidth !== this.srcW || frame.displayHeight !== this.srcH) this.configure(frame.displayWidth, frame.displayHeight);
        this.lastTs = frame.timestamp;
        // quadro-chave: a cada 4 s ou quando alguém precisa
        const keyFrame = this.forceKey || this.frameNo % (this.target.fps * 4) === 0;
        this.forceKey = false;
        this.frameNo++;
        this.inFlight.set(frame.timestamp, performance.now());
        if (this.inFlight.size > 30) this.inFlight.delete(this.inFlight.keys().next().value!);
        this.encoder.encode(frame, { keyFrame });
        // versões menores: a original tem prioridade; se o PC apertar, elas pulam quadros primeiro
        for (const L of this.layers.values()) {
          if (this.encoder.encodeQueueSize > 1 || L.encoder.encodeQueueSize > 2 || L.encoder.state !== 'configured') {
            this.counters.layerDrops++;
            continue;
          }
          const k = L.forceKey || L.frameNo % (this.target.fps * 4) === 0;
          L.forceKey = false;
          L.frameNo++;
          L.encoder.encode(frame, { keyFrame: k });
        }
      } catch (e) {
        this.log(`turbo: falha ao codificar: ${e}`);
      } finally {
        frame?.close();
      }
    }
  }

  private onChunk(chunk: EncodedVideoChunk, layerH = 0) {
    if (!layerH) {
      this.counters.encoded++;
      const began = this.inFlight.get(chunk.timestamp);
      if (began !== undefined) {
        this.counters.encodeMsSum += performance.now() - began;
        this.inFlight.delete(chunk.timestamp);
      }
    }
    const cfg = layerH ? this.layers.get(layerH)?.config : this.config;
    if (!cfg) return;
    const key = chunk.type === 'key';
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const seq = ++this.seq;
    const parts = Math.max(1, Math.ceil(data.byteLength / PART));
    let packets: ArrayBuffer[] | null = null;
    for (const v of this.viewers.values()) {
      if (v.dc.readyState !== 'open' || v.layerH !== layerH) continue;
      if (v.waitKey && !key) {
        v.skipped++;
        continue;
      }
      // fila de envio cheia (internet desse espectador): pula até o próximo quadro-chave só para ele
      if (v.dc.bufferedAmount > HIGH_WATER) {
        v.waitKey = true;
        v.skipped++;
        v.netSkips++;
        this.requestKeySoon(layerH);
        continue;
      }
      if (v.needCfg) {
        v.dc.send(
          JSON.stringify({
            t: 'cfg',
            codec: cfg.codec,
            width: cfg.width,
            height: cfg.height,
            fps: this.target.fps,
            want: v.want,
            srcHeight: this.mainH,
          }),
        );
        v.needCfg = false;
      }
      packets ??= this.packetize(data, seq, parts, key, chunk.timestamp);
      try {
        for (const p of packets) v.dc.send(p);
      } catch (err) {
        // o canal desse espectador está fechando: não pode atrapalhar o quadro dos outros
        // (quem assiste pede a transmissão de novo sozinho)
        this.log(`turbo: falha ao enviar para ${[...this.viewers].find(([, x]) => x === v)?.[0].slice(0, 6)}: ${(err as Error).message}`);
        v.waitKey = true;
        continue;
      }
      v.waitKey = false;
      v.sentFrames++;
      v.bytes += data.byteLength;
    }
  }

  private keyTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** depois de esvaziar a fila de quem ficou para trás, manda um quadro-chave (na versão dele) */
  private requestKeySoon(h = 0) {
    if (this.keyTimers.has(h)) return;
    this.keyTimers.set(
      h,
      setTimeout(() => {
        this.keyTimers.delete(h);
        this.requestKey(h);
      }, 400),
    );
  }

  /**
   * Uma vez por segundo, para cada pessoa: está perdendo quadros por causa da internet dela (ou o
   * aparelho dela não está dando conta)? No automático desce a qualidade só para ela; quem escolheu
   * "Original" recebe uma sugestão (uma vez a cada 5 min).
   */
  private adapt(v: Viewer, sentFps: number) {
    const now = performance.now();
    // compara com o que foi de fato ENVIADO para ela: se o PC de quem transmite está lento, todo mundo
    // recebe menos e isso não conta contra a internet de ninguém
    const struggling = v.netSkips > 0 || (sentFps >= 10 && v.shownFps > 0 && v.shownFps < sentFps * 0.6);
    v.netSkips = 0;
    if (struggling) {
      v.bad++;
      v.good = 0;
    } else {
      v.good++;
      v.bad = Math.max(0, v.bad - 1);
    }
    const options = [0, ...QUALITY_HEIGHTS.filter((h) => h < this.mainH)];
    if (v.want === 'auto') {
      const i = Math.max(0, options.indexOf(this.effective(v)));
      if (v.bad >= 4 && i < options.length - 1) {
        // subiu há pouco e já voltou a sofrer: espera mais antes de tentar de novo
        if (now - v.lastUp < 20_000) v.upWait = Math.min(300, v.upWait * 2);
        v.autoH = options[i + 1];
        v.bad = 0;
        v.good = 0;
        this.log(`turbo: automático ${v.id.slice(0, 6)} -> ${v.autoH}p`);
        this.rebind();
      } else if (i > 0 && v.good >= v.upWait) {
        v.autoH = options[i - 1];
        v.good = 0;
        v.lastUp = now;
        this.log(`turbo: automático ${v.id.slice(0, 6)} -> ${v.autoH || 'original'}`);
        this.rebind();
      }
    } else if (v.want === 'source' && v.bad >= 8 && options.length > 1 && now - v.lastHint > 300_000 && v.dc.readyState === 'open') {
      v.lastHint = now;
      v.bad = 0;
      v.dc.send(JSON.stringify({ t: 'hint', height: options[1] }));
    }
  }

  private packetize(data: Uint8Array, seq: number, parts: number, key: boolean, ts: number) {
    const out: ArrayBuffer[] = [];
    for (let i = 0; i < parts; i++) {
      const slice = data.subarray(i * PART, Math.min(data.byteLength, (i + 1) * PART));
      const buf = new ArrayBuffer(HEADER + slice.byteLength);
      const dv = new DataView(buf);
      dv.setUint8(0, 1); // tipo: pedaço de quadro
      dv.setUint8(1, key ? 1 : 0);
      dv.setUint16(2, i);
      dv.setUint16(4, parts);
      dv.setUint32(8, seq);
      dv.setFloat64(12, ts);
      new Uint8Array(buf, HEADER).set(slice);
      out.push(buf);
    }
    return out;
  }

  /** Estatísticas desde a última leitura (chamar ~1 vez por segundo). */
  stats(): TurboSendStats | null {
    if (!this.config) return this.lastStats;
    const now = performance.now();
    const secs = Math.max(0.25, (now - this.counters.at) / 1000);
    const viewers = [...this.viewers.values()].map((v) => {
      const r = {
        id: v.id,
        fps: Math.round(v.sentFrames / secs),
        shownFps: v.shownFps,
        skipped: v.skipped,
        mbps: (v.bytes * 8) / secs / 1e6,
        height: v.layerH || this.mainH,
        want: v.want,
      };
      this.adapt(v, r.fps);
      v.sentFrames = 0;
      v.skipped = 0;
      v.bytes = 0;
      return r;
    });
    this.lastStats = {
      captureFps: Math.round(this.counters.captured / secs),
      encodeFps: Math.round(this.counters.encoded / secs),
      encoderDrops: Math.round(this.counters.encoderDrops / secs),
      encodeMs: this.counters.encoded ? Math.round((this.counters.encodeMsSum / this.counters.encoded) * 10) / 10 : 0,
      width: this.config.width,
      height: this.config.height,
      codec: codecName(this.config.codec),
      hardware: this.hardware,
      viewers,
      layers: [...this.layers.keys()],
    };
    this.counters = { captured: 0, encoded: 0, encoderDrops: 0, layerDrops: 0, encodeMsSum: 0, at: now };
    return this.lastStats;
  }

  stop() {
    this.stopped = true;
    for (const id of [...this.viewers.keys()]) this.removeViewer(id);
    void this.reader?.cancel().catch(() => {});
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      /* já fechado */
    }
    this.encoder = null;
    this.closeLayers();
    for (const t of this.keyTimers.values()) clearTimeout(t);
    this.keyTimers.clear();
  }
}

// ======================================================================
// Quem assiste
// ======================================================================

export interface TurboRecvStats {
  fps: number;
  width: number;
  height: number;
  mbps: number;
  codec: string;
}

/** O que quem transmite contou sobre a versão que estou recebendo. */
export interface TurboRecvInfo {
  /** altura da versão que estou recebendo */
  height: number;
  /** altura da transmissão original */
  srcHeight: number;
  fps: number;
  want: StreamQuality;
}

export class TurboReceiver {
  private decoder: VideoDecoder | null = null;
  private codec = '';
  private waitKey = true;
  private parts: Uint8Array[] = [];
  private cur = { seq: -1, total: 0, got: 0, key: false, ts: 0 };
  private lastKeyReq = 0;
  private closed = false;
  readonly stream: MediaStream;
  private writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private counters = { frames: 0, bytes: 0, at: performance.now() };
  private size = { w: 0, h: 0 };
  private last: TurboRecvStats | null = null;
  private stTimer: ReturnType<typeof setInterval>;
  private dims = '';
  info: TurboRecvInfo | null = null;
  /** quem transmite sugeriu uma qualidade menor (minha internet não está dando conta) */
  onHint?: (height: number) => void;
  onInfo?: (info: TurboRecvInfo) => void;

  constructor(
    private dc: RTCDataChannel,
    private log: Log = () => {},
  ) {
    dc.binaryType = 'arraybuffer';
    if ('MediaStreamTrackGenerator' in window) {
      const gen = new MediaStreamTrackGenerator({ kind: 'video' });
      this.writer = gen.writable.getWriter();
      this.stream = new MediaStream([gen]);
    } else {
      // Safari/Firefox: desenha num canvas e usa a imagem dele como vídeo
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.stream = this.canvas.captureStream();
    }
    dc.onmessage = (e) => this.onMessage(e.data);
    // conta a quem transmite quantos quadros por segundo estou conseguindo mostrar
    this.stTimer = setInterval(() => {
      if (this.dc.readyState === 'open') this.dc.send(JSON.stringify({ t: 'st', fps: this.last?.fps ?? 0 }));
    }, 1000);
  }

  private onMessage(data: string | ArrayBuffer) {
    if (this.closed) return;
    if (typeof data === 'string') {
      try {
        const m = JSON.parse(data) as { t: string; codec?: string; width?: number; height?: number; srcHeight?: number; fps?: number; want?: StreamQuality; };
        if (m.t === 'cfg' && m.codec) {
          // trocou de versão (qualidade) ou de tamanho: recomeça o decodificador no próximo quadro-chave
          const dims = `${m.width}x${m.height}`;
          this.setup(m.codec, dims !== this.dims && !!this.dims);
          this.dims = dims;
          if (typeof m.height === 'number') {
            this.info = { height: m.height, srcHeight: m.srcHeight ?? m.height, fps: m.fps ?? 0, want: m.want ?? 'auto' };
            this.onInfo?.(this.info);
          }
        }
        if (m.t === 'hint' && typeof m.height === 'number') this.onHint?.(m.height);
      } catch {
        /* inválida */
      }
      return;
    }
    const dv = new DataView(data);
    if (dv.getUint8(0) !== 1) return;
    const key = dv.getUint8(1) === 1;
    const part = dv.getUint16(2);
    const total = dv.getUint16(4);
    const seq = dv.getUint32(8);
    const ts = dv.getFloat64(12);
    if (part === 0) {
      this.cur = { seq, total, got: 0, key, ts };
      this.parts = [];
    } else if (seq !== this.cur.seq) {
      return; // pedaço de um quadro que já foi descartado
    }
    this.parts.push(new Uint8Array(data, HEADER));
    this.cur.got++;
    this.counters.bytes += data.byteLength;
    if (this.cur.got === this.cur.total) this.decode();
  }

  private setup(codec: string, force = false) {
    if (this.decoder && this.codec === codec && !force) return;
    this.codec = codec;
    try {
      this.decoder?.close();
    } catch {
      /* já fechado */
    }
    this.decoder = new VideoDecoder({
      output: (frame) => this.show(frame),
      error: (e) => {
        this.log(`turbo: erro ao decodificar: ${e}`);
        // decodificador quebrado: recria e pede um quadro-chave
        const c = this.codec;
        this.codec = '';
        this.decoder = null;
        this.setup(c);
        this.askKey();
      },
    });
    this.decoder.configure({ codec, optimizeForLatency: true });
    this.waitKey = true;
  }

  private decode() {
    const { key, ts } = this.cur;
    const size = this.parts.reduce((a, p) => a + p.byteLength, 0);
    const data = new Uint8Array(size);
    let o = 0;
    for (const p of this.parts) {
      data.set(p, o);
      o += p.byteLength;
    }
    this.parts = [];
    if (!this.decoder || this.decoder.state !== 'configured') return;
    if (this.waitKey && !key) return;
    // aparelho lento ficando para trás: pula até o próximo quadro-chave
    if (!key && this.decoder.decodeQueueSize > 3) {
      this.waitKey = true;
      this.askKey();
      return;
    }
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data }));
      this.waitKey = false;
    } catch (e) {
      this.log(`turbo: quadro inválido: ${e}`);
      this.waitKey = true;
      this.askKey();
    }
  }

  private askKey() {
    const now = performance.now();
    if (now - this.lastKeyReq < 500 || this.dc.readyState !== 'open') return;
    this.lastKeyReq = now;
    this.dc.send(JSON.stringify({ t: 'key' }));
  }

  private show(frame: VideoFrame) {
    this.counters.frames++;
    this.size = { w: frame.displayWidth, h: frame.displayHeight };
    if (this.closed) {
      frame.close();
      return;
    }
    if (this.writer) {
      this.writer.write(frame).catch(() => frame.close());
      return;
    }
    if (this.canvas && this.ctx) {
      if (this.canvas.width !== frame.displayWidth) this.canvas.width = frame.displayWidth;
      if (this.canvas.height !== frame.displayHeight) this.canvas.height = frame.displayHeight;
      this.ctx.drawImage(frame, 0, 0);
    }
    frame.close();
  }

  stats(): TurboRecvStats | null {
    const now = performance.now();
    const secs = (now - this.counters.at) / 1000;
    if (secs < 0.5) return this.last;
    this.last = {
      fps: Math.round(this.counters.frames / secs),
      width: this.size.w,
      height: this.size.h,
      mbps: (this.counters.bytes * 8) / secs / 1e6,
      codec: codecName(this.codec),
    };
    this.counters = { frames: 0, bytes: 0, at: now };
    return this.last;
  }

  close() {
    this.closed = true;
    clearInterval(this.stTimer);
    try {
      this.decoder?.close();
    } catch {
      /* já fechado */
    }
    this.stream.getTracks().forEach((t) => t.stop());
    void this.writer?.close().catch(() => {});
    try {
      this.dc.close();
    } catch {
      /* já fechado */
    }
  }
}
