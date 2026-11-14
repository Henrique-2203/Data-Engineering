import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from './config.ts';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { USER_COLUMNS, deviceLabel, hashPassword, issueSession, sha256, verifyPassword, type requireAuth } from './auth.ts';
import { emailEnabled, maskEmail, sendEmail } from './email.ts';
import { checkSecondFactor, limit, requireStrongPassword } from './security.ts';
import type { PublicUser } from '../../shared/types.ts';

/**
 * Segurança da conta, parte 2:
 * - histórico de segurança (logins, troca de senha, 2FA, e-mail...) que a própria pessoa vê;
 * - alertas por e-mail (novo aparelho, senha trocada, 2FA desligado...);
 * - e-mail confirmado por código e "esqueci minha senha" por e-mail (pedindo o 2FA, se ativo);
 * - senhas vazadas (Have I Been Pwned, k-anonimato: a senha nunca sai do servidor);
 * - captcha invisível (Cloudflare Turnstile) contra robôs.
 */

// ---------- histórico de segurança ----------

export type SecurityEventType =
  | 'register'
  | 'login'
  | 'login_new_device'
  | 'login_blocked'
  | 'password_changed'
  | 'password_reset'
  | 'password_leaked'
  | 'recovery_used'
  | '2fa_enabled'
  | '2fa_disabled'
  | 'recovery_codes'
  | 'email_verified'
  | 'email_removed'
  | 'session_ended'
  | 'logout_others'
  | 'data_export';

/** Nomes em português (exportação de dados da LGPD). */
export const EVENT_NAMES: Record<SecurityEventType, string> = {
  register: 'Conta criada',
  login: 'Entrou na conta',
  login_new_device: 'Entrou de um aparelho novo',
  login_blocked: 'Tentativas de entrar bloqueadas',
  password_changed: 'Senha trocada',
  password_reset: 'Senha trocada com código do e-mail',
  password_leaked: 'Senha encontrada em vazamentos de outros sites',
  recovery_used: 'Senha trocada com código de recuperação',
  '2fa_enabled': 'Verificação em duas etapas ativada',
  '2fa_disabled': 'Verificação em duas etapas desativada',
  recovery_codes: 'Novos códigos de recuperação gerados',
  email_verified: 'E-mail confirmado',
  email_removed: 'E-mail removido',
  session_ended: 'Aparelho desconectado',
  logout_others: 'Saiu de todos os outros aparelhos',
  data_export: 'Baixou uma cópia dos dados',
};

export async function logEvent(db: Db, userId: string, type: SecurityEventType, req?: Request, detail?: string) {
  await db
    .query('insert into security_events (id, user_id, type, device, detail) values ($1, $2, $3, $4, $5)', [
      randomUUID(),
      userId,
      type,
      req ? deviceLabel(req.headers['user-agent']) : null,
      detail ?? null,
    ])
    .catch((err) => console.warn('[account] falha ao registrar evento', err));
}

const when = (d = new Date()) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long', timeStyle: 'short' });
const NOT_YOU = 'Não foi você? Abra o Resenha, vá em Configurações → Segurança, troque a senha e use "Sair dos outros aparelhos".';

/** Avisa por e-mail (se a pessoa tem e-mail confirmado). Nunca trava a ação principal. */
export async function alertUser(db: Db, userId: string, subject: string, lines: string[], warning: string | undefined = NOT_YOU) {
  const [u] = await db.query<{ email: string | null; verified: boolean; username: string }>(
    'select email, email_verified_at is not null as verified, username from users where id = $1',
    [userId],
  );
  if (!u?.email || !u.verified) return;
  void sendEmail({ to: u.email, subject, lines: [`Olá, @${u.username}.`, ...lines], warning });
}

/** Registra um login e avisa se foi de um aparelho novo. */
export async function recordLogin(db: Db, req: Request, userId: string, how: 'login' | 'register' | 'reset' | 'recover') {
  const device = deviceLabel(req.headers['user-agent']);
  if (how === 'register') return logEvent(db, userId, 'register', req);
  const [seen] = await db.query(
    `select 1 from security_events where user_id = $1 and device = $2 and type in ('login', 'login_new_device', 'register')
       and created_at > now() - interval '180 days' limit 1`,
    [userId, device],
  );
  if (how === 'reset') await logEvent(db, userId, 'password_reset', req);
  if (how === 'recover') await logEvent(db, userId, 'recovery_used', req);
  await logEvent(db, userId, seen ? 'login' : 'login_new_device', req);
  if (!seen && how === 'login') {
    await alertUser(db, userId, 'Novo acesso à sua conta', [`Sua conta do Resenha foi acessada em um aparelho novo: ${device}, em ${when()}.`, 'Se foi você, pode ignorar este e-mail.']);
  }
}

