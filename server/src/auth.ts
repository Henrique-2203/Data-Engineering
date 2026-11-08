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

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('insert into sessions (token_hash, user_id) values ($1, $2)', [sha256(token), userId]);
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
  if (typeof token !== 'string' || !token) return null;
  const rows = await db.query<PublicUser>(
    `select ${USER_COLUMNS} from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export function requireAuth(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await userFromToken(db, bearer(req));
      if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
