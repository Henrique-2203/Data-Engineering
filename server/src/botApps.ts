import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit, limited } from './security.ts';
import { requireFeature } from './beta.ts';
import { audit } from './audit.ts';
import { requirePerm, type ChannelRow, type MemberAccess } from './access.ts';
import { checkAutomod } from './community.ts';
import { USER_COLUMNS, verifyPassword, type requireAuth } from './auth.ts';
import { Perm, has } from '../../shared/permissions.ts';
import type { BotCommandInfo, BotEmbed, Member } from '../../shared/types.ts';
import { impersonatesStaff, skeleton } from './names.ts';
import { SafeFetchError, safePost, validateBotUrl } from './safeFetch.ts';
import type { Reply } from './botKit.ts';

/**
 * Bots de terceiros (recurso "botdev"): qualquer pessoa liberada cria o próprio bot, recebe um TOKEN e escreve o
 * código onde quiser (o Resenha não hospeda nada). Como funciona:
 *  - o bot é um usuário (is_bot) com token próprio; o token só aparece uma vez e fica guardado como hash;
 *  - quem administra um servidor instala o bot pelo ID dele (Configurações → Integrações);
 *  - o bot registra seus comandos ("/algo") e, quando alguém usa, o Resenha chama o ENDEREÇO do bot (https) com a
 *    chamada ASSINADA (HMAC) e posta a resposta; o bot também pode postar sozinho pela API com o token;
 *  - o bot só enxerga e escreve onde foi instalado, nunca em conversas privadas, e passa pela moderação do servidor.
 * Documentação para quem desenvolve: docs/BOTS-API.md.
 */
export const MAX_BOTS_PER_OWNER = 3;
export const MAX_COMMANDS = 25;
const MAX_BOTS_PER_GUILD = 10;

const sha = (s: string) => createHash('sha256').update(s).digest();
const newToken = (botId: string) => `${botId}.${randomBytes(32).toString('base64url')}`;
const newSecret = () => randomBytes(32).toString('hex');
const tokenHash = (token: string) => sha(token).toString('hex');

/** assinatura que o bot confere em cada chamada: HMAC-SHA256 de "<timestamp>.<corpo>" com o segredo dele */
export const sign = (secret: string, timestamp: string, body: string) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const colorOk = /^#[0-9a-fA-F]{6}$/;
export const embedSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().max(1500).optional(),
  color: z.string().regex(colorOk).optional(),
  fields: z.array(z.object({ name: z.string().max(60), value: z.string().max(300) })).max(10).optional(),
});
export const replySchema = z
  .object({ content: z.string().max(2000).optional(), embed: embedSchema.optional() })
  .refine((r) => (r.content && r.content.trim()) || r.embed, { message: 'Envie "content" ou "embed".' });

const commandSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,20}$/, 'Nome do comando: 1 a 20 letras minúsculas, números ou _.'),
  description: z.string().min(1, 'Falta a descrição do comando.').max(100),
  usage: z.string().max(100).optional(),
});

interface BotReq extends Request {
  bot?: { id: string; ownerId: string; name: string };
}

interface Deps {
  channelForMember(channelId: string, userId: string): Promise<ChannelRow & { access: MemberAccess | null; slowmode?: number }>;
  /** posta uma mensagem como um bot e avisa o canal */
  post(c: { id: string; guildId: string | null }, reply: Reply, interaction: unknown, authorId: string): Promise<unknown>;
  /** nomes dos comandos do Resenha Bot (reservados) */
  reserved: string[];
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18) || 'bot';

