import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import { HttpError, parse, wrap } from './http.ts';
import { isPlatformAdmin } from './reports.ts';
import type { requireAuth } from './auth.ts';

/**
 * Recursos em teste liberados só para algumas contas (o resto do Resenha não vê nada).
 * A lista fica no banco e a equipe muda em Painel da equipe → Saúde → 🧪 Laboratório, sem atualizar o site.
 * - layout2: o layout novo (abas no computador, barra de baixo no celular), como opção em Aparência.
 */
export const BETA_FEATURES = ['layout2'] as const;
export type BetaFeature = (typeof BETA_FEATURES)[number];
type BetaSettings = Record<BetaFeature, string[]>;
const EMPTY: BetaSettings = { layout2: [] };

let cache: { at: number; value: BetaSettings } | null = null;
export async function getBeta(db: Db): Promise<BetaSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [row] = await db.query<{ value: Partial<BetaSettings> }>(`select value from app_settings where name = 'beta'`);
  const value = { ...EMPTY, ...(row?.value ?? {}) };
  cache = { at: Date.now(), value };
  return value;
}

/** os recursos em teste desta conta */
export async function betaFeaturesFor(db: Db, username: string): Promise<BetaFeature[]> {
  const b = await getBeta(db);
  const u = username.toLowerCase();
  return BETA_FEATURES.filter((f) => b[f].includes(u));
}

const clean = (list: string[]) => [...new Set(list.map((u) => u.trim().replace(/^@/, '').toLowerCase()).filter((u) => /^[a-z0-9_.]{2,32}$/.test(u)))].slice(0, 50);

export function registerBetaRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>) {
  const admin = (username: string) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };
  r.get(
    '/admin/beta',
    auth,
    wrap(async (req) => {
      admin(req.user!.username);
      return { beta: await getBeta(db) };
    }),
  );
  r.put(
    '/admin/beta',
    auth,
    wrap(async (req) => {
      admin(req.user!.username);
      const b = parse(z.object({ layout2: z.array(z.string().max(40)).max(100) }), req.body);
      const value: BetaSettings = { layout2: clean(b.layout2) };
      await db.query(
        `insert into app_settings (name, value, updated_at) values ('beta', $1, now())
         on conflict (name) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify(value)],
      );
      cache = null;
      return { beta: value };
    }),
  );
}
