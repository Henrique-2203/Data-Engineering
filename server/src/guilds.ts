import { randomBytes, randomUUID } from 'node:crypto';
import express, { type Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { USER_COLUMNS, userJson, type requireAuth } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import { sniffImage } from './attachments.ts';
import { deleteFiles, guildFileIds, loadExpressions } from './expressions.ts';
import {
  CHANNEL_COLUMNS,
  type ChannelRow,
  type MemberAccess,
  canSee,
  loadChannel,
  memberAccess,
  memberRoleIds,
  requireMember,
  requireOutranks,
  requirePerm,
  requireStorage,
  storageUsage,
} from './access.ts';
import { ALL_PERMISSIONS, Perm, has, topRolePosition, type Role } from '../../shared/permissions.ts';
import type { Ban, Category, Channel, Guild, Member } from '../../shared/types.ts';

const inviteCode = () => randomBytes(6).toString('base64url');
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.');
const channelNameSchema = z.string().trim().min(1, 'Informe o nome do canal.').max(40, 'Nome muito longo.');
const slug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
const BITRATES = [32, 64, 96, 128, 192, 256, 384, 510];
const MAX_IMAGE_BYTES = 1024 * 1024; // ícone/banner já chegam comprimidos (~15-80 KB)

const toChannel = (c: ChannelRow): Channel => ({
  id: c.id,
  guildId: c.guildId ?? '',
  name: c.name,
  type: c.type,
  position: c.position,
  categoryId: c.categoryId,
  allowedRoleIds: c.allowedRoleIds ?? null, // [] = privado só para dono e administradores
  bitrate: c.bitrate,
  userLimit: c.userLimit,
});

/** Servidor do jeito que ESTA pessoa vê: só canais permitidos, convite só se puder convidar. */
export async function loadGuild(db: Db, userId: string, guildId: string): Promise<Guild | null> {
  const access = await memberAccess(db, guildId, userId);
  if (!access) return null;
  const [g] = await db.query<{
    id: string;
    name: string;
    ownerId: string;
    inviteCode: string;
    description: string;
    iconId: string | null;
    bannerId: string | null;
    everyonePermissions: number;
  }>(
    `select id, name, owner_id as "ownerId", invite_code as "inviteCode", description, icon_id as "iconId",
       banner_id as "bannerId", everyone_permissions as "everyonePermissions"
     from guilds where id = $1`,
    [guildId],
  );
  if (!g) return null;
  const categories = await db.query<Category>(
    'select id, name, position from categories where guild_id = $1 order by position, created_at',
    [guildId],
  );
  const channels = await db.query<ChannelRow>(
    `select ${CHANNEL_COLUMNS} from channels c where c.guild_id = $1 order by c.position, c.created_at`,
    [guildId],
  );
  const members = await db.query<Member & { roleIds: string[] | null }>(
    `select m.joined_at as "joinedAt", m.timeout_until as "timeoutUntil", m.nick, m.avatar_id as "guildAvatarId", ${USER_COLUMNS},
       (select array_agg(mr.role_id) from member_roles mr where mr.guild_id = m.guild_id and mr.user_id = m.user_id) as "roleIds"
     from members m join users u on u.id = m.user_id
     where m.guild_id = $1 order by m.joined_at`,
    [guildId],
  );
  return {
    ...g,
    inviteCode: has(access.perms, Perm.CREATE_INVITE) ? g.inviteCode : '',
    roles: access.ctx.roles,
    categories,
    channels: channels.filter((c) => canSee(access, c)).map(toChannel),
    // apelido e foto do servidor já aplicados (o resto do site só usa displayName/avatarId)
    members: members.map((m) => ({
      ...m,
      displayName: m.nick ?? m.displayName,
      avatarId: m.guildAvatarId ?? m.avatarId,
      roleIds: m.roleIds ?? [],
    })),
    expressions: await loadExpressions(db, guildId),
  };
}

export async function loadGuilds(db: Db, userId: string): Promise<Guild[]> {
  const rows = await db.query<{ guild_id: string }>('select guild_id from members where user_id = $1 order by joined_at', [
    userId,
  ]);
  const out: Guild[] = [];
  for (const r of rows) {
    const g = await loadGuild(db, userId, r.guild_id);
    if (g) out.push(g);
  }
  return out;
}

export function registerGuildRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  /** Depois de qualquer mudança estrutural: todos recarregam o servidor e a voz é reavaliada. */
  const changed = async (guildId: string, recheckVoice = false) => {
    rt.guildChanged(guildId);
    if (recheckVoice) await rt.recheckVoice(guildId);
  };

  const guildResponse = async (userId: string, guildId: string) => {
    const guild = await loadGuild(db, userId, guildId);
    if (!guild) throw new HttpError(404, 'Servidor não encontrado.');
    return { guild, voiceStates: rt.voiceStatesFor(guildId, userId) };
  };

  // ---------- servidor ----------

  r.post(
    '/guilds',
    auth,
    wrap(async (req) => {
      const body = parse(z.object({ name: z.string().trim().min(1, 'Dê um nome ao servidor.').max(50) }), req.body);
      const id = randomUUID();
      const me = req.user!.id;
      await db.query('insert into guilds (id, name, owner_id, invite_code) values ($1, $2, $3, $4)', [id, body.name, me, inviteCode()]);
      await db.query('insert into members (guild_id, user_id) values ($1, $2)', [id, me]);
      await db.query(
        `insert into channels (id, guild_id, name, type, position) values
         ($1, $3, 'geral', 'text', 0), ($2, $3, 'Sala de voz', 'voice', 1)`,
        [randomUUID(), randomUUID(), id],
      );
      rt.userJoinedGuild(me, id);
      return guildResponse(me, id);
    }),
  );

  r.get('/guilds/:id', auth, wrap(async (req) => guildResponse(req.user!.id, String(req.params.id))));

  r.patch(
    '/guilds/:id',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const body = parse(
        z.object({
          name: z.string().trim().min(1).max(50).optional(),
          description: z.string().trim().max(300, 'Descrição muito longa.').optional(),
          everyonePermissions: z.number().int().min(0).max(ALL_PERMISSIONS).optional(),
        }),
        req.body,
      );
      if (body.name !== undefined || body.description !== undefined) await requirePerm(db, id, req.user!.id, Perm.MANAGE_GUILD);
      if (body.everyonePermissions !== undefined) {
        const a = await requirePerm(db, id, req.user!.id, Perm.MANAGE_ROLES);
        if (has(body.everyonePermissions, Perm.ADMIN) && !a.isOwner) {
          throw new HttpError(403, 'Só o dono pode dar Administrador para todos.');
        }
        requireGrantable(a, body.everyonePermissions, a.ctx.everyonePermissions);
      }
      await db.query(
        `update guilds set name = coalesce($2, name), description = coalesce($3, description),
           everyone_permissions = coalesce($4, everyone_permissions) where id = $1`,
        [id, body.name ?? null, body.description ?? null, body.everyonePermissions ?? null],
      );
      await changed(id, body.everyonePermissions !== undefined);
    }),
  );

  r.delete(
    '/guilds/:id',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const a = await requireMember(db, id, req.user!.id);
      if (!a.isOwner) throw new HttpError(403, 'Só o dono pode excluir o servidor.');
      rt.emitGuild(id, 'guild:delete', { id });
      rt.guildDeleted(id);
      const [g] = await db.query<{ icon_id: string | null; banner_id: string | null }>(
        'select icon_id, banner_id from guilds where id = $1',
        [id],
      );
      const files = await guildFileIds(db, id);
      await db.query('delete from guilds where id = $1', [id]);
      await deleteFiles(db, [g?.icon_id, g?.banner_id, ...files]);
    }),
  );

  r.post(
    '/guilds/:id/invite',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requirePerm(db, id, req.user!.id, Perm.MANAGE_GUILD);
      const code = inviteCode();
      await db.query('update guilds set invite_code = $2 where id = $1', [id, code]);
      await changed(id);
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
      const [banned] = await db.query('select 1 from bans where guild_id = $1 and user_id = $2', [g.id, me.id]);
      if (banned) throw new HttpError(403, 'Você foi banido deste servidor.');
      const inserted = await db.query(
        'insert into members (guild_id, user_id) values ($1, $2) on conflict do nothing returning joined_at',
        [g.id, me.id],
      );
      if (inserted.length) {
        rt.userJoinedGuild(me.id, g.id);
        await changed(g.id);
      }
      return guildResponse(me.id, g.id);
    }),
  );

  // ---------- imagens do servidor (ícone e banner) ----------

  r.get(
    '/images/:id',
    wrap(async (req, res) => {
      const [img] = await db.query<{ mime: string; data: Uint8Array }>('select mime, data from images where id = $1', [
        String(req.params.id),
      ]);
      if (!img) throw new HttpError(404, 'Imagem não encontrada.');
      res.setHeader('Content-Type', img.mime);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(img.data));
    }),
  );

  for (const kind of ['icon', 'banner'] as const) {
    const column = kind === 'icon' ? 'icon_id' : 'banner_id';
    r.post(
      `/guilds/:id/${kind}`,
      auth,
      express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
      wrap(async (req) => {
        const id = String(req.params.id);
        await requirePerm(db, id, req.user!.id, Perm.MANAGE_GUILD);
        const data = req.body as Buffer;
        if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Arquivo vazio.');
        const mime = sniffImage(data);
        if (!mime || mime === 'image/gif') throw new HttpError(415, 'Envie uma imagem PNG, JPG ou WebP.');
        await requireStorage(db, data.length);
        const imageId = randomUUID();
        await db.query('insert into images (id, uploader_id, mime, size, data) values ($1, $2, $3, $4, $5)', [
          imageId,
          req.user!.id,
          mime,
          data.length,
          data,
        ]);
        // troca a imagem e apaga a antiga: o espaço não vai acumulando
        const [old] = await db.query<{ old: string | null }>(`select ${column} as old from guilds where id = $1`, [id]);
        await db.query(`update guilds set ${column} = $2 where id = $1`, [id, imageId]);
        if (old?.old) await db.query('delete from images where id = $1', [old.old]);
        await changed(id);
        return { imageId };
      }),
    );
    r.delete(
      `/guilds/:id/${kind}`,
      auth,
      wrap(async (req) => {
        const id = String(req.params.id);
        await requirePerm(db, id, req.user!.id, Perm.MANAGE_GUILD);
        const [old] = await db.query<{ old: string | null }>(`select ${column} as old from guilds where id = $1`, [id]);
        await db.query(`update guilds set ${column} = null where id = $1`, [id]);
        if (old?.old) await db.query('delete from images where id = $1', [old.old]);
        await changed(id);
      }),
    );
  }

  r.get(
    '/guilds/:id/storage',
    auth,
    wrap(async (req) => {
      await requirePerm(db, String(req.params.id), req.user!.id, Perm.MANAGE_GUILD);
      return storageUsage(db);
    }),
  );

  // ---------- cargos ----------

  /** Não dá para dar permissões que você mesmo não tem (o dono pode tudo). */
  function requireGrantable(a: MemberAccess, next: number, previous: number) {
    if (a.isOwner) return;
    const added = next & ~previous;
    if ((added & a.perms) !== added) throw new HttpError(403, 'Você não pode dar permissões que você mesmo não tem.');
  }

  async function roleForManage(roleId: string, userId: string) {
    const [role] = await db.query<Role & { guildId: string }>(
      'select id, guild_id as "guildId", name, color, position, permissions from roles where id = $1',
      [roleId],
    );
    if (!role) throw new HttpError(404, 'Cargo não encontrado.');
    const a = await requirePerm(db, role.guildId, userId, Perm.MANAGE_ROLES);
    if (!a.isOwner && role.position >= topRolePosition(a.ctx, userId, a.roleIds)) {
      throw new HttpError(403, 'Você só pode mexer em cargos abaixo do seu cargo mais alto.');
    }
    return { role, a };
  }

  r.post(
    '/guilds/:id/roles',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const a = await requirePerm(db, id, req.user!.id, Perm.MANAGE_ROLES);
      const body = parse(
        z.object({
          name: z.string().trim().min(1, 'Dê um nome ao cargo.').max(32, 'Nome muito longo.'),
          color: colorSchema.default('#99aab5'),
          permissions: z.number().int().min(0).max(ALL_PERMISSIONS).default(0),
        }),
        req.body,
      );
      requireGrantable(a, body.permissions, 0);
      if (a.ctx.roles.length >= 50) throw new HttpError(400, 'Limite de 50 cargos por servidor.');
      // novo cargo entra no fim da fila (posição 1), abaixo de todos
      await db.query('update roles set position = position + 1 where guild_id = $1', [id]);
      const roleId = randomUUID();
      await db.query('insert into roles (id, guild_id, name, color, position, permissions) values ($1, $2, $3, $4, 1, $5)', [
        roleId,
        id,
        body.name,
        body.color,
        body.permissions,
      ]);
      await changed(id);
      return { roleId };
    }),
  );

  r.patch(
    '/roles/:roleId',
    auth,
    wrap(async (req) => {
      const { role, a } = await roleForManage(String(req.params.roleId), req.user!.id);
      const body = parse(
        z.object({
          name: z.string().trim().min(1).max(32).optional(),
          color: colorSchema.optional(),
          permissions: z.number().int().min(0).max(ALL_PERMISSIONS).optional(),
        }),
        req.body,
      );
      if (body.permissions !== undefined) requireGrantable(a, body.permissions, role.permissions);
      await db.query(
        'update roles set name = coalesce($2, name), color = coalesce($3, color), permissions = coalesce($4, permissions) where id = $1',
        [role.id, body.name ?? null, body.color ?? null, body.permissions ?? null],
      );
      await changed(role.guildId, body.permissions !== undefined);
    }),
  );

  r.delete(
    '/roles/:roleId',
    auth,
    wrap(async (req) => {
      const { role } = await roleForManage(String(req.params.roleId), req.user!.id);
      await db.query('delete from roles where id = $1', [role.id]);
      // canais que só esse cargo via voltam a ser só de administradores (lista vazia continua privada)
      await db.query('update channels set allowed_role_ids = array_remove(allowed_role_ids, $2) where guild_id = $1', [
        role.guildId,
        role.id,
      ]);
      await changed(role.guildId, true);
    }),
  );

  r.post(
    '/roles/:roleId/move',
    auth,
    wrap(async (req) => {
      const { role, a } = await roleForManage(String(req.params.roleId), req.user!.id);
      const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body);
      const sorted = [...a.ctx.roles].sort((x, y) => y.position - x.position); // mais alto primeiro
      const i = sorted.findIndex((x) => x.id === role.id);
      const j = direction === 'up' ? i - 1 : i + 1;
      const other = sorted[j];
      if (!other) return;
      if (!a.isOwner && other.position >= topRolePosition(a.ctx, req.user!.id, a.roleIds)) {
        throw new HttpError(403, 'Não dá para subir acima do seu próprio cargo.');
      }
      await db.query('update roles set position = $2 where id = $1', [role.id, other.position]);
      await db.query('update roles set position = $2 where id = $1', [other.id, role.position]);
      await changed(role.guildId);
    }),
  );

  // ---------- membros: cargos, castigo, expulsar, banir ----------

  r.put(
    '/guilds/:id/members/:userId/roles',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const target = String(req.params.userId);
      const a = await requirePerm(db, id, req.user!.id, Perm.MANAGE_ROLES);
      if (target !== a.userId) await requireOutranks(db, id, a, target);
      const [isMember] = await db.query('select 1 from members where guild_id = $1 and user_id = $2', [id, target]);
      if (!isMember) throw new HttpError(404, 'Membro não encontrado.');
      const { roleIds } = parse(z.object({ roleIds: z.array(z.string()).max(50) }), req.body);
      const current = await memberRoleIds(db, id, target);
      const top = topRolePosition(a.ctx, a.userId, a.roleIds);
      const changedIds = [...roleIds.filter((r) => !current.includes(r)), ...current.filter((r) => !roleIds.includes(r))];
      for (const rid of changedIds) {
        const role = a.ctx.roles.find((x) => x.id === rid);
        if (!role) throw new HttpError(400, 'Cargo inválido.');
        if (!a.isOwner && role.position >= top) throw new HttpError(403, `Você não pode dar ou tirar o cargo "${role.name}".`);
      }
      await db.query('delete from member_roles where guild_id = $1 and user_id = $2', [id, target]);
      for (const rid of roleIds) {
        await db.query('insert into member_roles (guild_id, user_id, role_id) values ($1, $2, $3) on conflict do nothing', [
          id,
          target,
          rid,
        ]);
      }
      await changed(id, true);
    }),
  );

  r.post(
    '/guilds/:id/members/:userId/timeout',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const target = String(req.params.userId);
      const a = await requirePerm(db, id, req.user!.id, Perm.TIMEOUT);
      await requireOutranks(db, id, a, target);
      const { minutes } = parse(z.object({ minutes: z.number().int().min(0).max(7 * 24 * 60) }), req.body);
      const updated = await db.query(
        `update members set timeout_until = case when $3::int = 0 then null else now() + make_interval(mins => $3::int) end
         where guild_id = $1 and user_id = $2 returning 1`,
        [id, target, minutes],
      );
      if (!updated.length) throw new HttpError(404, 'Membro não encontrado.');
      await changed(id, true);
    }),
  );

  async function removeMember(guildId: string, userId: string) {
    const [m] = await db.query<{ avatar_id: string | null }>('delete from members where guild_id = $1 and user_id = $2 returning avatar_id', [
      guildId,
      userId,
    ]);
    await deleteFiles(db, [m?.avatar_id]);
    rt.emitUser(userId, 'guild:delete', { id: guildId });
    rt.userLeftGuild(userId, guildId);
    await changed(guildId);
  }

  r.delete(
    '/guilds/:id/members/:userId',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const me = req.user!.id;
      const target = req.params.userId === '@me' ? me : String(req.params.userId);
      if (target === me) {
        const a = await requireMember(db, id, me);
        if (a.isOwner) throw new HttpError(400, 'O dono não pode sair. Exclua o servidor.');
      } else {
        const a = await requirePerm(db, id, me, Perm.KICK);
        await requireOutranks(db, id, a, target);
      }
      await removeMember(id, target);
    }),
  );

  r.get(
    '/guilds/:id/bans',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requirePerm(db, id, req.user!.id, Perm.BAN);
      const bans = await db.query<Ban>(
        `select ${userJson('u')} as user,
           b.reason, b.created_at as "createdAt"
         from bans b join users u on u.id = b.user_id where b.guild_id = $1 order by b.created_at desc`,
        [id],
      );
      return { bans };
    }),
  );

  r.post(
    '/guilds/:id/bans',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const a = await requirePerm(db, id, req.user!.id, Perm.BAN);
      const body = parse(z.object({ userId: z.string(), reason: z.string().trim().max(200).default('') }), req.body);
      await requireOutranks(db, id, a, body.userId);
      await db.query(
        'insert into bans (guild_id, user_id, reason, banned_by) values ($1, $2, $3, $4) on conflict (guild_id, user_id) do update set reason = $3',
        [id, body.userId, body.reason, a.userId],
      );
      await removeMember(id, body.userId);
    }),
  );

  r.delete(
    '/guilds/:id/bans/:userId',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requirePerm(db, id, req.user!.id, Perm.BAN);
      await db.query('delete from bans where guild_id = $1 and user_id = $2', [id, String(req.params.userId)]);
    }),
  );

  // ---------- categorias e canais ----------

  r.post(
    '/guilds/:id/categories',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requirePerm(db, id, req.user!.id, Perm.MANAGE_CHANNELS);
      const { name } = parse(z.object({ name: z.string().trim().min(1, 'Dê um nome à categoria.').max(40) }), req.body);
      const [{ max }] = await db.query<{ max: number | null }>('select max(position) as max from categories where guild_id = $1', [id]);
      const categoryId = randomUUID();
      await db.query('insert into categories (id, guild_id, name, position) values ($1, $2, $3, $4)', [
        categoryId,
        id,
        name,
        (max ?? 0) + 1,
      ]);
      await changed(id);
      return { categoryId };
    }),
  );

  async function categoryForManage(categoryId: string, userId: string) {
    const [cat] = await db.query<{ guildId: string }>('select guild_id as "guildId" from categories where id = $1', [categoryId]);
    if (!cat) throw new HttpError(404, 'Categoria não encontrada.');
    await requirePerm(db, cat.guildId, userId, Perm.MANAGE_CHANNELS);
    return cat;
  }

  r.patch(
    '/categories/:categoryId',
    auth,
    wrap(async (req) => {
      const cat = await categoryForManage(String(req.params.categoryId), req.user!.id);
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(40) }), req.body);
      await db.query('update categories set name = $2 where id = $1', [String(req.params.categoryId), name]);
      await changed(cat.guildId);
    }),
  );

  r.delete(
    '/categories/:categoryId',
    auth,
    wrap(async (req) => {
      const cat = await categoryForManage(String(req.params.categoryId), req.user!.id);
      // os canais da categoria continuam, só ficam sem categoria
      await db.query('delete from categories where id = $1', [String(req.params.categoryId)]);
      await changed(cat.guildId);
    }),
  );

  const channelSettings = z.object({
    name: channelNameSchema.optional(),
    categoryId: z.string().nullable().optional(),
    allowedRoleIds: z.array(z.string()).max(50).nullable().optional(),
    bitrate: z.number().int().refine((b) => BITRATES.includes(b), 'Qualidade inválida.').optional(),
    userLimit: z.number().int().min(0).max(99).optional(),
  });

  async function validateChannelRefs(guildId: string, body: z.infer<typeof channelSettings>) {
    if (body.categoryId) {
      const [cat] = await db.query('select 1 from categories where id = $1 and guild_id = $2', [body.categoryId, guildId]);
      if (!cat) throw new HttpError(400, 'Categoria inválida.');
    }
    if (body.allowedRoleIds?.length) {
      const roles = await db.query('select 1 from roles where id = any($1) and guild_id = $2', [body.allowedRoleIds, guildId]);
      if (roles.length !== body.allowedRoleIds.length) throw new HttpError(400, 'Cargo inválido.');
    }
  }

  r.post(
    '/guilds/:id/channels',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await requirePerm(db, guildId, req.user!.id, Perm.MANAGE_CHANNELS);
      const body = parse(channelSettings.extend({ name: channelNameSchema, type: z.enum(['text', 'voice']) }), req.body);
      await validateChannelRefs(guildId, body);
      const [{ max }] = await db.query<{ max: number | null }>('select max(position) as max from channels where guild_id = $1', [
        guildId,
      ]);
      const channelId = randomUUID();
      await db.query(
        `insert into channels (id, guild_id, name, type, position, category_id, allowed_role_ids, bitrate, user_limit)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          channelId,
          guildId,
          body.type === 'text' ? slug(body.name) : body.name,
          body.type,
          (max ?? 0) + 1,
          body.categoryId ?? null,
          body.allowedRoleIds ?? null,
          body.bitrate ?? 128,
          body.userLimit ?? 0,
        ],
      );
      await changed(guildId);
      return { channel: toChannel((await loadChannel(db, channelId))!) };
    }),
  );

  async function channelForManage(channelId: string, userId: string) {
    const c = await loadChannel(db, channelId);
    if (!c || !c.guildId) throw new HttpError(404, 'Canal não encontrado.');
    const a = await requirePerm(db, c.guildId, userId, Perm.MANAGE_CHANNELS);
    if (!canSee(a, c)) throw new HttpError(404, 'Canal não encontrado.');
    return c as ChannelRow & { guildId: string };
  }

  r.patch(
    '/channels/:id',
    auth,
    wrap(async (req) => {
      const c = await channelForManage(String(req.params.id), req.user!.id);
      const body = parse(channelSettings, req.body);
      await validateChannelRefs(c.guildId, body);
      await db.query(
        `update channels set
           name = coalesce($2, name),
           category_id = case when $3::boolean then $4 else category_id end,
           allowed_role_ids = case when $5::boolean then $6::text[] else allowed_role_ids end,
           bitrate = coalesce($7, bitrate),
           user_limit = coalesce($8, user_limit)
         where id = $1`,
        [
          c.id,
          body.name ? (c.type === 'text' ? slug(body.name) : body.name) : null,
          body.categoryId !== undefined,
          body.categoryId ?? null,
          body.allowedRoleIds !== undefined,
          body.allowedRoleIds ?? null,
          body.bitrate ?? null,
          body.userLimit ?? null,
        ],
      );
      await changed(c.guildId, body.allowedRoleIds !== undefined);
    }),
  );

  r.delete(
    '/channels/:id',
    auth,
    wrap(async (req) => {
      const c = await channelForManage(String(req.params.id), req.user!.id);
      rt.channelDeleted(c.id);
      await db.query('delete from channels where id = $1', [c.id]);
      await changed(c.guildId);
    }),
  );

  /** Organização da barra lateral (arrastar e soltar): ordem das categorias e dos canais. */
  r.put(
    '/guilds/:id/layout',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      await requirePerm(db, id, req.user!.id, Perm.MANAGE_CHANNELS);
      const body = parse(
        z.object({
          categories: z.array(z.string()).max(100),
          channels: z.array(z.object({ id: z.string(), categoryId: z.string().nullable() })).max(500),
        }),
        req.body,
      );
      const cats = new Set((await db.query<{ id: string }>('select id from categories where guild_id = $1', [id])).map((x) => x.id));
      const chans = new Set((await db.query<{ id: string }>('select id from channels where guild_id = $1', [id])).map((x) => x.id));
      body.categories.forEach((cid) => {
        if (!cats.has(cid)) throw new HttpError(400, 'Categoria inválida.');
      });
      body.channels.forEach((ch) => {
        if (!chans.has(ch.id) || (ch.categoryId && !cats.has(ch.categoryId))) throw new HttpError(400, 'Canal inválido.');
      });
      for (const [i, cid] of body.categories.entries()) await db.query('update categories set position = $2 where id = $1', [cid, i]);
      for (const [i, ch] of body.channels.entries()) {
        await db.query('update channels set position = $2, category_id = $3 where id = $1', [ch.id, i, ch.categoryId]);
      }
      await changed(id);
    }),
  );
}
