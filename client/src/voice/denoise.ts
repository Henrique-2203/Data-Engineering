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
  stop(): void;
}

let ctx: AudioContext | null = null;
const loaded = new Map<AiNoiseMode, Promise<ArrayBuffer>>();

function context() {
  // os dois modelos trabalham em 48 kHz
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  return ctx;
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

export const aiNoiseSupported = () => typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';

/** Passa o microfone pelo filtro de IA. Lança erro se o aparelho não suportar (aí usamos o filtro do navegador). */
export async function createDenoiser(raw: MediaStreamTrack, mode: AiNoiseMode): Promise<Denoiser> {
  const c = context();
  void c.resume();
  const wasmBinary = await load(mode, c);
  const source = c.createMediaStreamSource(new MediaStream([raw]));
  const node: AudioWorkletNode & { destroy?(): void } =
    mode === 'rnnoise' ? new RnnoiseWorkletNode(c, { wasmBinary, maxChannels: 1 }) : new GtcrnWorkletNode(c, { wasmBinary, maxChannels: 1 });
  const dest = c.createMediaStreamDestination();
  dest.channelCount = 1;
  source.connect(node);
  node.connect(dest);
  const track = dest.stream.getAudioTracks()[0];
  return {
    track,
    stop() {
      try {
        source.disconnect();
        node.disconnect();
        node.destroy?.();
      } catch {
        /* já desligado */
      }
      track.stop();
      raw.stop();
    },
  };
}
