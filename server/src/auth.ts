import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { ScryptOptions } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.ts';
import type { PublicUser } from '../../shared/types.ts';
import { markActive } from './stats.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: ScryptOptions) => Promise<Buffer>;

/**
 * Senhas com scrypt (aprovado pela OWASP) nos parâmetros recomendados: N=2^16, r=8, p=1 (~64 MB e ~100 ms por conta).
 * Formato novo: scrypt$N$r$p$sal$hash. As contas antigas (scrypt$sal$hash, N=2^14) continuam entrando e são
 * regravadas no formato novo no primeiro login certo. No máximo 2 cálculos ao mesmo tempo: protege a memória do servidor.
 */
const SCRYPT = { N: 1 << 16, r: 8, p: 1 };
const LEGACY = { N: 1 << 14, r: 8, p: 1 };
const MAXMEM = 160 * 1024 * 1024;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((ok) => waiting.push(ok));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
const derive = (password: string, salt: Buffer, len: number, p: { N: number; r: number; p: number }) => slot(() => scryptAsync(password, salt, len, { ...p, maxmem: MAXMEM }));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parseHash(stored: string) {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { params: LEGACY, salt: parts[1], hash: parts[2], legacy: true };
  if (parts.length === 6) {
    const [N, r, p] = parts.slice(1, 4).map(Number);
    if (!(N >= 1 << 14 && N <= 1 << 18 && r >= 1 && r <= 16 && p >= 1 && p <= 4)) return null; // não confia em parâmetros absurdos
    return { params: { N, r, p }, salt: parts[4], hash: parts[5], legacy: false };
  }
  return null;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const h = parseHash(stored);
  if (!h || !h.salt || !h.hash) return false;
  const expected = Buffer.from(h.hash, 'base64');
  const actual = await derive(password, Buffer.from(h.salt, 'base64'), expected.length, h.params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** o hash guardado é de um formato mais fraco que o atual (regravar no próximo login certo) */
export function needsRehash(stored: string): boolean {
  const h = parseHash(stored);
  return !h || h.legacy || h.params.N < SCRYPT.N || h.params.r < SCRYPT.r || h.params.p < SCRYPT.p;
}

let dummyHash: Promise<string> | null = null;
/** Gasta o MESMO tempo de uma conferência de senha quando o usuário não existe (ninguém descobre quem tem conta pelo tempo da resposta). */
export async function fakeVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('resenha-sem-conta');
  await verifyPassword(password, await dummyHash);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Sessão sem uso por mais que isso deixa de valer (precisa entrar de novo). */
export const SESSION_IDLE_DAYS = 60;
/** E mesmo usada todo dia, nenhuma sessão passa disso: depois, entrar de novo (SES-02: roubo de token não dura para sempre). */
export const SESSION_MAX_DAYS = 180;

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

/** Banner da call já resolvido: 'preset:<tema>' ou 'image:<id>' (ou null). */
const CALL_BANNER = (t: string) => `case ${t}.call_banner
    when 'profile' then case when ${t}.banner_id is null then null else 'image:' || ${t}.banner_id end
    when 'upload' then case when ${t}.call_banner_image is null then null else 'image:' || ${t}.call_banner_image end
    else ${t}.call_banner end`;

/**
 * Anel de Fundador: só sai do servidor para quem teve o apoio CONFIRMADO pela equipe (pendente,
 * recusado ou sem apoio = sem anel, mesmo que a coluna tenha valor). Sem escolha = Raiz.
 */
const FOUNDER_RING = (t: string) => `case when exists (select 1 from supporters fs where fs.user_id = ${t}.id and fs.status = 'confirmed')
    then nullif(coalesce(${t}.founder_ring, 'raiz'), 'none') else null end`;

export const USER_COLUMNS = `u.id, u.username, u.display_name as "displayName", u.avatar_color as "avatarColor",
  u.avatar_id as "avatarId", ${STATUS_JSON('u')} as status, ${CALL_BANNER('u')} as "callBanner", u.call_banner_pos as "callBannerPos", ${FOUNDER_RING('u')} as ring,
  u.is_bot as bot`;

/** Mesmo usuário público, como objeto JSON dentro de uma consulta (autor de mensagem etc.). */
export const userJson = (t: string) =>
  `json_build_object('id', ${t}.id, 'username', ${t}.username, 'displayName', ${t}.display_name,
    'avatarColor', ${t}.avatar_color, 'avatarId', ${t}.avatar_id, 'status', ${STATUS_JSON(t)},
    'callBanner', ${CALL_BANNER(t)}, 'callBannerPos', ${t}.call_banner_pos, 'ring', ${FOUNDER_RING(t)}, 'bot', ${t}.is_bot)`;

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
     where s.token_hash = $1 and s.last_seen_at > now() - interval '${SESSION_IDLE_DAYS} days' and s.created_at > now() - interval '${SESSION_MAX_DAYS} days' and not (u.suspended_at is not null and (u.suspended_until is null or u.suspended_until > now()))`,
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
