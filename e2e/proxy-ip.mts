// IP de cada pessoa com e sem a Cloudflare na frente (limites contra spam). Uso: node --import tsx e2e/proxy-ip.mts
import express from 'express';
import { trustProxy } from '../server/src/proxy.ts';
const app = express();
app.set('trust proxy', trustProxy);
app.get('/', (req, res) => res.send(req.ip));
const srv = app.listen(0);
const port = (srv.address() as any).port;
const cases: [string | undefined, string][] = [
  ['9.9.9.9, 162.158.1.1', '9.9.9.9'],          // pessoa → Cloudflare → Render
  ['2804:14c::1, 2606:4700::6810:1', '2804:14c::1'], // IPv6 via Cloudflare
  ['9.9.9.9, 5.5.5.5', '5.5.5.5'],              // alguém tentando fingir IP direto no onrender
  ['5.5.5.5', '5.5.5.5'],                       // como é hoje (sem Cloudflare)
  [undefined, '::ffff:127.0.0.1'],
];
let ok = true;
for (const [xff, want] of cases) {
  const got = await (await fetch(`http://127.0.0.1:${port}/`, { headers: xff ? { 'x-forwarded-for': xff } : {} })).text();
  const pass = got === want || (want === '::ffff:127.0.0.1' && got === '127.0.0.1');
  ok &&= pass;
  console.log(pass ? '✓' : '✗', xff ?? '(nada)', '→', got);
}
srv.close();
process.exit(ok ? 0 : 1);
