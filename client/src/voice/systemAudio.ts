import { desktop } from '../lib/desktop';

/**
 * App de Windows 0.3.9+: o "som do computador" da transmissão vem do programa nativo, SEM o próprio
 * Resenha (a voz da call não volta para quem assiste). Aqui viramos esse áudio uma faixa normal.
 */
export interface SystemAudioTrack {
  track: MediaStreamTrack;
  stop(): void;
}

export async function desktopSystemAudio(): Promise<SystemAudioTrack | null> {
  const bridge = desktop?.sysAudio;
  if (!bridge) return null;
  const st = await bridge.status().catch(() => null);
  if (!st?.active) return null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('/pcm-feed-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm-feed', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 2;
    node.connect(dest);
    // os pedaços chegam com qualquer tamanho: guarda a sobra para não partir uma amostra ao meio
    let rest = new Uint8Array(0);
    const off = bridge.onData((chunk) => {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
      const all = new Uint8Array(rest.length + u8.length);
      all.set(rest);
      all.set(u8, rest.length);
      const usable = all.length - (all.length % 4); // 2 canais × 16 bits
      rest = all.slice(usable);
      if (!usable) return;
      const buf = all.slice(0, usable).buffer;
      node.port.postMessage(buf, [buf]);
    });
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const track = dest.stream.getAudioTracks()[0];
    const c = ctx;
    let stopped = false;
    return {
      track,
      stop() {
        if (stopped) return;
        stopped = true;
        off();
        bridge.stop();
        node.disconnect();
        track.stop();
        void c.close().catch(() => {});
      },
    };
  } catch {
    bridge.stop();
    void ctx?.close().catch(() => {});
    return null;
  }
}
