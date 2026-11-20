import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import { isPlatformAdmin } from './reports.ts';
import type { requireAuth } from './auth.ts';

/**
 * Painel de números da equipe, sem rastreadores: só contadores SOMADOS POR DIA
 * (visitas, downloads, inscrições, contas, uso). Nada de IP, cookie ou identificador de visitante.
 * A única coisa por pessoa é o "último dia em que usou" de cada conta (para contar ativos).
 */

export type Metric = 'landing_view' | 'download_windows' | 'waitlist' | 'signup' | 'active_user' | 'messages' | 'voice_join' | 'screen_share';
const METRICS: Metric[] = ['landing_view', 'download_windows', 'waitlist', 'signup', 'active_user', 'messages', 'voice_join', 'screen_share'];
const TODAY = `(now() at time zone 'America/Sao_Paulo')::date`;

let db: Db | null = null;
export function initStats(d: Db) {
  db = d;
}

/** +1 no contador de hoje (falha silenciosa: estatística nunca derruba o app). */
export function bump(metric: Metric, key = '') {
  if (!db) return;
  void db
    .query(
      `insert into daily_stats (day, metric, key, count) values (${TODAY}, $1, $2, 1)
       on conflict (day, metric, key) do update set count = daily_stats.count + 1`,
      [metric, key.slice(0, 40)],
    )
    .catch(() => {});
}

/** Conta a pessoa como ativa hoje (uma vez por dia por conta). */
export function markActive(userId: string) {
  if (!db) return;
  void db
    .query(`update users set last_active_on = ${TODAY} where id = $1 and (last_active_on is null or last_active_on < ${TODAY}) returning 1`, [userId])
    .then((rows) => rows.length && bump('active_user'))
    .catch(() => {});
}

const SOURCE_ALIASES: [RegExp, string][] = [
  [/^(ig|insta)/, 'instagram'],
  [/^(tt|tiktok|tik)/, 'tiktok'],
  [/^(yt|youtube|shorts)/, 'youtube'],
  [/^(wa|whats|zap)/, 'whatsapp'],
  [/^(fb|face)/, 'facebook'],
  [/^(x|tw|twitter)$/, 'x'],
  [/^(dc|discord)/, 'discord'],
  [/^(google|gg)/, 'google'],
];

/** De onde a pessoa veio: ?src= do link, app do Instagram/TikTok (pelo navegador interno) ou site anterior. */
export function classifySource(src: string | undefined, referrer: string | undefined, ua: string): string {
  const s = (src ?? '').toLowerCase().trim();
  if (s) return SOURCE_ALIASES.find(([re]) => re.test(s))?.[1] ?? 'outro';
  if (/Instagram/.test(ua)) return 'instagram';
  if (/musical_ly|TikTok|BytedanceWebview|Bytedance/i.test(ua)) return 'tiktok';
  if (/FBAN|FBAV/.test(ua)) return 'facebook';
  let host = '';
  try {
    host = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  if (!host) return 'direto';
  const map: [RegExp, string][] = [
    [/instagram\.com$/, 'instagram'],
    [/tiktok\.com$/, 'tiktok'],
    [/(youtube\.com|youtu\.be)$/, 'youtube'],
    [/whatsapp\.com$/, 'whatsapp'],
    [/(facebook\.com|fb\.com)$/, 'facebook'],
    [/(t\.co|x\.com|twitter\.com)$/, 'x'],
    [/discord\.(com|gg)$/, 'discord'],
    [/^google\./, 'google'],
  ];
  return map.find(([re]) => re.test(host))?.[1] ?? 'outro';
}

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|WhatsApp\/|TelegramBot|Discordbot|Twitterbot|headless/i;

export function registerStatsRoutes(r: Router, d: Db, auth: ReturnType<typeof requireAuth>) {
  initStats(d);

  // visita à página inicial (o site manda uma vez por aba)
  r.post(
    '/stats/view',
    wrap(async (req) => {
      const ua = String(req.headers['user-agent'] ?? '');
      if (BOT_UA.test(ua)) return { ok: true };
      limit(`view:${req.ip}`, 60, 60 * 60_000); // ninguém infla os números da própria máquina
      const body = parse(z.object({ src: z.string().max(40).optional(), ref: z.string().max(300).optional() }), req.body ?? {});
      bump('landing_view', classifySource(body.src, body.ref, ua));
      return { ok: true };
    }),
  );

  r.get(
    '/admin/stats',
    auth,
    wrap(async (req) => {
      if (!isPlatformAdmin(req.user!.username)) throw new HttpError(404, 'Rota não encontrada.');
      const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
      const rows = await d.query<{ day: string; metric: Metric; total: number }>(
        `select to_char(day, 'YYYY-MM-DD') as day, metric, sum(count)::int as total from daily_stats
         where day > ${TODAY} - $1::int group by day, metric`,
        [days],
      );
      const series: Record<string, Record<Metric, number>> = {};
      const [{ today }] = await d.query<{ today: string }>(`select to_char(${TODAY}, 'YYYY-MM-DD') as today`);
      for (let i = days - 1; i >= 0; i--) {
        const dt = new Date(`${today}T12:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() - i);
        series[dt.toISOString().slice(0, 10)] = Object.fromEntries(METRICS.map((m) => [m, 0])) as Record<Metric, number>;
      }
      for (const row of rows) if (series[row.day]) series[row.day][row.metric] = row.total;
      const sources = await d.query<{ metric: string; key: string; total: number }>(
        `select metric, key, sum(count)::int as total from daily_stats
         where day > ${TODAY} - $1::int and metric in ('landing_view', 'waitlist') group by metric, key order by total desc`,
        [days],
      );
      const [totals] = await d.query<{ users: number; waitlist: number; active7: number; active30: number; invited: number }>(
        `select (select count(*)::int from users) as users,
           (select count(*)::int from waitlist) as waitlist,
           (select count(*)::int from waitlist where invited_at is not null) as invited,
           (select count(*)::int from users where last_active_on > ${TODAY} - 7) as active7,
           (select count(*)::int from users where last_active_on > ${TODAY} - 30) as active30`,
      );
      return {
        days: Object.entries(series).map(([day, v]) => ({ day, ...v })),
        sources: {
          landing_view: sources.filter((s) => s.metric === 'landing_view').map(({ key, total }) => ({ key, total })),
          waitlist: sources.filter((s) => s.metric === 'waitlist').map(({ key, total }) => ({ key, total })),
        },
        totals,
      };
    }),
  );
}
