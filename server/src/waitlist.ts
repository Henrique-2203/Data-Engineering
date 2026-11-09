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
      if (existing) return { position: existing.position, already: true };
      await db.query(
        `insert into waitlist (id, name, email, whatsapp, platforms, source, consent_at) values ($1, $2, $3, $4, $5, $6, now())`,
        [randomUUID(), body.name, body.email, body.whatsapp || null, body.platforms, body.source ?? null],
      );
      bump('waitlist', body.source ?? 'nao_informado');
      const [{ position }] = await db.query<{ position: number }>('select count(*)::int as position from waitlist');
      return { position, already: false };
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
      const rows = await db.query<{ id: string; name: string; email: string; whatsapp: string | null; platforms: string[]; source: string | null; createdAt: string; invitedAt: string | null }>(
        `select id, name, email, whatsapp, platforms, source, created_at as "createdAt", invited_at as "invitedAt" from waitlist order by created_at`,
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
      return { entries: rows };
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
