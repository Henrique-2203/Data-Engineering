import { randomBytes, randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { memberJoined } from './welcome.ts';
import { HttpError, parse, wrap } from './http.ts';
import { isPlatformAdmin } from './reports.ts';
import type { requireAuth } from './auth.ts';

/**
 * Recursos em teste liberados só para algumas contas (o resto do Resenha não vê nada).
 * A lista fica no banco e a equipe muda em Painel da equipe → Saúde → 🧪 Laboratório, sem atualizar o site.
 * - layout2: o layout novo (abas no computador, barra de baixo no celular), como opção em Aparência.
 * - phonecam: usar a câmera do celular como câmera do computador na call (QR Code).
 * - bots: bots da casa (comandos com /) e a aba Integrações nas configurações do servidor.
 * Os nomes das contas ficam só no banco, nunca no código.
 */
export const BETA_FEATURES = ['layout2', 'phonecam', 'bots'] as const;
export type BetaFeature = (typeof BETA_FEATURES)[number];
/** `open`: recursos liberados para TODAS as contas (o resto só para as listas). Lançados: layout novo e câmera do celular. */
type BetaSettings = Record<BetaFeature, string[]> & { open: BetaFeature[] };
const EMPTY: BetaSettings = { layout2: [], phonecam: [], bots: [], open: ['layout2', 'phonecam'] };

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
  return BETA_FEATURES.filter((f) => b.open.includes(f) || b[f].includes(u));
}

/**
 * Barra quem não tem o recurso em teste: o servidor também confere (esconder o botão não basta).
 * Responde 404, como se a rota não existisse. A equipe (PLATFORM_ADMINS) não é liberada sozinha: precisa estar na lista.
 */
export async function requireFeature(db: Db, username: string, feature: BetaFeature) {
  if (!(await betaFeaturesFor(db, username)).includes(feature)) throw new HttpError(404, 'Rota não encontrada.');
}

const clean = (list: string[]) => [...new Set(list.map((u) => u.trim().replace(/^@/, '').toLowerCase()).filter((u) => /^[a-z0-9_.]{2,32}$/.test(u)))].slice(0, 50);

export function registerBetaRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
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
      // aceita só as listas enviadas e mantém as outras como estão (salvar uma não apaga as demais)
      const list = z.array(z.string().max(40)).max(100).optional();
      const b = parse(z.object({ layout2: list, phonecam: list, bots: list, open: z.array(z.enum(BETA_FEATURES)).optional() }), req.body);
      const value: BetaSettings = { ...(await getBeta(db)) };
      for (const f of BETA_FEATURES) if (b[f]) value[f] = clean(b[f]);
      if (b.open) value.open = [...new Set(b.open)];
      await db.query(
        `insert into app_settings (name, value, updated_at) values ('beta', $1, now())
         on conflict (name) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify(value)],
      );
      cache = null;
      return { beta: value };
    }),
  );

  /**
   * Servidor privado "Laboratório Resenha" para a equipe testar tudo antes de lançar.
   * Quem clica vira dono; entram todas as contas liberadas para câmera do celular e bots.
   * Pode clicar de novo: só acrescenta quem foi liberado depois.
   */
  r.post(
    '/admin/test-guild',
    auth,
    wrap(async (req) => {
      admin(req.user!.username);
      const me = req.user!.id;
      const [saved] = await db.query<{ value: { id?: string } }>(`select value from app_settings where name = 'test_guild'`);
      let guildId = saved?.value?.id ?? null;
      let created = false;
      if (guildId) {
        const [g] = await db.query<{ id: string }>('select id from guilds where id = $1', [guildId]);
        if (!g) guildId = null; // alguém apagou o servidor: cria de novo
      }
      if (!guildId) {
        guildId = randomUUID();
        created = true;
        await db.query(`insert into guilds (id, name, owner_id, invite_code, public, category) values ($1, 'Laboratório Resenha', $2, $3, false, '')`, [
          guildId,
          me,
          randomBytes(6).toString('base64url'),
        ]);
        await db.query('insert into members (guild_id, user_id) values ($1, $2)', [guildId, me]);
        await db.query(
          `insert into channels (id, guild_id, name, type, position) values ($1, $3, 'geral', 'text', 0), ($2, $3, 'Sala de voz', 'voice', 1)`,
          [randomUUID(), randomUUID(), guildId],
        );
        rt.userJoinedGuild(me, guildId);
        await db.query(
          `insert into app_settings (name, value, updated_at) values ('test_guild', $1, now())
           on conflict (name) do update set value = excluded.value, updated_at = now()`,
          [JSON.stringify({ id: guildId })],
        );
      }
      // quem clicou também precisa estar no servidor (pode ser outra conta da equipe, se ele já existia)
      const [mine] = await db.query('select 1 from members where guild_id = $1 and user_id = $2', [guildId, me]);
      if (!mine) {
        await db.query('insert into members (guild_id, user_id) values ($1, $2) on conflict do nothing', [guildId, me]);
        await memberJoined(db, rt, guildId, me);
      }
      // os aplicativos abertos ainda não sabem do servidor novo: avisa para ele aparecer na coluna de servidores na hora
      rt.emitUser(me, 'guild:refresh', { guildId });
      // todas as contas liberadas para algum recurso que ainda não estão no servidor
      const beta = await getBeta(db);
      const names = [...new Set([...beta.phonecam, ...beta.bots])];
      const added: string[] = [];
      if (names.length) {
        const users = await db.query<{ id: string; username: string }>(
          `select u.id, u.username from users u where u.username = any($1::text[])
             and not exists (select 1 from members m where m.guild_id = $2 and m.user_id = u.id)
             and not exists (select 1 from bans b where b.guild_id = $2 and b.user_id = u.id)`,
          [names, guildId],
        );
        for (const u of users) {
          await db.query('insert into members (guild_id, user_id) values ($1, $2) on conflict do nothing', [guildId, u.id]);
          await memberJoined(db, rt, guildId, u.id);
          added.push(u.username);
          rt.emitUser(u.id, 'guild:refresh', { guildId });
        }
      }
      return { guildId, created, added };
    }),
  );
}
