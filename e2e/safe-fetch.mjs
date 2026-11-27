// Proteção contra SSRF nas chamadas aos bots de terceiros (sem BOT_ALLOW_LOCAL_URLS):
//   node --import tsx e2e/safe-fetch.mjs
import { isBlockedIp, safePost, validateBotUrl } from '../server/src/safeFetch.ts';

const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
delete process.env.BOT_ALLOW_LOCAL_URLS;

for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'ff02::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2'])
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

// Tetos de tempo: o prazo é TOTAL (não só de inatividade). Servidor local que "goteja" 1 byte por segundo (resposta lenta
// demais, sempre ativa) não pode prender a chamada além de ~3 s. Aqui, e só aqui, endereços locais são liberados.
{
  const http = (await import('node:http')).default;
  process.env.BOT_ALLOW_LOCAL_URLS = '1';
  let aberto = 0;
  const drip = http.createServer((req, res) => {
    aberto++;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    let n = 0;
    const t = setInterval(() => {
      res.write(' ');
      if (++n >= 10) {
        clearInterval(t);
        res.end('{}');
      }
    }, 1000);
    res.on('close', () => {
      clearInterval(t);
      aberto--;
    });
  });
  await new Promise((r) => drip.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${drip.address().port}/hook`;
  const t0 = Date.now();
  let erro = null;
  try {
    await safePost(url, '{}', {});
  } catch (e) {
    erro = e;
  }
  const gasto = Date.now() - t0;
  assert(erro && /demorou demais/.test(erro.message), `gotejamento deveria dar "demorou demais" (deu: ${erro?.message})`);
  assert(gasto <= 3600, `o prazo total de 3 s não valeu: levou ${gasto} ms`);
  await new Promise((r) => setTimeout(r, 300));
  assert(aberto === 0, 'a conexão com o servidor lento foi derrubada (nada ficou preso)');
  console.log(`✓ resposta que goteja 1 byte por segundo é cortada em ${gasto} ms (prazo total de 3 s) e a conexão é derrubada`);

  // resposta grande + 'end': só uma conclusão (erro de tamanho), sem estourar
  const grande = http.createServer((_req, res) => res.end('x'.repeat(100_000)));
  await new Promise((r) => grande.listen(0, '127.0.0.1', r));
  let e2 = null;
  try {
    await safePost(`http://127.0.0.1:${grande.address().port}/x`, '{}', {});
  } catch (e) {
    e2 = e;
  }
  assert(e2 && /grande demais/.test(e2.message), `resposta grande: ${e2?.message}`);
  console.log('✓ resposta grande demais é recusada uma vez só');

  // servidor rápido continua funcionando
  const ok = http.createServer((_req, res) => res.end('{"ok":true}'));
  await new Promise((r) => ok.listen(0, '127.0.0.1', r));
  const r3 = await safePost(`http://127.0.0.1:${ok.address().port}/x`, '{}', {});
  assert(r3.status === 200 && r3.text === '{"ok":true}', 'resposta normal continua passando');
  console.log('✓ resposta normal continua passando');
  delete process.env.BOT_ALLOW_LOCAL_URLS;
  drip.close();
  grande.close();
  ok.close();
  process.exit(0);
}
