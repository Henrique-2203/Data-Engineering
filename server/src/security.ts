import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from './db.ts';
import { config } from './config.ts';
import { r2Configured } from './storage.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { SESSION_IDLE_DAYS, createSession, hashPassword, sha256, verifyPassword, type requireAuth } from './auth.ts';
import { deleteFiles, guildFileIds } from './expressions.ts';

/**
 * Segurança da conta e privacidade:
 * cabeçalhos de segurança, limites contra abuso, senha forte, verificação em duas etapas (TOTP),
 * códigos de recuperação, aparelhos conectados, "baixar meus dados" e "excluir minha conta".
 */

// ---------- cabeçalhos de segurança (valem para o site inteiro) ----------

/** vídeos e áudios dos anexos tocam direto do R2 (por link assinado que expira) */
const R2_ORIGIN = r2Configured() ? new URL(config.r2.endpoint).origin : '';

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const host = req.headers.host ?? '';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https:${R2_ORIGIN ? ` ${R2_ORIGIN}` : ''}`,
      `media-src 'self' blob: data:${R2_ORIGIN ? ` ${R2_ORIGIN}` : ''}`,
      `connect-src 'self' wss://${host} ws://${host}`,
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
  next();
}

// ---------- limites contra abuso (força bruta, spam) ----------

const buckets = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 60_000).unref();

/** Conta uma tentativa; passou de `max` dentro da janela, recusa com 429. */
export function limit(key: string, max: number, windowMs: number, message = 'Muitas tentativas. Aguarde um pouco e tente de novo.') {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  if (++b.count > max) throw new HttpError(429, message);
}
/** Já estourou o limite? (sem contar uma nova tentativa) */
export const limited = (key: string, max: number) => {
  const b = buckets.get(key);
  return !!b && b.reset > Date.now() && b.count >= max;
};
export const clearLimit = (key: string) => buckets.delete(key);

// ---------- senha ----------

const COMMON = new Set(
  `123456 1234567 12345678 123456789 1234567890 senha senha123 senha1234 minhasenha password password1 qwerty qwerty123 abc123
  111111 000000 123123 654321 abcdef abcd1234 iloveyou admin admin123 brasil brasil123 flamengo palmeiras corinthians
  saopaulo vasco gremio internacional cruzeiro santos 102030 112233 121212 gamer gamer123 valorant minecraft fortnite
  teste teste123 mudar123 trocar123 discord resenha resenha123 aaaaaa`.split(/\s+/),
);

export const passwordSchema = z
  .string()
  .min(8, 'A senha precisa de pelo menos 8 caracteres.')
  .max(200)
  .refine((p) => !COMMON.has(p.toLowerCase()), 'Essa senha é muito comum e fácil de adivinhar. Escolha outra.')
  .refine((p) => !/^(.)\1+$/.test(p) && !/^(0123456789|1234567890|abcdefgh)/i.test(p), 'Senha muito fácil de adivinhar.');

export function requireStrongPassword(password: string, username: string) {
  parse(passwordSchema, password);
  if (password.toLowerCase().includes(username.toLowerCase())) throw new HttpError(400, 'A senha não pode conter o seu nome de usuário.');
}

