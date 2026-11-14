import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import webpush from 'web-push';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { requireAuth } from './auth.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';

/**
 * Notificações no celular / com o site fechado (Web Push). O texto vai criptografado até o
 * aparelho: o serviço de push (Google, Mozilla, Apple, Microsoft) só entrega, não consegue ler.
 * As chaves VAPID são geradas uma vez e guardadas no banco (ou vêm de VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).
 */

// o servidor só manda requisições para serviços de push conhecidos (evita usar o Resenha para acessar outros endereços)
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export const allowedPushEndpoint = (endpoint: string) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
};

let keys: { publicKey: string; privateKey: string } | null = null;
/** em testes: guarda o que seria enviado em vez de mandar */
const testOutbox: { userId: string; payload: PushPayload }[] = [];

async function vapid(db: Db) {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const fresh = webpush.generateVAPIDKeys();
    await db.query('insert into server_secrets (name, value) values ($1, $2) on conflict (name) do nothing', ['vapid', JSON.stringify(fresh)]);
    const [row] = await db.query<{ value: string }>('select value from server_secrets where name = $1', ['vapid']);
    keys = JSON.parse(row.value);
  }
  const contact = process.env.VAPID_SUBJECT || `mailto:${process.env.PRIVACY_CONTACT || 'resenha.brasilgames@gmail.com'}`;
  webpush.setVapidDetails(contact, keys!.publicKey, keys!.privateKey);
  return keys!;
}

export interface PushPayload {
  title: string;
  body: string;
  channelId?: string | null;
  guildId?: string | null;
  tag?: string;
  kind?: 'test';
}

/**
 * Manda a notificação para os aparelhos inscritos destas pessoas.
 * `onlyAway`: pula quem está com o Resenha aberto e visível em algum aparelho (lá a página já avisa).
 */
export async function sendPush(db: Db, userIds: string[], payload: PushPayload, opts: { onlyAway?: { isActive(userId: string): boolean } } = {}) {
  const targets = [...new Set(userIds)].filter((id) => !opts.onlyAway?.isActive(id));
  if (!targets.length) return 0;
  const subs = await db.query<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>(
    'select id, user_id, endpoint, p256dh, auth from push_subscriptions where user_id = any($1)',
    [targets],
  );
  if (!subs.length) return 0;
  if (process.env.PUSH_TEST_OUTBOX === '1') {
    for (const s of subs) testOutbox.push({ userId: s.user_id, payload });
    return subs.length;
  }
  await vapid(db);
  const body = JSON.stringify({ ...payload, title: payload.title.slice(0, 120), body: payload.body.slice(0, 240) });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 6 * 3600, urgency: 'high', timeout: 10_000 });
        sent++;
        await db.query('update push_subscriptions set last_used_at = now(), failures = 0 where id = $1', [s.id]);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // inscrição cancelada no aparelho: apaga
        if (status === 404 || status === 410) await db.query('delete from push_subscriptions where id = $1', [s.id]);
        else await db.query('update push_subscriptions set failures = failures + 1 where id = $1', [s.id]);
      }
    }),
  );
  // aparelhos que falham sempre (sem internet há muito tempo, app desinstalado...)
  await db.query('delete from push_subscriptions where failures >= 20');
  return sent;
}

export function registerPushRoutes(r: Router, db: Db, auth: ReturnType<typeof requireAuth>) {
  r.get(
    '/push/key',
    auth,
    wrap(async () => ({ key: (await vapid(db)).publicKey })),
  );

  r.post(
    '/push/subscribe',
    auth,
    wrap(async (req) => {
      const uid = req.user!.id;
      limit(`push-sub:${uid}`, 20, 60 * 60_000);
      const body = parse(
        z.object({
          endpoint: z.string().url().max(1000),
          keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
        }),
        req.body,
      );
      if (!allowedPushEndpoint(body.endpoint)) throw new HttpError(400, 'Serviço de notificação não suportado.');
      const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from push_subscriptions where user_id = $1', [uid]);
      if (n >= 10) await db.query('delete from push_subscriptions where id = (select id from push_subscriptions where user_id = $1 order by last_used_at limit 1)', [uid]);
      // mesmo navegador com outra conta: a inscrição passa para quem está logado agora
      await db.query(
        `insert into push_subscriptions (id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)
         on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0, last_used_at = now()`,
        [randomUUID(), uid, body.endpoint, body.keys.p256dh, body.keys.auth],
      );
      return { ok: true };
    }),
  );

  r.post(
    '/push/unsubscribe',
    auth,
    wrap(async (req) => {
      const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
      await db.query('delete from push_subscriptions where endpoint = $1 and user_id = $2', [endpoint, req.user!.id]);
    }),
  );

  r.post(
    '/push/test',
    auth,
    wrap(async (req) => {
      limit(`push-test:${req.user!.id}`, 5, 10 * 60_000, 'Espere um pouco para testar de novo.');
      const sent = await sendPush(db, [req.user!.id], { title: 'Resenha', body: 'Notificações ligadas! É assim que elas vão aparecer.', kind: 'test', tag: 'test' });
      if (!sent) throw new HttpError(400, 'Nenhum aparelho recebeu. Desligue e ligue as notificações de novo.');
      return { sent };
    }),
  );

  if (process.env.PUSH_TEST_OUTBOX === '1') {
    r.get('/push/test-outbox', (_req, res) => {
      res.json({ items: testOutbox });
    });
  }
}
