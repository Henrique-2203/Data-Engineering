// XSS (checklist XSS-01..06, TST-06): código malicioso em TODOS os campos que outras pessoas veem,
// renderizado no site de verdade; nada pode executar, abrir alerta ou virar elemento perigoso.
// Uso: npm run build && node e2e/xss.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3302;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  if (!c) fails.push(m);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-xss-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let n = 1;
const call = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.60.${(n >> 8) % 250}.${n++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
// cada carga marca window.__pwned se executar (e abre alert, que também é pego)
const P = [
  '<img src=x onerror="window.__pwned=1">',
  '<script>window.__pwned=1</script>',
  '"><svg onload="window.__pwned=1">',
  "'-window.__pwned=1-'",
  '<iframe srcdoc="<script>parent.__pwned=1</script>"></iframe>',
  '<a href="javascript:window.__pwned=1">clique</a>',
  '[clique](javascript:window.__pwned=1)',
  'javascript:window.__pwned=1',
  'data:text/html,<script>parent.__pwned=1</script>',
  '<style>body{display:none}</style>',
  '${window.__pwned=1}',
  '{{constructor.constructor("window.__pwned=1")()}}',
  '<math><mi xlink:href="javascript:window.__pwned=1">x</mi></math>',
];
const pick = (i) => P[i % P.length];
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, dn) => call('POST', '/auth/register', null, { username: u, password: PASS, displayName: dn ?? u, acceptTerms: true });
  const ana = await reg('ana', pick(0).slice(0, 32));
  const bia = await reg('bia');
  const made = await call('POST', '/guilds', ana.token, { name: pick(1).slice(0, 50) });
  const guild = made.guild;
  await call('POST', `/invites/${guild.inviteCode}/join`, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await call('PATCH', `/channels/${geral.id}`, ana.token, { name: pick(2).slice(0, 40) });
  for (let i = 0; i < P.length; i++) {
    await call('POST', `/channels/${geral.id}/messages`, ana.token, { content: P[i] + ' ' + pick(i + 5) });
    await call('POST', `/guilds/${guild.id}/roles`, ana.token, { name: pick(i).slice(0, 32) });
  }
  await call('POST', `/guilds/${guild.id}/channels`, ana.token, { name: pick(4).slice(0, 40), type: 'text' });
  await call('POST', `/guilds/${guild.id}/channels`, ana.token, { name: pick(6).slice(0, 40), type: 'voice' });
  await call('POST', `/guilds/${guild.id}/categories`, ana.token, { name: pick(3).slice(0, 40) });
  await call('PATCH', '/me', ana.token, { bio: pick(0), pronouns: pick(2).slice(0, 40), status: { text: pick(5).slice(0, 80), emoji: '<b>', expiresInMinutes: 60 } });
  await call('PATCH', '/me', bia.token, { displayName: pick(12).slice(0, 32) });
  await call('POST', `/guilds/${guild.id}/events`, ana.token, { title: pick(1), description: pick(0), startsAt: new Date(Date.now() + 3600e3).toISOString() });
  await call('POST', '/support', bia.token, { subject: pick(0), message: pick(2), category: 'other' });
  // links do perfil precisam ser https (javascript: é recusado pelo servidor)
  const badLink = await call('PATCH', '/me', ana.token, { links: [{ type: 'website', url: 'javascript:window.__pwned=1' }] });
  check(badLink.status === 400, `XSS-02: link de perfil "javascript:" foi aceito (${badLink.status})`);
  const badLink2 = await call('PATCH', '/me', ana.token, { links: [{ type: 'website', url: 'data:text/html;base64,PHNjcmlwdD4=' }] });
  check(badLink2.status === 400, 'XSS-02: link de perfil "data:" foi aceito');

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()));
  const cspErrors = [];
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && cspErrors.push(m.text()));
  await page.goto(`${BASE}/app`);
  await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('bia');
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: /^Entrar$/ }).click();
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
  await sleep(800);
  const probe = async (onde) => {
    const r = await page.evaluate(() => ({
      pwned: window.__pwned,
      dom: document.querySelectorAll('img[onerror], svg[onload], script:not([src]), iframe[srcdoc], a[href^="javascript:"], a[href^="data:"], [onclick*="__pwned"]').length,
    }));
    check(r.pwned === undefined, `XSS: código executou (${onde})`);
    check(r.dom === 0, `XSS: elemento perigoso criado no DOM (${onde}): ${r.dom}`);
    check(dialogs.length === 0, `XSS: alerta abriu (${onde}): ${dialogs.join('|')}`);
  };
  await probe('lista de servidores');
  await page.locator('[aria-label*="svg"], .guild-icon, .guild-list button').first().click({ timeout: 3000 }).catch(() => {});
  // entra no servidor (nome malicioso): clica no primeiro ícone de servidor
  const guildBtns = page.locator('.server-rail button, .guild-rail button, nav button').filter({ hasText: /.|/ });
  for (const b of await guildBtns.all()) {
    await b.click({ timeout: 1500 }).catch(() => {});
    if (await page.locator('.message').count()) break;
  }
  await sleep(1200);
  await probe('servidor, canais, categorias e mensagens');
  // abre o cartão de perfil de quem escreveu (bio/status maliciosos) e a lista de membros
  await page.locator('.message .avatar, .message-author, .author-name').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  await probe('cartão de perfil');
  await page.keyboard.press('Escape');
  // eventos, configurações do servidor (cargos) e suporte
  await page.getByRole('button', { name: /Eventos/ }).first().click({ timeout: 2000 }).catch(() => {});
  await sleep(500);
  await probe('eventos');
  await page.keyboard.press('Escape');
  // aba de busca com as cargas
  const search = page.getByPlaceholder(/Buscar/).first();
  if (await search.count()) {
    await search.fill('img');
    await page.keyboard.press('Enter');
    await sleep(600);
    await probe('busca');
  }
  const html = await page.content();
  check(!/<img[^>]*onerror=[^>]*__pwned/i.test(html) && !/<script>window\.__pwned/.test(html), 'XSS-01: a carga apareceu como HTML de verdade na página');
  check(await page.locator('.message').count() > 5, 'o teste não chegou a renderizar as mensagens (teste inválido)');
  step(`XSS-01/02/06: ${P.length} cargas (img/onerror, script, svg, iframe, javascript:, data:, markdown, template) em servidor, canal, cargo, categoria, nome, bio, status, evento e mensagens: nada executa, nenhum alerta, nenhum elemento perigoso`);

  // ---- XSS-04: cabeçalhos que seguram o resto ----
  const doc = await fetch(`${BASE}/app`);
  const csp = doc.headers.get('content-security-policy') ?? '';
  check(!/script-src[^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'unsafe-eval'/.test(csp), `XSS-04: CSP permite script inline/eval: ${csp.slice(0, 200)}`);
  check(/object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /base-uri/.test(csp), 'XSS-04: CSP sem object-src/frame-ancestors/base-uri');
  check(doc.headers.get('x-content-type-options') === 'nosniff' && doc.headers.get('x-frame-options') === 'DENY', 'INF-02: faltam nosniff/X-Frame-Options');
  check(!!doc.headers.get('referrer-policy') && !!doc.headers.get('permissions-policy') && !!doc.headers.get('cross-origin-opener-policy'), 'INF-02: faltam Referrer-Policy/Permissions-Policy/COOP');
  step('XSS-04/INF-02: CSP sem script inline/eval, object-src/frame-ancestors fechados, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP');

  if (fails.length) {
    console.error(`\n✗ ${fails.length} falha(s):\n- ${fails.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('\nTudo certo com os testes de XSS.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (fails.length) process.exitCode = 1;
  await browser?.close();
  server.kill();
}
