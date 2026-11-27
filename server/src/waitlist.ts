import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import { isPlatformAdmin } from './reports.ts';
import { bump } from './stats.ts';
import type { requireAuth } from './auth.ts';
import { config } from './config.ts';
import { emailEnabled, maskEmail, sendEmail } from './email.ts';
import { createSignupCode, normalizeCode } from './signupCodes.ts';

/**
 * Lista de espera (página inicial): nome, e-mail, WhatsApp opcional e plataformas.
 * Os dados só servem para mandar o acesso e novidades do Resenha (consentimento LGPD).
 * Também: link de download direto do instalador mais recente do Windows.
 */

const PLATFORMS = ['windows', 'android', 'iphone', 'navegador'] as const;
const SOURCES = ['instagram', 'tiktok', 'youtube', 'amigo', 'outro'] as const;
const REPO = 'Henrique-2203/Data-Engineering';

export function registerWaitlistRoutes(r: Router, db: Db, _rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  r.post(
    '/waitlist',
    wrap(async (req) => {
      limit(`waitlist:${req.ip}`, 20, 60 * 60_000, 'Muitas inscrições deste aparelho. Tente de novo mais tarde.');
      const body = parse(
        z.object({
          name: z.string().trim().min(2, 'Diga seu nome.').max(60, 'Nome muito longo.'),
          email: z.string().trim().toLowerCase().max(120).email('Confira o e-mail.'),
          whatsapp: z
            .string()
            .trim()
            .max(30)
            .transform((v) => v.replace(/[^\d+]/g, ''))
            .refine((v) => !v || /^\+?\d{10,14}$/.test(v), 'WhatsApp inválido. Use DDD + número.')
            .default(''),
          platforms: z.array(z.enum(PLATFORMS)).min(1, 'Escolha pelo menos uma plataforma.').max(4),
          source: z.enum(SOURCES).optional(),
          consent: z.literal(true, { message: 'Para entrar na lista, aceite receber o convite e as novidades.' }),
          website: z.string().max(0).optional(), // armadilha para robôs (campo invisível)
        }),
        req.body,
      );
      const [existing] = await db.query<{ position: number }>(
        `select (select count(*)::int from waitlist w2 where w2.created_at <= w.created_at) as position from waitlist w where email = $1`,
        [body.email],
      );
      if (existing) {
        // já estava na lista: se ainda não recebeu convite e o automático está ligado, manda agora
        const [w] = await db.query<{ id: string; invite_code: string | null }>('select id, invite_code from waitlist where email = $1', [body.email]);
        const invited = !w.invite_code && (await autoInvite(db, w.id, body.email));
        return { position: existing.position, already: true, invited };
      }
      const id = randomUUID();
      await db.query(
        `insert into waitlist (id, name, email, whatsapp, platforms, source, consent_at) values ($1, $2, $3, $4, $5, $6, now())`,
        [id, body.name, body.email, body.whatsapp || null, body.platforms, body.source ?? null],
      );
      bump('waitlist', body.source ?? 'nao_informado');
      const [{ position }] = await db.query<{ position: number }>('select count(*)::int as position from waitlist');
      const invited = await autoInvite(db, id, body.email);
      return { position, already: false, invited };
    }),
  );

  // sair da lista (direito LGPD): basta o e-mail
  r.post(
    '/waitlist/remove',
    wrap(async (req) => {
      limit(`waitlist-rm:${req.ip}`, 10, 60 * 60_000);
      const { email } = parse(z.object({ email: z.string().trim().toLowerCase().max(120) }), req.body);
      await db.query('delete from waitlist where email = $1', [email]);
      return { ok: true };
    }),
  );

  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };

  r.get(
    '/admin/waitlist',
    auth,
    wrap(async (req, res) => {
      requireAdmin(req.user!.username);
      const rows = await db.query<{ id: string; name: string; email: string; whatsapp: string | null; platforms: string[]; source: string | null; createdAt: string; invitedAt: string | null; inviteCode: string | null; invitedBy: string | null; codeUses: number | null; codeMax: number | null; joined: string | null }>(
        `select w.id, w.name, w.email, w.whatsapp, w.platforms, w.source, w.created_at as "createdAt", w.invited_at as "invitedAt",
                w.invite_code as "inviteCode", w.invited_by as "invitedBy", c.uses as "codeUses", c.max_uses as "codeMax", o.username as joined
         from waitlist w left join signup_codes c on c.code = w.invite_code left join users o on o.id = c.owner_id
         order by w.created_at`,
      );
      if (req.query.format === 'csv') {
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [
          'posicao;nome;email;whatsapp;plataformas;origem;inscrito_em;convidado_em',
          ...rows.map((r, i) =>
            [i + 1, r.name, r.email, r.whatsapp, r.platforms.join(', '), r.source, new Date(r.createdAt).toLocaleString('pt-BR'), r.invitedAt ? new Date(r.invitedAt).toLocaleString('pt-BR') : '']
              .map(esc)
              .join(';'),
          ),
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="resenha-lista-de-espera.csv"');
        res.end('﻿' + lines.join('\r\n'));
        return;
      }
      return { entries: rows, emailEnabled: emailEnabled() };
    }),
  );

  r.post(
    '/admin/waitlist/:id/invited',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const { invited } = parse(z.object({ invited: z.boolean() }), req.body);
      await db.query('update waitlist set invited_at = case when $2 then now() else null end where id = $1', [String(req.params.id), invited]);
    }),
  );

  /**
   * Convite pela lista de espera: cria um código (escolhido ou gerado com o nome da pessoa) com o limite
   * dado e manda por e-mail. De novo na mesma pessoa = reenvia o mesmo código (e pode aumentar o limite).
   * Quando ela cria a conta com o código, ele passa a ser dela ("Seus convites" e ranking).
   */
  r.post(
    '/admin/waitlist/:id/invite',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const body = parse(
        z.object({
          code: z.string().trim().max(24).optional(),
          maxUses: z.number().int().min(1, 'O limite é de pelo menos 1 conta.').max(1000).default(1),
        }),
        req.body,
      );
      return inviteEntry(db, String(req.params.id), { code: body.code, maxUses: body.maxUses, by: req.user!.username });
    }),
  );

  // ---------- convite automático (para a lista andar sozinha, mesmo de madrugada) ----------
  r.get(
    '/admin/waitlist/auto',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      return { ...(await getAuto(db)), today: await autoToday(db), emailEnabled: emailEnabled() };
    }),
  );
  r.put(
    '/admin/waitlist/auto',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const body = parse(
        z.object({
          enabled: z.boolean(),
          maxUses: z.number().int().min(1).max(50),
          dailyCap: z.number().int().min(1).max(250),
        }),
        req.body,
      );
      if (body.enabled && !emailEnabled()) throw new HttpError(400, 'O envio de e-mails está desligado no servidor: ligue o e-mail (Brevo) antes do convite automático.');
      await db.query(
        `insert into app_settings (name, value, updated_at) values ('waitlist_auto', $1, now())
         on conflict (name) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify(body)],
      );
      return { ...body, today: await autoToday(db), emailEnabled: emailEnabled() };
    }),
  );

  r.delete(
    '/admin/waitlist/:id',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      await db.query('delete from waitlist where id = $1', [String(req.params.id)]);
    }),
  );

  // ---------- download direto do instalador do Windows (versão mais recente) ----------
  let cache: { url: string; version: string; at: number } | null = null;
  async function latestWindows() {
    if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'resenha-server' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const rel = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
      const exe = rel.assets.find((a) => /\.exe$/i.test(a.name));
      if (!exe) throw new Error('sem .exe');
      cache = { url: exe.browser_download_url, version: rel.tag_name.replace(/^v/, ''), at: Date.now() };
    } catch {
      cache = { url: `https://github.com/${REPO}/releases/latest`, version: '', at: Date.now() - 9 * 60_000 }; // tenta de novo em 1 min
    }
    return cache;
  }
  r.get(
    '/download/windows',
    wrap(async (_req, res) => {
      bump('download_windows');
      res.redirect(302, (await latestWindows()).url);
    }),
  );
  r.get(
    '/download/info',
    wrap(async () => {
      const w = await latestWindows();
      return { windowsVersion: w.version };
    }),
  );
}

