// Contas das métricas da transmissão: zero medido x métrica ausente, e onde o FPS ficou para trás.
// Uso: node --import tsx e2e/limits-unit.ts
import { classifyLimit, minMeasured, stat } from '../client/src/voice/limits';

let n = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`FALHOU: ${m}\n  esperado ${JSON.stringify(b)}\n  veio     ${JSON.stringify(a)}`);
  n++;
};

// zero medido conta; ausente não vira zero
eq(stat([0, 0, 0]), { n: 3, avg: 0, min: 0, max: 0, zero: 3 }, 'três zeros medidos continuam sendo três amostras');
eq(stat([null, undefined, 60]), { n: 1, avg: 60, min: 60, max: 60, zero: 0 }, 'ausentes ficam de fora da média');
eq(stat([null, undefined]), null, 'sem nenhuma medida = null (não 0)');
eq(stat([]), null, 'série vazia = null');
eq(stat([0, 60, null]), { n: 2, avg: 30, min: 0, max: 60, zero: 1 }, 'zero medido entra na média');
eq(minMeasured([60, 0, 45]), 0, 'o espectador com 0 FPS é o gargalo (não é descartado)');
eq(minMeasured([null, undefined]), null, 'ninguém mediu = null');
eq(minMeasured([null, 50]), 50, 'ausente não ganha do medido');

const base = { targetFps: 60, captureFps: 60, encodeFps: 60, sentFps: 60, viewerShownFps: 60, encoderDrops: 0, netDrops: 0 };
eq(classifyLimit(base).where, 'none', 'tudo no alvo');
eq(classifyLimit({ ...base, captureFps: null }).where, 'unknown', 'sem medida da captura não acusa nada');
eq(classifyLimit({ ...base, captureFps: 0, encodeFps: 0, sentFps: 0, viewerShownFps: 0 }).where, 'capture', 'captura em 0 FPS medido é captura');
eq(classifyLimit({ ...base, captureFps: 41, encodeFps: 41, sentFps: 41, viewerShownFps: 41 }).where, 'capture', 'captura em 41 FPS (menu do jogo) é captura');
eq(classifyLimit({ ...base, encodeFps: 30, sentFps: 30, viewerShownFps: 30 }).where, 'encoder', 'captura boa e codificador a 30 = codificador');
eq(classifyLimit({ ...base, encoderDrops: 5 }).where, 'encoder', 'quadros pulados pelo codificador');
eq(classifyLimit({ ...base, netDrops: 2, viewerShownFps: 40 }).where, 'transport', 'fila de envio cheia = transporte');
eq(classifyLimit({ ...base, viewerShownFps: 35 }).where, 'receiver', 'enviou 60 e a pessoa mostrou 35, sem fila cheia = recepção/decodificação/exibição');
eq(classifyLimit({ ...base, viewerShownFps: 0 }).where, 'receiver', 'espectador com 0 FPS medido não é descartado');
eq(classifyLimit({ ...base, viewerShownFps: null }).where, 'none', 'sem informação do espectador mas envio no alvo: nada comprovado');
eq(classifyLimit({ ...base, viewerShownFps: null, sentFps: 40, encodeFps: 60 }).where, 'unknown', 'envio abaixo do alvo e sem informação do espectador: causa desconhecida, NÃO "internet"');
eq(classifyLimit({ ...base, viewerShownFps: null, sentFps: null }).where, 'unknown', 'sem medida do envio');
console.log(`OK: ${n} verificações das contas de métricas`);

// ---- modo desempenho: só reduz com evidência do codificador, nunca por captura lenta nem latência isolada ----
import { decidePerf, type PerfSample } from '../client/src/voice/limits';
const sample = (o: Partial<PerfSample>): PerfSample => ({ captureFps: 60, encodeFps: 60, encoderBusy: 0, encoderLatencyMs: 4, hardware: null, height: 1080, ...o });
const win = (o: Partial<PerfSample>, k = 3) => Array.from({ length: k }, () => sample(o));
// o que aconteceu na abertura do CS2: 1 FPS de captura, 1 de codificação, 186 ms de latência, 1080p
eq(decidePerf(win({ captureFps: 1, encodeFps: 1, encoderLatencyMs: 186 }), 60, 0).reason, null, 'captura em 1 FPS com latência de 186 ms NÃO reduz resolução');
eq(decidePerf(win({ captureFps: 1, encodeFps: 1, encoderLatencyMs: 186 }), 60, 0).captureLimited, true, 'e é registrado como limitado pela captura');
eq(decidePerf(win({ encoderLatencyMs: 186 }), 60, 0).reason, null, 'latência alta isolada (captura e codificação em 60) não reduz');
eq(decidePerf(win({ encoderLatencyMs: 186 }), 60, 0).confirmedSoftware, false, 'latência alta NÃO confirma software');
eq(decidePerf(win({ encodeFps: 35 }), 60, 0).reason, 'encode-below-capture', 'captura em 60 e codificação em 35: o codificador não acompanha');
eq(decidePerf(win({ encoderBusy: 6 }), 60, 0).reason, 'encoder-drops', 'codificador pulando quadros');
eq(decidePerf(win({ hardware: false, height: 1080 }), 60, 0).reason, 'software-too-big', 'software confirmado em 1080p reduz');
eq(decidePerf(win({ hardware: false, height: 1080 }), 60, 0).confirmedSoftware, true, 'software confirmado só quando foi pedido software');
eq(decidePerf(win({ hardware: false, height: 720 }), 60, 0).reason, null, 'software confirmado em 720p ainda cabe');
eq(decidePerf(win({ hardware: null, height: 1080 }), 60, 0).reason, null, 'sem confirmação de software, resolução alta sozinha não reduz');
eq(decidePerf([sample({ encodeFps: 20 })], 60, 0).reason, null, 'uma única amostra não decide');
console.log(`OK: ${n} verificações (contas + modo desempenho)`);