// ---------- senhas vazadas ----------

/**
 * Quantas vezes a senha apareceu em vazamentos conhecidos (Have I Been Pwned).
 * Só os 5 primeiros caracteres do SHA-1 saem do servidor (k-anonimato): o serviço nunca vê a senha.
 * Se o serviço não responder, devolve null (não trava ninguém).
 */
export async function pwnedCount(password: string): Promise<number | null> {
  if (!config.pwnedCheck) return null;
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`${config.pwnedApiUrl}${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Resenha' }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

/** Regras da senha + não pode ter vazado. Marca a conta como "senha conferida". */
export async function requireSafePassword(password: string, username: string) {
  requireStrongPassword(password, username);
  const n = await pwnedCount(password);
  if (n && n > 0) {
    throw new HttpError(400, `Essa senha já apareceu em vazamentos de dados de outros sites (${n.toLocaleString('pt-BR')} vezes), então criminosos a testam primeiro. Escolha outra.`);
  }
  return n !== null;
}

export async function setPassword(db: Db, userId: string, password: string, checked: boolean) {
  await db.query(
    `update users set password_hash = $2, password_changed_at = now(), password_checked_at = case when $3 then now() else null end, password_leaked = false where id = $1`,
    [userId, await hashPassword(password), checked],
  );
}

// ---------- captcha (Cloudflare Turnstile) ----------

export const turnstileEnabled = () => !!(config.turnstile.siteKey && config.turnstile.secret);

export async function verifyHuman(token: unknown, ip: string | undefined): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const res = await fetch(config.turnstile.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.turnstile.secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch (err) {
    // se a Cloudflare cair, não tranca ninguém do lado de fora (os outros limites continuam valendo)
    console.warn('[turnstile] verificação indisponível', (err as Error).message);
    return true;
  }
}

export async function requireHuman(req: Request, token: unknown) {
  if (!(await verifyHuman(token, req.ip))) throw new HttpError(400, 'Confirme que você não é um robô e tente de novo.');
}

// ---------- códigos por e-mail ----------

const CODE_MINUTES = 15;
const codeHash = (userId: string, purpose: string, code: string) => sha256(`${userId}:${purpose}:${code}`);

async function newCode(db: Db, userId: string, purpose: 'verify' | 'reset', email: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query('delete from email_codes where user_id = $1 and purpose = $2', [userId, purpose]);
  await db.query(
    `insert into email_codes (id, user_id, purpose, email, code_hash, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [randomUUID(), userId, purpose, email, codeHash(userId, purpose, code), CODE_MINUTES],
  );
  return code;
}

