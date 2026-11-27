import type { Db } from './db.ts';

/**
 * Peças pequenas do servidor oficial e do Explorar, sem depender de outros módulos (as denúncias usam
 * isto, e o Explorar e o servidor oficial usam as denúncias: separado, não vira importação circular).
 */
let cached: { id: string | null; at: number } | null = null;

export function resetOfficialCache() {
  cached = null;
}

export async function officialGuildId(db: Db): Promise<string | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.id;
  const [row] = await db.query<{ value: { guildId?: string } }>(`select value from app_settings where name = 'official_guild'`);
  let id = row?.value?.guildId ?? null;
  if (id) {
    const [g] = await db.query('select 1 from guilds where id = $1', [id]);
    if (!g) id = null; // o servidor foi excluído
  }
  cached = { id, at: Date.now() };
  return id;
}

/** Para aparecer no Explorar: público, com descrição, ícone, categoria e regras com "Aceito", e não tirado da lista. */
export const LISTED_SQL = `g.public and not g.unlisted and g.description <> '' and g.icon_id is not null
  and g.rules <> '' and g.rules_required and g.category <> ''`;

export async function isListed(db: Db, guildId: string) {
  if ((await officialGuildId(db)) === guildId) return true;
  const [g] = await db.query(`select 1 from guilds g where g.id = $1 and ${LISTED_SQL}`, [guildId]);
  return !!g;
}
