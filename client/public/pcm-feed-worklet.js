// Toca na faixa da transmissão o som do PC que o app de Windows manda (PCM 16 bits, 48 kHz, estéreo,
// sem o próprio Resenha). Guarda um pouquinho (40 ms) para não picotar e no máximo 200 ms: se atrasar,
// joga fora o mais antigo para o som não ficar defasado da imagem.
const PRIME = 1920; // 40 ms
const MAX = 9600; // 200 ms

class PcmFeed extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.read = 0; // posição (em amostras int16) dentro do primeiro pedaço
    this.avail = 0; // quadros (esquerda+direita) prontos
    this.primed = false;
    this.port.onmessage = (e) => {
      const a = new Int16Array(e.data);
      if (!a.length) return;
      this.chunks.push(a);
      this.avail += a.length / 2;
      while (this.avail > MAX && this.chunks.length > 1) {
        const first = this.chunks.shift();
        this.avail -= (first.length - this.read) / 2;
        this.read = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    if (!this.primed && this.avail < PRIME) {
      L.fill(0);
      R.fill(0);
      return true;
    }
    this.primed = true;
    for (let i = 0; i < L.length; i++) {
      const c = this.chunks[0];
      if (!c) {
        // acabou o que tinha: silêncio e espera juntar de novo
        this.primed = false;
        L.fill(0, i);
        R.fill(0, i);
        break;
      }
      L[i] = c[this.read] / 32768;
      R[i] = c[this.read + 1] / 32768;
      this.read += 2;
      this.avail--;
      if (this.read >= c.length) {
        this.chunks.shift();
        this.read = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-feed', PcmFeed);