export function registerBotApps(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>, deps: Deps) {
  const owner = async (req: Request) => {
    await requireFeature(db, req.user!.username, 'botdev');
    return req.user!;
  };

  /** Ações que dão ou tiram o controle de um bot (criar, trocar token, apagar) pedem a senha de novo (SES-06). */
  const reauth = async (userId: string, password: unknown) => {
    if (limited(`botpw:${userId}`, 8)) throw new HttpError(429, 'Muitas senhas erradas. Aguarde 15 minutos.');
    const [u] = await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId]);
    if (typeof password !== 'string' || !u || !(await verifyPassword(password, u.password_hash))) {
      limit(`botpw:${userId}`, 1000, 15 * 60_000); // só os ERROS contam para o bloqueio
      throw new HttpError(403, 'Senha incorreta.');
    }
  };

  const appRow = async (botId: string) =>
    (
      await db.query<{ id: string; ownerId: string; name: string; description: string; url: string | null; secret: string; createdAt: string; disabled: boolean }>(
        `select a.user_id as id, a.owner_id as "ownerId", u.display_name as name, a.description, a.interactions_url as url,
                a.signing_secret as secret, a.created_at as "createdAt", (a.disabled_at is not null) as disabled
         from bot_apps a join users u on u.id = a.user_id where a.user_id = $1`,
        [botId],
      )
    )[0];

  const myApp = async (req: Request) => {
    const user = await owner(req);
    const a = await appRow(String(req.params.id));
    if (!a || a.ownerId !== user.id) throw new HttpError(404, 'Bot não encontrado.');
    return { user, a };
  };

  const listFor = async (ownerId: string) => {
    const rows = await db.query<{ id: string; name: string; username: string; description: string; url: string | null; createdAt: string; disabled: boolean; guilds: number }>(
      `select a.user_id as id, u.display_name as name, u.username, a.description, a.interactions_url as url, a.created_at as "createdAt",
              (a.disabled_at is not null) as disabled, (select count(*)::int from guild_bots g where g.bot_id = a.user_id) as guilds
       from bot_apps a join users u on u.id = a.user_id where a.owner_id = $1 order by a.created_at`,
      [ownerId],
    );
    for (const row of rows as any[]) {
      row.commands = await db.query('select name, description, usage from bot_app_commands where bot_id = $1 order by name', [row.id]);
    }
    return rows;
  };

  // ---------- quem desenvolve: criar e gerenciar os próprios bots ----------
  r.get('/bot-apps', auth, wrap(async (req) => ({ bots: await listFor((await owner(req)).id) })));

  r.post(
    '/bot-apps',
    auth,
    wrap(async (req) => {
      const user = await owner(req);
      limit(`botapp:${user.id}`, 10, 3600_000, 'Muitos bots criados seguidos. Tente mais tarde.');
      // bot de terceiro não pode se passar pelo Resenha nem pela equipe (o selo BOT já mostra que é bot, mas o NOME não pode enganar)
      if (typeof req.body?.name === 'string' && (impersonatesStaff(req.body.name, user.username) || skeleton(req.body.name).includes('resenha'))) {
        throw new HttpError(400, 'O nome de um bot não pode usar "Resenha" nem se passar pela equipe. Escolha outro.');
      }
      const body = parse(z.object({ name: z.string().trim().min(2, 'Dê um nome ao bot (2 a 32 letras).').max(32), description: z.string().trim().max(200).default(''), password: z.string().max(200) }), req.body);
      await reauth(user.id, body.password);
      const [count] = await db.query<{ n: number }>('select count(*)::int as n from bot_apps where owner_id = $1', [user.id]);
      if ((count?.n ?? 0) >= MAX_BOTS_PER_OWNER) throw new HttpError(400, `Você pode ter até ${MAX_BOTS_PER_OWNER} bots.`);
      const id = `bot_${randomBytes(8).toString('hex')}`;
      let username = '';
      for (let i = 0; i < 20 && !username; i++) {
        const cand = `${slug(body.name)}_bot${i ? randomBytes(2).toString('hex') : ''}`.slice(0, 30);
        const [taken] = await db.query('select 1 from users where username = $1', [cand]);
        if (!taken) username = cand;
      }
      if (!username) throw new HttpError(409, 'Não foi possível escolher um nome de usuário para o bot. Tente outro nome.');
      const token = newToken(id);
      const secret = newSecret();
      await db.query(
        `insert into users (id, username, display_name, password_hash, avatar_color, is_bot, official_auto_at, terms_accepted_at)
         values ($1, $2, $3, 'bot$sem-login', $4, true, now(), now())`,
        [id, username, body.name, '#' + randomBytes(3).toString('hex')],
      );
      await db.query('insert into bot_apps (user_id, owner_id, description, token_hash, signing_secret) values ($1, $2, $3, $4, $5)', [id, user.id, body.description, tokenHash(token), secret]);
      // o token e o segredo só aparecem agora: guarde
      return { bot: { id, name: body.name, username, description: body.description }, token, signingSecret: secret };
    }),
  );

  r.patch(
    '/bot-apps/:id',
    auth,
    wrap(async (req) => {
      const { a } = await myApp(req);
      const body = parse(z.object({ name: z.string().trim().min(2).max(32).optional(), description: z.string().trim().max(200).optional(), interactionsUrl: z.string().max(300).nullable().optional() }), req.body);
      if (body.name && (impersonatesStaff(body.name, req.user!.username) || skeleton(body.name).includes('resenha'))) throw new HttpError(400, 'O nome de um bot não pode usar "Resenha" nem se passar pela equipe.');
      if (body.name) await db.query('update users set display_name = $2 where id = $1', [a.id, body.name]);
      if (body.description !== undefined) await db.query('update bot_apps set description = $2 where user_id = $1', [a.id, body.description]);
      if (body.interactionsUrl !== undefined) {
        let url: string | null = null;
        if (body.interactionsUrl) {
          try {
            url = validateBotUrl(body.interactionsUrl).toString();
          } catch (e) {
            throw new HttpError(400, e instanceof SafeFetchError ? e.message : 'Endereço inválido.');
          }
        }
        await db.query('update bot_apps set interactions_url = $2 where user_id = $1', [a.id, url]);
      }
      return { ok: true };
    }),
  );

  /** gera token e segredo novos (o antigo para de funcionar na hora) */
  r.post(
    '/bot-apps/:id/token',
    auth,
    wrap(async (req) => {
      const { user, a } = await myApp(req);
      limit(`bottoken:${user.id}`, 10, 3600_000);
      await reauth(user.id, req.body?.password);
      const token = newToken(a.id);
      const secret = newSecret();
      await db.query('update bot_apps set token_hash = $2, signing_secret = $3, token_rotated_at = now() where user_id = $1', [a.id, tokenHash(token), secret]);
      return { token, signingSecret: secret };
    }),
  );

  /** apaga o bot: sai dos servidores e o token deixa de existir (as mensagens antigas ficam, assinadas como "Bot removido") */
  r.delete(
    '/bot-apps/:id',
    auth,
    wrap(async (req) => {
      const { user, a } = await myApp(req);
      await reauth(user.id, req.body?.password);
      const guilds = await db.query<{ guildId: string }>('select guild_id as "guildId" from guild_bots where bot_id = $1', [a.id]);
      await db.query('delete from members where user_id = $1', [a.id]);
      await db.query('delete from guild_bots where bot_id = $1', [a.id]);
      await db.query('delete from bot_app_commands where bot_id = $1', [a.id]);
      await db.query('delete from bot_apps where user_id = $1', [a.id]);
      await db.query(`update users set display_name = 'Bot removido' where id = $1`, [a.id]);
      for (const g of guilds) rt.guildChanged(g.guildId);
      return { ok: true };
    }),
  );

  /** a equipe do Resenha desliga um bot que esteja abusando (ele para de responder e de postar) */
  r.post(
    '/admin/bot-apps/:id/disable',
    auth,
    wrap(async (req) => {
      const { isPlatformAdmin } = await import('./reports.ts');
      if (!isPlatformAdmin(req.user!.username)) throw new HttpError(404, 'Rota não encontrada.');
      const { disabled } = parse(z.object({ disabled: z.boolean() }), req.body);
      await db.query('update bot_apps set disabled_at = $2 where user_id = $1', [String(req.params.id), disabled ? new Date() : null]);
      return { ok: true };
    }),
  );

  // ---------- servidor: instalar um bot de terceiro ----------
  const manage = async (req: Request, guildId: string) => {
    await requireFeature(db, req.user!.username, 'bots');
    return requirePerm(db, guildId, req.user!.id, Perm.MANAGE_GUILD);
  };

  /** dados públicos do bot (para a pessoa conferir antes de instalar) */
  r.get(
    '/bot-apps/:id/public',
    auth,
    wrap(async (req) => {
      await requireFeature(db, req.user!.username, 'bots');
      const a = await appRow(String(req.params.id));
      if (!a || a.disabled) throw new HttpError(404, 'Bot não encontrado.');
      const [u] = await db.query<{ username: string; avatarColor: string; ownerName: string }>(
        `select b.username, b.avatar_color as "avatarColor", o.display_name as "ownerName" from users b join users o on o.id = $2 where b.id = $1`,
        [a.id, a.ownerId],
      );
      const commands = await db.query('select name, description, usage from bot_app_commands where bot_id = $1 order by name', [a.id]);
      return { id: a.id, name: a.name, description: a.description, username: u?.username, avatarColor: u?.avatarColor, owner: u?.ownerName, commands, hasUrl: !!a.url };
    }),
  );

  r.get(
    '/guilds/:id/bot-apps',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req, guildId);
      const bots = await db.query(
        `select a.user_id as id, u.display_name as name, a.description, g.installed_at as "installedAt",
                coalesce((select json_agg(json_build_object('name', c.name, 'description', c.description, 'usage', c.usage) order by c.name) from bot_app_commands c where c.bot_id = a.user_id), '[]') as commands
         from guild_bots g join bot_apps a on a.user_id = g.bot_id join users u on u.id = a.user_id where g.guild_id = $1 order by g.installed_at`,
        [guildId],
      );
      return { bots };
    }),
  );

  r.post(
    '/guilds/:id/bot-apps',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req, guildId);
      limit(`botinst:${req.user!.id}`, 10, 60_000, 'Calma! Muitas mudanças seguidas.');
      const { botId } = parse(z.object({ botId: z.string().trim().regex(/^bot_[a-f0-9]{16}$/, 'ID de bot inválido.') }), req.body);
      const a = await appRow(botId);
      if (!a || a.disabled) throw new HttpError(404, 'Bot não encontrado.');
      const [already] = await db.query('select 1 from guild_bots where guild_id = $1 and bot_id = $2', [guildId, botId]);
      if (already) throw new HttpError(409, 'Este bot já está no servidor.');
      const [n] = await db.query<{ n: number }>('select count(*)::int as n from guild_bots where guild_id = $1', [guildId]);
      if ((n?.n ?? 0) >= MAX_BOTS_PER_GUILD) throw new HttpError(400, `O servidor pode ter até ${MAX_BOTS_PER_GUILD} bots.`);
      // dois bots não podem ter o mesmo comando no mesmo servidor (nem repetir os da casa)
      const clash = await db.query<{ name: string }>(
        `select c.name from bot_app_commands c where c.bot_id = $1 and (c.name = any($2::text[])
           or c.name in (select c2.name from bot_app_commands c2 join guild_bots g on g.bot_id = c2.bot_id where g.guild_id = $3))`,
        [botId, deps.reserved, guildId],
      );
      if (clash.length) throw new HttpError(409, `Comando repetido neste servidor: /${clash.map((c) => c.name).join(', /')}. Remova o outro bot ou peça ao dono para renomear.`);
      await db.query('insert into guild_bots (guild_id, bot_id, installed_by) values ($1, $2, $3)', [guildId, botId, req.user!.id]);
      await db.query('insert into members (guild_id, user_id, rules_accepted_at) values ($1, $2, now()) on conflict (guild_id, user_id) do nothing', [guildId, botId]);
      const [member] = await db.query<Member>(
        `select m.joined_at as "joinedAt", m.timeout_until as "timeoutUntil", m.nick, ${USER_COLUMNS}, '{}'::text[] as "roleIds"
         from members m join users u on u.id = m.user_id where m.guild_id = $1 and m.user_id = $2`,
        [guildId, botId],
      );
      if (member) rt.emitGuild(guildId, 'member:join', { guildId, member });
      await audit(db, guildId, req.user!.id, 'bot_add', { type: 'user', id: botId, label: a.name });
      return { installed: true };
    }),
  );

  r.delete(
    '/guilds/:id/bot-apps/:botId',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req, guildId);
      const botId = String(req.params.botId);
      const a = await appRow(botId);
      const [row] = await db.query('select 1 from guild_bots where guild_id = $1 and bot_id = $2', [guildId, botId]);
      if (!a || !row) throw new HttpError(404, 'Este bot não está no servidor.');
      await db.query('delete from guild_bots where guild_id = $1 and bot_id = $2', [guildId, botId]);
      await db.query('delete from members where guild_id = $1 and user_id = $2', [guildId, botId]);
      rt.guildChanged(guildId);
      await audit(db, guildId, req.user!.id, 'bot_remove', { type: 'user', id: botId, label: a.name });
      return { installed: false };
    }),
  );

  // ---------- API do bot (Authorization: Bot <token>) ----------
  const botAuth = async (req: BotReq, res: Response, next: NextFunction) => {
    try {
      const m = /^Bot\s+(bot_[a-f0-9]{16})\.([A-Za-z0-9_-]{20,64})$/.exec(String(req.headers.authorization ?? ''));
      const fail = () => {
        // chutar tokens é travado por IP (sem isso cada tentativa custaria uma consulta ao banco)
        try {
          limit(`botauthfail:${req.ip}`, 60, 60_000, 'Muitas tentativas com token inválido. Espere um minuto.');
        } catch (e) {
          return next(e);
        }
        return res.status(401).json({ error: 'Token inválido. Use o cabeçalho "Authorization: Bot <token>".' });
      };
      if (!m) return fail();
      const [row] = await db.query<{ hash: string; ownerId: string; name: string; disabled: boolean }>(
        `select a.token_hash as hash, a.owner_id as "ownerId", u.display_name as name, (a.disabled_at is not null) as disabled from bot_apps a join users u on u.id = a.user_id where a.user_id = $1`,
        [m[1]],
      );
      const given = Buffer.from(tokenHash(`${m[1]}.${m[2]}`), 'hex');
      const stored = Buffer.from(row?.hash ?? '00'.repeat(32), 'hex');
      if (!row || given.length !== stored.length || !timingSafeEqual(given, stored)) return fail();
      if (row.disabled) return res.status(403).json({ error: 'Este bot foi desligado pela equipe do Resenha.' });
      limit(`botapi:${m[1]}`, 120, 60_000, 'Limite de chamadas do bot: no máximo 120 por minuto.');
      req.bot = { id: m[1], ownerId: row.ownerId, name: row.name };
      next();
    } catch (err) {
      next(err);
    }
  };

  r.get(
    '/bot/me',
    botAuth,
    wrap(async (req) => {
      const bot = (req as BotReq).bot!;
      const guilds = await db.query('select g.id, g.name from guild_bots b join guilds g on g.id = b.guild_id where b.bot_id = $1 order by g.name', [bot.id]);
      const commands = await db.query('select name, description, usage from bot_app_commands where bot_id = $1 order by name', [bot.id]);
      return { id: bot.id, name: bot.name, guilds, commands };
    }),
  );

  /** canais de texto (que o bot enxerga) de um servidor onde ele está instalado: para o bot achar o canal pelo nome */
  r.get(
    '/bot/guilds/:id/channels',
    botAuth,
    wrap(async (req) => {
      const bot = (req as BotReq).bot!;
      const guildId = String(req.params.id);
      const [inst] = await db.query('select 1 from guild_bots where guild_id = $1 and bot_id = $2', [guildId, bot.id]);
      if (!inst) throw new HttpError(403, 'O bot não está instalado neste servidor.');
      const rows = await db.query<{ id: string; name: string }>(`select id, name from channels where guild_id = $1 and type = 'text' order by position, name limit 100`, [guildId]);
      const channels: { id: string; name: string }[] = [];
      for (const c of rows) {
        const visible = await deps.channelForMember(c.id, bot.id).catch(() => null);
        if (visible?.access) channels.push(c);
      }
      return { channels };
    }),
  );

  /** o bot informa a lista COMPLETA dos seus comandos (substitui a anterior) */
  r.put(
    '/bot/commands',
    botAuth,
    wrap(async (req) => {
      const bot = (req as BotReq).bot!;
      const { commands } = parse(z.object({ commands: z.array(commandSchema).max(MAX_COMMANDS, `No máximo ${MAX_COMMANDS} comandos.`) }), req.body);
      const names = commands.map((c) => c.name);
      if (new Set(names).size !== names.length) throw new HttpError(400, 'Há comandos com o mesmo nome.');
      const reserved = names.filter((n) => deps.reserved.includes(n));
      if (reserved.length) throw new HttpError(400, `Estes nomes são do Resenha Bot e não podem ser usados: /${reserved.join(', /')}.`);
      await db.query('delete from bot_app_commands where bot_id = $1 and not (name = any($2::text[]))', [bot.id, names]);
      if (commands.length)
        await db.query(
          `insert into bot_app_commands (bot_id, name, description, usage)
           select $1, t.name, t.description, t.usage from unnest($2::text[], $3::text[], $4::text[]) as t(name, description, usage)
           on conflict (bot_id, name) do update set description = excluded.description, usage = excluded.usage`,
          [bot.id, names, commands.map((c) => c.description), commands.map((c) => c.usage ?? `/${c.name}`)],
        );
      return { commands };
    }),
  );

  /** posta uma mensagem num canal de texto de um servidor onde o bot está instalado */
  async function sendAsBot(botId: string, channelId: string, reply: Reply, interaction: unknown) {
    limit(`botmsg:${botId}`, 30, 10_000, 'O bot está mandando mensagens rápido demais (máximo 30 a cada 10 segundos).');
    limit(`botmsg:${botId}:${channelId}`, 5, 5_000, 'Muitas mensagens neste canal (máximo 5 a cada 5 segundos).');
    const c = await deps.channelForMember(channelId, botId).catch(() => null);
    if (!c || !c.guildId || !c.access || c.type !== 'text') throw new HttpError(403, 'O bot não pode escrever neste canal (instale o bot no servidor e use um canal de texto).');
    const [inst] = await db.query('select 1 from guild_bots where guild_id = $1 and bot_id = $2', [c.guildId, botId]);
    if (!inst) throw new HttpError(403, 'O bot não está instalado neste servidor.');
    if (c.announce && !has(c.access.perms, Perm.MANAGE_GUILD) && !has(c.access.perms, Perm.MANAGE_MESSAGES)) throw new HttpError(403, 'Este é um canal de avisos: só a equipe do servidor publica aqui.');
    const e = reply.embed;
    const texts = [reply.content ?? '', e?.title ?? '', e?.description ?? '', ...(e?.fields ?? []).flatMap((f) => [f.name, f.value])];
    const [g] = await db.query<{ code: string }>('select invite_code as code from guilds where id = $1', [c.guildId]);
    await checkAutomod(db, { guildId: c.guildId, channelName: c.name, access: c.access, userId: botId, inviteCode: g?.code ?? '', texts });
    return deps.post(c, reply, interaction, botId);
  }

  r.post(
    '/bot/channels/:id/messages',
    botAuth,
    wrap(async (req) => {
      const bot = (req as BotReq).bot!;
      const body = parse(replySchema, req.body);
      const embed: BotEmbed | undefined = body.embed ? { ...body.embed, color: body.embed.color ?? '#7c6cff' } : undefined;
      const message = await sendAsBot(bot.id, String(req.params.id), { content: body.content, embed }, null);
      return { message };
    }),
  );

  // ---------- usar: chamado por /channels/:id/interactions quando o comando é de um bot de terceiro ----------
  return {
    /** comandos dos bots de terceiros instalados no servidor (popup do "/") */
    async commandsFor(guildId: string): Promise<BotCommandInfo[]> {
      const rows = await db.query<{ name: string; description: string; usage: string; group: string; botId: string }>(
        `select c.name, c.description, c.usage, u.display_name as "group", c.bot_id as "botId"
         from guild_bots g join bot_apps a on a.user_id = g.bot_id and a.disabled_at is null
         join bot_app_commands c on c.bot_id = g.bot_id join users u on u.id = g.bot_id
         where g.guild_id = $1 and not (c.name = any(g.disabled_commands)) order by u.display_name, c.name`,
        [guildId],
      );
      return rows.map((c) => ({ name: c.name, group: c.group, description: c.description, usage: c.usage, enabled: true, botId: c.botId }));
    },

    /** roda o comando de um bot de terceiro (devolve null se nenhum bot do servidor tem esse comando) */
    async run(opts: {
      guildId: string;
      guildName: string;
      channel: { id: string; name: string };
      user: { id: string; username: string; displayName: string };
      command: string;
      args: string;
    }) {
      const [b] = await db.query<{ botId: string; url: string | null; secret: string; name: string }>(
        `select a.user_id as "botId", a.interactions_url as url, a.signing_secret as secret, u.display_name as name
         from guild_bots g join bot_apps a on a.user_id = g.bot_id and a.disabled_at is null
         join bot_app_commands c on c.bot_id = g.bot_id join users u on u.id = g.bot_id
         where g.guild_id = $1 and c.name = $2 and not (c.name = any(g.disabled_commands)) order by g.installed_at limit 1`,
        [opts.guildId, opts.command],
      );
      if (!b) return null;
      if (!b.url) throw new HttpError(502, `O bot ${b.name} ainda não tem um endereço para receber comandos.`);
      limit(`botcall:${b.botId}`, 60, 60_000, 'Este bot está recebendo comandos demais. Espere um pouco.');
      const body = JSON.stringify({
        type: 'command',
        id: randomUUID(),
        command: opts.command,
        args: opts.args,
        user: { id: opts.user.id, username: opts.user.username, displayName: opts.user.displayName },
        channel: { id: opts.channel.id, name: opts.channel.name },
        guild: { id: opts.guildId, name: opts.guildName },
      });
      const ts = String(Math.floor(Date.now() / 1000));
      let res;
      try {
        res = await safePost(b.url, body, { 'X-Resenha-Timestamp': ts, 'X-Resenha-Signature': `v1=${sign(b.secret, ts, body)}` });
      } catch (e) {
        throw new HttpError(502, `${b.name}: ${e instanceof SafeFetchError ? e.message : 'o bot não respondeu.'}`);
      }
      if (res.status === 204 || res.status === 202) return { botId: b.botId, reply: null as Reply | null, name: b.name };
      if (res.status < 200 || res.status >= 300) throw new HttpError(502, `${b.name} respondeu com erro (${res.status}).`);
      let json: unknown;
      try {
        json = JSON.parse(res.text);
      } catch {
        throw new HttpError(502, `${b.name} respondeu algo que não é JSON.`);
      }
      if (json && typeof json === 'object' && (json as { deferred?: boolean }).deferred) return { botId: b.botId, reply: null as Reply | null, name: b.name };
      const parsed = replySchema.safeParse(json);
      if (!parsed.success) throw new HttpError(502, `${b.name} respondeu em um formato inválido (use "content" e/ou "embed").`);
      const p = parsed.data;
      return { botId: b.botId, name: b.name, reply: { content: p.content, embed: p.embed ? { ...p.embed, color: p.embed.color ?? '#7c6cff' } : undefined } as Reply };
    },
    sendAsBot,
  };
}
