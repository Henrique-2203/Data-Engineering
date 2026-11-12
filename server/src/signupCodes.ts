import { randomInt } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import { config } from './config.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import { isPlatformAdmin } from './reports.ts';
import type { requireAuth } from './auth.ts';

/**
 * Códigos de convite para criar conta. Cada pessoa pode ganhar o SEU código, com um limite de contas
 * (ex.: 5 amigos). Assim a equipe controla quantas contas entram e sabe quem trouxe quem.
 * O código geral antigo (variável REGISTRATION_CODE) continua valendo, sem limite, como mais um código
 * da lista — e pode ser desligado no painel sem mexer no Render.
 * O cadastro só pede código quando REGISTRATION_CODE existe (sem ela, o cadastro é aberto para todos).
 */

/** "galera 2026" -> "GALERA2026"; aceita letras, números e hífen */
export const normalizeCode = (raw: string | undefined | null) =>
  String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');

// sem letras e números que confundem (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPart = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export const registrationNeedsCode = () => !!config.registrationCode;

/** o código geral (REGISTRATION_CODE) vira uma linha da lista na primeira vez */
let generalReady: Promise<void> | null = null;
function ensureGeneral(db: Db) {
  if (!config.registrationCode) return Promise.resolve();
  generalReady ??= db
    .query(
      `insert into signup_codes (code, label, max_uses, is_general, created_by) values ($1, 'Código geral (REGISTRATION_CODE no Render)', null, true, 'sistema')
       on conflict (code) do nothing`,
      [normalizeCode(config.registrationCode)],
    )
    .then(() => undefined)
    .catch((err) => {
      generalReady = null;
      throw err;
    });
  return generalReady;
}

interface CodeRow {
  code: string;
  max_uses: number | null;
  uses: number;
  active: boolean;
}

/**
 * Confere o código digitado no cadastro (sem gastar um uso). Devolve o código normalizado, ou null
 * quando o cadastro está aberto. Erros contam para o limite de tentativas (evita adivinhar códigos).
 */
export async function checkSignupCode(db: Db, raw: string | undefined, ip: string): Promise<string | null> {
  if (!registrationNeedsCode()) return null;
  await ensureGeneral(db);
  const code = normalizeCode(raw);
  const fail = (msg: string): never => {
    limit(`signup-code:${ip}`, 15, 60 * 60_000, 'Muitos códigos errados. Tente de novo em uma hora.');
    throw new HttpError(403, msg);
  };
  if (!code) fail('Digite o código de convite.');
  const [row] = await db.query<CodeRow>('select code, max_uses, uses, active from signup_codes where code = $1', [code]);
  if (!row) return fail('Código de convite inválido. Confira com quem te convidou.');
  if (!row.active) return fail('Esse código de convite foi desativado. Peça um novo para quem te convidou.');
  if (row.max_uses !== null && row.uses >= row.max_uses) return fail('Esse código de convite já foi usado o máximo de vezes. Peça um novo para quem te convidou.');
  return row.code;
}

/** Gasta um uso do código na hora em que a conta nasce (atômico: dois cadastros ao mesmo tempo não passam do limite). */
export async function consumeSignupCode(db: Db, code: string | null) {
  if (!code) return;
  const [ok] = await db.query(
    `update signup_codes set uses = uses + 1 where code = $1 and active and (max_uses is null or uses < max_uses) returning code`,
    [code],
  );
  if (!ok) throw new HttpError(403, 'Esse código de convite chegou ao limite enquanto você se cadastrava. Peça um novo para quem te convidou.');
}

/** devolve o uso quando a conta acabou não sendo criada */
export async function releaseSignupCode(db: Db, code: string | null) {
  if (code) await db.query('update signup_codes set uses = greatest(0, uses - 1) where code = $1', [code]).catch(() => {});
}

