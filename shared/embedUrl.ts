/** Links que viram player no Resenha (o mesmo código roda no site e no servidor). */
export type EmbedProvider = 'youtube' | 'spotify';

/** Reconhece links do YouTube e do Spotify (o mesmo código roda no site). */
export function parseEmbedUrl(raw: string): { provider: EmbedProvider; id: string; start?: number } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  const start = t ? Number(/^(\d+)s?$/.exec(t)?.[1] ?? 0) || undefined : undefined;
  const ytId = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const id = u.pathname === '/watch' ? ytId(u.searchParams.get('v')) : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? ytId(parts[1]) : null;
    return id ? { provider: 'youtube', id, start } : null;
  }
  if (host === 'youtu.be') {
    const id = ytId(u.pathname.slice(1).split('/')[0]);
    return id ? { provider: 'youtube', id, start } : null;
  }
  if (host === 'open.spotify.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    // /intl-pt/track/ID ou /track/ID
    if (parts[0]?.startsWith('intl-')) parts.shift();
    const [type, id] = parts;
    if (['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(type) && /^[A-Za-z0-9]{10,40}$/.test(id ?? '')) {
      return { provider: 'spotify', id: `${type}/${id}` };
    }
  }
  return null;
}


/** Todos os links do texto que viram player (no máximo `max`, sem repetir). */
export function findEmbedUrls(text: string, max = 2): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const p = parseEmbedUrl(m[0]);
    if (!p || seen.has(p.provider + p.id)) continue;
    seen.add(p.provider + p.id);
    out.push(m[0]);
    if (out.length >= max) break;
  }
  return out;
}
