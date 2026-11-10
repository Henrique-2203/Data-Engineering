import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { config } from './config.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import { userJson, type requireAuth } from './auth.ts';
import { alertUser } from './account.ts';
import { sendPush } from './push.ts';
import { isPlatformAdmin } from './reports.ts';
import type { SupportCategory, SupportTicket } from '../../shared/types.ts';

/**
 * Suporte: a pessoa abre um chamado pelo app (Configurações → Suporte ou o botão "?") e a equipe
 * (PLATFORM_ADMINS) responde pelo Painel da equipe. Quem abriu é avisado da resposta no app, no
 * celular (se ligou as notificações) e por e-mail (se tem e-mail confirmado).
 */
const CATEGORIES = ['bug', 'call', 'account', 'question', 'idea', 'other'] as const satisfies readonly SupportCategory[];

const TICKET_SELECT = `select t.id, t.category, t.subject, t.status, t.created_at as "createdAt", t.updated_at as "updatedAt",
    t.user_unread as "unread", ${userJson('u')} as user, t.diagnostics,
    coalesce((select json_agg(json_build_object('id', m.id, 'fromTeam', m.from_team, 'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from support_messages m where m.ticket_id = t.id), '[]'::json) as messages
  from support_tickets t join users u on u.id = t.user_id`;

export function registerSupportRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };
  const notifyAdmins = async () => {
    if (!config.platformAdmins.length) return;
    const admins = await db.query<{ id: string }>('select id from users where username = any($1)', [config.platformAdmins]);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from support_tickets where status = 'open'");
    for (const a of admins) rt.emitUser(a.id, 'support:count', { open: n });
  };
  const ticket = async (id: string) => (await db.query<SupportTicket>(`${TICKET_SELECT} where t.id = $1`, [id]))[0];
  const body = z.string().trim().min(3, 'Escreva um pouco mais.').max(4000, 'Mensagem muito longa (até 4000 letras).');

  // ---------- quem pede ajuda ----------
  r.get(
    '/support',
    auth,
    wrap(async (req) => ({
      tickets: await db.query<SupportTicket>(`${TICKET_SELECT} where t.user_id = $1 order by t.updated_at desc limit 50`, [req.user!.id]),
    })),
  );

  r.post(
    '/support',
    auth,
    wrap(async (req) => {
      const uid = req.user!.id;
      limit(`support:${uid}`, 5, 24 * 60 * 60_000, 'Você já abriu vários chamados hoje. Responda num chamado aberto ou tente amanhã.');
      const b = parse(
        z.object({
          category: z.enum(CATEGORIES),
          subject: z.string().trim().min(3, 'Dê um título curto.').max(100, 'Título muito longo.'),
          message: body,
          // informações técnicas que a pessoa aceitou mandar (navegador, versão do app)
          device: z.string().max(300).optional(),
          // "Relatar problema da call": só números (a pessoa vê tudo antes de mandar)
          diagnostics: z.record(z.string(), z.unknown()).optional(),
        }),
        req.body,
      );
      const diagnostics = b.diagnostics ? JSON.stringify(b.diagnostics) : null;
      if (diagnostics && diagnostics.length > 64_000) throw new HttpError(413, 'Diagnóstico grande demais.');
      const id = randomUUID();
      await db.query('insert into support_tickets (id, user_id, category, subject, diagnostics) values ($1, $2, $3, $4, $5)', [
        id,
        uid,
        b.category,
        b.subject,
        diagnostics,
      ]);
      const text = b.device ? `${b.message}\n\n— Aparelho: ${b.device}` : b.message;
      await db.query('insert into support_messages (id, ticket_id, from_team, body) values ($1, $2, false, $3)', [randomUUID(), id, text]);
      await notifyAdmins();
      return { ticket: await ticket(id) };
    }),
  );

  r.post(
    '/support/:id/messages',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      limit(`support-msg:${me.id}`, 30, 60 * 60_000, 'Muitas mensagens seguidas. Espere um pouco.');
      const t = await ticket(String(req.params.id));
      const admin = isPlatformAdmin(me.username);
      if (!t || (t.user.id !== me.id && !admin)) throw new HttpError(404, 'Chamado não encontrado.');
      const { message } = parse(z.object({ message: body }), req.body);
      const fromTeam = admin && t.user.id !== me.id;
      await db.query('insert into support_messages (id, ticket_id, from_team, body) values ($1, $2, $3, $4)', [randomUUID(), t.id, fromTeam, message]);
      await db.query(
        `update support_tickets set updated_at = now(), status = $2, user_unread = $3 where id = $1`,
        [t.id, fromTeam ? 'answered' : 'open', fromTeam],
      );
      if (fromTeam) {
        rt.emitUser(t.user.id, 'support:update', { id: t.id });
        await sendPush(db, [t.user.id], { title: 'Suporte do Resenha respondeu', body: t.subject, tag: `support:${t.id}` }, { onlyAway: rt });
        await alertUser(db, t.user.id, 'O suporte do Resenha respondeu', [
          `A equipe respondeu o seu chamado "${t.subject}".`,
          'Abra o Resenha e vá em Configurações → Suporte para ler e responder.',
        ], '');
      }
      await notifyAdmins();
      return { ticket: await ticket(t.id) };
    }),
  );

  /** A pessoa leu a resposta (tira o aviso de "nova resposta"). */
  r.post(
    '/support/:id/read',
    auth,
    wrap(async (req) => {
      await db.query('update support_tickets set user_unread = false where id = $1 and user_id = $2', [String(req.params.id), req.user!.id]);
    }),
  );

  r.post(
    '/support/:id/close',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      const t = await ticket(String(req.params.id));
      if (!t || (t.user.id !== me.id && !isPlatformAdmin(me.username))) throw new HttpError(404, 'Chamado não encontrado.');
      await db.query("update support_tickets set status = 'closed', updated_at = now() where id = $1", [t.id]);
      await notifyAdmins();
      return { ticket: await ticket(t.id) };
    }),
  );

  // ---------- equipe ----------
  r.get(
    '/admin/support',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const { status } = parse(z.object({ status: z.enum(['open', 'answered', 'closed']).default('open') }), req.query);
      return {
        tickets: await db.query<SupportTicket>(`${TICKET_SELECT} where t.status = $1 order by t.updated_at ${status === 'open' ? 'asc' : 'desc'} limit 100`, [
          status,
        ]),
      };
    }),
  );

  r.get(
    '/admin/support/count',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from support_tickets where status = 'open'");
      return { open: n };
    }),
  );
}
