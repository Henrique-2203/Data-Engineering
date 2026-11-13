import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.ts';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { getIceServers, hasTurn } from './ice.ts';
import {
  USER_COLUMNS,
  userJson,
  clearSessionCookie,
  setSessionCookie,
  deleteSession,
  hashPassword,
  issueSession,
  requireAuth,
  tokenFromHeaders,
  verifyPassword,
} from './auth.ts';
import {
  alertUser,
  emailSchema,
  finishLogin,
  logEvent,
  recordLogin,
  registerAccountRoutes,
  requireHuman,
  requireSafePassword,
  sendSignupCode,
  signupCodeHash,
  sixDigits,
  turnstileEnabled,
  verifyHuman,
} from './account.ts';
import { emailEnabled, maskEmail } from './email.ts';
import type { Channel, Guild, Member, Message, PublicUser } from '../../shared/types.ts';
import { HttpError, parse, wrap } from './http.ts';
import { dmMemberIds, registerSocialRoutes } from './social.ts';
import { maxFileBytes, registerAttachmentRoutes, withFileLinks } from './attachments.ts';
import { registerSystemRoutes } from './backup.ts';
import { audit, registerAuditRoutes, userLabel } from './audit.ts';
import { loadGuilds, registerGuildRoutes } from './guilds.ts';
import { type MemberAccess, canSee, channelAudience, guildUsage, loadChannel, memberAccess, requireNotTimedOut } from './access.ts';
import { Perm, has } from '../../shared/permissions.ts';
import { siteVersion } from './version.ts';
import { registerProfileRoutes } from './profile.ts';
import { registerExpressionRoutes, usableExpression } from './expressions.ts';
import { isPlatformAdmin, registerReportRoutes } from './reports.ts';
import { registerWaitlistRoutes } from './waitlist.ts';
import { checkSignupCode, claimSignupCode, consumeSignupCode, registerSignupCodeRoutes, registrationNeedsCode, releaseSignupCode } from './signupCodes.ts';
import { bump, registerStatsRoutes } from './stats.ts';
import { checkSecondFactor, clearLimit, hits, limit, limited, registerSecurityRoutes } from './security.ts';
import { POLL_SELECT, checkAutomod, checkSlowmode, pollSchema, registerCommunityRoutes } from './community.ts';
import { registerPushRoutes, sendPush } from './push.ts';
import { registerSupportRoutes } from './support.ts';
import { registerApoioRoutes } from './apoio.ts';
import { ensureOfficialMember, registerOfficialRoutes } from './official.ts';
import { registerExploreRoutes } from './explore.ts';
import { registerHealthRoutes } from './health.ts';
import { registerEmbedRoutes } from './embeds.ts';
import { mentionedUsernames } from './mentions.ts';

export { HttpError };

const AVATAR_COLORS = ['#f97316', '#ef4444', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
const inviteCode = () => randomBytes(6).toString('base64url');

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, 'O usuário deve ter 3 a 24 caracteres: letras, números, _ ou .');
const displayNameSchema = z.string().trim().min(1, 'Informe um nome.').max(32, 'Nome muito longo.');
const channelNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do canal.')
  .max(40, 'Nome muito longo.');

