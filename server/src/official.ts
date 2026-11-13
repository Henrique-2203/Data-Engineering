import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { USER_COLUMNS, type requireAuth } from './auth.ts';
import { isPlatformAdmin } from './reports.ts';
import { audit, userLabel } from './audit.ts';
import { Perm } from '../../shared/permissions.ts';
import { officialGuildId, resetOfficialCache } from './listing.ts';
import type { Member } from '../../shared/types.ts';

/**
 * Servidor oficial do Resenha ("Resenha Brasil OFC"): a comunidade onde quem cria conta entra
 * sozinho, para não chegar num app vazio. Regras do jogo:
 *  - entra UMA vez (cadastro novo ou primeira vez que abre o app depois de criado o servidor);
 *  - quem sair não é colocado de volta; quem foi banido não entra;
 *  - o servidor é criado pela equipe no Painel da equipe → Servidor oficial (dono = quem criou).
 */
export { officialGuildId };

/**
 * Coloca a pessoa no servidor oficial se ela ainda não passou por isso. Devolve o nome do servidor
 * quando acabou de entrar (para o app mostrar o aviso), ou null.
 */
export async function ensureOfficialMember(db: Db, rt: Realtime, userId: string): Promise<{ guildId: string; name: string } | null> {
  const [u] = await db.query<{ done: boolean }>('select official_auto_at is not null as done from users where id = $1', [userId]);
  if (!u || u.done) return null;
  const guildId = await officialGuildId(db);
  if (!guildId) return null; // ainda não existe: tenta de novo da próxima vez
  // marca antes: mesmo que algo falhe, nunca coloca a pessoa duas vezes
  const [mark] = await db.query<{ id: string }>('update users set official_auto_at = now() where id = $1 and official_auto_at is null returning id', [userId]);
  if (!mark) return null;
  const [banned] = await db.query('select 1 from bans where guild_id = $1 and user_id = $2', [guildId, userId]);
  if (banned) return null;
  const inserted = await db.query('insert into members (guild_id, user_id) values ($1, $2) on conflict do nothing returning joined_at', [guildId, userId]);
  if (!inserted.length) return null; // já era membro
  await audit(db, guildId, userId, 'member_join', { type: 'user', id: userId, label: await userLabel(db, userId) });
  rt.userJoinedGuild(userId, guildId);
  // aviso leve para quem já está lá (sem fazer todo mundo recarregar o servidor inteiro)
  const [member] = await db.query<Member>(
    `select m.joined_at as "joinedAt", m.timeout_until as "timeoutUntil", m.nick, ${USER_COLUMNS}, '{}'::text[] as "roleIds"
     from members m join users u on u.id = m.user_id where m.guild_id = $1 and m.user_id = $2`,
    [guildId, userId],
  );
  if (member) rt.emitGuild(guildId, 'member:join', { guildId, member });
  const [g] = await db.query<{ name: string }>('select name from guilds where id = $1', [guildId]);
  return { guildId, name: g?.name ?? 'servidor oficial' };
}

const RULES = `1. Respeito acima de tudo: nada de ódio, preconceito, assédio ou ameaça.
2. Nada de conteúdo adulto, violento ou ilegal. Tolerância zero com qualquer coisa envolvendo menores.
3. Sem spam, golpe, divulgação sem permissão ou correntes.
4. Não compartilhe dados pessoais (seus ou de outras pessoas).
5. Use cada canal para o que ele é: #procurando-grupo para chamar galera, #sugestões para ideias.
6. Na call, sem gritar no microfone, sem tocar som alto e sem atrapalhar a partida dos outros.
7. A moderação pode silenciar, mover, castigar ou banir quem quebrar as regras.
8. Viu algo errado? Use o botão Denunciar (🚩) na mensagem ou no perfil.

Valem também os Termos de uso do Resenha.`;

