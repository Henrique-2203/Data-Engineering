import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { config } from './config.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import type { requireAuth } from './auth.ts';

/**
 * Etapa 3 da transmissão: servidor de mídia da Cloudflare (Realtime SFU). Quem transmite manda UMA cópia
 * (com 3 qualidades: simulcast) e a Cloudflare repassa para cada pessoa a qualidade que a internet dela
 * aguenta, sem pesar a internet de quem transmite. Só no laboratório (chave 'sfu'), até a equipe aprovar.
 *
 * O servidor do Resenha é um intermediário com regras (a chave da Cloudflare nunca vai para o navegador):
 * - cada sessão da Cloudflare tem dono: só quem criou mexe nela;
 * - só publica quem está numa call; só assiste quem está na MESMA call e pode ver aquela transmissão
 *   (mesma regra de "quem pode assistir" do P2P);
 * - limite de segurança do mês: a franquia grátis da Cloudflare (1.000 GB) é dividida com o TURN. Somando os
 *   dois, chegou em CLOUDFLARE_TURN_LIMIT_MB (padrão 500 GB): o SFU desliga até o mês virar e todo mundo
 *   volta para a transmissão direta (P2P), sem cobrança.
 * Formato da API: o mesmo da biblioteca oficial da Cloudflare (partytracks).
 */
interface SessionInfo {
  userId: string;
  createdAt: number;
  /** faixas publicadas nesta sessão (nome → tipo), para quem assiste poder puxar */
  published: Map<string, 'video' | 'audio'>;
}
const sessions = new Map<string, SessionInfo>();
const SESSION_TTL = 12 * 3600_000;
setInterval(() => {
  const old = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) if (s.createdAt < old) sessions.delete(id);
}, 600_000).unref();

export const sfuConfigured = () => !!(config.cloudflareSfu.appId && config.cloudflareSfu.appToken);

/** MB do mês que passaram pela Cloudflare (TURN + SFU), contados pelos aparelhos */
async function cloudflareMonthMb(db: Db) {
  const [{ month }] = await db.query<{ month: number }>(
    `select coalesce(sum(sum), 0)::float as month from call_health
     where metric in ('turn_mb', 'sfu_mb') and date_trunc('month', day) = date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)`,
  );
  return month;
}
let capCache: { at: number; over: boolean } | null = null;
async function overCap(db: Db) {
  if (capCache && Date.now() - capCache.at < 60_000) return capCache.over;
  const over = (await cloudflareMonthMb(db)) >= config.cloudflareTurn.limitMb;
  capCache = { at: Date.now(), over };
  return over;
}

