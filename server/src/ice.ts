import { config } from './config.ts';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const STUN: IceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

let cache: { servers: IceServer[]; expires: number } | null = null;

async function cloudflareServers(): Promise<IceServer[]> {
  const { keyId, apiToken } = config.cloudflareTurn;
  if (!keyId || !apiToken) return [];
  if (cache && cache.expires > Date.now()) return cache.servers;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers: IceServer | IceServer[] };
    const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    cache = { servers, expires: Date.now() + 12 * 3600_000 };
    return servers;
  } catch (err) {
    console.warn('[ice] falha ao gerar credenciais TURN da Cloudflare:', err);
    return [];
  }
}

export async function getIceServers(): Promise<IceServer[]> {
  const servers = [...STUN, ...(await cloudflareServers())];
  const { urls, username, credential } = config.turn;
  if (urls.length) servers.push({ urls, username, credential });
  return servers;
}
