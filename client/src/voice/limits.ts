/**
 * Contas puras das métricas da transmissão (sem DOM, sem navegador: testáveis em Node).
 *
 * Regra de ouro: `null` = "não medido"; `0` = "medido e deu zero". Nunca misturar os dois
 * (o código antigo usava `if (st && st.fps)` e descartava justamente as amostras com 0 FPS).
 */

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface Stat {
  /** quantas amostras MEDIDAS entraram (null/undefined ficam de fora) */
  n: number;
  avg: number;
  min: number;
  max: number;
  /** quantas dessas amostras foram exatamente 0 */
  zero: number;
}

/** Resume uma série: amostras ausentes (null/undefined) NÃO viram zero; zeros medidos contam. Sem nenhuma medida → null. */
export function stat(values: readonly (number | null | undefined)[]): Stat | null {
  const v = values.filter(isNum);
  if (!v.length) return null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { n: v.length, avg: round(v.reduce((a, b) => a + b, 0) / v.length), min: round(Math.min(...v)), max: round(Math.max(...v)), zero: v.filter((x) => x === 0).length };
}

/** Menor valor medido (o "gargalo"), ou null se ninguém mediu. Zero medido ganha de tudo. */
export function minMeasured(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter(isNum);
  return v.length ? Math.min(...v) : null;
}

export type LimitWhere = 'none' | 'capture' | 'encoder' | 'transport' | 'receiver' | 'unknown';

export interface LimitInput {
  /** FPS que a pessoa escolheu */
  targetFps: number;
  captureFps: number | null;
  encodeFps: number | null;
  sentFps: number | null;
  /** o que o pior espectador conseguiu mostrar (null = ainda não informou) */
  viewerShownFps: number | null;
  /** quadros que o codificador não aguentou, por segundo */
  encoderDrops: number | null;
  /** quadros pulados porque a fila de envio de alguém encheu (por intervalo) */
  netDrops: number | null;
}

export interface Limit {
  where: LimitWhere;
  /** em português simples: o que sustenta a conclusão */
  evidence: string;
}

/**
 * Onde o FPS escolhido ficou para trás. Só afirma uma causa quando há EVIDÊNCIA dela:
 * sem medida da captura não dá para acusar captura; sem medida de quem assiste não dá para
 * acusar internet nem aparelho dele (antes tudo que sobrava virava "internet").
 */
export function classifyLimit(i: LimitInput): Limit {
  const t = Math.max(1, i.targetFps);
  const low = (n: number | null, k = 0.9) => isNum(n) && n < t * k;
  const encoderBusy = isNum(i.encoderDrops) && i.encoderDrops >= 3;
  if (!isNum(i.captureFps)) return { where: 'unknown', evidence: 'sem medida da captura' };
  if (low(i.captureFps) && !encoderBusy)
    return { where: 'capture', evidence: `a captura entregou ${i.captureFps} FPS (alvo ${t}); tela parada também gera isso` };
  if (encoderBusy || (isNum(i.encodeFps) && i.encodeFps < Math.min(i.captureFps, t) * 0.9))
    return { where: 'encoder', evidence: `a captura entregou ${i.captureFps} FPS e o codificador só ${i.encodeFps ?? '?'} (${i.encoderDrops ?? 0} quadros pulados/s)` };
  if (isNum(i.netDrops) && i.netDrops > 0) return { where: 'transport', evidence: `a fila de envio de alguém encheu (${i.netDrops} quadros pulados)` };
  if (isNum(i.viewerShownFps)) {
    const sent = isNum(i.sentFps) ? Math.min(i.sentFps, t) : t;
    if (i.viewerShownFps < sent * 0.9)
      return { where: 'receiver', evidence: `foram enviados ${i.sentFps ?? '?'} FPS e quem assiste mostrou ${i.viewerShownFps} (recepção, decodificação ou exibição dele; não prova que seja a internet)` };
    return { where: 'none', evidence: `quem assiste mostrou ${i.viewerShownFps} FPS` };
  }
  if (isNum(i.sentFps)) {
    return i.sentFps >= t * 0.9 ? { where: 'none', evidence: `foram enviados ${i.sentFps} FPS` } : { where: 'unknown', evidence: `enviou ${i.sentFps} FPS e quem assiste ainda não informou o que mostrou` };
  }
  return { where: 'unknown', evidence: 'sem medida do envio' };
}
