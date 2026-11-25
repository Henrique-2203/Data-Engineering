import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Chamadas HTTP para endereços que OUTRAS pessoas escolheram (ex.: o endereço de um bot de terceiro).
 * Proteções contra SSRF (usar o servidor do Resenha para alcançar a rede interna):
 *  - só https, porta 443, sem usuário/senha no endereço e sem endereço IP escrito direto;
 *  - o nome é resolvido AQUI e se qualquer resposta for de rede privada (127.x, 10.x, 192.168.x, 169.254.x,
 *    metadados de nuvem, IPv6 local...) a chamada é recusada;
 *  - a conexão usa exatamente o IP que foi conferido (não resolve de novo: vence o "DNS rebinding");
 *  - nada de redirecionamentos, tempo curto e tamanho de resposta limitado.
 * BOT_ALLOW_LOCAL_URLS=1 existe só nos testes automáticos.
 */
const allowLocal = () => process.env.BOT_ALLOW_LOCAL_URLS === '1';

export class SafeFetchError extends Error {}

const blocked = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32], ['2002::', 16], ['100::', 64],
] as const) blocked.addSubnet(net6, bits, 'ipv6');

export function isBlockedIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const fam = net.isIP(ip);
  if (!fam) return true;
  return blocked.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}

/** confere o endereço escolhido pela pessoa (sem chamar nada); devolve o URL já limpo */
export function validateBotUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError('Endereço inválido.');
  }
  if (!allowLocal()) {
    if (u.protocol !== 'https:') throw new SafeFetchError('O endereço precisa começar com https://');
    if (u.port && u.port !== '443') throw new SafeFetchError('Use a porta padrão (443).');
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) throw new SafeFetchError('Use um nome de site, não um endereço IP.');
    if (!u.hostname.includes('.') || /\.(local|internal|localhost|lan|home)$/i.test(u.hostname)) throw new SafeFetchError('Esse endereço não é público.');
  }
  if (u.username || u.password) throw new SafeFetchError('O endereço não pode ter usuário e senha.');
  if (raw.length > 300) throw new SafeFetchError('Endereço muito longo.');
  return u;
}

export interface SafeResponse {
  status: number;
  text: string;
}

export async function safePost(raw: string, body: string, headers: Record<string, string>, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<SafeResponse> {
  const u = validateBotUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new SafeFetchError('Não foi possível encontrar o servidor do bot.');
  }
  if (!addrs.length || (!allowLocal() && addrs.some((a) => isBlockedIp(a.address)))) throw new SafeFetchError('Esse endereço não é público.');
  const pick = addrs[0];
  const lib = u.protocol === 'https:' ? https : http;
  const maxBytes = opts.maxBytes ?? 32_768;
  return new Promise<SafeResponse>((resolve, reject) => {
    const req = lib.request(
      {
        host,
        port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        servername: net.isIP(host) ? undefined : host,
        // conecta no IP que acabamos de conferir (sem nova consulta de DNS)
        lookup: (_h: string, o: { all?: boolean }, cb: (e: Error | null, a: any, f?: number) => void) =>
          o?.all ? cb(null, [{ address: pick.address, family: pick.family }]) : cb(null, pick.address, pick.family),
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ResenhaBot/1' },
        timeout: opts.timeoutMs ?? 3000,
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new SafeFetchError('A resposta do bot é grande demais.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new SafeFetchError('O bot demorou demais para responder.'));
    });
    req.on('error', (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError('Não foi possível falar com o servidor do bot.')));
    req.end(body);
  });
}
