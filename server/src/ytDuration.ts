/**
 * Duração de um vídeo do YouTube (segundos), pela API oficial (videos.list, 1 ponto de cota).
 * Serve para o DJ avançar a fila sozinho quando ninguém está ouvindo (quem ouve avisa quando acaba;
 * se ninguém ouve, ninguém avisa). Sem a chave, ou se falhar, devolve null e o DJ só avança por quem ouve.
 */
const YT_API = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
const cache = new Map<string, number>();

/** "PT1H2M3S" -> segundos (0 para transmissão ao vivo "P0D") */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
  return d * 86_400 + h * 3600 + mi * 60 + s;
}

export async function youtubeDuration(videoId: string): Promise<number | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const hit = cache.get(videoId);
  if (hit !== undefined) return hit || null;
  try {
    const u = new URL(`${YT_API}/videos`);
    u.search = new URLSearchParams({ part: 'contentDetails', id: videoId, key }).toString();
    const res = await fetch(u, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: { contentDetails?: { duration?: string } }[] };
    const secs = parseIsoDuration(String(j.items?.[0]?.contentDetails?.duration ?? ''));
    if (cache.size > 500) cache.clear();
    cache.set(videoId, secs);
    return secs || null;
  } catch {
    return null;
  }
}
