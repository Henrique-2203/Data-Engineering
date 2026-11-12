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
let meteredCache: { servers: IceServer[]; expires: number } | null = null;

/** Metered (https://www.metered.ca/stun-turn): plano grátis sem cartão. */
async function meteredServers(): Promise<IceServer[]> {
  const { domain, apiKey } = config.meteredTurn;
  if (!domain || !apiKey) return [];
  if (meteredCache && meteredCache.expires > Date.now()) return meteredCache.servers;
  // aceita "resenha", "resenha.metered.live" ou "https://resenha.metered.live"
  const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const fullHost = host.includes('.') ? host : `${host}.metered.live`;
  try {
    const res = await fetch(`https://${fullHost}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as IceServer[] | { iceServers: IceServer[] };
    const servers = Array.isArray(body) ? body : body.iceServers;
    // só os servidores TURN (STUN já temos)
    const turn = servers.filter((s) => [s.urls].flat().some((u) => u.startsWith('turn')));
    meteredCache = { servers: turn, expires: Date.now() + 3600_000 };
    return turn;
  } catch (err) {
    console.warn('[ice] falha ao buscar credenciais TURN da Metered:', err);
    return [];
  }
}

async function cloudflareServers(): Promise<IceServer[]> {
  const { keyId, apiToken } = config.cloudflareTurn;
  if (!keyId || !apiToken) return [];
  if (cache && cache.expires > Date.now()) return cache.servers;
  try {
    const res = await fetch(
      `${process.env.CLOUDFLARE_TURN_API_BASE || 'https://rtc.live.cloudflare.com'}/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers: IceServer | IceServer[] };
    const raw = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    // A Cloudflare inclui URLs na porta 53, que os navegadores bloqueiam (fazem a conexão demorar).
    const servers = raw
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    cache = { servers, expires: Date.now() + 12 * 3600_000 };
    return servers;
  } catch (err) {
    console.warn('[ice] falha ao gerar credenciais TURN da Cloudflare:', err);
    return [];
  }
}

export const hasTurn = () =>
  !!(config.cloudflareTurn.keyId && config.cloudflareTurn.apiToken) ||
  !!(config.meteredTurn.domain && config.meteredTurn.apiKey) ||
  config.turn.urls.length > 0;

if (!hasTurn()) {
  console.warn(
    '[ice] Nenhum servidor TURN configurado: chamadas entre redes móveis (4G/5G) podem não conectar. Veja o README.',
  );
}

/**
 * TURN preferido: Cloudflare (1.000 GB grátis por mês). O Metered (cota pequena) só entra se a
 * Cloudflare não estiver configurada ou falhar: se os dois fossem juntos, o navegador poderia escolher
 * o Metered e gastar a cota dele à toa.
 */
export async function getIceServers(): Promise<IceServer[]> {
  const cloudflare = await cloudflareServers();
  const metered = cloudflare.length ? [] : await meteredServers();
  const servers = [...STUN, ...cloudflare, ...metered];
  const { urls, username, credential } = config.turn;
  if (urls.length) servers.push({ urls, username, credential });
  return servers;
}
