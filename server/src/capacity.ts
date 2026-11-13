import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { config } from './config.ts';
import { storageUsage } from './access.ts';
import { alertUser } from './account.ts';
import { cloudflareConfigured } from './ice.ts';

/**
 * Capacidade (Painel da equipe → Sistema): quanto já foi usado de cada limite do plano grátis, para
 * decidir com números quando pagar algo. Os limites vêm de variáveis (o plano pode mudar):
 *   CPU_LIMIT (núcleos; Render grátis = 0.1), MEMORY_LIMIT_MB (512), TURN_QUOTA_MB (a cota do Metered).
 * Passou de 80% em algum: a equipe recebe um e-mail (no máximo um por dia por limite).
 */
const cpuLimit = Number(process.env.CPU_LIMIT) || 0.1;
const memoryLimitMb = Number(process.env.MEMORY_LIMIT_MB) || 512;
const turnQuotaMb = Number(process.env.TURN_QUOTA_MB) || null;

// processador: média do último minuto e pico de 10 s
let last = { cpu: process.cpuUsage(), at: process.hrtime.bigint() };
const window: number[] = [];
const sampler = setInterval(() => {
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(last.cpu);
  const wallUs = Number(now - last.at) / 1000;
  window.push(((cpu.user + cpu.system) / wallUs) * 100); // % de 1 núcleo
  if (window.length > 6) window.shift();
  last = { cpu: process.cpuUsage(), at: now };
}, 10_000);
sampler.unref();

export interface Capacity {
  cpu: { avgPct: number; peakPct: number; limitPct: number };
  memory: { usedMb: number; limitMb: number };
  database: { usedMb: number; limitMb: number };
  files: { usedMb: number; limitMb: number; where: 'r2' | 'db' };
  turn: { monthMb: number; quotaMb: number | null; cloudflareLimitMb: number | null; paused: boolean };
  live: { online: number; inVoice: number; calls: number; streaming: number };
  /** banco embutido (sem DATABASE_URL): ele roda dentro do servidor e soma no processador e na memória */
  embeddedDb: boolean;
}

export async function capacity(db: Db, rt: Realtime): Promise<Capacity> {
  const s = await storageUsage(db);
  const [{ month }] = await db.query<{ month: number }>(
    `select coalesce(sum(sum), 0)::float as month from call_health
     where metric = 'turn_mb' and date_trunc('month', day) = date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)`,
  );
  const avg = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
  return {
    cpu: { avgPct: Math.round(avg), peakPct: Math.round(Math.max(0, ...window)), limitPct: Math.round(cpuLimit * 100) },
    memory: { usedMb: Math.round(process.memoryUsage().rss / 1048576), limitMb: memoryLimitMb },
    database: { usedMb: Math.round(s.databaseBytes / 1048576), limitMb: Math.round(s.databaseLimitBytes / 1048576) },
    files: { usedMb: Math.round(s.filesBytes / 1048576), limitMb: Math.round(s.filesLimitBytes / 1048576), where: s.where },
    turn: {
      monthMb: Math.round(month),
      quotaMb: turnQuotaMb,
      cloudflareLimitMb: cloudflareConfigured() ? config.cloudflareTurn.limitMb : null,
      paused: cloudflareConfigured() && month >= config.cloudflareTurn.limitMb,
    },
    live: rt.liveCounts(),
    embeddedDb: !config.databaseUrl,
  };
}

/** Quais limites estão acima de 80% (com o texto do aviso). */
export function overLimits(c: Capacity): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  // banco embutido (desenvolvimento/testes): processador e memória não dizem nada sobre o site de verdade
  if (c.embeddedDb) return out;
  const p = (used: number, limit: number | null) => (limit ? used / limit : 0);
  if (p(c.cpu.avgPct, c.cpu.limitPct) >= 0.8) out.push({ key: 'cpu', text: `Processador: ${c.cpu.avgPct}% de 1 núcleo em média no último minuto (o plano dá ${c.cpu.limitPct}%).` });
  if (p(c.memory.usedMb, c.memory.limitMb) >= 0.8) out.push({ key: 'memory', text: `Memória: ${c.memory.usedMb} MB de ${c.memory.limitMb} MB.` });
  if (p(c.database.usedMb, c.database.limitMb) >= 0.8) out.push({ key: 'database', text: `Banco de dados: ${c.database.usedMb} MB de ${c.database.limitMb} MB.` });
  if (p(c.files.usedMb, c.files.limitMb) >= 0.8) out.push({ key: 'files', text: `Arquivos: ${c.files.usedMb} MB de ${c.files.limitMb} MB.` });
  if (c.turn.quotaMb && p(c.turn.monthMb, c.turn.quotaMb) >= 0.8) out.push({ key: 'turn', text: `TURN: ${c.turn.monthMb} MB de ${c.turn.quotaMb} MB este mês.` });
  const gb = (mb: number) => `${(mb / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  if (c.turn.cloudflareLimitMb && c.turn.paused)
    out.push({
      key: 'turn-paused',
      text: `TURN da Cloudflare PAUSADO até o mês virar: chegou no limite de segurança (${gb(c.turn.monthMb)} de ${gb(c.turn.cloudflareLimitMb)}). Quem está no 4G/5G agora usa o Metered (cota pequena) e pode não conectar. Para liberar, aumente CLOUDFLARE_TURN_LIMIT_MB no Render (a Cloudflare dá 1.000 GB grátis; o que passar custa US$ 0,05 por GB).`,
    });
  else if (c.turn.cloudflareLimitMb && p(c.turn.monthMb, c.turn.cloudflareLimitMb) >= 0.8)
    out.push({ key: 'turn-cf', text: `TURN da Cloudflare: ${gb(c.turn.monthMb)} de ${gb(c.turn.cloudflareLimitMb)} (limite de segurança). Ao chegar no limite, ele pausa até o mês virar.` });
  return out;
}

/** A cada 10 minutos confere; passou de 80%, manda e-mail para a equipe (uma vez por dia por limite). */
export function startCapacityAlerts(db: Db, rt: Realtime) {
  const sent = new Map<string, string>(); // limite -> dia do último aviso
  const tick = async () => {
    const over = overLimits(await capacity(db, rt));
    if (!over.length || !config.platformAdmins.length) return;
    const day = new Date().toISOString().slice(0, 10);
    const fresh = over.filter((o) => sent.get(o.key) !== day);
    if (!fresh.length) return;
    fresh.forEach((o) => sent.set(o.key, day));
    const admins = await db.query<{ id: string }>('select id from users where username = any($1)', [config.platformAdmins]);
    for (const a of admins) {
      await alertUser(
        db,
        a.id,
        'Resenha perto do limite do plano',
        ['Um ou mais limites do plano passaram de 80%:', ...fresh.map((o) => `• ${o.text}`), 'Veja os detalhes no Painel da equipe → Sistema e o guia docs/CAPACIDADE.md.'],
        '',
      );
    }
  };
  const timer = setInterval(() => void tick().catch((err) => console.warn('[capacidade]', err)), 10 * 60_000);
  timer.unref();
}
