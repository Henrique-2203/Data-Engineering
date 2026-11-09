import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.ts';
import type { PublicUser } from '../../shared/types.ts';
import { markActive } from './stats.ts';

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
  markActive(user.id);
  if (stale) void db.query('update sessions set last_seen_at = now() where token_hash = $1', [hash]).catch(() => {});
  return { user, sessionHash: hash };
}

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

// ---------- sessão em cookie protegido ----------
//
// O site guarda o login num cookie HttpOnly: scripts da página NÃO conseguem lê-lo (nem um script
// malicioso, se um dia algum entrar), Secure (só HTTPS) e SameSite=Lax (outros sites não conseguem
// fazer ações em seu nome). Com HTTPS, usa o prefixo __Host-, que impede subdomínios de mexer nele.
// O cabeçalho "Authorization: Bearer" continua aceito para clientes sem navegador (testes, scripts).

const COOKIE_SECURE = '__Host-resenha_sid';
const COOKIE_DEV = 'resenha_sid';

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Token da sessão: do cabeçalho Bearer ou do cookie protegido. */
export function tokenFromHeaders(headers: { authorization?: string; cookie?: string }): string | null {
  const h = headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return readCookie(headers.cookie, COOKIE_SECURE) ?? readCookie(headers.cookie, COOKIE_DEV);
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  const secure = req.secure;
  // 400 dias é o máximo que os navegadores aceitam; quem expira de verdade é o servidor (60 dias sem uso)
  res.append('Set-Cookie', `${secure ? COOKIE_SECURE : COOKIE_DEV}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(req: Request, res: Response) {
  for (const name of [COOKIE_SECURE, COOKIE_DEV]) {
    res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${name === COOKIE_SECURE || req.secure ? '; Secure' : ''}`);
  }
}

/**
 * Cria a sessão e entrega no cookie. O token só volta no corpo da resposta para clientes sem navegador
 * (que não mandam "Origin"); o site nunca o vê, então não fica guardado em lugar nenhum que um script leia.
 */
export async function issueSession(db: Db, req: Request, res: Response, userId: string): Promise<{ token?: string }> {
  const token = await createSession(db, userId, req.headers['user-agent']);
  setSessionCookie(req, res, token);
  return req.headers.origin ? {} : { token };
}

/**
 * Proteção contra "CSRF" (outro site tentando agir em seu nome): pedidos que mudam algo
 * só são aceitos se vierem do próprio Resenha.
 */
export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Pedido recusado (origem desconhecida).' });
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Pedido recusado (origem desconhecida).' });
    } catch {
      return res.status(403).json({ error: 'Pedido recusado (origem desconhecida).' });
    }
  } else if (origin === 'null') {
    return res.status(403).json({ error: 'Pedido recusado (origem desconhecida).' });
  }
  next();
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
      const s = await sessionFromToken(db, tokenFromHeaders(req.headers));
      if (!s) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      req.user = s.user;
      req.sessionHash = s.sessionHash;
      next();
    } catch (err) {
      next(err);
    }
  };
}