/**
 * Convite de uma inscrição: cria um código (escolhido ou gerado com o nome da pessoa) com o limite
 * dado e manda por e-mail. De novo na mesma pessoa = reenvia o mesmo código (e pode aumentar o limite).
 * Quando ela cria a conta com o código, ele passa a ser dela ("Seus convites" e ranking).
 */
export async function inviteEntry(db: Db, id: string, opts: { code?: string; maxUses: number; by: string }) {
  const [w] = await db.query<{ name: string; email: string; invite_code: string | null }>('select name, email, invite_code from waitlist where id = $1', [id]);
  if (!w) throw new HttpError(404, 'Inscrição não encontrada.');
  const first = w.name.trim().split(/\s+/)[0];
  let code = w.invite_code;
  const [existing] = code ? await db.query<{ uses: number; max_uses: number | null }>('select uses, max_uses from signup_codes where code = $1', [code]) : [];
  if (existing) {
    if (opts.code && normalizeCode(opts.code) !== code) throw new HttpError(400, `Essa pessoa já recebeu o código ${code}. Use "Reenviar" ou desative ele na aba Convites.`);
    if (existing.max_uses !== null && opts.maxUses > existing.max_uses) await db.query('update signup_codes set max_uses = $2 where code = $1', [code, opts.maxUses]);
  } else {
    code = await createSignupCode(db, { code: opts.code, base: first, label: `Lista de espera: ${w.name}`, maxUses: opts.maxUses, createdBy: opts.by, waitlistId: id });
    await db.query('update waitlist set invite_code = $2 where id = $1', [id, code]);
  }
  const [c] = await db.query<{ max_uses: number | null }>('select max_uses from signup_codes where code = $1', [code]);
  const max = c?.max_uses ?? opts.maxUses;
  const extra = max - 1;
  const emailed = await sendEmail({
    to: w.email,
    subject: 'Seu convite para o Resenha chegou! 🎉',
    lines: [
      `Oi, ${first}! Você entrou na lista de espera do Resenha e agora chegou a sua vez.`,
      'Este é o seu código de convite. Toque em "Criar sua conta" logo abaixo: o código já vai preenchido. (No app do Windows, é só escolher "Criar conta" e digitar o código.)',
      ...(extra > 0
        ? [`Ele vale para ${max} contas: a sua e mais ${extra} ${extra === 1 ? 'amigo' : 'amigos'}. Depois de entrar, você encontra o código em Configurações → Minha conta → "Seus convites".`]
        : []),
    ],
    code: code!,
    button: { label: 'Criar sua conta', url: `${config.officialUrl.replace(/\/$/, '')}/app?convite=${encodeURIComponent(code!)}` },
    warning: 'O Resenha nunca pede sua senha por e-mail. Não estava esperando este convite? É só ignorar.',
  });
  if (emailed) await db.query('update waitlist set invited_at = now(), invited_by = $2 where id = $1', [id, opts.by]);
  return { code, emailed, sentTo: maskEmail(w.email) };
}

