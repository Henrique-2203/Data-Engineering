import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.ts';
import type { PublicUser } from '../../shared/types.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Sessão sem uso por mais que isso deixa de valer (precisa entrar de novo). */
export const SESSION_IDLE_DAYS = 60;

/** "Chrome no Windows", "App Resenha no Windows", "Safari no iPhone"... (só para a lista de aparelhos) */
export function deviceLabel(ua: string | undefined): string {
  const u = ua ?? '';
  const os = /iPhone|iPad/.test(u) ? (/iPad/.test(u) ? 'iPad' : 'iPhone') : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  const app = /Electron|Resenha\//.test(u) ? 'App Resenha' : /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : u ? 'Navegador' : 'Aparelho';
  return os ? `${app} no ${os}` : app;
}

export async function createSession(db: Db, userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('insert into sessions (token_hash, user_id, device) values ($1, $2, $3)', [sha256(token), userId, deviceLabel(userAgent)]);
  return token;
}

export async function deleteSession(db: Db, token: string) {
  await db.query('delete from sessions where token_hash = $1', [sha256(token)]);
}

/** Status só vale se não expirou. */
const STATUS_JSON = (t: string) => `case when (${t}.status_text is not null or ${t}.status_emoji is not null)
    and (${t}.status_expires_at is null or ${t}.status_expires_at > now())
  then json_build_object('text', coalesce(${t}.status_text, ''), 'emoji', ${t}.status_emoji, 'expiresAt', ${t}.status_expires_at)
  else null end`;

export const USER_COLUMNS = `u.id, u.username, u.display_name as "displayName", u.avatar_color as "avatarColor",
  u.avatar_id as "avatarId", ${STATUS_JSON('u')} as status`;

/** Mesmo usuário público, como objeto JSON dentro de uma consulta (autor de mensagem etc.). */
export const userJson = (t: string) =>
  `json_build_object('id', ${t}.id, 'username', ${t}.username, 'displayName', ${t}.display_name,
    'avatarColor', ${t}.avatar_color, 'avatarId', ${t}.avatar_id, 'status', ${STATUS_JSON(t)})`;

export async function userFromToken(db: Db, token: unknown): Promise<PublicUser | null> {
  return (await sessionFromToken(db, token))?.user ?? null;
}

/** Usuário + sessão (expira depois de SESSION_IDLE_DAYS sem uso; o último acesso é anotado a cada 10 min). */
export async function sessionFromToken(db: Db, token: unknown): Promise<{ user: PublicUser; sessionHash: string } | null> {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  const hash = sha256(token);
  const rows = await db.query<PublicUser & { stale: boolean }>(
    `select ${USER_COLUMNS}, s.last_seen_at < now() - interval '10 minutes' as stale
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.last_seen_at > now() - interval '${SESSION_IDLE_DAYS} days' and u.suspended_at is null`,
    [hash],
  );
  if (!rows[0]) return null;
  const { stale, ...user } = rows[0];
  if (stale) void db.query('update sessions set last_seen_at = now() where token_hash = $1', [hash]).catch(() => {});
  return { user, sessionHash: hash };
}

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
      /** hash do token da sessão atual (para "sair dos outros aparelhos") */
      sessionHash?: string;
    }
  }
}

export function requireAuth(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const s = await sessionFromToken(db, bearer(req));
      if (!s) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      req.user = s.user;
      req.sessionHash = s.sessionHash;
      next();
    } catch (err) {
      next(err);
    }
  };
}
