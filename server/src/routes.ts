import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.ts';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { getIceServers, hasTurn } from './ice.ts';
import {
  USER_COLUMNS,
  bearer,
  createSession,
  deleteSession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from './auth.ts';
import type { Channel, Guild, Member, Message, PublicUser } from '../../shared/types.ts';
import { HttpError, parse, wrap } from './http.ts';
import { dmMemberIds, registerSocialRoutes } from './social.ts';
import { registerAttachmentRoutes } from './attachments.ts';
import { loadGuilds, registerGuildRoutes } from './guilds.ts';
import { type MemberAccess, canSee, channelAudience, loadChannel, memberAccess, requireNotTimedOut } from './access.ts';
import { Perm, has } from '../../shared/permissions.ts';

export { HttpError };

const AVATAR_COLORS = ['#f97316', '#ef4444', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
const inviteCode = () => randomBytes(6).toString('base64url');

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, 'O usuário deve ter 3 a 24 caracteres: letras, números, _ ou .');
const passwordSchema = z.string().min(6, 'A senha precisa de pelo menos 6 caracteres.').max(200);
const displayNameSchema = z.string().trim().min(1, 'Informe um nome.').max(32, 'Nome muito longo.');
const channelNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do canal.')
  .max(40, 'Nome muito longo.');

// Limite simples de tentativas de login por IP (proteção contra força bruta).
const attempts = new Map<string, { count: number; reset: number }>();
function rateLimit(key: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  if (++entry.count > max) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto.');
}

export function createRoutes(db: Db, rt: Realtime) {
  const r = Router();
  const auth = requireAuth(db);

  // ---------- helpers de consulta ----------

  /**
   * Canal de servidor (sendo membro e podendo ver o canal) ou conversa direta (sendo participante).
   * Junto vem o acesso no servidor (permissões, castigo), ou null em DMs.
   */
  async function channelForMember(channelId: string, userId: string) {
    const c = await loadChannel(db, channelId);
    if (!c) throw new HttpError(404, 'Canal não encontrado.');
    if (!c.guildId) {
      const [dm] = await db.query('select 1 from dm_members where channel_id = $1 and user_id = $2', [c.id, userId]);
      if (!dm) throw new HttpError(404, 'Canal não encontrado.');
      return { ...c, access: null as MemberAccess | null };
    }
    const access = await memberAccess(db, c.guildId, userId);
    if (!access || !canSee(access, c)) throw new HttpError(404, 'Canal não encontrado.');
    return { ...c, access };
  }

  /** Entrega um evento de mensagem só a quem vê o canal: servidor todo, só os cargos do canal privado, ou os dois da DM. */
  async function emitToChannel(c: { id: string; guildId: string | null; allowedRoleIds: string[] | null }, event: string, payload: object) {
    if (c.guildId) {
      const audience = await channelAudience(db, c);
      if (audience === null) rt.emitGuild(c.guildId, event, { guildId: c.guildId, ...payload });
      else for (const uid of audience) rt.emitUser(uid, event, { guildId: c.guildId, ...payload });
    } else {
      for (const uid of await dmMemberIds(db, c.id)) rt.emitUser(uid, event, { guildId: null, ...payload });
    }
  }

  const userJson = (t: string) =>
    `json_build_object('id', ${t}.id, 'username', ${t}.username, 'displayName', ${t}.display_name, 'avatarColor', ${t}.avatar_color)`;

  /** Mensagem completa: autor, trecho respondido, reações agrupadas por emoji e imagens. */
  const MESSAGE_SELECT = `select msg.id, msg.channel_id as "channelId", msg.content,
      msg.created_at as "createdAt", msg.edited_at as "editedAt", msg.mention_everyone as "mentionEveryone",
      ${userJson('u')} as author,
      case
        when msg.reply_to_id is null then null
        when rm.id is null then json_build_object('id', msg.reply_to_id, 'deleted', true)
        else json_build_object('id', rm.id, 'content', left(rm.content, 200), 'author', ${userJson('ru')},
          'hasAttachments', exists (select 1 from attachments ra where ra.message_id = rm.id))
      end as "replyTo",
      coalesce((
        select json_agg(json_build_object('emoji', r.emoji, 'userIds', r.user_ids) order by r.first_at)
        from (
          select emoji, array_agg(user_id order by created_at) as user_ids, min(created_at) as first_at
          from reactions where message_id = msg.id group by emoji
        ) r
      ), '[]'::json) as reactions,
      coalesce((
        select json_agg(json_build_object('id', a.id, 'name', a.filename, 'mime', a.mime, 'size', a.size,
          'width', a.width, 'height', a.height) order by a.created_at)
        from attachments a where a.message_id = msg.id
      ), '[]'::json) as attachments
    from messages msg
    join users u on u.id = msg.author_id
    left join messages rm on rm.id = msg.reply_to_id
    left join users ru on ru.id = rm.author_id`;

  // ---------- públicas ----------

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  r.get('/config', (_req, res) => {
    res.json({ registrationRequiresCode: !!config.registrationCode });
  });

  r.post(
    '/auth/register',
    wrap(async (req) => {
      rateLimit(`reg:${req.ip}`, 5);
      const body = parse(
        z.object({
          username: usernameSchema,
          password: passwordSchema,
          displayName: displayNameSchema.optional(),
          registrationCode: z.string().optional(),
        }),
        req.body,
      );
      if (config.registrationCode && body.registrationCode?.trim() !== config.registrationCode) {
        throw new HttpError(403, 'Código de convite para cadastro inválido.');
      }
      const exists = await db.query('select 1 from users where username = $1', [body.username]);
      if (exists.length) throw new HttpError(409, 'Esse nome de usuário já está em uso.');
      const user: PublicUser = {
        id: randomUUID(),
        username: body.username,
        displayName: body.displayName || body.username,
        avatarColor: randomColor(),
      };
      await db.query(
        `insert into users (id, username, display_name, password_hash, avatar_color) values ($1, $2, $3, $4, $5)`,
        [user.id, user.username, user.displayName, await hashPassword(body.password), user.avatarColor],
      );
      return { token: await createSession(db, user.id), user };
    }),
  );

  r.post(
    '/auth/login',
    wrap(async (req) => {
      rateLimit(`login:${req.ip}`);
      const body = parse(z.object({ username: z.string().trim().toLowerCase(), password: z.string() }), req.body);
      const [row] = await db.query<PublicUser & { password_hash: string }>(
        `select ${USER_COLUMNS}, u.password_hash from users u where u.username = $1`,
        [body.username],
      );
      if (!row || !(await verifyPassword(body.password, row.password_hash))) {
        throw new HttpError(401, 'Usuário ou senha incorretos.');
      }
      const { password_hash, ...user } = row;
      return { token: await createSession(db, user.id), user };
    }),
  );

  r.get(
    '/invites/:code',
    wrap(async (req) => {
      const [g] = await db.query<{ id: string; name: string; count: string }>(
        `select g.id, g.name, (select count(*) from members m where m.guild_id = g.id) as count
         from guilds g where g.invite_code = $1`,
        [req.params.code],
      );
      if (!g) throw new HttpError(404, 'Convite inválido ou expirado.');
      return { code: req.params.code, guildId: g.id, guildName: g.name, memberCount: Number(g.count) };
    }),
  );

  // ---------- autenticadas ----------

  r.post(
    '/auth/logout',
    auth,
    wrap(async (req) => {
      const token = bearer(req);
      if (token) await deleteSession(db, token);
    }),
  );

  r.get(
    '/bootstrap',
    auth,
    wrap(async (req) => ({ user: req.user, guilds: await loadGuilds(db, req.user!.id) })),
  );

  registerSocialRoutes(r, db, rt, auth);
  registerGuildRoutes(r, db, rt, auth);

  r.get('/ice', auth, wrap(async () => ({ iceServers: await getIceServers(), hasTurn: hasTurn() })));

  r.patch(
    '/me',
    auth,
    wrap(async (req) => {
      const body = parse(
        z.object({
          displayName: displayNameSchema.optional(),
          avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        }),
        req.body,
      );
      const me = req.user!;
      const user: PublicUser = {
        ...me,
        displayName: body.displayName ?? me.displayName,
        avatarColor: body.avatarColor ?? me.avatarColor,
      };
      await db.query('update users set display_name = $2, avatar_color = $3 where id = $1', [
        me.id,
        user.displayName,
        user.avatarColor,
      ]);
      const guilds = await db.query<{ guild_id: string }>('select guild_id from members where user_id = $1', [me.id]);
      for (const g of guilds) rt.emitGuild(g.guild_id, 'user:update', user);
      rt.emitUser(me.id, 'user:update', user);
      return { user };
    }),
  );

  // Mensagens
  r.get(
    '/channels/:id/messages',
    auth,
    wrap(async (req) => {
      const c = await channelForMember(String(req.params.id), req.user!.id);
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      const limit = 50;
      const rows = await db.query<Message>(
        `${MESSAGE_SELECT} where msg.channel_id = $1
         ${before ? 'and msg.created_at < (select created_at from messages where id = $3)' : ''}
         order by msg.created_at desc limit $2`,
        before ? [c.id, limit, before] : [c.id, limit],
      );
      return { messages: rows.reverse(), hasMore: rows.length === limit };
    }),
  );

  r.post(
    '/channels/:id/messages',
    auth,
    wrap(async (req) => {
      const c = await channelForMember(String(req.params.id), req.user!.id);
      if (c.type === 'voice') throw new HttpError(400, 'Este canal não aceita mensagens.');
      if (c.access) requireNotTimedOut(c.access);
      const body = parse(
        z.object({
          content: z.string().trim().max(4000, 'Mensagem muito longa.').default(''),
          replyToId: z.string().optional(),
          attachmentIds: z.array(z.string()).max(4, 'No máximo 4 imagens por mensagem.').default([]),
        }),
        req.body,
      );
      if (!body.content && body.attachmentIds.length === 0) throw new HttpError(400, 'Mensagem vazia.');
      if (body.replyToId) {
        const [target] = await db.query('select 1 from messages where id = $1 and channel_id = $2', [body.replyToId, c.id]);
        if (!target) throw new HttpError(400, 'A mensagem respondida não existe mais.');
      }
      if (body.attachmentIds.length) {
        const owned = await db.query(
          'select id from attachments where id = any($1) and uploader_id = $2 and message_id is null',
          [body.attachmentIds, req.user!.id],
        );
        if (owned.length !== body.attachmentIds.length) throw new HttpError(400, 'Imagem inválida. Envie de novo.');
      }
      // @todos só notifica se a pessoa tem permissão (senão vira texto comum)
      const mentionEveryone =
        !!c.access && has(c.access.perms, Perm.MENTION_EVERYONE) && /(^|[^\w@])@todos(?![\w])/i.test(body.content);
      const id = randomUUID();
      await db.query(
        'insert into messages (id, channel_id, author_id, content, reply_to_id, mention_everyone) values ($1, $2, $3, $4, $5, $6)',
        [id, c.id, req.user!.id, body.content, body.replyToId ?? null, mentionEveryone],
      );
      if (body.attachmentIds.length) {
        await db.query('update attachments set message_id = $1 where id = any($2)', [id, body.attachmentIds]);
      }
      const [message] = await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [id]);
      await emitToChannel(c, 'message:new', { message });
      return { message };
    }),
  );

  async function messageForEdit(messageId: string, userId: string) {
    const [m] = await db.query<{ id: string; channelId: string; authorId: string }>(
      'select id, channel_id as "channelId", author_id as "authorId" from messages where id = $1',
      [messageId],
    );
    if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
    const c = await channelForMember(m.channelId, userId);
    // apagar mensagens dos outros: permissão "Gerenciar mensagens" no servidor
    return { ...m, channel: c, canModerate: !!c.access && has(c.access.perms, Perm.MANAGE_MESSAGES) };
  }

  r.patch(
    '/messages/:id',
    auth,
    wrap(async (req) => {
      const m = await messageForEdit(String(req.params.id), req.user!.id);
      if (m.authorId !== req.user!.id) throw new HttpError(403, 'Você só pode editar suas mensagens.');
      const body = parse(z.object({ content: z.string().trim().max(4000) }), req.body);
      if (!body.content) {
        const [att] = await db.query('select 1 from attachments where message_id = $1 limit 1', [m.id]);
        if (!att) throw new HttpError(400, 'Mensagem vazia.');
      }
      await db.query('update messages set content = $2, edited_at = now() where id = $1', [m.id, body.content]);
      const [message] = await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [m.id]);
      await emitToChannel(m.channel, 'message:update', { message });
      return { message };
    }),
  );

  r.delete(
    '/messages/:id',
    auth,
    wrap(async (req) => {
      const m = await messageForEdit(String(req.params.id), req.user!.id);
      if (m.authorId !== req.user!.id && !m.canModerate) throw new HttpError(403, 'Sem permissão.');
      await db.query('delete from messages where id = $1', [m.id]);
      await emitToChannel(m.channel, 'message:delete', { channelId: m.channelId, id: m.id });
    }),
  );

  // Reação: o mesmo emoji de novo tira a sua reação
  r.post(
    '/messages/:id/reactions',
    auth,
    wrap(async (req) => {
      const m = await messageForEdit(String(req.params.id), req.user!.id);
      if (m.channel.access) requireNotTimedOut(m.channel.access);
      const { emoji } = parse(
        z.object({
          emoji: z
            .string()
            .min(1)
            .max(32)
            .refine((e) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e), 'Emoji inválido.'),
        }),
        req.body,
      );
      const removed = await db.query(
        'delete from reactions where message_id = $1 and user_id = $2 and emoji = $3 returning 1',
        [m.id, req.user!.id, emoji],
      );
      if (!removed.length) {
        const [{ n }] = await db.query<{ n: number }>(
          'select count(distinct emoji)::int as n from reactions where message_id = $1 and emoji <> $2',
          [m.id, emoji],
        );
        if (n >= 20) throw new HttpError(400, 'Limite de 20 emojis diferentes por mensagem.');
        await db.query('insert into reactions (message_id, user_id, emoji) values ($1, $2, $3) on conflict do nothing', [
          m.id,
          req.user!.id,
          emoji,
        ]);
      }
      const [{ reactions }] = await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [m.id]);
      await emitToChannel(m.channel, 'message:reactions', { channelId: m.channelId, messageId: m.id, reactions });
      return { reactions };
    }),
  );

  registerAttachmentRoutes(r, db, auth);

  return r;
}