async function cf<T>(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<T> {
  const { baseUrl, appId, appToken } = config.cloudflareSfu;
  const res = await fetch(`${baseUrl}/apps/${appId}/${path}`, {
    method,
    headers: { authorization: `Bearer ${appToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { errorCode?: string; errorDescription?: string };
  if (!res.ok || json.errorCode) {
    console.warn('[sfu]', method, path.replace(/sessions\/[^/]+/, 'sessions/…'), res.status, json.errorCode, json.errorDescription);
    throw new HttpError(502, 'O servidor de mídia não respondeu. A transmissão continua pelo jeito normal.');
  }
  return json;
}

const sdp = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(10).max(200_000) });
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function registerSfuRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const own = (req: { user?: { id: string } }, id: string) => {
    const s = sessions.get(id);
    if (!s || s.userId !== req.user!.id) throw new HttpError(404, 'Sessão não encontrada.');
    return s;
  };
  const inVoice = (userId: string) => {
    const v = rt.voiceOfUser(userId)[0];
    if (!v) throw new HttpError(403, 'Entre numa call primeiro.');
    return v;
  };

  /** o app pergunta se pode usar o servidor de mídia agora */
  r.get(
    '/sfu/status',
    auth,
    wrap(async () => ({ enabled: sfuConfigured() && !(await overCap(db)) })),
  );

  r.post(
    '/sfu/sessions',
    auth,
    wrap(async (req) => {
      if (!sfuConfigured() || (await overCap(db))) throw new HttpError(503, 'Servidor de mídia desligado.');
      limit(`sfu-session:${req.user!.id}`, 30, 60 * 60_000);
      inVoice(req.user!.id);
      const { sessionId } = await cf<{ sessionId: string }>('sessions/new', 'POST');
      if (!sessionId || !NAME.test(sessionId)) throw new HttpError(502, 'Resposta estranha do servidor de mídia.');
      sessions.set(sessionId, { userId: req.user!.id, createdAt: Date.now(), published: new Map() });
      return { sessionId, iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }] };
    }),
  );

  /** publicar a minha tela (vídeo em 3 qualidades + som): o nome das faixas é o servidor que dá */
  r.post(
    '/sfu/sessions/:id/publish',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      const s = own(req, id);
      inVoice(req.user!.id);
      limit(`sfu-pub:${req.user!.id}`, 60, 60 * 60_000);
      const b = parse(z.object({ sessionDescription: sdp, tracks: z.array(z.object({ mid: z.string().max(16), kind: z.enum(['video', 'audio']) })).min(1).max(2) }), req.body);
      const tracks = b.tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: `${t.kind}-${randomUUID()}`, kind: t.kind }));
      const out = await cf<{ sessionDescription: unknown; tracks: { mid?: string; trackName: string; errorCode?: string }[] }>(`sessions/${id}/tracks/new`, 'POST', {
        sessionDescription: b.sessionDescription,
        tracks: tracks.map(({ kind: _k, ...t }) => t),
      });
      for (const t of tracks) s.published.set(t.trackName, t.kind);
      return { sessionDescription: out.sessionDescription, tracks: tracks.map((t) => ({ mid: t.mid, trackName: t.trackName, kind: t.kind })) };
    }),
  );

  /** assistir: puxa as faixas da transmissão de alguém da mesma call (se a pessoa pode assistir) */
  r.post(
    '/sfu/sessions/:id/pull',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      own(req, id);
      const b = parse(
        z.object({
          remoteSessionId: z.string().regex(NAME),
          tracks: z.array(z.string().regex(NAME)).min(1).max(2),
          preferredRid: z.enum(['a', 'b', 'c']).optional(),
          /** true: deixa a Cloudflare trocar a qualidade sozinha conforme a internet de quem assiste */
          auto: z.boolean().optional(),
        }),
        req.body,
      );
      limit(`sfu-pull:${req.user!.id}`, 120, 60 * 60_000);
      const remote = sessions.get(b.remoteSessionId);
      if (!remote || !b.tracks.every((t) => remote.published.has(t))) throw new HttpError(404, 'Essa transmissão acabou.');
      const viewer = inVoice(req.user!.id);
      const streamer = rt.voiceOfUser(remote.userId).find((v) => v.channelId === viewer.channelId && v.screen);
      if (!streamer) throw new HttpError(403, 'Essa transmissão não está na sua call.');
      if (!(await rt.canWatch(streamer.socketId, req.user!.id))) throw new HttpError(403, 'Você não está entre quem pode assistir essa transmissão.');
      const out = await cf<{ sessionDescription?: unknown; requiresImmediateRenegotiation?: boolean; tracks: { mid?: string; trackName: string; sessionId?: string; errorCode?: string }[] }>(
        `sessions/${id}/tracks/new`,
        'POST',
        {
          tracks: b.tracks.map((trackName) => ({
            location: 'remote',
            sessionId: b.remoteSessionId,
            trackName,
            ...(remote.published.get(trackName) === 'video'
              ? { simulcast: { preferredRid: b.preferredRid ?? 'a', priorityOrdering: b.auto === false ? 'none' : 'asciibetical', ridNotAvailable: 'asciibetical' } }
              : {}),
          })),
        },
      );
      return { sessionDescription: out.sessionDescription, requiresImmediateRenegotiation: !!out.requiresImmediateRenegotiation, tracks: out.tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) };
    }),
  );

  r.put(
    '/sfu/sessions/:id/renegotiate',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      own(req, id);
      const b = parse(z.object({ sessionDescription: sdp }), req.body);
      return cf(`sessions/${id}/renegotiate`, 'PUT', b);
    }),
  );

  /** quem assiste trocou a qualidade (Auto / Original / 720p / 480p) */
  r.put(
    '/sfu/sessions/:id/quality',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      own(req, id);
      const b = parse(z.object({ mid: z.string().max(16), remoteSessionId: z.string().regex(NAME), trackName: z.string().regex(NAME), preferredRid: z.enum(['a', 'b', 'c']), auto: z.boolean() }), req.body);
      await cf(`sessions/${id}/tracks/update`, 'PUT', {
        tracks: [{ location: 'remote', mid: b.mid, sessionId: b.remoteSessionId, trackName: b.trackName, simulcast: { preferredRid: b.preferredRid, priorityOrdering: b.auto ? 'asciibetical' : 'none', ridNotAvailable: 'asciibetical' } }],
      });
      return { ok: true };
    }),
  );

  /** parou de transmitir / de assistir */
  r.put(
    '/sfu/sessions/:id/close',
    auth,
    wrap(async (req) => {
      const id = String(req.params.id);
      own(req, id);
      const b = parse(z.object({ sessionDescription: sdp.optional(), mids: z.array(z.string().max(16)).max(4) }), req.body);
      const out = await cf<{ sessionDescription?: unknown }>(`sessions/${id}/tracks/close`, 'PUT', {
        tracks: b.mids.map((mid) => ({ mid })),
        ...(b.sessionDescription ? { sessionDescription: b.sessionDescription } : {}),
        force: !b.sessionDescription,
      }).catch(() => ({ sessionDescription: undefined }));
      sessions.delete(id);
      return { sessionDescription: out.sessionDescription ?? null };
    }),
  );
}