export function registerOfficialRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };

  r.get(
    '/admin/official',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const id = await officialGuildId(db);
      if (!id) return { guild: null };
      const [g] = await db.query<{ id: string; name: string; members: number }>(
        'select g.id, g.name, (select count(*)::int from members m where m.guild_id = g.id) as members from guilds g where g.id = $1',
        [id],
      );
      const [{ pending }] = await db.query<{ pending: number }>('select count(*)::int as pending from users where official_auto_at is null');
      return { guild: g ?? null, pending };
    }),
  );

  /** Cria o servidor oficial com os canais, as regras e o cargo da moderação (uma vez só). */
  r.post(
    '/admin/official',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      if (await officialGuildId(db)) throw new HttpError(400, 'O servidor oficial já existe.');
      const body = parse(
        z.object({
          name: z.string().trim().min(1).max(50).default('Resenha Brasil OFC'),
          moderators: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
        }),
        req.body ?? {},
      );
      const me = req.user!.id;
      const id = randomUUID();
      const code = randomUUID().replace(/-/g, '').slice(0, 10);
      await db.query(
        `insert into guilds (id, name, owner_id, invite_code, description, rules, rules_required, everyone_permissions)
         values ($1, $2, $3, $4, $5, $6, true, $7)`,
        [
          id,
          body.name,
          me,
          code,
          'A comunidade oficial do Resenha: conheça gente nova, chame galera pra jogar e fique por dentro das novidades.',
          RULES,
          // todos convidam, transmitem, usam o soundboard e mudam o apelido; @todos fica com a equipe
          Perm.CREATE_INVITE | Perm.STREAM | Perm.USE_SOUNDBOARD | Perm.CHANGE_NICKNAME,
        ],
      );
      await db.query('insert into members (guild_id, user_id, rules_accepted_at) values ($1, $2, now())', [id, me]);
      // categorias e canais
      const cat = async (name: string, position: number) => {
        const cid = randomUUID();
        await db.query('insert into categories (id, guild_id, name, position) values ($1, $2, $3, $4)', [cid, id, name, position]);
        return cid;
      };
      const info = await cat('📌 Informações', 0);
      const comm = await cat('💬 Comunidade', 1);
      const calls = await cat('🔊 Calls', 2);
      let pos = 0;
      const ch = async (name: string, type: 'text' | 'voice', categoryId: string, extra: { announce?: boolean; slowmode?: number } = {}) => {
        const cid = randomUUID();
        await db.query(
          `insert into channels (id, guild_id, name, type, position, category_id, announce, slowmode, bitrate, user_limit)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 128, 0)`,
          [cid, id, name, type, pos++, categoryId, !!extra.announce, extra.slowmode ?? 0],
        );
        return cid;
      };
      const rulesCh = await ch('regras', 'text', info, { announce: true });
      const news = await ch('novidades', 'text', info, { announce: true });
      await ch('geral', 'text', comm, { slowmode: 5 });
      await ch('procurando-grupo', 'text', comm, { slowmode: 10 });
      await ch('sugestões', 'text', comm, { slowmode: 30 });
      for (const n of ['Call 1', 'Call 2', 'Call 3']) await ch(n, 'voice', calls);
      // mensagens iniciais: as regras e o "bem-vindo" nos avisos
      const post = (channelId: string, content: string) =>
        db.query('insert into messages (id, channel_id, author_id, content) values ($1, $2, $3, $4)', [randomUUID(), channelId, me, content]);
      await post(rulesCh, `📜 Regras do ${body.name}\n\n${RULES}`);
      await post(news, `👋 Bem-vindo(a) ao ${body.name}! Aqui a equipe posta as novidades do Resenha. Para conversar, use o #geral; para chamar galera pra jogar, o #procurando-grupo.`);
      // cargo da moderação (abaixo do dono)
      const roleId = randomUUID();
      await db.query('insert into roles (id, guild_id, name, color, position, permissions) values ($1, $2, $3, $4, 1, $5)', [
        roleId,
        id,
        'Moderação Suprema',
        '#ff7a45',
        Perm.ADMIN,
      ]);
      const missing: string[] = [];
      for (const username of [...new Set(body.moderators.map((u) => u.replace(/^@/, '')))]) {
        const [u] = await db.query<{ id: string }>('select id from users where username = $1', [username]);
        if (!u) {
          missing.push(username);
          continue;
        }
        await db.query('insert into members (guild_id, user_id, rules_accepted_at) values ($1, $2, now()) on conflict do nothing', [id, u.id]);
        await db.query('insert into member_roles (guild_id, user_id, role_id) values ($1, $2, $3) on conflict do nothing', [id, u.id, roleId]);
        await db.query('update users set official_auto_at = coalesce(official_auto_at, now()) where id = $1', [u.id]);
        rt.userJoinedGuild(u.id, id);
      }
      await db.query('update users set official_auto_at = coalesce(official_auto_at, now()) where id = $1', [me]);
      await db.query(
        `insert into app_settings (name, value, updated_at) values ('official_guild', $1, now())
         on conflict (name) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify({ guildId: id })],
      );
      resetOfficialCache();
      rt.userJoinedGuild(me, id);
      return { guildId: id, missing };
    }),
  );
}