/** Confere o código (5 tentativas, 15 minutos). Devolve o e-mail ao qual ele foi enviado. */
async function useCode(db: Db, userId: string, purpose: 'verify' | 'reset', code: string): Promise<string | null> {
  const [row] = await db.query<{ id: string; email: string; code_hash: string; attempts: number; expired: boolean }>(
    `select id, email, code_hash, attempts, expires_at < now() as expired from email_codes where user_id = $1 and purpose = $2`,
    [userId, purpose],
  );
  if (!row || row.expired || row.attempts >= 5) return null;
  if (row.code_hash !== codeHash(userId, purpose, code.replace(/\D/g, ''))) {
    await db.query('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
    return null;
  }
  await db.query('delete from email_codes where id = $1', [row.id]);
  return row.email;
}

export const emailSchema = z.string().trim().toLowerCase().max(254).email('E-mail inválido.');

/** Código de 6 dígitos (cadastro): guardado só como hash. */
export const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const signupCodeHash = (pendingId: string, code: string) => sha256(`signup:${pendingId}:${code.replace(/\D/g, '')}`);

export async function sendSignupCode(email: string, username: string, code: string) {
  return sendEmail({
    to: email,
    subject: 'Seu código para criar a conta',
    lines: [`Falta pouco! Digite o código abaixo no Resenha para criar a conta @${username}. Ele vale por ${CODE_MINUTES} minutos.`],
    code,
    warning: 'Não pediu isso? Ignore este e-mail: nenhuma conta é criada sem o código.',
  });
}

// ---------- rotas ----------

export function registerAccountRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const confirmPassword = async (userId: string, password: unknown) => {
    limit(`confirm:${userId}`, 8, 15 * 60_000);
    const [u] = await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId]);
    if (typeof password !== 'string' || !u || !(await verifyPassword(password, u.password_hash))) throw new HttpError(403, 'Senha incorreta.');
  };

  // histórico de segurança (só da própria pessoa)
  r.get(
    '/me/security/events',
    auth,
    wrap(async (req) => ({
      events: await db.query(
        `select id, type, device, detail, created_at as "createdAt" from security_events where user_id = $1 order by created_at desc limit 40`,
        [req.user!.id],
      ),
    })),
  );

  // ---------- e-mail ----------

  r.post(
    '/me/email',
    auth,
    wrap(async (req) => {
      if (!emailEnabled()) throw new HttpError(503, 'O envio de e-mails ainda não está configurado no Resenha.');
      const me = req.user!.id;
      const body = parse(z.object({ email: emailSchema, password: z.string() }), req.body);
      await confirmPassword(me, body.password);
      limit(`email-send:${me}`, 5, 60 * 60_000, 'Muitos códigos pedidos. Tente de novo em uma hora.');
      const [taken] = await db.query('select 1 from users where lower(email) = $1 and id <> $2', [body.email, me]);
      if (taken) throw new HttpError(409, 'Este e-mail já está sendo usado em outra conta do Resenha.');
      const code = await newCode(db, me, 'verify', body.email);
      const ok = await sendEmail({
        to: body.email,
        subject: 'Confirme seu e-mail',
        lines: [`Use o código abaixo para confirmar este e-mail na conta @${req.user!.username} do Resenha. Ele vale por ${CODE_MINUTES} minutos.`],
        code,
        warning: 'Se você não pediu isso, ignore este e-mail: nada muda sem o código.',
      });
      if (!ok) throw new HttpError(502, 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.');
      return { sentTo: maskEmail(body.email) };
    }),
  );

  r.post(
    '/me/email/verify',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      limit(`email-verify:${me}`, 10, 15 * 60_000);
      const { code } = parse(z.object({ code: z.string().trim().max(12) }), req.body);
      const email = await useCode(db, me, 'verify', code);
      if (!email) throw new HttpError(400, 'Código incorreto ou vencido. Peça um novo.');
      const [old] = await db.query<{ email: string | null; verified: boolean }>('select email, email_verified_at is not null as verified from users where id = $1', [me]);
      try {
        await db.query('update users set email = $2, email_verified_at = now() where id = $1', [me, email]);
      } catch {
        throw new HttpError(409, 'Este e-mail já está sendo usado em outra conta do Resenha.');
      }
      await logEvent(db, me, 'email_verified', req, maskEmail(email));
      if (old?.email && old.verified && old.email.toLowerCase() !== email) {
        void sendEmail({
          to: old.email,
          subject: 'O e-mail da sua conta foi trocado',
          lines: [`O e-mail da conta @${req.user!.username} no Resenha foi trocado para ${maskEmail(email)} em ${when()}.`],
          warning: `Não foi você? Escreva para ${config.privacyContact} o quanto antes.`,
        });
      }
      return { email };
    }),
  );

  r.post(
    '/me/email/remove',
    auth,
    wrap(async (req) => {
      const me = req.user!.id;
      await confirmPassword(me, req.body?.password);
      const [old] = await db.query<{ email: string | null; verified: boolean }>('select email, email_verified_at is not null as verified from users where id = $1', [me]);
      await db.query('update users set email = null, email_verified_at = null where id = $1', [me]);
      await db.query('delete from email_codes where user_id = $1', [me]);
      if (old?.email) {
        await logEvent(db, me, 'email_removed', req, maskEmail(old.email));
        if (old.verified) {
          void sendEmail({
            to: old.email,
            subject: 'E-mail removido da sua conta',
            lines: [`Este e-mail foi removido da conta @${req.user!.username} no Resenha em ${when()}. Você não vai mais receber alertas de segurança aqui.`],
          });
        }
      }
    }),
  );

  // ---------- esqueci minha senha (por e-mail) ----------

  const findForReset = async (login: string) => {
    const l = login.trim().toLowerCase().replace(/^@/, '');
    const [u] = await db.query<{ id: string; username: string; email: string | null; verified: boolean; suspended: boolean }>(
      `select id, username, email, email_verified_at is not null as verified, suspended_at is not null as suspended
       from users where username = $1 or (lower(email) = $1 and email_verified_at is not null) limit 1`,
      [l],
    );
    return u ?? null;
  };

  r.post(
    '/auth/forgot',
    wrap(async (req) => {
      limit(`forgot:${req.ip}`, 5, 15 * 60_000);
      const body = parse(z.object({ login: z.string().trim().min(1).max(254), captcha: z.string().optional() }), req.body);
      await requireHuman(req, body.captcha);
      const sameAnswer = { message: 'Se existir uma conta com esse usuário ou e-mail confirmado, enviamos um código para o e-mail dela. Confira também o spam.' };
      if (!emailEnabled()) throw new HttpError(503, 'A recuperação por e-mail ainda não está disponível. Use um código de recuperação.');
      const u = await findForReset(body.login);
      // mesma resposta para quem existe e quem não existe (não revela quem tem conta)
      if (!u || !u.email || !u.verified || u.suspended) return sameAnswer;
      try {
        limit(`forgot-user:${u.id}`, 3, 60 * 60_000);
      } catch {
        return sameAnswer;
      }
      const code = await newCode(db, u.id, 'reset', u.email);
      void sendEmail({
        to: u.email,
        subject: 'Código para criar uma senha nova',
        lines: [`Alguém pediu para criar uma senha nova para a conta @${u.username} no Resenha. Digite o código abaixo no Resenha. Ele vale por ${CODE_MINUTES} minutos.`],
        code,
        warning: 'Não foi você? Ignore este e-mail: sua senha continua a mesma. Nunca passe este código para ninguém, nem para alguém dizendo ser do Resenha.',
      });
      return sameAnswer;
    }),
  );

  r.post(
    '/auth/reset',
    wrap(async (req, res) => {
      limit(`reset:${req.ip}`, 20, 15 * 60_000);
      const body = parse(
        z.object({ login: z.string().trim().min(1).max(254), code: z.string().trim().max(12), password: z.string().max(200), totp: z.string().max(20).optional() }),
        req.body,
      );
      const u = await findForReset(body.login);
      if (u) limit(`reset-user:${u.id}`, 8, 15 * 60_000);
      const wrong = () => new HttpError(400, 'Código incorreto ou vencido. Peça um novo.');
      if (!u || u.suspended) throw wrong();
      // confere o código sem gastá-lo ainda (o 2FA e a senha nova podem precisar de outra tentativa)
      const [row] = await db.query<{ code_hash: string; attempts: number; expired: boolean }>(
        `select code_hash, attempts, expires_at < now() as expired from email_codes where user_id = $1 and purpose = 'reset'`,
        [u.id],
      );
      if (!row || row.expired || row.attempts >= 5) throw wrong();
      if (row.code_hash !== codeHash(u.id, 'reset', body.code.replace(/\D/g, ''))) {
        await db.query(`update email_codes set attempts = attempts + 1 where user_id = $1 and purpose = 'reset'`, [u.id]);
        throw wrong();
      }
      // quem tem verificação em duas etapas precisa dela também: só o e-mail não basta para tomar a conta
      const second = await checkSecondFactor(db, u.id, body.totp);
      if (second === 'missing') return res.status(401).json({ error: 'Sua conta tem verificação em duas etapas: digite o código do app autenticador (ou um código de recuperação).', need2fa: true });
      if (second === 'wrong') return res.status(401).json({ error: 'Código do app autenticador incorreto.', need2fa: true });
      const checked = await requireSafePassword(body.password, u.username);
      await useCode(db, u.id, 'reset', body.code);
      await setPassword(db, u.id, body.password, checked);
      const ended = await db.query<{ token_hash: string }>('delete from sessions where user_id = $1 returning token_hash', [u.id]);
      rt.endSessions(ended.map((s) => s.token_hash));
      await alertUser(db, u.id, 'Sua senha foi trocada', [`A senha da sua conta foi trocada usando um código enviado para este e-mail, em ${when()}. Todos os aparelhos foram desconectados.`], `Não foi você? Escreva para ${config.privacyContact} o quanto antes.`);
      const session = await issueSession(db, req, res, u.id);
      await recordLogin(db, req, u.id, 'reset');
      const [user] = await db.query<PublicUser>(`select ${USER_COLUMNS} from users u where u.id = $1`, [u.id]);
      return { ...session, user };
    }),
  );

  // limpeza: códigos vencidos e histórico com mais de 180 dias
  const cleanup = () =>
    Promise.all([
      db.query(`delete from email_codes where expires_at < now() - interval '1 day'`),
      db.query(`delete from pending_signups where expires_at < now() - interval '1 day'`),
      db.query(`delete from security_events where created_at < now() - interval '180 days'`),
    ]).catch(() => {});
  setTimeout(cleanup, 90_000).unref();
  setInterval(cleanup, 6 * 3600_000).unref();
}

/** Responde o login de quem acabou de entrar, já conferindo se a senha usada vazou em outros sites. */
export async function finishLogin(db: Db, req: Request, res: Response, user: PublicUser, password: string) {
  const session = await issueSession(db, req, res, user.id);
  await recordLogin(db, req, user.id, 'login');
  const leaked = await pwnedCount(password);
  if (leaked !== null) {
    await db.query('update users set password_checked_at = now(), password_leaked = $2 where id = $1', [user.id, leaked > 0]);
    if (leaked > 0) await logEvent(db, user.id, 'password_leaked', req);
  }
  return { ...session, user, passwordLeaked: !!leaked };
}
