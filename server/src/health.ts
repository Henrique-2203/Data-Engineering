import { createHash } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import { isPlatformAdmin } from './reports.ts';
import type { requireAuth } from './auth.ts';
import { capacity, overLimits } from './capacity.ts';

/**
 * Saúde das calls (Painel da equipe → Saúde). O app manda, a cada minuto de call, NÚMEROS de qualidade
 * (atraso, perda, FPS da transmissão...) e os erros do site. Aqui eles viram SOMAS POR DIA: não se
 * guarda quem mandou, de qual call, nem IP. Dá para saber "como as calls estão", nunca "como está a
 * call de Fulano". Quem não quiser, desliga em Configurações → Privacidade e dados.
 */
export const HEALTH_METRICS = [
  // conexões com cada pessoa da call
  'conn_ok',
  'conn_fail',
  'conn_ms',
  'resume',
  // voz (amostras de 1 minuto)
  'voice_samples',
  'voice_rtt',
  'voice_loss',
  'voice_bad',
  'relayed_samples',
  'turn_mb',
  // minha transmissão (amostras de 1 minuto)
  'stream_samples',
  'stream_capture',
  'stream_sent',
  'stream_viewer',
  'stream_ok40',
  'stream_turbo',
  'stream_encode_ms',
  'stream_light',
  // transmissões que estou assistindo
  'watch_samples',
  'watch_fps',
  'watch_low',
] as const;
export type HealthMetric = (typeof HEALTH_METRICS)[number];

const TODAY = `(now() at time zone 'America/Sao_Paulo')::date`;

/** Tira do texto do erro o que poderia identificar alguém (e-mails, números longos, ids, endereços). */
export function cleanError(msg: string) {
  return msg
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[ip]')
    .replace(/\d{5,}/g, '[n]')
    .slice(0, 200);
}

export function registerHealthRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const metric = z.object({ sum: z.number().finite().min(0).max(1e9), count: z.number().int().min(0).max(100_000) });

  r.post(
    '/telemetry/call-health',
    auth,
    wrap(async (req) => {
      // cada aparelho manda ~1 vez por minuto; o limite impede alguém de inflar os números
      limit(`health:${req.user!.id}`, 20, 10 * 60_000);
      const body = parse(
        z.object({
          metrics: z.partialRecord(z.enum(HEALTH_METRICS), metric).default({}),
          errors: z.array(z.object({ message: z.string().max(500), version: z.string().max(20).optional() })).max(10).default([]),
        }),
        req.body,
      );
      for (const [name, m] of Object.entries(body.metrics)) {
        if (!m.count && !m.sum) continue;
        await db.query(
          `insert into call_health (day, metric, sum, count) values (${TODAY}, $1, $2, $3)
           on conflict (day, metric) do update set sum = call_health.sum + excluded.sum, count = call_health.count + excluded.count`,
          [name, m.sum, m.count],
        );
      }
      for (const e of body.errors) {
        const message = cleanError(e.message);
        if (!message.trim()) continue;
        const hash = createHash('sha256').update(message).digest('hex').slice(0, 16);
        await db.query(
          `insert into client_errors (day, hash, message, count, version) values (${TODAY}, $1, $2, 1, $3)
           on conflict (day, hash) do update set count = client_errors.count + 1, version = excluded.version, last_at = now()`,
          [hash, message, e.version ?? null],
        );
      }
      return { ok: true };
    }),
  );

  r.get(
    '/admin/capacity',
    auth,
    wrap(async (req) => {
      if (!isPlatformAdmin(req.user!.username)) throw new HttpError(404, 'Rota não encontrada.');
      const c = await capacity(db, rt);
      return { ...c, warnings: overLimits(c).map((o) => o.text) };
    }),
  );

  r.get(
    '/admin/call-health',
    auth,
    wrap(async (req) => {
      if (!isPlatformAdmin(req.user!.username)) throw new HttpError(404, 'Rota não encontrada.');
      const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
      const rows = await db.query<{ day: string; metric: HealthMetric; sum: number; count: number }>(
        `select to_char(day, 'YYYY-MM-DD') as day, metric, sum::float as sum, count::int as count from call_health where day > ${TODAY} - $1::int order by day`,
        [days],
      );
      const totals: Record<string, { sum: number; count: number }> = {};
      const byDay: Record<string, Record<string, { sum: number; count: number }>> = {};
      for (const row of rows) {
        totals[row.metric] = { sum: (totals[row.metric]?.sum ?? 0) + row.sum, count: (totals[row.metric]?.count ?? 0) + row.count };
        (byDay[row.day] ??= {})[row.metric] = { sum: row.sum, count: row.count };
      }
      const [{ month }] = await db.query<{ month: number }>(
        `select coalesce(sum(sum), 0)::float as month from call_health where metric = 'turn_mb' and date_trunc('month', day) = date_trunc('month', ${TODAY})`,
      );
      const errors = await db.query<{ message: string; total: number; version: string | null; last: string }>(
        `select message, sum(count)::int as total, max(version) as version, max(last_at) as last from client_errors
         where day > ${TODAY} - $1::int group by message order by total desc limit 15`,
        [days],
      );
      return { days, totals, byDay, turnMonthMb: Math.round(month), errors, live: rt.liveCounts() };
    }),
  );
}
