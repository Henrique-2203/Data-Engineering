import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { isPlatformAdmin } from './reports.ts';
import type { requireAuth } from './auth.ts';
import { sha256 } from './auth.ts';

/**
 * Chaves de emergência (INF-06): a equipe desliga uma parte do Resenha na hora, sem atualizar o site, quando algo
 * está sendo abusado (raid de convites, spam de DMs, upload de lixo, bot malicioso...).
 * Painel da equipe → Sistema → "Chaves de emergência". Também: "Sair de TODOS os aparelhos" (revoga todas as sessões).
 */
export const KILL_SWITCHES = ['uploads', 'invites', 'dms', 'calls', 'bots'] as const;
export type KillSwitch = (typeof KILL_SWITCHES)[number];
type State = Record<KillSwitch, boolean>;
const OFF: State = { uploads: false, invites: false, dms: false, calls: false, bots: false };
const LABEL: Record<KillSwitch, string> = { uploads: 'O envio de arquivos', invites: 'Entrar por convite', dms: 'Abrir conversas privadas novas', calls: 'As chamadas de voz', bots: 'Os bots' };

let cache: { at: number; state: State } | null = null;
export async function killState(db: Db): Promise<State> {
  if (cache && Date.now() - cache.at < 5000) return cache.state;
  const [row] = await db.query<{ value: Partial<State> }>(`select value from app_settings where name = 'killswitch'`);
  const state = { ...OFF, ...(row?.value ?? {}) };
  cache = { at: Date.now(), state };
  return state;
}

/** barra a ação com 503 se a equipe desligou essa parte */
export async function requireOn(db: Db, what: KillSwitch) {
  if ((await killState(db))[what]) throw new HttpError(503, `${LABEL[what]} está temporariamente desligado pela equipe do Resenha. Tente de novo mais tarde.`);
}

export function registerKillRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const staff = (username: string) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };
  r.get('/admin/killswitch', auth, wrap(async (req) => (staff(req.user!.username), { state: await killState(db), labels: LABEL })));
  r.put(
    '/admin/killswitch',
    auth,
    wrap(async (req) => {
      staff(req.user!.username);
      const body = parse(z.object({ uploads: z.boolean().optional(), invites: z.boolean().optional(), dms: z.boolean().optional(), calls: z.boolean().optional(), bots: z.boolean().optional() }), req.body);
      const next = { ...(await killState(db)), ...body };
      await db.query(`insert into app_settings (name, value, updated_at) values ('killswitch', $1, now()) on conflict (name) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(next)]);
      cache = null;
      console.warn(`[segurança] chaves de emergência alteradas por @${req.user!.username}:`, JSON.stringify(next));
      return { state: next };
    }),
  );
  /** Incidente (chave vazada, onda de contas invadidas): derruba TODAS as sessões, menos a de quem clicou. */
  r.post(
    '/admin/security/revoke-all-sessions',
    auth,
    wrap(async (req) => {
      staff(req.user!.username);
      parse(z.object({ confirm: z.literal('REVOGAR TODAS') }), req.body);
      const mine = sha256(String(req.headers.authorization?.slice(7) ?? ''));
      const rows = await db.query<{ token_hash: string }>('delete from sessions where token_hash <> $1 returning token_hash', [mine]);
      rt.endSessions(rows.map((x) => x.token_hash));
      console.warn(`[segurança] @${req.user!.username} revogou ${rows.length} sessões.`);
      return { revoked: rows.length };
    }),
  );
}