const AUTO_DEFAULT = { enabled: false, maxUses: 3, dailyCap: 60 };
export async function getAuto(db: Db): Promise<typeof AUTO_DEFAULT> {
  const [row] = await db.query<{ value: typeof AUTO_DEFAULT }>(`select value from app_settings where name = 'waitlist_auto'`);
  return { ...AUTO_DEFAULT, ...(row?.value ?? {}) };
}
/** convites automáticos mandados hoje (horário de Brasília) */
async function autoToday(db: Db) {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::int as n from waitlist where invited_by = 'automático' and (invited_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date`,
  );
  return r?.n ?? 0;
}
/**
 * Logo depois da inscrição: se o convite automático estiver ligado, manda o código na hora. Respeita
 * o teto do dia (a Brevo grátis manda 300 e-mails/dia e cada pessoa nova gasta 2: o convite e o
 * código do cadastro). Quem já tem conta com esse e-mail não recebe. Passou do teto = fica na lista.
 */
async function autoInvite(db: Db, id: string, email: string): Promise<boolean> {
  const auto = await getAuto(db);
  if (!auto.enabled || !emailEnabled()) return false;
  if ((await db.query('select 1 from users where lower(email) = $1', [email])).length) return false;
  if ((await autoToday(db)) >= auto.dailyCap) return false;
  try {
    const r = await inviteEntry(db, id, { maxUses: auto.maxUses, by: 'automático' });
    return r.emailed;
  } catch (err) {
    console.warn('[lista] convite automático falhou', (err as Error).message);
    return false;
  }
}