const rateLimit = (key: string, max = 10, windowMs = 60_000) => limit(key, max, windowMs, 'Muitas tentativas. Aguarde um minuto.');

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

  async function guildInviteCode(guildId: string) {
    const [g] = await db.query<{ invite_code: string }>('select invite_code from guilds where id = $1', [guildId]);
    return g?.invite_code ?? '';
  }

  /**
   * Notificação no celular de quem não está com o Resenha aberto: mensagem direta, menção
   * (@usuario) ou @todos. Só para quem consegue ver o canal.
   */
  async function notifyByPush(c: Awaited<ReturnType<typeof channelForMember>>, message: Message) {
    const author = message.author;
    const preview =
      (message.content ? message.content.replace(/<:([a-z0-9_]+):[0-9a-f-]{36}>/g, ':$1:') : '') ||
      (message.poll ? `📊 ${message.poll.question}` : message.attachments.length ? '📎 Arquivo' : message.sticker ? 'Figurinha' : '');
    if (!c.guildId) {
      const others = (await dmMemberIds(db, c.id)).filter((id) => id !== author.id);
      await sendPush(db, others, { title: author.displayName, body: preview, channelId: c.id, tag: c.id }, { onlyAway: rt });
      return;
    }
    const audience = await channelAudience(db, c);
    let targets: string[];
    if (message.mentionEveryone) {
      targets = audience ?? (await db.query<{ user_id: string }>('select user_id from members where guild_id = $1', [c.guildId])).map((x) => x.user_id);
      targets = targets.slice(0, 500);
    } else {
      const names = mentionedUsernames(message.content);
      if (!names.length) return;
      const rows = await db.query<{ id: string }>(
        'select u.id from users u join members m on m.user_id = u.id and m.guild_id = $1 where u.username = any($2)',
        [c.guildId, names],
      );
      targets = rows.map((x) => x.id).filter((id) => !audience || audience.includes(id));
    }
    targets = targets.filter((id) => id !== author.id);
    await sendPush(
      db,
      targets,
      { title: `${author.displayName} em #${c.name}`, body: preview, channelId: c.id, guildId: c.guildId, tag: c.id },
      { onlyAway: rt },
    );
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


  /** Mensagem completa: autor, trecho respondido, reações agrupadas por emoji e imagens. */
  const MESSAGE_SELECT = `select msg.id, msg.channel_id as "channelId", msg.content,
      msg.created_at as "createdAt", msg.edited_at as "editedAt", msg.mention_everyone as "mentionEveryone",
      msg.pinned_at as "pinnedAt", ${POLL_SELECT} as poll,
      ${userJson('u')} as author,
      case
        when msg.reply_to_id is null then null
        when rm.id is null then json_build_object('id', msg.reply_to_id, 'deleted', true)
        else json_build_object('id', rm.id, 'content', left(rm.content, 200), 'author', ${userJson('ru')},
          'hasAttachments', exists (select 1 from attachments ra where ra.message_id = rm.id),
          'hasSticker', rm.sticker_id is not null)
      end as "replyTo",
      case when msg.sticker_id is null then null
        else json_build_object('id', msg.sticker_id, 'name', coalesce(st.name, ''), 'fileId', st.file_id)
      end as sticker,
      coalesce((
        select json_agg(json_build_object('emoji', r.emoji, 'userIds', r.user_ids) order by r.first_at)
        from (
          select emoji, array_agg(user_id order by created_at) as user_ids, min(created_at) as first_at
          from reactions where message_id = msg.id group by emoji
        ) r
      ), '[]'::json) as reactions,
      coalesce((
        select json_agg(json_build_object('id', a.id, 'name', a.filename, 'mime', a.mime, 'kind', a.kind, 'size', a.size,
          'width', a.width, 'height', a.height) order by a.created_at)
        from attachments a where a.message_id = msg.id
      ), '[]'::json) as attachments
    from messages msg
    join users u on u.id = msg.author_id
    left join messages rm on rm.id = msg.reply_to_id
    left join users ru on ru.id = rm.author_id
    left join expressions st on st.id = msg.sticker_id
    left join polls p on p.message_id = msg.id`;

  // ---------- públicas ----------

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // "Impressão digital" do site publicado: muda a cada nova versão, e o site/app avisam para atualizar.
  r.get('/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ version: siteVersion(), env: config.appEnv, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
  });

  r.get('/config', (_req, res) => {
    res.json({
      turnstileSiteKey: turnstileEnabled() ? config.turnstile.siteKey : null,
      emailEnabled: emailEnabled(),
      registrationRequiresCode: registrationNeedsCode(),
      env: config.appEnv,
      officialUrl: config.appEnv === 'staging' ? config.officialUrl : null,
      privacyContact: config.privacyContact,
      maxFileMb: Math.floor(maxFileBytes() / 1024 / 1024),
      maxImageMb: config.maxUploadMb,
    });
  });

  r.post(
    '/auth/register',
    wrap(async (req, res) => {
      rateLimit(`reg:${req.ip}`, 10);
      const body = parse(
        z.object({
          username: usernameSchema,
          password: z.string().max(200),
          displayName: displayNameSchema.optional(),
          registrationCode: z.string().optional(),
          acceptTerms: z.boolean().optional(),
          captcha: z.string().optional(),
        }),
        req.body,
      );
      // com e-mail configurado, o cadastro é em 2 passos (e-mail confirmado): /auth/register/start
      if (emailEnabled()) throw new HttpError(400, 'Atualize a página: o cadastro agora confirma o seu e-mail.');
      await requireHuman(req, body.captcha);
      const checked = await requireSafePassword(body.password, body.username);
      const signupCode = await checkSignupCode(db, body.registrationCode, req.ip ?? '');
      const exists = await db.query('select 1 from users where username = $1', [body.username]);
      if (exists.length) throw new HttpError(409, 'Esse nome de usuário já está em uso.');
      const user: PublicUser = {
        id: randomUUID(),
        username: body.username,
        displayName: body.displayName || body.username,
        avatarColor: randomColor(),
      };
      const hash = await hashPassword(body.password);
      await consumeSignupCode(db, signupCode);
      try {
        await db.query(
          `insert into users (id, username, display_name, password_hash, avatar_color, terms_accepted_at, password_checked_at, signup_code)
           values ($1, $2, $3, $4, $5, case when $6 then now() else null end, case when $7 then now() else null end, $8)`,
          [user.id, user.username, user.displayName, hash, user.avatarColor, !!body.acceptTerms, checked, signupCode],
        );
      } catch (err) {
        await releaseSignupCode(db, signupCode);
        throw err;
      }
      await claimSignupCode(db, signupCode, user.id);
      bump('signup');
      const session = await issueSession(db, req, res, user.id);
      await recordLogin(db, req, user.id, 'register');
      return { ...session, user };
    }),
  );

  // ---------- cadastro com e-mail confirmado (2 passos) ----------

  r.get(
    '/auth/username-available',
    wrap(async (req) => {
      limit(`uname:${req.ip}`, 60, 60_000);
      const parsed = usernameSchema.safeParse(String(req.query.u ?? ''));
      if (!parsed.success) return { available: false, reason: parsed.error.issues[0]?.message };
      const [taken] = await db.query('select 1 from users where username = $1', [parsed.data]);
      return taken ? { available: false, reason: 'Esse nome de usuário já está em uso.' } : { available: true };
    }),
  );

  r.post(
    '/auth/register/start',
    wrap(async (req) => {
      rateLimit(`reg:${req.ip}`, 10);
      if (!emailEnabled()) throw new HttpError(400, 'Cadastro por e-mail indisponível.');
      const body = parse(
        z.object({
          email: emailSchema,
          username: usernameSchema,
          password: z.string().max(200),
          displayName: displayNameSchema.optional(),
          registrationCode: z.string().optional(),
          acceptTerms: z.literal(true, { message: 'Aceite os Termos de uso e a Política de Privacidade para continuar.' }),
          captcha: z.string().optional(),
        }),
        req.body,
      );
      await requireHuman(req, body.captcha);
      const signupCode = await checkSignupCode(db, body.registrationCode, req.ip ?? '');
      if ((await db.query('select 1 from users where username = $1', [body.username])).length) throw new HttpError(409, 'Esse nome de usuário já está em uso.');
      if ((await db.query('select 1 from users where lower(email) = $1', [body.email])).length) {
        throw new HttpError(409, 'Este e-mail já tem uma conta no Resenha. Entre com ele ou use "Esqueci minha senha".');
      }
      limit(`reg-mail:${body.email}`, 5, 60 * 60_000, 'Muitos códigos para este e-mail. Tente de novo em uma hora.');
      const checked = await requireSafePassword(body.password, body.username);
      const id = randomUUID();
      const code = sixDigits();
      await db.query('delete from pending_signups where email = $1', [body.email]);
      await db.query(
        `insert into pending_signups (id, email, username, display_name, password_hash, password_checked, terms, code_hash, expires_at, signup_code)
         values ($1, $2, $3, $4, $5, $6, true, $7, now() + interval '15 minutes', $8)`,
        [id, body.email, body.username, body.displayName || body.username, await hashPassword(body.password), checked, signupCodeHash(id, code), signupCode],
      );
      if (!(await sendSignupCode(body.email, body.username, code))) {
        await db.query('delete from pending_signups where id = $1', [id]);
        throw new HttpError(502, 'Não conseguimos enviar o e-mail agora. Confira o endereço e tente de novo em alguns minutos.');
      }
      return { pendingId: id, sentTo: maskEmail(body.email) };
    }),
  );

  r.post(
    '/auth/register/resend',
    wrap(async (req) => {
      rateLimit(`reg:${req.ip}`, 10);
      const { pendingId } = parse(z.object({ pendingId: z.string().max(64) }), req.body);
      const [p] = await db.query<{ email: string; username: string; sends: number; wait: number }>(
        `select email, username, sends, greatest(0, 45 - extract(epoch from now() - last_sent_at))::int as wait
         from pending_signups where id = $1 and expires_at > now()`,
        [pendingId],
      );
      if (!p) throw new HttpError(410, 'Esse cadastro expirou. Preencha de novo.');
      if (p.wait > 0) throw new HttpError(429, `Espere ${p.wait} segundos para pedir outro código.`);
      if (p.sends >= 5) throw new HttpError(429, 'Muitos códigos pedidos. Confira o e-mail digitado e comece de novo.');
      const code = sixDigits();
      await db.query(
        `update pending_signups set code_hash = $2, attempts = 0, sends = sends + 1, last_sent_at = now(), expires_at = now() + interval '15 minutes' where id = $1`,
        [pendingId, signupCodeHash(pendingId, code)],
      );
      await sendSignupCode(p.email, p.username, code);
      return { sentTo: maskEmail(p.email) };
    }),
  );

  r.post(
    '/auth/register/confirm',
    wrap(async (req, res) => {
      limit(`reg-confirm:${req.ip}`, 30, 15 * 60_000);
      const body = parse(z.object({ pendingId: z.string().max(64), code: z.string().trim().max(12) }), req.body);
      const [p] = await db.query<{ email: string; username: string; display_name: string; password_hash: string; password_checked: boolean; attempts: number; code_hash: string; signup_code: string | null }>(
        `select email, username, display_name, password_hash, password_checked, attempts, code_hash, signup_code from pending_signups where id = $1 and expires_at > now()`,
        [body.pendingId],
      );
      if (!p) throw new HttpError(410, 'Esse código expirou. Peça um novo ou preencha de novo.');
      if (p.attempts >= 5) throw new HttpError(429, 'Muitos códigos errados. Peça um novo código.');
      if (p.code_hash !== signupCodeHash(body.pendingId, body.code)) {
        await db.query('update pending_signups set attempts = attempts + 1 where id = $1', [body.pendingId]);
        throw new HttpError(400, 'Código incorreto. Confira o e-mail (e a pasta de spam).');
      }
      if ((await db.query('select 1 from users where username = $1', [p.username])).length) throw new HttpError(409, 'Esse nome de usuário foi pego enquanto isso. Escolha outro.');
      if ((await db.query('select 1 from users where lower(email) = $1', [p.email])).length) throw new HttpError(409, 'Este e-mail já tem uma conta no Resenha.');
      const user: PublicUser = { id: randomUUID(), username: p.username, displayName: p.display_name, avatarColor: randomColor() };
      // o código de convite só gasta um uso agora, quando a conta nasce
      await consumeSignupCode(db, p.signup_code);
      try {
        await db.query(
          `insert into users (id, username, display_name, password_hash, avatar_color, terms_accepted_at, password_checked_at, email, email_verified_at, signup_code)
           values ($1, $2, $3, $4, $5, now(), case when $6 then now() else null end, $7, now(), $8)`,
          [user.id, user.username, user.displayName, p.password_hash, user.avatarColor, p.password_checked, p.email, p.signup_code],
        );
      } catch (err) {
        await releaseSignupCode(db, p.signup_code);
        throw err;
      }
      await claimSignupCode(db, p.signup_code, user.id);
      await db.query('delete from pending_signups where id = $1', [body.pendingId]);
      bump('signup');
      const session = await issueSession(db, req, res, user.id);
      await recordLogin(db, req, user.id, 'register');
      await logEvent(db, user.id, 'email_verified', req, maskEmail(p.email));
      return { ...session, user };
    }),
  );

  r.post(
    '/auth/login',
    wrap(async (req, res) => {
      rateLimit(`login:${req.ip}`);
      const body = parse(
        z.object({ username: z.string().trim().toLowerCase().max(254), password: z.string().max(200), code: z.string().max(20).optional(), captcha: z.string().optional() }),
        req.body,
      );
      // força bruta numa conta específica (de vários IPs): trava a conta por 15 min após 8 erros
      const failKey = `login-fail:${body.username}`;
      const ipFailKey = `login-fail-ip:${req.ip}`;
      if (limited(failKey, 8)) throw new HttpError(429, 'Muitas tentativas erradas nessa conta. Aguarde 15 minutos.');
      // depois de 3 erros (na conta ou vindos do mesmo lugar), pede o captcha invisível
      const suspicious = () => turnstileEnabled() && (hits(failKey) >= 3 || hits(ipFailKey) >= 3);
      if (suspicious() && !(await verifyHuman(body.captcha, req.ip))) {
        return res.status(401).json({ error: 'Confirme que você não é um robô.', needCaptcha: true });
      }
      const failed = async (userId: string | null, message: string, extra: object = {}) => {
        limit(failKey, 1000, 15 * 60_000);
        limit(ipFailKey, 1000, 15 * 60_000);
        if (userId && hits(failKey) === 8) {
          await logEvent(db, userId, 'login_blocked');
          await alertUser(db, userId, 'Tentativas de entrar na sua conta', [
            `Bloqueamos por 15 minutos as tentativas de entrar na sua conta, depois de 8 senhas ou códigos errados seguidos.`,
          ], 'Se não foi você, sua conta continua protegida, mas é uma boa hora para trocar a senha e ativar a verificação em duas etapas.');
        }
        return res.status(401).json({ error: message, needCaptcha: suspicious(), ...extra });
      };
      const [row] = await db.query<PublicUser & { password_hash: string; suspended_at: string | null; suspended_reason: string | null }>(
        // entra com o usuário OU com o e-mail confirmado
        `select ${USER_COLUMNS}, u.password_hash, u.suspended_at, u.suspended_reason from users u
         where u.username = $1 or (lower(u.email) = $1 and u.email_verified_at is not null)
         order by (u.username = $1) desc limit 1`,
        [body.username.replace(/^@/, '')],
      );
      if (!row || !(await verifyPassword(body.password, row.password_hash))) return failed(row?.id ?? null, 'Usuário ou senha incorretos.');
      if (row.suspended_at) {
        throw new HttpError(403, `Esta conta foi suspensa por violar os Termos de uso${row.suspended_reason ? ` (${row.suspended_reason})` : ''}. Se acha que foi um engano, escreva para ${config.privacyContact}.`);
      }
      // verificação em duas etapas (se a pessoa ativou)
      const second = await checkSecondFactor(db, row.id, body.code);
      if (second === 'missing') return res.status(401).json({ error: 'Digite o código do seu app autenticador.', need2fa: true });
      if (second === 'wrong') return failed(row.id, 'Código de verificação incorreto.', { need2fa: true });
      clearLimit(failKey);
      const { password_hash, suspended_at, suspended_reason, ...user } = row;
      return finishLogin(db, req, res, user, body.password);
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

  // migração: o site antigo guardava o token no localStorage; aqui ele vira cookie protegido (HttpOnly)
  r.post(
    '/auth/cookie',
    auth,
    wrap(async (req, res) => {
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
      if (!token) throw new HttpError(400, 'Nada para migrar.');
      setSessionCookie(req, res, token);
      return { ok: true };
    }),
  );

  r.post(
    '/auth/logout',
    auth,
    wrap(async (req, res) => {
      const token = tokenFromHeaders(req.headers);
      if (token) await deleteSession(db, token);
      clearSessionCookie(req, res);
    }),
  );

  r.get(
    '/bootstrap',
    auth,
    wrap(async (req) => {
      const [acc] = await db.query<{ emailVerified: boolean; changelogSeen: string | null; createdAt: string; supportUnread: number }>(
        `select email_verified_at is not null as "emailVerified", changelog_seen as "changelogSeen", created_at as "createdAt",
           (select count(*)::int from support_tickets t where t.user_id = users.id and t.user_unread) as "supportUnread"
         from users where id = $1`,
        [req.user!.id],
      );
      // servidor oficial: entra uma vez (cadastro novo ou primeira visita depois de ele existir)
      const joinedOfficial = await ensureOfficialMember(db, rt, req.user!.id).catch((err) => {
        console.warn('[oficial] falha ao colocar no servidor oficial', err);
        return null;
      });
      return {
        user: req.user,
        guilds: await loadGuilds(db, req.user!.id),
        joinedOfficial,
        isPlatformAdmin: isPlatformAdmin(req.user!.username),
        // contas antigas sem e-mail recebem o convite para adicionar um (recuperação e alertas)
        account: { emailVerified: !!acc?.emailVerified, emailEnabled: emailEnabled() },
        // novidades: a última que a pessoa confirmou que leu (vale para todos os aparelhos dela)
        changelog: { seen: acc?.changelogSeen ?? null, accountCreatedAt: acc?.createdAt ?? null },
        supportUnread: acc?.supportUnread ?? 0,
      };
    }),
  );

  /** "Entendi": a pessoa leu as novidades até esta versão. */
  r.post(
    '/me/changelog-seen',
    auth,
    wrap(async (req) => {
      const { id } = parse(z.object({ id: z.string().regex(/^\d{4}-\d{2}-\d{2}[a-z0-9-]*$/).max(40) }), req.body);
      await db.query('update users set changelog_seen = $2 where id = $1 and (changelog_seen is null or changelog_seen < $2)', [req.user!.id, id]);
    }),
  );

  registerSocialRoutes(r, db, rt, auth);
  registerGuildRoutes(r, db, rt, auth);
  registerProfileRoutes(r, db, rt, auth);
  registerExpressionRoutes(r, db, rt, auth);
  registerSecurityRoutes(r, db, rt, auth);
  registerAccountRoutes(r, db, rt, auth);
  registerAuditRoutes(r, db, auth);
  registerReportRoutes(r, db, rt, auth);
  registerWaitlistRoutes(r, db, rt, auth);
  registerSignupCodeRoutes(r, db, auth);
  registerStatsRoutes(r, db, auth);
  registerSystemRoutes(r, db, auth);

  r.get('/ice', auth, wrap(async () => ({ iceServers: await getIceServers(db), hasTurn: hasTurn() })));

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
      return { messages: await withFileLinks(db, rows.reverse()), hasMore: rows.length === limit };
    }),
  );

  r.post(
    '/channels/:id/messages',
    auth,
    wrap(async (req) => {
      const c = await channelForMember(String(req.params.id), req.user!.id);
      limit(`msg:${req.user!.id}`, 12, 10_000, 'Calma! Muitas mensagens seguidas. Espere alguns segundos.');
      if (c.access) requireNotTimedOut(c.access);
      const body = parse(
        z.object({
          content: z.string().trim().max(4000, 'Mensagem muito longa.').default(''),
          replyToId: z.string().optional(),
          attachmentIds: z.array(z.string()).max(10, 'No máximo 10 arquivos por mensagem.').default([]),
          stickerId: z.string().optional(),
          poll: pollSchema.optional(),
        }),
        req.body,
      );
      if (!body.content && body.attachmentIds.length === 0 && !body.stickerId && !body.poll) throw new HttpError(400, 'Mensagem vazia.');
      // canal de avisos: só a equipe do servidor publica
      if (c.announce && c.access && !has(c.access.perms, Perm.MANAGE_GUILD) && !has(c.access.perms, Perm.MANAGE_MESSAGES)) {
        throw new HttpError(403, 'Este é um canal de avisos: só a equipe do servidor publica aqui.');
      }
      if (c.access) {
        await checkSlowmode(db, c, c.access, req.user!.id);
        await checkAutomod(db, {
          guildId: c.guildId!,
          channelName: c.name,
          access: c.access,
          userId: req.user!.id,
          inviteCode: await guildInviteCode(c.guildId!),
          texts: [body.content, body.poll?.question ?? '', ...(body.poll?.options ?? [])],
        });
      }
      // figurinhas de qualquer servidor do qual você participa (o Discord cobra por isso)
      if (body.stickerId && !(await usableExpression(db, body.stickerId, req.user!.id, 'sticker'))) {
        throw new HttpError(400, 'Figurinha não encontrada.');
      }
      if (body.replyToId) {
        const [target] = await db.query('select 1 from messages where id = $1 and channel_id = $2', [body.replyToId, c.id]);
        if (!target) throw new HttpError(400, 'A mensagem respondida não existe mais.');
      }
      if (body.attachmentIds.length) {
        const owned = await db.query<{ size: number }>(
          'select size from attachments where id = any($1) and uploader_id = $2 and message_id is null',
          [body.attachmentIds, req.user!.id],
        );
        if (owned.length !== body.attachmentIds.length) throw new HttpError(400, 'Arquivo inválido. Envie de novo.');
        // o arquivo pode ter sido enviado sem dizer o canal: confere a cota do servidor agora
        if (c.guildId) {
          const g = await guildUsage(db, c.guildId);
          if (g.usedBytes + owned.reduce((a, x) => a + x.size, 0) > g.quotaBytes) {
            throw new HttpError(413, 'Este servidor atingiu o espaço de arquivos dele. Quem administra pode apagar arquivos antigos.');
          }
        }
      }
      // @todos só notifica se a pessoa tem permissão (senão vira texto comum)
      const mentionEveryone =
        !!c.access && has(c.access.perms, Perm.MENTION_EVERYONE) && /(^|[^\w@])@todos(?![\w])/i.test(body.content);
      const id = randomUUID();
      await db.query(
        'insert into messages (id, channel_id, author_id, content, reply_to_id, mention_everyone, sticker_id) values ($1, $2, $3, $4, $5, $6, $7)',
        [id, c.id, req.user!.id, body.content, body.replyToId ?? null, mentionEveryone, body.stickerId ?? null],
      );
      if (body.attachmentIds.length) {
        await db.query('update attachments set message_id = $1, guild_id = $3 where id = any($2)', [id, body.attachmentIds, c.guildId]);
      }
      if (body.poll) {
        await db.query(
          `insert into polls (message_id, question, options, multi, ends_at) values ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
          [id, body.poll.question, JSON.stringify(body.poll.options), body.poll.multi, body.poll.hours],
        );
      }
      const [message] = await withFileLinks(db, await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [id]));
      bump('messages');
      await emitToChannel(c, 'message:new', { message });
      void notifyByPush(c, message).catch((err) => console.warn('[push]', err));
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
      if (m.channel.access) {
        await checkAutomod(db, {
          guildId: m.channel.guildId!,
          channelName: m.channel.name,
          access: m.channel.access,
          userId: req.user!.id,
          inviteCode: await guildInviteCode(m.channel.guildId!),
          texts: [body.content],
        });
      }
      if (!body.content) {
        const [att] = await db.query(
          'select 1 from attachments where message_id = $1 union all select 1 from messages where id = $1 and sticker_id is not null limit 1',
          [m.id],
        );
        if (!att) throw new HttpError(400, 'Mensagem vazia.');
      }
      await db.query('update messages set content = $2, edited_at = now() where id = $1', [m.id, body.content]);
      const [message] = await withFileLinks(db, await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [m.id]));
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
      // moderação: apagar mensagem de OUTRA pessoa entra no registro (sem guardar o conteúdo)
      if (m.authorId !== req.user!.id && m.channel.guildId) {
        await audit(db, m.channel.guildId, req.user!.id, 'message_delete', { type: 'user', id: m.authorId, label: await userLabel(db, m.authorId) }, {
          channel: m.channel.name,
        });
      }
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
            .max(80)
            .refine(
              (e) => (e.length <= 32 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e)) || /^<:[a-z0-9_]{2,32}:[0-9a-f-]{36}>$/.test(e),
              'Emoji inválido.',
            ),
        }),
        req.body,
      );
      // emoji personalizado: precisa existir num servidor do qual você participa
      const custom = /^<:[a-z0-9_]{2,32}:([0-9a-f-]{36})>$/.exec(emoji);
      if (custom && !(await usableExpression(db, custom[1], req.user!.id, 'emoji'))) {
        const [already] = await db.query('select 1 from reactions where message_id = $1 and emoji = $2 and user_id = $3', [m.id, emoji, req.user!.id]);
        if (!already) throw new HttpError(400, 'Esse emoji não está disponível para você.');
      }
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

  registerCommunityRoutes(r, db, rt, auth, { channelForMember, emitToChannel, messageSelect: MESSAGE_SELECT });
  registerPushRoutes(r, db, auth);
  registerSupportRoutes(r, db, rt, auth);
  registerApoioRoutes(r, db, rt, auth);
  registerOfficialRoutes(r, db, rt, auth);
  registerExploreRoutes(r, db, rt, auth);
  registerHealthRoutes(r, db, rt, auth);
  registerEmbedRoutes(r, auth);

  registerAttachmentRoutes(r, db, auth, {
    channelGuild: async (channelId, userId) => (await channelForMember(channelId, userId)).guildId,
    messageChanged: async (messageId) => {
      const [m] = await db.query<{ channel_id: string; empty: boolean }>(
        `select m.channel_id, (m.content = '' and m.sticker_id is null and not exists (select 1 from attachments a where a.message_id = m.id)) as empty
         from messages m where m.id = $1`,
        [messageId],
      );
      if (!m) return;
      const c = await loadChannel(db, m.channel_id);
      if (!c) return;
      if (m.empty) {
        await db.query('delete from messages where id = $1', [messageId]);
        await emitToChannel(c, 'message:delete', { channelId: c.id, id: messageId });
      } else {
        const [message] = await withFileLinks(db, await db.query<Message>(`${MESSAGE_SELECT} where msg.id = $1`, [messageId]));
        await emitToChannel(c, 'message:update', { message });
      }
    },
  });

  return r;
}
