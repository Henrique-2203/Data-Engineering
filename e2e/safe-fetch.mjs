// Proteção contra SSRF nas chamadas aos bots de terceiros (sem BOT_ALLOW_LOCAL_URLS):
//   node --import tsx e2e/safe-fetch.mjs
import { isBlockedIp, safePost, validateBotUrl } from '../server/src/safeFetch.ts';

const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
delete process.env.BOT_ALLOW_LOCAL_URLS;

for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'ff02::1'])
  assert(isBlockedIp(ip), `${ip} deve ser bloqueado`);
for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert(!isBlockedIp(ip), `${ip} deve passar`);
console.log('✓ faixas de IP privadas, de loopback, link-local, nuvem e IPv6 locais são bloqueadas; IPs públicos passam');

for (const bad of [
  'http://exemplo.com/hook', 'https://127.0.0.1/hook', 'https://[::1]/hook', 'https://10.0.0.5/x', 'https://localhost/x', 'https://exemplo.com:8443/x',
  'https://user:senha@exemplo.com/x', 'ftp://exemplo.com/x', 'não é endereço', 'https://servidor.local/x', 'https://meu.internal/x', 'https://semponto/x', 'https://169.254.169.254/latest/meta-data',
])
  assert((() => { try { validateBotUrl(bad); return false; } catch { return true; } })(), `${bad} deve ser recusado`);
assert(validateBotUrl('https://meubot.exemplo.com/hook?x=1').hostname === 'meubot.exemplo.com', 'endereço público https passa');
console.log('✓ só https, porta 443, sem IP escrito, sem usuário/senha, sem nomes internos');

// nomes que apontam para a rede interna (o DNS "localhost" resolve para 127.0.0.1)
for (const url of ['https://localhost.localdomain/x', 'https://ip6-localhost.example/x']) {
  let failed = false;
  try { await safePost(url, '{}', {}); } catch { failed = true; }
  assert(failed, `${url} não pode ser chamado`);
}
console.log('✓ a chamada é recusada antes de abrir conexão quando o nome não resolve para um endereço público');