export function registerSignupCodeRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>) {
  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };

  // ---------- equipe ----------
  r.get(
    '/admin/signup-codes',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      await ensureGeneral(db);
      const codes = await db.query(
        `select c.code, c.label, c.max_uses as "maxUses", c.uses, c.active, c.is_general as "isGeneral", c.created_at as "createdAt",
                o.username as owner, o.display_name as "ownerName",
                coalesce((select json_agg(json_build_object('username', u.username, 'displayName', u.display_name, 'createdAt', u.created_at) order by u.created_at desc)
                          from users u where u.signup_code = c.code), '[]') as "users"
         from signup_codes c left join users o on o.id = c.owner_id
         order by c.is_general, c.created_at desc`,
      );
      const [totals] = await db.query<{ withCode: number; total: number }>(
        `select count(*) filter (where signup_code is not null)::int as "withCode", count(*)::int as total from users`,
      );
      return { codes, totals, needsCode: registrationNeedsCode() };
    }),
  );

  r.post(
    '/admin/signup-codes',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const body = parse(
        z.object({
          label: z.string().trim().max(80).default(''),
          maxUses: z.number().int().min(1, 'O limite é de pelo menos 1 conta.').max(1000, 'Limite máximo: 1000 contas por código.'),
          owner: z.string().trim().toLowerCase().max(40).optional(),
          code: z.string().trim().max(24).optional(),
        }),
        req.body,
      );
      let ownerId: string | null = null;
      const ownerName = body.owner?.replace(/^@/, '');
      if (ownerName) {
        const [u] = await db.query<{ id: string }>('select id from users where username = $1', [ownerName]);
        if (!u) throw new HttpError(404, `Não achamos ninguém com o usuário @${ownerName}.`);
        ownerId = u.id;
      }
      let code = normalizeCode(body.code);
      if (body.code && !/^[A-Z0-9][A-Z0-9-]{3,23}$/.test(code)) throw new HttpError(400, 'O código precisa ter de 4 a 24 letras, números ou hífen.');
      if (!code) {
        // ex.: LARI-7K3P (com o nome de quem recebe, fica fácil de lembrar)
        const base = normalizeCode(ownerName || body.label).replace(/-/g, '').slice(0, 8) || 'RESENHA';
        for (let i = 0; i < 5 && !code; i++) {
          const c = `${base}-${randomPart(4)}`;
          if (!(await db.query('select 1 from signup_codes where code = $1', [c])).length) code = c;
        }
      }
      if ((await db.query('select 1 from signup_codes where code = $1', [code])).length) throw new HttpError(409, 'Já existe um código igual. Escolha outro.');
      await db.query(
        `insert into signup_codes (code, label, owner_id, max_uses, created_by) values ($1, $2, $3, $4, $5)`,
        [code, body.label, ownerId, body.maxUses, req.user!.username],
      );
      return { code };
    }),
  );

  r.patch(
    '/admin/signup-codes/:code',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const body = parse(
        z.object({
          label: z.string().trim().max(80).optional(),
          maxUses: z.number().int().min(1).max(1000).nullable().optional(),
          active: z.boolean().optional(),
        }),
        req.body,
      );
      const code = normalizeCode(String(req.params.code));
      const [row] = await db.query<{ is_general: boolean; uses: number }>('select is_general, uses from signup_codes where code = $1', [code]);
      if (!row) throw new HttpError(404, 'Código não encontrado.');
      if (body.maxUses === null && !row.is_general) throw new HttpError(400, 'Códigos pessoais precisam de um limite.');
      if (body.maxUses != null && body.maxUses < row.uses) throw new HttpError(400, `Esse código já criou ${row.uses} contas: o limite não pode ser menor que isso.`);
      await db.query(
        `update signup_codes set label = coalesce($2, label), max_uses = case when $3 then $4 else max_uses end, active = coalesce($5, active) where code = $1`,
        [code, body.label ?? null, body.maxUses !== undefined, body.maxUses ?? null, body.active ?? null],
      );
    }),
  );

  r.delete(
    '/admin/signup-codes/:code',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const code = normalizeCode(String(req.params.code));
      const [row] = await db.query<{ uses: number; is_general: boolean }>('select uses, is_general from signup_codes where code = $1', [code]);
      if (!row) throw new HttpError(404, 'Código não encontrado.');
      if (row.is_general) throw new HttpError(400, 'O código geral não pode ser apagado: desative ele (ou tire a variável REGISTRATION_CODE no Render).');
      if (row.uses > 0) throw new HttpError(400, 'Esse código já criou contas: desative em vez de apagar, para manter o histórico de quem trouxe quem.');
      await db.query('delete from signup_codes where code = $1', [code]);
    }),
  );

  // ---------- a própria pessoa: os códigos que ela pode compartilhar ----------
  r.get(
    '/me/invite-codes',
    auth,
    wrap(async (req) => {
      const codes = await db.query(
        `select code, max_uses as "maxUses", uses, active from signup_codes where owner_id = $1 order by created_at desc`,
        [req.user!.id],
      );
      return { codes };
    }),
  );
}
