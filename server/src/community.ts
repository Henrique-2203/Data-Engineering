import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import type { requireAuth } from './auth.ts';
import { userJson } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import { type ChannelRow, type MemberAccess, canSee, memberAccess, requireMember, requireNotTimedOut, requirePerm } from './access.ts';
import { audit, userLabel } from './audit.ts';
import { limit } from './security.ts';
import { withFileLinks } from './attachments.ts';
import { sendPush } from './push.ts';
import { Perm, has } from '../../shared/permissions.ts';
import type { AutomodSettings, GuildEvent, Message } from '../../shared/types.ts';

// ======================================================================
// Modo lento
// ======================================================================

export const SLOWMODE_VALUES = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];

/** Quem gerencia mensagens ou canais não espera o modo lento. */
export async function checkSlowmode(db: Db, c: ChannelRow & { slowmode?: number }, access: MemberAccess | null, userId: string) {
  const wait = c.slowmode ?? 0;
  if (!wait || !access || has(access.perms, Perm.MANAGE_MESSAGES) || has(access.perms, Perm.MANAGE_CHANNELS)) return;
  const [row] = await db.query<{ ago: number | null }>(
    'select extract(epoch from now() - max(created_at))::float as ago from messages where channel_id = $1 and author_id = $2',
    [c.id, userId],
  );
  if (row?.ago != null && row.ago < wait) {
    const left = Math.ceil(wait - row.ago);
    throw new HttpError(429, `Modo lento: espere ${left < 60 ? `${left}s` : `${Math.ceil(left / 60)} min`} para mandar outra mensagem.`);
  }
}

// ======================================================================
// Moderação automática
// ======================================================================

export const DEFAULT_AUTOMOD: AutomodSettings = { words: [], blockLinks: false, blockInvites: false, antiSpam: false, exemptRoleIds: [] };

const automodSchema = z.object({
  words: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(300).default([]),
  blockLinks: z.boolean().default(false),
  blockInvites: z.boolean().default(false),
  antiSpam: z.boolean().default(false),
  exemptRoleIds: z.array(z.string()).max(50).default([]),
});

export async function loadAutomod(db: Db, guildId: string): Promise<AutomodSettings> {
  const [g] = await db.query<{ automod: Partial<AutomodSettings> | null }>('select automod from guilds where id = $1', [guildId]);
  return { ...DEFAULT_AUTOMOD, ...(g?.automod ?? {}) };
}

