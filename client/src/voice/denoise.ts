import { GtcrnWorkletNode, RnnoiseWorkletNode, loadGtcrn, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';

/**
 * Supressão de ruído por IA, rodando no seu próprio aparelho (nada sai do computador):
 *  - 'gtcrn': GTCRN (modelo novo; no teste do e2e/noise.mjs derruba o teclado em ~70 dB e mantém a voz);
 *  - 'rnnoise': RNNoise (mais leve; tira ventilador e chiado, mas o teclado passa em parte).
 * O microfone passa pelo filtro antes de tudo, então a ativação por voz também mede o som já limpo:
 * o teclado não abre mais o microfone.
 */
export type AiNoiseMode = 'rnnoise' | 'gtcrn';

export interface Denoiser {
  /** faixa limpa (é ela que vai para a chamada) */
  track: MediaStreamTrack;
  /**
   * Quanto o processamento de áudio ficou para trás do relógio nos últimos segundos (%). Acima de
   * ~3% o aparelho não está dando conta do filtro: a voz sai picotada ou robótica para os outros.
   */
  slowPct(): number;
  stop(): void;
}

/**
 * Mede se o áudio está sendo processado em tempo real: o relógio do áudio (currentTime) só anda
 * quando o aparelho termina de processar cada pedacinho; se o filtro pesa demais, ele anda mais
 * devagar que o relógio normal. Duas medições seguidas acima de 3% → `onSlow`.
 */
export function watchRealtime(c: BaseAudioContext & { state: AudioContextState }, onSlow?: () => void, everyMs = 3000) {
  let last = { wall: performance.now(), audio: c.currentTime };
  let pct = 0;
  let strikes = 0;
  const timer = setInterval(() => {
    const now = { wall: performance.now(), audio: c.currentTime };
    const dw = (now.wall - last.wall) / 1000;
    const da = now.audio - last.audio;
    last = now;
    if (c.state !== 'running' || dw < 1) return;
    pct = Math.round(Math.max(0, ((dw - da) / dw) * 100) * 10) / 10;
    strikes = pct >= 3 ? strikes + 1 : 0;
    if (strikes >= 2) {
      strikes = 0;
      onSlow?.();
    }
  }, everyMs);
  return { pct: () => pct, stop: () => clearInterval(timer) };
}

let ctx: AudioContext | null = null;
/**
 * +6 dB depois do filtro. Com o limitador em -10 dB a voz fica no mesmo volume de antes (+8 dB com
 * limitador em -3), mas os picos de voz alta não estouram mais (medido: distorção ~230x menor).
 */
const MAKEUP_GAIN = 2.0;
const loaded = new Map<AiNoiseMode, Promise<ArrayBuffer>>();

function context() {
  // os dois modelos trabalham em 48 kHz
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  return ctx;
}

/** retoma o áudio do filtro (o Safari "interrompe" o AudioContext quando a página sai da tela) */
export function resumeDenoise() {
  if (ctx && ctx.state !== 'closed' && ctx.state !== 'running') void ctx.resume().catch(() => {});
}

function load(mode: AiNoiseMode, c: AudioContext): Promise<ArrayBuffer> {
  let p = loaded.get(mode);
  if (!p) {
    p = (async () => {
      if (mode === 'rnnoise') {
        await c.audioWorklet.addModule(rnnoiseWorkletUrl);
        return loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
      }
      await c.audioWorklet.addModule(gtcrnWorkletUrl);
      return loadGtcrn({ url: gtcrnWasmUrl });
    })();
    p.catch(() => loaded.delete(mode));
    loaded.set(mode, p);
  }
  return p;
}

/**
 * Arredonda picos acima de -1 dBFS em vez de cortar (o corte vira estalo). Aceita picos de até +6 dB
 * acima do máximo (o WaveShaper só enxerga -1..1, por isso entra com metade do volume).
 */
export function softClipCurve(n = 4096) {
  const curve = new Float32Array(n);
  const knee = 0.89; // -1 dBFS
  const room = 0.98 - knee;
  for (let i = 0; i < n; i++) {
    const v = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(v);
    curve[i] = a <= knee ? v : Math.sign(v) * (knee + room * Math.tanh((a - knee) / room));
  }
  return curve;
}
function softClipper(c: BaseAudioContext) {
  const input = c.createGain();
  input.gain.value = 0.5;
  const output = c.createWaveShaper();
  output.curve = softClipCurve();
  output.oversample = '2x';
  input.connect(output);
  return { input, output };
}

export const aiNoiseSupported = () => typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';

/** Passa o microfone pelo filtro de IA. Lança erro se o aparelho não suportar (aí usamos o filtro do navegador). */
export async function createDenoiser(raw: MediaStreamTrack, mode: AiNoiseMode, onSlow?: () => void): Promise<Denoiser> {
  const c = context();
  void c.resume();
  const wasmBinary = await load(mode, c);
  const source = c.createMediaStreamSource(new MediaStream([raw]));
  const node: AudioWorkletNode & { destroy?(): void } =
    mode === 'rnnoise' ? new RnnoiseWorkletNode(c, { wasmBinary, maxChannels: 1 }) : new GtcrnWorkletNode(c, { wasmBinary, maxChannels: 1 });
  const dest = c.createMediaStreamDestination();
  dest.channelCount = 1;
  // o filtro deixa a voz uns 8-10 dB mais baixa (medido no e2e/noise.mjs): devolve o volume e um
  // limitador segura os picos para nunca distorcer
  const makeup = c.createGain();
  makeup.gain.value = MAKEUP_GAIN;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  // o limitador do navegador deixa passar picos rápidos (voz alta, risada): sem isto eles estouram
  // e viram estalos na call. Proteção final: abaixo de -1 dB nada muda; acima, o pico é arredondado.
  const guard = softClipper(c);
  source.connect(node);
  node.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(guard.input);
  guard.output.connect(dest);
  const track = dest.stream.getAudioTracks()[0];
  const rt = watchRealtime(c, onSlow);
  return {
    track,
    slowPct: rt.pct,
    stop() {
      rt.stop();
      try {
        source.disconnect();
        node.disconnect();
        makeup.disconnect();
        limiter.disconnect();
        guard.input.disconnect();
        guard.output.disconnect();
        node.destroy?.();
      } catch {
        /* já desligado */
      }
      track.stop();
      raw.stop();
    },
  };
}
