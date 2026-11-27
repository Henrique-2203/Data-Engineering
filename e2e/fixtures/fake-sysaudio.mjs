// Faz o papel do resenha-sysaudio.exe nos testes (fora do Windows): mesmo protocolo. Recebe o pid a
// excluir, avisa "ready" no stderr, manda um tom de 440 Hz (PCM 16 bits, 48 kHz, estéreo) em pedaços
// de tamanho irregular (como um pipe de verdade) e para quando o stdin fecha. Anota tudo em
// RESENHA_FAKE_SYSAUDIO_LOG para o teste conferir.
import { appendFileSync } from 'node:fs';
const log = (m) => process.env.RESENHA_FAKE_SYSAUDIO_LOG && appendFileSync(process.env.RESENHA_FAKE_SYSAUDIO_LOG, `${m}\n`);
log(`start pid=${process.argv[2]}`);
process.stderr.write('ready\n');
let t = 0;
const timer = setInterval(() => {
  const frames = 480; // 10 ms
  const buf = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++, t++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * t) / 48000) * 12000);
    buf.writeInt16LE(v, i * 4);
    buf.writeInt16LE(v, i * 4 + 2);
  }
  // pedaços que não respeitam o tamanho da amostra (o pipe pode cortar no meio)
  process.stdout.write(buf.subarray(0, 1001));
  process.stdout.write(buf.subarray(1001));
}, 10);
process.stdin.on('end', () => {
  clearInterval(timer);
  log('stop');
  process.exit(0);
});
process.stdin.resume();
