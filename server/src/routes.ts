import { randomBytes, randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
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

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((body) => {
    if (!res.headersSent) res.json(body ?? { ok: true });
  }, next);
};

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

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

  async function loadGuilds(userId: string, onlyGuildId?: string): Promise<Guild[]> {
    const guilds = await db.query<Omit<Guild, 'channels' | 'members'>>(
      `select g.id, g.name, g.owner_id as "ownerId", g.invite_code as "inviteCode"
       from guilds g join members m on m.guild_id = g.id
       where m.user_id = $1 ${onlyGuildId ? 'and g.id = $2' : ''}
       order by m.joined_at`,
      onlyGuildId ? [userId, onlyGuildId] : [userId],
    );
    if (!guilds.length) return [];
    const ids = guilds.map((g) => g.id);
    const channels = await db.query<Channel>(
      `select id, guild_id as "guildId", name, type, position from channels
       where guild_id = any($1) order by position, created_at`,
      [ids],
    );
    const members = await db.query<Member & { guildId: string }>(
      `select m.guild_id as "guildId", m.joined_at as "joinedAt", ${USER_COLUMNS}
       from members m join users u on u.id = m.user_id
       where m.guild_id = any($1) order by m.joined_at`,
      [ids],
    );
    return guilds.map((g) => ({
      ...g,
      channels: channels.filter((c) => c.guildId === g.id),
      members: members.filter((m) => m.guildId === g.id).map(({ guildId, ...m }) => m),
    }));
  }

  async function requireMember(guildId: string, userId: string) {
    const [g] = await db.query<{ ownerId: string }>(
      `select g.owner_id as "ownerId" from guilds g
       join members m on m.guild_id = g.id and m.user_id = $2 where g.id = $1`,
      [guildId, userId],
    );
    if (!g) throw new HttpError(404, 'Servidor não encontrado.');
    return { isOwner: g.ownerId === userId, ownerId: g.ownerId };
  }

  async function requireOwner(guildId: string, userId: string) {
    const m = await requireMember(guildId, userId);
    if (!m.isOwner) throw new HttpError(403, 'Apenas o dono do servidor pode fazer isso.');
  }

  async function channelForMember(channelId: string, userId: string) {
    const [c] = await db.query<Channel & { ownerId: string }>(
      `select c.id, c.guild_id as "guildId", c.name, c.type, c.position, g.owner_id as "ownerId"
       from channels c join guilds g on g.id = c.guild_id
       join members m on m.guild_id = c.guild_id and m.user_id = $2
       where c.id = $1`,
      [channelId, userId],
    );
    if (!c) throw new HttpError(404, 'Canal não encontrado.');
    return c;
  }

  const MESSAGE_SELECT = `select msg.id, msg.channel_id as "channelId", msg.content,
      msg.created_at as "createdAt", msg.edited_at as "editedAt",
      json_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name, 'avatarColor', u.avatar_color) as author
    from messages msg join users u on u.id = msg.author_id`;

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
    wrap(async (req) => ({ user: req.user, guilds: await loadGuilds(req.user!.id) })),
  );

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

  // Servidores (guilds)
  r.post(
    '/guilds',
    auth,
    wrap(async (req) => {
      const body = parse(z.object({ name: z.string().trim().min(1, 'Dê um nome ao servidor.').max(50) }), req.body);
      const id = randomUUID();
      const me = req.user!.id;
      await db.query('insert into guilds (id, name, owner_id, invite_code) values ($1, $2, $3, $4)', [
        id,
        body.name,
        me,
        inviteCode(),
      ]);
      await db.query('insert into members (guild_id, user_id) values ($1, $2)', [id, me]);
      await db.query(
        `insert into channels (id, guild_id, name, type, position) values
         ($1, $3, 'geral', 'text', 0), ($2, $3, 'Sala de voz', 'voice', 1)`,
        [randomUUID(), randomUUID(), id],
      );
      rt.userJoinedGuild(me, id);
      const [guild] = await loadGuilds(me, id);
      return { guild };
    }),
  );

  r.patch(
    '/guilds/:id',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requireOwner(id, req.user!.id);
      const body = parse(z.object({ name: z.string().trim().min(1).max(50) }), req.body);
      await db.query('update guilds set name = $2 where id = $1', [id, body.name]);
      rt.emitGuild(id, 'guild:update', { id, name: body.name });
    }),
  );

  r.delete(
    '/guilds/:id',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requireOwner(id, req.user!.id);
      rt.emitGuild(id, 'guild:delete', { id });
      rt.guildDeleted(id);
      await db.query('delete from guilds where id = $1', [id]);
    }),
  );

  r.post(
    '/guilds/:id/invite',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requireOwner(id, req.user!.id);
      const code = inviteCode();
      await db.query('update guilds set invite_code = $2 where id = $1', [id, code]);
      rt.emitGuild(id, 'guild:update', { id, inviteCode: code });
      return { inviteCode: code };
    }),
  );

  r.post(
    '/invites/:code/join',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      const [g] = await db.query<{ id: string }>('select id from guilds where invite_code = $1', [req.params.code]);
      if (!g) throw new HttpError(404, 'Convite inválido ou expirado.');
      const inserted = await db.query(
        'insert into members (guild_id, user_id) values ($1, $2) on conflict do nothing returning joined_at',
        [g.id, me.id],
      );
      if (inserted.length) {
        rt.emitGuild(g.id, 'member:join', { guildId: g.id, member: { ...me, joinedAt: inserted[0].joined_at } });
        rt.userJoinedGuild(me.id, g.id);
      }
      const [guild] = await loadGuilds(me.id, g.id);
      return { guild };
    }),
  );

  r.delete(
    '/guilds/:id/members/:userId',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const me = req.user!.id;
      const target = req.params.userId === '@me' ? me : String(req.params.userId);
      const { isOwner, ownerId } = await requireMember(id, me);
      if (target !== me && !isOwner) throw new HttpError(403, 'Apenas o dono pode remover membros.');
      if (target === ownerId) throw new HttpError(400, 'O dono não pode sair. Exclua o servidor.');
      await db.query('delete from members where guild_id = $1 and user_id = $2', [id, target]);
      rt.emitGuild(id, 'member:leave', { guildId: id, userId: target });
      rt.emitUser(target, 'guild:delete', { id });
      rt.userLeftGuild(target, id);
    }),
  );

  // Canais
  r.post(
    '/guilds/:id/channels',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await requireOwner(guildId, req.user!.id);
      const body = parse(z.object({ name: channelNameSchema, type: z.enum(['text', 'voice']) }), req.body);
      const name = body.type === 'text' ? body.name.toLowerCase().replace(/\s+/g, '-') : body.name;
      const [{ max }] = await db.query<{ max: number | null }>(
        'select max(position) as max from channels where guild_id = $1',
        [guildId],
      );
      const channel: Channel = { id: randomUUID(), guildId, name, type: body.type, position: (max ?? 0) + 1 };
      await db.query('insert into channels (id, guild_id, name, type, position) values ($1, $2, $3, $4, $5)', [
        channel.id,
        guildId,
        channel.name,
        channel.type,
        channel.position,
      ]);
      rt.emitGuild(guildId, 'channel:create', channel);
      return { channel };
    }),
  );

  r.patch(
    '/channels/:id',
    auth,
    wrap(async (req) => {
      const c = await channelForMember(String(req.params.id), req.user!.id);
      if (c.ownerId !== req.user!.id) throw new HttpError(403, 'Apenas o dono do servidor pode fazer isso.');
      const body = parse(z.object({ name: channelNameSchema }), req.body);
      const name = c.type === 'text' ? body.name.toLowerCase().replace(/\s+/g, '-') : body.name;
      await db.query('update channels set name = $2 where id = $1', [c.id, name]);
      rt.emitGuild(c.guildId, 'channel:update', { ...c, ownerId: undefined, name });
    }),
  );

  r.delete(
    '/channels/:id',
    auth,
    wrap(async (req) => {
      const c = await channelForMember(String(req.params.id), req.user!.id);
      if (c.ownerId !== req.user!.id) throw new HttpError(403, 'Apenas o dono do servidor pode fazer isso.');
      rt.channelDeleted(c.id);
      await db.query('delete from channels where id = $1', [c.id]);
      rt.emitGuild(c.guildId, 'channel:delete', { id: c.id, guildId: c.guildId });
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
      if (c.type !== 'text') throw new HttpError(400, 'Este canal não aceita mensagens.');
      const body = parse(
        z.object({ content: z.string().trim().min(1, 'Mensagem vazia.').max(4000, 'Mensagem muito longa.') }),
        req.body,
      );
      const id = randomUUID();
      await db.query('insert into messages (id, channel_id, author_id, content) values ($1, $2, $3, $4)', [
        id,
        c.id,
        req.user!.id,
        body.content,
      ]);
      const [message] = await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [id]);
      rt.emitGuild(c.guildId, 'message:new', { guildId: c.guildId, message });
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
    return { ...m, guildId: c.guildId, isOwner: c.ownerId === userId };
  }

  r.patch(
    '/messages/:id',
    auth,
    wrap(async (req) => {
      const m = await messageForEdit(String(req.params.id), req.user!.id);
      if (m.authorId !== req.user!.id) throw new HttpError(403, 'Você só pode editar suas mensagens.');
      const body = parse(z.object({ content: z.string().trim().min(1).max(4000) }), req.body);
      await db.query('update messages set content = $2, edited_at = now() where id = $1', [m.id, body.content]);
      const [message] = await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [m.id]);
      rt.emitGuild(m.guildId, 'message:update', { guildId: m.guildId, message });
      return { message };
    }),
  );

  r.delete(
    '/messages/:id',
    auth,
    wrap(async (req) => {
      const m = await messageForEdit(String(req.params.id), req.user!.id);
      if (m.authorId !== req.user!.id && !m.isOwner) throw new HttpError(403, 'Sem permissão.');
      await db.query('delete from messages where id = $1', [m.id]);
      rt.emitGuild(m.guildId, 'message:delete', { guildId: m.guildId, channelId: m.channelId, id: m.id });
    }),
  );

  return r;
}