// ---------- verificação em duas etapas (TOTP, compatível com Google Authenticator, Authy etc.) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpAt(secret: string, step: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
/** Confere o código (tolera 30 s de diferença no relógio) e devolve o passo usado, ou null. */
function checkTotp(secret: string, code: string, lastStep: number): number | null {
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue; // o mesmo código não vale duas vezes
    const expected = totpAt(secret, step);
    if (code.length === 6 && timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

// ---------- códigos de recuperação (substituem o "esqueci a senha por e-mail") ----------

const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para não confundir
function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
async function saveRecoveryCodes(db: Db, userId: string) {
  const codes = newRecoveryCodes();
  await db.query('delete from recovery_codes where user_id = $1', [userId]);
  for (const c of codes) await db.query('insert into recovery_codes (user_id, code_hash) values ($1, $2)', [userId, sha256(normCode(c))]);
  return codes;
}
/** Usa um código de recuperação (cada um vale uma vez). */
async function useRecoveryCode(db: Db, userId: string, code: string) {
  const rows = await db.query(
    'update recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning 1',
    [userId, sha256(normCode(code))],
  );
  return rows.length > 0;
}

/**
 * Segunda etapa do login (ou de ações sensíveis): código do app autenticador OU código de recuperação.
 * Se a pessoa não ativou a verificação em duas etapas, não pede nada.
 */
export async function checkSecondFactor(db: Db, userId: string, code: unknown): Promise<'ok' | 'missing' | 'wrong'> {
  const [u] = await db.query<{ totp_enabled: boolean; totp_secret: string | null; totp_last_step: string }>(
    'select totp_enabled, totp_secret, totp_last_step from users where id = $1',
    [userId],
  );
  if (!u?.totp_enabled || !u.totp_secret) return 'ok';
  if (typeof code !== 'string' || !code.trim()) return 'missing';
  const c = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(c)) {
    const step = checkTotp(u.totp_secret, c, Number(u.totp_last_step));
    if (step === null) return 'wrong';
    await db.query('update users set totp_last_step = $2 where id = $1', [userId, step]);
    return 'ok';
  }
  return (await useRecoveryCode(db, userId, c)) ? 'ok' : 'wrong';
}

// ---------- rotas ----------

export function registerSecurityRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const passwordOf = async (userId: string) =>
    (await db.query<{ password_hash: string; username: string }>('select password_hash, username from users where id = $1', [userId]))[0];

  /** Ações sensíveis pedem a senha de novo (e o 2º fator, se estiver ativado). */
  async function confirmIdentity(userId: string, password: unknown, code?: unknown) {
    limit(`confirm:${userId}`, 8, 15 * 60_000);
    const u = await passwordOf(userId);
    if (typeof password !== 'string' || !u || !(await verifyPassword(password, u.password_hash))) throw new HttpError(403, 'Senha incorreta.');
    if (code !== undefined) {
      const second = await checkSecondFactor(db, userId, code);
      if (second === 'missing') throw new HttpError(403, 'Digite o código do app autenticador (ou um código de recuperação).');
      if (second === 'wrong') throw new HttpError(403, 'Código de verificação incorreto.');
    }
    return u;
  }

  // resumo da segurança da conta
  r.get(
    '/me/security',
    auth,
    wrap(async (req) => {
      const [u] = await db.query<{ totpEnabled: boolean; passwordChangedAt: string | null; createdAt: string; codesLeft: number }>(
        `select totp_enabled as "totpEnabled", password_changed_at as "passwordChangedAt", created_at as "createdAt",
           (select count(*)::int from recovery_codes c where c.user_id = u.id and c.used_at is null) as "codesLeft"
         from users u where id = $1`,
        [req.user!.id],
      );
      return u;
    }),
  );

  // aparelhos conectados
  r.get(
    '/me/sessions',
    auth,
    wrap(async (req) => {
      const rows = await db.query<{ token_hash: string; device: string; created_at: string; last_seen_at: string }>(
        `select token_hash, device, created_at, last_seen_at from sessions
         where user_id = $1 and last_seen_at > now() - interval '${SESSION_IDLE_DAYS} days' order by last_seen_at desc`,
        [req.user!.id],
      );
      return {
        sessions: rows.map((s) => ({
          id: s.token_hash.slice(0, 16),
          device: s.device || 'Aparelho',
          createdAt: s.created_at,
          lastSeenAt: s.last_seen_at,
          current: s.token_hash === req.sessionHash,
        })),
      };
    }),
  );

  r.delete(
    '/me/sessions/:id',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, 'Sessão inválida.');
      const rows = await db.query<{ token_hash: string }>(
        `delete from sessions where user_id = $1 and left(token_hash, 16) = $2 returning token_hash`,
        [req.user!.id, id],
      );
      rt.endSessions(rows.map((r) => r.token_hash));
    }),
  );

  r.post(
    '/me/sessions/logout-others',
    auth,
    wrap(async (req) => {
      const rows = await db.query<{ token_hash: string }>('delete from sessions where user_id = $1 and token_hash <> $2 returning token_hash', [
        req.user!.id,
        req.sessionHash,
      ]);
      rt.endSessions(rows.map((r) => r.token_hash));
      return { ended: rows.length };
    }),
  );

  // trocar a senha: desconecta os outros aparelhos
  r.post(
    '/me/password',
    auth,
    wrap(async (req) => {
      const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
      const u = await confirmIdentity(req.user!.id, body.current);
      requireStrongPassword(body.next, u.username);
      await db.query('update users set password_hash = $2, password_changed_at = now() where id = $1', [req.user!.id, await hashPassword(body.next)]);
      const rows = await db.query<{ token_hash: string }>('delete from sessions where user_id = $1 and token_hash <> $2 returning token_hash', [
        req.user!.id,
        req.sessionHash,
      ]);
      rt.endSessions(rows.map((r) => r.token_hash));
      return { endedOtherSessions: rows.length };
    }),
  );

  // códigos de recuperação: mostrados uma única vez
  r.post(
    '/me/recovery-codes',
    auth,
    wrap(async (req) => {
      await confirmIdentity(req.user!.id, req.body?.password);
      return { codes: await saveRecoveryCodes(db, req.user!.id) };
    }),
  );

  // verificação em duas etapas
  r.post(
    '/me/2fa/setup',
    auth,
    wrap(async (req) => {
      const u = await confirmIdentity(req.user!.id, req.body?.password);
      const secret = base32(randomBytes(20));
      await db.query('update users set totp_secret = $2, totp_enabled = false where id = $1 and not totp_enabled', [req.user!.id, secret]);
      const [check] = await db.query<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [req.user!.id]);
      if (check.totp_enabled) throw new HttpError(409, 'A verificação em duas etapas já está ativada.');
      const otpauth = `otpauth://totp/Resenha:${encodeURIComponent(u.username)}?secret=${secret}&issuer=Resenha&algorithm=SHA1&digits=6&period=30`;
      const qrSvg = await QRCode.toString(otpauth, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return { secret, otpauth, qrSvg };
    }),
  );

  r.post(
    '/me/2fa/enable',
    auth,
    wrap(async (req) => {
      const { code } = parse(z.object({ code: z.string().trim() }), req.body);
      const [u] = await db.query<{ totp_secret: string | null; totp_enabled: boolean }>('select totp_secret, totp_enabled from users where id = $1', [req.user!.id]);
      if (!u?.totp_secret) throw new HttpError(400, 'Comece pelo QR code.');
      if (u.totp_enabled) throw new HttpError(409, 'A verificação em duas etapas já está ativada.');
      const step = checkTotp(u.totp_secret, code.replace(/\s/g, ''), 0);
      if (step === null) throw new HttpError(400, 'Código incorreto. Confira se o relógio do celular está certo e tente o código novo.');
      await db.query('update users set totp_enabled = true, totp_last_step = $2 where id = $1', [req.user!.id, step]);
      // junto com o 2FA vêm códigos novos de recuperação (para não ficar trancado fora se perder o celular)
      return { codes: await saveRecoveryCodes(db, req.user!.id) };
    }),
  );

  r.post(
    '/me/2fa/disable',
    auth,
    wrap(async (req) => {
      await confirmIdentity(req.user!.id, req.body?.password, req.body?.code ?? '');
      await db.query('update users set totp_enabled = false, totp_secret = null, totp_last_step = 0 where id = $1', [req.user!.id]);
    }),
  );

  // "Esqueci minha senha": usuário + código de recuperação + senha nova
  r.post(
    '/auth/recover',
    wrap(async (req) => {
      limit(`recover:${req.ip}`, 6, 15 * 60_000);
      const body = parse(z.object({ username: z.string().trim().toLowerCase(), code: z.string().trim(), password: z.string() }), req.body);
      limit(`recover-user:${body.username}`, 6, 15 * 60_000);
      const [u] = await db.query<{ id: string; username: string; suspended_at: string | null }>('select id, username, suspended_at from users where username = $1', [body.username]);
      if (u?.suspended_at) throw new HttpError(403, 'Esta conta está suspensa por violar os Termos de uso.');
      // mesma resposta para usuário inexistente e código errado (não revela quem tem conta)
      if (!u || !(await useRecoveryCode(db, u.id, body.code))) throw new HttpError(400, 'Usuário ou código de recuperação incorreto.');
      requireStrongPassword(body.password, u.username);
      await db.query('update users set password_hash = $2, password_changed_at = now() where id = $1', [u.id, await hashPassword(body.password)]);
      const ended = await db.query<{ token_hash: string }>('delete from sessions where user_id = $1 returning token_hash', [u.id]);
      rt.endSessions(ended.map((r) => r.token_hash));
      const [left] = await db.query<{ n: number }>('select count(*)::int as n from recovery_codes where user_id = $1 and used_at is null', [u.id]);
      return { token: await createSession(db, u.id, req.headers['user-agent']), codesLeft: left.n };
    }),
  );

  // LGPD: baixar meus dados
  r.get(
    '/me/export',
    auth,
    wrap(async (req, res) => {
      limit(`export:${req.user!.id}`, 5, 60 * 60_000, 'Você já baixou seus dados várias vezes. Tente de novo mais tarde.');
      const id = req.user!.id;
      const [profile] = await db.query(
        `select id, username, display_name as "displayName", bio, pronouns, links, avatar_color as "avatarColor",
           status_text as "statusText", status_emoji as "statusEmoji", created_at as "createdAt",
           terms_accepted_at as "termsAcceptedAt", totp_enabled as "twoFactorEnabled"
         from users where id = $1`,
        [id],
      );
      const servers = await db.query(
        `select g.name, m.joined_at as "joinedAt", m.nick, g.owner_id = $1 as owner from members m join guilds g on g.id = m.guild_id where m.user_id = $1`,
        [id],
      );
      const friends = await db.query(
        `select u.username, f.status, f.created_at as "since" from friendships f
         join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
         where f.requester_id = $1 or f.addressee_id = $1`,
        [id],
      );
      const messages = await db.query(
        `select m.created_at as "sentAt", m.edited_at as "editedAt", m.content,
           case when c.type = 'dm' then 'Mensagem direta' else coalesce(g.name, '') || ' #' || c.name end as "where",
           (select count(*)::int from attachments a where a.message_id = m.id) as files
         from messages m join channels c on c.id = m.channel_id left join guilds g on g.id = c.guild_id
         where m.author_id = $1 order by m.created_at`,
        [id],
      );
      const files = await db.query(
        `select filename as name, kind, size, created_at as "sentAt" from attachments where uploader_id = $1 and message_id is not null order by created_at`,
        [id],
      );
      const sessions = await db.query(
        `select device, created_at as "createdAt", last_seen_at as "lastSeenAt" from sessions where user_id = $1`,
        [id],
      );
      const data = {
        about: 'Todos os dados que o Resenha guarda sobre você (LGPD, art. 18). Sua senha não aparece porque só guardamos uma versão embaralhada (hash) dela.',
        exportedAt: new Date().toISOString(),
        profile,
        servers,
        friends,
        messages,
        files,
        sessions,
      };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="resenha-meus-dados-${profile.username}.json"`);
      res.end(JSON.stringify(data, null, 2));
    }),
  );

  // LGPD: excluir minha conta (apaga tudo, inclusive os servidores de que a pessoa é dona)
  r.post(
    '/me/delete',
    auth,
    wrap(async (req) => {
      const body = parse(z.object({ password: z.string(), code: z.string().optional(), confirm: z.literal('EXCLUIR', { message: 'Digite EXCLUIR para confirmar.' }) }), req.body);
      const id = req.user!.id;
      await confirmIdentity(id, body.password, body.code ?? '');
      const owned = await db.query<{ id: string; icon_id: string | null; banner_id: string | null }>('select id, icon_id, banner_id from guilds where owner_id = $1', [id]);
      const memberOf = await db.query<{ guild_id: string; avatar_id: string | null }>('select guild_id, avatar_id from members where user_id = $1', [id]);
      const [u] = await db.query<{ avatar_id: string | null; banner_id: string | null }>('select avatar_id, banner_id from users where id = $1', [id]);
      const files: (string | null)[] = [u?.avatar_id, u?.banner_id, ...memberOf.map((m) => m.avatar_id)];
      for (const g of owned) {
        files.push(g.icon_id, g.banner_id, ...(await guildFileIds(db, g.id)));
        rt.emitGuild(g.id, 'guild:delete', { id: g.id });
        rt.guildDeleted(g.id);
        await db.query('delete from guilds where id = $1', [g.id]);
      }
      // apaga a conta: sessões, mensagens, reações, amizades e participação em servidores vão junto (cascade)
      await db.query('delete from users where id = $1', [id]);
      await deleteFiles(db, files);
      rt.endUser(id);
      for (const m of memberOf) if (!owned.some((g) => g.id === m.guild_id)) rt.guildChanged(m.guild_id);
      return { deletedServers: owned.length };
    }),
  );

  // limpeza de sessões vencidas
  const cleanup = () =>
    db.query(`delete from sessions where last_seen_at < now() - interval '${SESSION_IDLE_DAYS} days'`).catch(() => {});
  setTimeout(cleanup, 60_000);
  setInterval(cleanup, 6 * 3600_000).unref();
}

export const _test = { base32 };
