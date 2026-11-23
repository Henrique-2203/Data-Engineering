import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Db } from './db.ts';

/**
 * Internet que o servidor gastou no mês (o que o Render cobra depois dos 5 GB grátis do plano Hobby).
 * Conta tudo que o servidor escreve nas conexões: páginas, app, API e WebSocket (chat, presença, call).
 * É uma estimativa nossa (o número oficial é o do painel do Render: Billing → Included Bandwidth), mas
 * fica bem perto, porque o Render cobra justamente o que sai do servidor. O que a Cloudflare entrega da
 * cópia dela não passa por aqui e não é cobrado.
 *
 * Variáveis (no Render): BANDWIDTH_FREE_GB (5), BANDWIDTH_PRICE_USD (0.15 por GB), BANDWIDTH_ALERT_GB
 * (20: aos 80% disso a equipe recebe e-mail).
 */
export const bandwidthFreeGb = Number(process.env.BANDWIDTH_FREE_GB ?? 5);
export const bandwidthPriceUsd = Number(process.env.BANDWIDTH_PRICE_USD ?? 0.15);
export const bandwidthAlertGb = Number(process.env.BANDWIDTH_ALERT_GB ?? 20);

/** mês atual em Brasília (AAAA-MM) */
const monthKey = (now = new Date()) => new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 7);

let pending = 0; // bytes ainda não gravados no banco
const counted = new WeakMap<Socket, number>();
const live = new Set<Socket>();

function take(sock: Socket) {
  const total = sock.bytesWritten ?? 0;
  const before = counted.get(sock) ?? 0;
  if (total > before) {
    pending += total - before;
    counted.set(sock, total);
  }
}

export async function flushBandwidth(db: Db) {
  for (const s of live) take(s);
  if (!pending) return;
  const add = pending;
  pending = 0;
  const month = monthKey();
  try {
    // virou o mês: começa do zero
    await db.query(
      `insert into app_settings (name, value, updated_at) values ('bandwidth', jsonb_build_object('month', $1::text, 'bytes', $2::bigint), now())
       on conflict (name) do update set updated_at = now(), value = case
         when app_settings.value->>'month' = $1 then jsonb_build_object('month', $1::text, 'bytes', (app_settings.value->>'bytes')::bigint + $2::bigint)
         else jsonb_build_object('month', $1::text, 'bytes', $2::bigint) end`,
      [month, add],
    );
  } catch (err) {
    pending += add; // tenta de novo na próxima
    console.warn('[internet]', err);
  }
}

export function startBandwidthMeter(http: Server, db: Db) {
  http.on('connection', (sock: Socket) => {
    live.add(sock);
    sock.once('close', () => {
      take(sock);
      live.delete(sock);
    });
  });
  const timer = setInterval(() => void flushBandwidth(db), 60_000);
  timer.unref();
}

/** quanto já saiu este mês, em MB (o que está gravado + o que ainda está na memória) */
export async function bandwidthMonthMb(db: Db) {
  const [row] = await db.query<{ value: { month?: string; bytes?: number | string } }>(`select value from app_settings where name = 'bandwidth'`);
  let stored = row?.value?.month === monthKey() ? Number(row.value.bytes) || 0 : 0;
  let mem = pending;
  for (const s of live) mem += Math.max(0, (s.bytesWritten ?? 0) - (counted.get(s) ?? 0));
  stored += mem;
  return Math.round(stored / 1_000_000);
}