/** minúsculas, sem acento e com as trocas mais comuns para driblar filtro (0→o, 1→i, @→a...) */
export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134@$5!|7]/g, (ch) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '@': 'a', $: 's', '5': 's', '!': 'i', '|': 'i', '7': 't' })[ch] ?? ch);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palavra proibida encontrada (ou null). "idiot*" pega idiota, idiotice...; letras repetidas ("buuurro") também. */
export function findBlockedWord(text: string, words: string[]): string | null {
  if (!words.length || !text) return null;
  const norm = normalizeText(text);
  const squeezed = norm.replace(/(.)\1+/g, '$1');
  for (const w of words) {
    const prefix = w.endsWith('*');
    const base = normalizeText(prefix ? w.slice(0, -1) : w).trim();
    if (!base) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(base)}${prefix ? '' : '(?![a-z0-9])'}`);
    if (re.test(norm) || re.test(squeezed)) return w;
  }
  return null;
}

const INVITE_RE = /(discord(app)?\.com\/invite\/|discord\.gg\/|\/invite\/)([a-z0-9_-]+)/gi;
const LINK_RE = /(https?:\/\/|www\.)\S+/i;

/** últimas mensagens de cada pessoa por servidor (só em memória, para o anti-spam) */
const recent = new Map<string, { text: string; at: number }[]>();
/** evita encher o registro quando alguém insiste */
const lastAuditAt = new Map<string, number>();

/**
 * Confere a mensagem contra a moderação automática do servidor. Quem gerencia mensagens/servidor
 * e os cargos isentos passam direto. Bloqueia com uma explicação para quem escreveu e anota no registro.
 */
export async function checkAutomod(
  db: Db,
  o: { guildId: string; channelName: string; access: MemberAccess; userId: string; inviteCode: string; texts: string[] },
) {
  const a = o.access;
  if (a.isOwner || has(a.perms, Perm.MANAGE_MESSAGES) || has(a.perms, Perm.MANAGE_GUILD)) return;
  const s = await loadAutomod(db, o.guildId);
  if (!s.words.length && !s.blockLinks && !s.blockInvites && !s.antiSpam) return;
  if (s.exemptRoleIds.some((id) => a.roleIds.includes(id))) return;
  const text = o.texts.filter(Boolean).join('\n');

  let rule: string | null = null;
  let reason = '';
  let detail: Record<string, unknown> = {};
  const word = findBlockedWord(text, s.words);
  if (word) {
    rule = 'words';
    reason = 'tem uma palavra proibida neste servidor';
    detail = { word };
  } else if (s.blockInvites && [...text.matchAll(INVITE_RE)].some((m) => m[3] !== o.inviteCode)) {
    rule = 'invites';
    reason = 'convites para outros servidores não são permitidos aqui';
  } else if (s.blockLinks && LINK_RE.test(text)) {
    rule = 'links';
    reason = 'links não são permitidos neste servidor';
  } else if (s.antiSpam) {
    const mentions = new Set(text.match(/@[a-z0-9_.]{3,24}/gi) ?? []).size;
    const key = `${o.guildId}:${o.userId}`;
    const now = Date.now();
    const mine = (recent.get(key) ?? []).filter((m) => now - m.at < 60_000);
    const norm = normalizeText(text).replace(/\s+/g, ' ').trim();
    if (mentions > 5) {
      rule = 'spam';
      reason = 'menções demais numa mensagem só';
    } else if (norm && mine.filter((m) => m.text === norm).length >= 2) {
      rule = 'spam';
      reason = 'a mesma mensagem foi repetida várias vezes';
    } else if (/(.)\1{29,}/s.test(text) || (text.length > 300 && new Set(text).size < 6)) {
      rule = 'spam';
      reason = 'parece spam (caracteres repetidos)';
    }
    if (!rule && norm) recent.set(key, [...mine.slice(-9), { text: norm, at: now }]);
    if (recent.size > 5000) for (const k of [...recent.keys()].slice(0, 1000)) recent.delete(k);
  }
  if (!rule) return;

  const auditKey = `${o.guildId}:${o.userId}:${rule}`;
  if ((lastAuditAt.get(auditKey) ?? 0) < Date.now() - 60_000) {
    lastAuditAt.set(auditKey, Date.now());
    await audit(db, o.guildId, o.userId, 'automod_block', { type: 'user', id: o.userId, label: await userLabel(db, o.userId) }, {
      rule,
      channel: o.channelName,
      ...detail,
    });
  }
  throw new HttpError(400, `Mensagem bloqueada pela moderação automática: ${reason}.`);
}

// ======================================================================
// Enquetes
// ======================================================================

export const POLL_HOURS = [1, 4, 8, 24, 72, 168];

export const pollSchema = z.object({
  question: z.string().trim().min(1, 'Escreva a pergunta.').max(300, 'Pergunta muito longa.'),
  options: z
    .array(z.string().trim().min(1, 'Opção vazia.').max(55, 'Opção muito longa (até 55 letras).'))
    .min(2, 'A enquete precisa de pelo menos 2 opções.')
    .max(10, 'No máximo 10 opções.')
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'Há opções repetidas.'),
  multi: z.boolean().default(false),
  hours: z
    .number()
    .int()
    .refine((h) => POLL_HOURS.includes(h), 'Duração inválida.')
    .default(24),
});

/** Campo `poll` da mensagem completa (com quem votou em cada opção). */
export const POLL_SELECT = `case when p.message_id is null then null else json_build_object(
    'question', p.question, 'multi', p.multi, 'endsAt', p.ends_at,
    'options', (select json_agg(json_build_object('text', o.value #>> '{}', 'userIds', coalesce((
        select json_agg(v.user_id order by v.created_at) from poll_votes v where v.message_id = msg.id and v.option = o.ord - 1
      ), '[]'::json)) order by o.ord)
      from jsonb_array_elements(p.options) with ordinality o(value, ord))
  ) end`;

// ======================================================================
// Eventos agendados
// ======================================================================

const EVENT_COLUMNS = `e.id, e.guild_id as "guildId", e.channel_id as "channelId", e.title, e.description,
  e.starts_at as "startsAt", e.ends_at as "endsAt",
  case when cu.id is null then null else ${userJson('cu')} end as creator,
  coalesce((select json_agg(i.user_id order by i.created_at) from guild_event_interest i where i.event_id = e.id), '[]'::json) as "interestedIds"`;

/** Eventos que ainda não acabaram (sem fim marcado, valem por 3 horas). */
export async function loadEvents(db: Db, guildId: string): Promise<GuildEvent[]> {
  return db.query<GuildEvent>(
    `select ${EVENT_COLUMNS} from guild_events e left join users cu on cu.id = e.creator_id
     where e.guild_id = $1 and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now()
     order by e.starts_at limit 50`,
    [guildId],
  );
}

async function loadEvent(db: Db, id: string): Promise<GuildEvent | null> {
  const [e] = await db.query<GuildEvent>(`select ${EVENT_COLUMNS} from guild_events e left join users cu on cu.id = e.creator_id where e.id = $1`, [id]);
  return e ?? null;
}

const eventSchema = z.object({
  title: z.string().trim().min(1, 'Dê um nome ao evento.').max(100, 'Nome muito longo.'),
  description: z.string().trim().max(1000, 'Descrição muito longa.').default(''),
  startsAt: z.string().datetime({ offset: true, message: 'Data inválida.' }),
  endsAt: z.string().datetime({ offset: true, message: 'Data inválida.' }).nullable().optional(),
  channelId: z.string().nullable().optional(),
});

// ======================================================================
// Rotas
// ======================================================================

interface Deps {
  channelForMember(channelId: string, userId: string): Promise<ChannelRow & { access: MemberAccess | null; slowmode?: number }>;
  emitToChannel(c: { id: string; guildId: string | null; allowedRoleIds: string[] | null }, event: string, payload: object): Promise<void>;
  messageSelect: string;
}

export function registerCommunityRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>, deps: Deps) {
  const fullMessage = async (id: string) => (await withFileLinks(db, await db.query<Message>(`${deps.messageSelect} where msg.id = $1`, [id])))[0];

  async function messageInChannel(messageId: string, userId: string) {
    const [m] = await db.query<{ id: string; channelId: string; authorId: string; pinnedAt: string | null }>(
      'select id, channel_id as "channelId", author_id as "authorId", pinned_at as "pinnedAt" from messages where id = $1',
      [messageId],
    );
    if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
    return { ...m, channel: await deps.channelForMember(m.channelId, userId) };
  }

  // ---------- busca ----------
  r.get(
    '/search',
    auth,
    wrap(async (req) => {
      const uid = req.user!.id;
      limit(`search:${uid}`, 30, 30_000, 'Muitas buscas seguidas. Espere alguns segundos.');
      const q = parse(
        z.object({
          guildId: z.string().optional(),
          channelId: z.string().optional(),
          authorId: z.string().optional(),
          text: z.string().trim().max(200).default(''),
          has: z.enum(['file', 'image', 'link', 'pinned', 'poll']).optional(),
          offset: z.coerce.number().int().min(0).max(5000).default(0),
        }),
        req.query,
      );
      if (!q.guildId && !q.channelId) throw new HttpError(400, 'Diga onde buscar.');
      if (!q.text && !q.authorId && !q.has) throw new HttpError(400, 'Digite o que procurar.');

      // só os canais que a pessoa enxerga
      let channelIds: string[];
      if (q.channelId) {
        const c = await deps.channelForMember(q.channelId, uid);
        if (q.guildId && c.guildId !== q.guildId) throw new HttpError(404, 'Canal não encontrado.');
        channelIds = [c.id];
      } else {
        const access = await requireMember(db, q.guildId!, uid);
        const rows = await db.query<ChannelRow>(
          `select id, guild_id as "guildId", allowed_role_ids as "allowedRoleIds" from channels where guild_id = $1`,
          [q.guildId],
        );
        channelIds = rows.filter((c) => canSee(access, c)).map((c) => c.id);
      }
      if (!channelIds.length) return { messages: [], total: 0 };

      const params: unknown[] = [channelIds];
      const where = ['msg.channel_id = any($1)'];
      // cada palavra precisa aparecer (sem diferenciar maiúsculas nem acentos)
      const fold = (sql: string) => `translate(lower(${sql}), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`;
      const terms = q.text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8);
      for (const t of terms) {
        params.push(`%${t.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
        where.push(`(${fold('msg.content')} like $${params.length} or ${fold("coalesce(p.question, '')")} like $${params.length})`);
      }
      if (q.authorId) {
        params.push(q.authorId);
        where.push(`msg.author_id = $${params.length}`);
      }
      if (q.has === 'file') where.push('exists (select 1 from attachments a where a.message_id = msg.id)');
      if (q.has === 'image') where.push(`exists (select 1 from attachments a where a.message_id = msg.id and a.kind = 'image')`);
      if (q.has === 'link') where.push(`msg.content ~* '(https?://|www\\.)'`);
      if (q.has === 'pinned') where.push('msg.pinned_at is not null');
      if (q.has === 'poll') where.push('p.message_id is not null');

      const filter = where.join(' and ');
      const [{ total }] = await db.query<{ total: number }>(
        `select count(*)::int as total from messages msg left join polls p on p.message_id = msg.id where ${filter}`,
        params,
      );
      const rows = await db.query<Message>(`${deps.messageSelect} where ${filter} order by msg.created_at desc limit 25 offset ${q.offset}`, params);
      return { messages: await withFileLinks(db, rows), total };
    }),
  );

  // ---------- mensagens fixadas ----------
  r.get(
    '/channels/:id/pins',
    auth,
    wrap(async (req) => {
      const c = await deps.channelForMember(String(req.params.id), req.user!.id);
      const rows = await db.query<Message>(`${deps.messageSelect} where msg.channel_id = $1 and msg.pinned_at is not null order by msg.pinned_at desc limit 50`, [
        c.id,
      ]);
      return { messages: await withFileLinks(db, rows) };
    }),
  );

  for (const pin of [true, false]) {
    r[pin ? 'post' : 'delete'](
      '/messages/:id/pin',
      auth,
      wrap(async (req) => {
        const m = await messageInChannel(String(req.params.id), req.user!.id);
        const c = m.channel;
        // no servidor: quem gerencia mensagens; na conversa direta: os dois
        if (c.access && !has(c.access.perms, Perm.MANAGE_MESSAGES)) throw new HttpError(403, 'Você não tem permissão para fixar mensagens aqui.');
        if (pin && !m.pinnedAt) {
          const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from messages where channel_id = $1 and pinned_at is not null', [c.id]);
          if (n >= 50) throw new HttpError(400, 'Este canal já tem 50 mensagens fixadas. Desafixe alguma antes.');
        }
        await db.query(`update messages set pinned_at = ${pin ? 'coalesce(pinned_at, now())' : 'null'}, pinned_by = $2 where id = $1`, [
          m.id,
          pin ? req.user!.id : null,
        ]);
        if (c.guildId && !!m.pinnedAt !== pin) {
          await audit(db, c.guildId, req.user!.id, pin ? 'message_pin' : 'message_unpin', { type: 'user', id: m.authorId, label: await userLabel(db, m.authorId) }, {
            channel: c.name,
          });
        }
        const message = await fullMessage(m.id);
        await deps.emitToChannel(c, 'message:update', { message });
        return { message };
      }),
    );
  }

  // ---------- enquetes: votar ----------
  r.post(
    '/messages/:id/poll',
    auth,
    wrap(async (req) => {
      const uid = req.user!.id;
      limit(`vote:${uid}`, 20, 10_000, 'Calma! Espere alguns segundos.');
      const m = await messageInChannel(String(req.params.id), uid);
      if (m.channel.access) requireNotTimedOut(m.channel.access);
      const [p] = await db.query<{ options: string[]; multi: boolean; ended: boolean }>(
        'select options, multi, ends_at <= now() as ended from polls where message_id = $1',
        [m.id],
      );
      if (!p) throw new HttpError(404, 'Enquete não encontrada.');
      if (p.ended) throw new HttpError(400, 'Esta enquete já terminou.');
      const { options } = parse(z.object({ options: z.array(z.number().int().min(0)).max(10) }), req.body);
      const chosen = [...new Set(options)];
      if (chosen.some((o) => o >= p.options.length)) throw new HttpError(400, 'Opção inválida.');
      if (!p.multi && chosen.length > 1) throw new HttpError(400, 'Esta enquete aceita só uma opção.');
      await db.query('delete from poll_votes where message_id = $1 and user_id = $2', [m.id, uid]);
      for (const o of chosen) await db.query('insert into poll_votes (message_id, user_id, option) values ($1, $2, $3)', [m.id, uid, o]);
      const message = await fullMessage(m.id);
      await deps.emitToChannel(m.channel, 'message:update', { message });
      return { message };
    }),
  );

  // ---------- moderação automática ----------
  r.get(
    '/guilds/:id/automod',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await requirePerm(db, guildId, req.user!.id, Perm.MANAGE_GUILD);
      return { automod: await loadAutomod(db, guildId) };
    }),
  );

  r.put(
    '/guilds/:id/automod',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await requirePerm(db, guildId, req.user!.id, Perm.MANAGE_GUILD);
      const body = parse(automodSchema, req.body);
      const words = [...new Set(body.words)];
      if (body.exemptRoleIds.length) {
        const roles = await db.query('select 1 from roles where id = any($1) and guild_id = $2', [body.exemptRoleIds, guildId]);
        if (roles.length !== body.exemptRoleIds.length) throw new HttpError(400, 'Cargo inválido.');
      }
      const before = await loadAutomod(db, guildId);
      const next: AutomodSettings = { ...body, words };
      await db.query('update guilds set automod = $2 where id = $1', [guildId, JSON.stringify(next)]);
      const diff: Record<string, unknown> = {};
      for (const k of ['blockLinks', 'blockInvites', 'antiSpam'] as const) if (before[k] !== next[k]) diff[k] = next[k];
      if (before.words.length !== next.words.length || before.words.some((w, i) => w !== next.words[i])) diff.words = next.words.length;
      if (JSON.stringify(before.exemptRoleIds) !== JSON.stringify(next.exemptRoleIds)) diff.exempt = next.exemptRoleIds.length;
      if (Object.keys(diff).length) await audit(db, guildId, req.user!.id, 'automod_update', { type: 'guild', id: guildId, label: 'moderação automática' }, diff);
      return { automod: next };
    }),
  );

  // ---------- eventos ----------
  const canManageEvent = (a: MemberAccess, e: GuildEvent) => e.creator?.id === a.userId || has(a.perms, Perm.MANAGE_GUILD);

  async function validateEvent(guildId: string, a: MemberAccess, body: z.infer<typeof eventSchema>) {
    const starts = new Date(body.startsAt).getTime();
    if (starts < Date.now() - 5 * 60_000) throw new HttpError(400, 'O evento precisa começar no futuro.');
    if (starts > Date.now() + 366 * 86_400_000) throw new HttpError(400, 'Marque o evento para daqui a no máximo um ano.');
    if (body.endsAt && new Date(body.endsAt).getTime() <= starts) throw new HttpError(400, 'O fim precisa ser depois do começo.');
    if (body.endsAt && new Date(body.endsAt).getTime() - starts > 7 * 86_400_000) throw new HttpError(400, 'Um evento pode durar no máximo 7 dias.');
    if (body.channelId) {
      const [c] = await db.query<ChannelRow>(
        `select id, type, allowed_role_ids as "allowedRoleIds" from channels where id = $1 and guild_id = $2`,
        [body.channelId, guildId],
      );
      if (!c || c.type !== 'voice' || !canSee(a, c)) throw new HttpError(400, 'Canal de voz inválido.');
    }
  }

  const emitEvent = async (guildId: string, id: string) => {
    const event = await loadEvent(db, id);
    if (event) rt.emitGuild(guildId, 'event:update', { guildId, event });
    return event;
  };

  r.post(
    '/guilds/:id/events',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      const a = await requirePerm(db, guildId, req.user!.id, Perm.CREATE_EVENTS);
      requireNotTimedOut(a);
      limit(`event:${req.user!.id}`, 10, 60 * 60_000, 'Você criou muitos eventos. Tente de novo mais tarde.');
      const body = parse(eventSchema, req.body);
      await validateEvent(guildId, a, body);
      const [{ n }] = await db.query<{ n: number }>(
        `select count(*)::int as n from guild_events where guild_id = $1 and coalesce(ends_at, starts_at + interval '3 hours') > now()`,
        [guildId],
      );
      if (n >= 50) throw new HttpError(400, 'Este servidor já tem 50 eventos marcados.');
      const id = randomUUID();
      await db.query(
        `insert into guild_events (id, guild_id, channel_id, creator_id, title, description, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, guildId, body.channelId ?? null, req.user!.id, body.title, body.description, body.startsAt, body.endsAt ?? null],
      );
      // quem cria já fica interessado
      await db.query('insert into guild_event_interest (event_id, user_id) values ($1, $2) on conflict do nothing', [id, req.user!.id]);
      await audit(db, guildId, req.user!.id, 'event_create', { type: 'guild', id, label: body.title }, { startsAt: body.startsAt });
      return { event: await emitEvent(guildId, id) };
    }),
  );

  async function eventForManage(id: string, userId: string) {
    const e = await loadEvent(db, id);
    if (!e) throw new HttpError(404, 'Evento não encontrado.');
    const a = await requireMember(db, e.guildId, userId);
    if (!canManageEvent(a, e)) throw new HttpError(403, 'Só quem criou o evento (ou quem gerencia o servidor) pode mudar.');
    return { e, a };
  }

  r.patch(
    '/events/:id',
    auth,
    wrap(async (req) => {
      const { e, a } = await eventForManage(String(req.params.id), req.user!.id);
      const body = parse(eventSchema, req.body);
      await validateEvent(e.guildId, a, body);
      const moved = new Date(body.startsAt).getTime() !== new Date(e.startsAt).getTime();
      await db.query(
        `update guild_events set title = $2, description = $3, starts_at = $4, ends_at = $5, channel_id = $6,
           notified = case when $7::boolean then false else notified end where id = $1`,
        [e.id, body.title, body.description, body.startsAt, body.endsAt ?? null, body.channelId ?? null, moved],
      );
      await audit(db, e.guildId, req.user!.id, 'event_update', { type: 'guild', id: e.id, label: body.title }, moved ? { startsAt: body.startsAt } : {});
      return { event: await emitEvent(e.guildId, e.id) };
    }),
  );

  r.delete(
    '/events/:id',
    auth,
    wrap(async (req) => {
      const { e } = await eventForManage(String(req.params.id), req.user!.id);
      await db.query('delete from guild_events where id = $1', [e.id]);
      await audit(db, e.guildId, req.user!.id, 'event_delete', { type: 'guild', id: e.id, label: e.title });
      rt.emitGuild(e.guildId, 'event:delete', { guildId: e.guildId, id: e.id });
    }),
  );

  r.post(
    '/events/:id/interest',
    auth,
    wrap(async (req) => {
      const e = await loadEvent(db, String(req.params.id));
      if (!e || !(await memberAccess(db, e.guildId, req.user!.id))) throw new HttpError(404, 'Evento não encontrado.');
      const { interested } = parse(z.object({ interested: z.boolean() }), req.body);
      if (interested) await db.query('insert into guild_event_interest (event_id, user_id) values ($1, $2) on conflict do nothing', [e.id, req.user!.id]);
      else await db.query('delete from guild_event_interest where event_id = $1 and user_id = $2', [e.id, req.user!.id]);
      return { event: await emitEvent(e.guildId, e.id) };
    }),
  );
}

/** A cada minuto: avisa quem tem interesse quando um evento começa (no site e no celular). */
export function startEventReminders(db: Db, rt: Realtime) {
  const tick = async () => {
    const due = await db.query<{ id: string; guildId: string; title: string; channelId: string | null; guildName: string }>(
      `update guild_events e set notified = true from guilds g
       where g.id = e.guild_id and not e.notified and e.starts_at <= now() and e.starts_at > now() - interval '30 minutes'
       returning e.id, e.guild_id as "guildId", e.title, e.channel_id as "channelId", g.name as "guildName"`,
    );
    for (const e of due) {
      rt.emitGuild(e.guildId, 'event:start', { guildId: e.guildId, id: e.id, title: e.title, channelId: e.channelId });
      const interested = await db.query<{ user_id: string }>('select user_id from guild_event_interest where event_id = $1', [e.id]);
      await sendPush(
        db,
        interested.map((i) => i.user_id),
        { title: `Começou: ${e.title}`, body: `Evento em ${e.guildName}${e.channelId ? '. Entre na call!' : ''}`, channelId: e.channelId, guildId: e.guildId, tag: `event:${e.id}` },
        { onlyAway: rt },
      );
    }
  };
  const timer = setInterval(() => void tick().catch((err) => console.warn('[eventos]', err)), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
