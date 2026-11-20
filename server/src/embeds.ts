import type { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import type { requireAuth } from './auth.ts';
import { type EmbedProvider, parseEmbedUrl } from '../../shared/embedUrl.ts';

/**
 * Prévia de links do YouTube e do Spotify no chat (e títulos do "Assistir juntos").
 * O SERVIDOR busca o título e a miniatura: quem só abre o chat não manda o próprio IP para o Google
 * ou o Spotify. O player deles só carrega quando a pessoa clica.
 * Só fala com endereços fixos (sem acessar endereços que o usuário escolhe).
 */
export interface Embed {
  provider: EmbedProvider;
  /** youtube: id do vídeo (11 caracteres); spotify: "tipo/id" (track/abc, playlist/xyz...) */
  id: string;
  title: string | null;
  author: string | null;
  /** miniatura pelo nosso servidor */
  thumb: string | null;
  /** youtube: segundo inicial (?t=) */
  start?: number;
}

const YT_OEMBED = process.env.EMBED_YOUTUBE_OEMBED || 'https://www.youtube.com/oembed';
const SP_OEMBED = process.env.EMBED_SPOTIFY_OEMBED || 'https://open.spotify.com/oembed';
const YT_THUMB = process.env.EMBED_YOUTUBE_THUMB || 'https://i.ytimg.com/vi';
/** de onde a miniatura do Spotify pode vir (o oEmbed devolve uma destas) */
const SP_THUMB_HOSTS = (process.env.EMBED_SPOTIFY_THUMB_HOSTS || 'i.scdn.co,image-cdn-ak.spotifycdn.com,image-cdn-fa.spotifycdn.com,mosaic.scdn.co')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const cache = new Map<string, { at: number; embed: Embed }>();
const DAY = 24 * 3600_000;

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
}

export async function resolveEmbed(raw: string): Promise<Embed | null> {
  const p = parseEmbedUrl(raw);
  if (!p) return null;
  const key = `${p.provider}:${p.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return { ...hit.embed, start: p.start };
  let embed: Embed = { ...p, title: null, author: null, thumb: null };
  try {
    if (p.provider === 'youtube') {
      const j = await fetchJson(`${YT_OEMBED}?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${p.id}`)}`);
      embed = { ...embed, title: j.title?.slice(0, 200) ?? null, author: j.author_name?.slice(0, 100) ?? null };
    } else {
      const j = await fetchJson(`${SP_OEMBED}?url=${encodeURIComponent(`https://open.spotify.com/${p.id}`)}`);
      embed = { ...embed, title: j.title?.slice(0, 200) ?? null, author: null };
      if (j.thumbnail_url) {
        try {
          const t = new URL(j.thumbnail_url);
          if (t.protocol === 'https:' && SP_THUMB_HOSTS.includes(t.hostname)) embed.thumb = `/api/embed/thumb?sp=${encodeURIComponent(t.hostname + t.pathname)}`;
        } catch {
          /* sem miniatura */
        }
      }
    }
  } catch {
    // o serviço não respondeu: fica a prévia sem título (o player funciona igual)
  }
  if (p.provider === 'youtube') embed.thumb = `/api/embed/thumb?yt=${p.id}`;
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), embed });
  return { ...embed, start: p.start };
}

export function registerEmbedRoutes(r: Router, auth: ReturnType<typeof requireAuth>) {
  r.get(
    '/embed',
    auth,
    wrap(async (req) => {
      limit(`embed:${req.user!.id}`, 120, 60_000);
      const { url } = parse(z.object({ url: z.string().max(500) }), req.query);
      const embed = await resolveEmbed(url);
      if (!embed) throw new HttpError(404, 'Link não suportado.');
      return { embed };
    }),
  );

  // miniatura pelo nosso servidor (endereços fixos do YouTube e do Spotify)
  r.get('/embed/thumb', auth, async (req, res, next) => {
    try {
      const yt = typeof req.query.yt === 'string' ? req.query.yt : null;
      const sp = typeof req.query.sp === 'string' ? req.query.sp : null;
      let url: string | null = null;
      if (yt && /^[A-Za-z0-9_-]{11}$/.test(yt)) url = `${YT_THUMB}/${yt}/hqdefault.jpg`;
      if (sp) {
        const [host, ...rest] = sp.split('/');
        if (SP_THUMB_HOSTS.includes(host) && /^[A-Za-z0-9/_.-]{1,200}$/.test(rest.join('/'))) url = `https://${host}/${rest.join('/')}`;
      }
      if (!url) return res.status(404).end();
      const up = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      const type = up?.headers.get('content-type') ?? '';
      if (!up?.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return res.status(404).end();
      const buf = Buffer.from(await up.arrayBuffer());
      if (buf.length > 2 * 1024 * 1024) return res.status(404).end();
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.end(buf);
    } catch (err) {
      next(err);
    }
  });
}
