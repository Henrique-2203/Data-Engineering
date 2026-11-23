import { BlockList, isIPv4 } from 'node:net';

/**
 * De onde veio cada pedido (o IP da pessoa), usado nos limites contra spam e robôs.
 *
 * Caminho: pessoa → (Cloudflare, se estiver ligada na frente do domínio) → Render → servidor.
 * - O Render é sempre o primeiro "intermediário" (o endereço que conecta no servidor): confiamos nele.
 * - A Cloudflare só é confiada quando o endereço é MESMO dela (faixas oficiais abaixo). Assim quem acessa
 *   direto pelo onrender.com não consegue fingir outro IP para escapar dos limites.
 * Faixas oficiais: https://www.cloudflare.com/ips/ (mudam muito raramente).
 */
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

const cloudflare = new BlockList();
for (const c of CLOUDFLARE_V4) {
  const [net, bits] = c.split('/');
  cloudflare.addSubnet(net, Number(bits), 'ipv4');
}
for (const c of CLOUDFLARE_V6) {
  const [net, bits] = c.split('/');
  cloudflare.addSubnet(net, Number(bits), 'ipv6');
}

export function isCloudflare(addr: string): boolean {
  const a = addr.startsWith('::ffff:') && isIPv4(addr.slice(7)) ? addr.slice(7) : addr;
  try {
    return cloudflare.check(a, isIPv4(a) ? 'ipv4' : 'ipv6');
  } catch {
    return false;
  }
}

/** para app.set('trust proxy', ...): o 1º salto (Render) e, depois dele, só endereços da Cloudflare */
export const trustProxy = (addr: string, hop: number) => hop === 0 || isCloudflare(addr);
