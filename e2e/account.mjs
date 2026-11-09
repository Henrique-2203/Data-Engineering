// Etapa 2 (conta segura): sessão em cookie protegido, proteção contra CSRF, captcha invisível, senhas vazadas,
// e-mail confirmado, "esqueci a senha" por e-mail (pedindo 2FA), alertas, histórico e checkup de segurança.
// Uso: npm run build && node e2e/account.mjs
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3161;
const MOCK = 3162;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'resenha-acc-'));
const OUTBOX = path.join(DATA_DIR, 'outbox.jsonl');
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};

// ---------- simuladores: Cloudflare Turnstile e Have I Been Pwned ----------
const leaked = new Set(['SenhaVazada#2024']);
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/turnstile') {
      const { response, secret } = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ success: secret === 'segredo-turnstile' && response === 'humano-ok' }));
    }
    const prefix = req.url.split('/').pop();
    const lines = [...leaked]
      .map((p) => createHash('sha1').update(p).digest('hex').toUpperCase())
      .filter((h) => h.startsWith(prefix))
      .map((h) => `${h.slice(5)}:4242`);
    res.end([...lines, '0000000000000000000000000000000000A:0'].join('\r\n'));
  });
}).listen(MOCK);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    EMAIL_PROVIDER: 'file',
    EMAIL_OUTBOX: OUTBOX,
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET_KEY: 'segredo-turnstile',
    TURNSTILE_VERIFY_URL: `http://localhost:${MOCK}/turnstile`,
    PWNED_API_URL: `http://localhost:${MOCK}/range/`,
    PRIVACY_CONTACT: 'privacidade@exemplo.com',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));

const mails = () => (existsSync(OUTBOX) ? readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const lastMail = (to, subject) => mails().filter((m) => m.to === to && (!subject || m.subject.includes(subject))).at(-1);

async function call(p, { body, token, cookie, method, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, setCookie: res.headers.getSetCookie?.() ?? [], ...data };
}
function totp(secret, offset = 0) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) (bytes.push((value >>> (bits - 8)) & 255), (bits -= 8));
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const cfg = await call('/config');
  assert(cfg.turnstileSiteKey && cfg.emailEnabled, 'site sabe do captcha e do e-mail');

  // ---------- cadastro: captcha e senha vazada ----------
  const noCaptcha = await call('/auth/register', { body: { username: 'ana', password: 'Azul-Forte-Lua-91', acceptTerms: true } });
  assert(noCaptcha.status === 400 && /robô/.test(noCaptcha.error), `cadastro sem captcha recusado (${noCaptcha.status})`);
  const robot = await call('/auth/register', { body: { username: 'ana', password: 'Azul-Forte-Lua-91', acceptTerms: true, captcha: 'sou-robo' } });
  assert(robot.status === 400, 'captcha falso recusado');
  const pwned = await call('/auth/register', { body: { username: 'ana', password: 'SenhaVazada#2024', acceptTerms: true, captcha: 'humano-ok' } });
  assert(pwned.status === 400 && /vazamentos/.test(pwned.error), `senha vazada recusada: ${pwned.error}`);
  step(`cadastro exige captcha; senha vazada recusada ("${pwned.error.slice(0, 70)}…")`);

  // pelo navegador (com Origin), o token NÃO vem no corpo: só no cookie protegido
  const browserReg = await call('/auth/register', {
    body: { username: 'ana', password: 'Azul-Forte-Lua-91', acceptTerms: true, captcha: 'humano-ok' },
    headers: { origin: BASE, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36' },
  });
  assert(browserReg.status === 200 && !browserReg.token, `site não recebe o token no corpo: ${JSON.stringify(browserReg).slice(0, 300)}`);
  const sc = browserReg.setCookie.join('; ');
  assert(/resenha_sid=/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), `cookie protegido: ${sc}`);
  const cookie = browserReg.setCookie[0].split(';')[0];
  const boot = await call('/bootstrap', { cookie });
  assert(boot.status === 200 && boot.user.username === 'ana', 'cookie sozinho autentica');
  step('sessão em cookie HttpOnly + SameSite=Lax; o token nunca chega ao JavaScript do site');

  // ---------- CSRF ----------
  const evil = await call('/me/sessions/logout-others', { body: {}, cookie, headers: { origin: 'https://site-malicioso.com' } });
  assert(evil.status === 403, `pedido vindo de outro site recusado (${evil.status})`);
  const evil2 = await call('/me/sessions/logout-others', { body: {}, cookie, headers: { 'sec-fetch-site': 'cross-site' } });
  assert(evil2.status === 403, 'Sec-Fetch-Site cross-site recusado');
  const fine = await call('/me/sessions/logout-others', { body: {}, cookie, headers: { origin: BASE } });
  assert(fine.status === 200, 'mesmo site funciona');
  step('CSRF: ações vindas de outro site são recusadas, mesmo com o cookie');

  const out = await call('/auth/logout', { body: {}, cookie, headers: { origin: BASE } });
  assert(out.setCookie.some((c) => /Max-Age=0/.test(c)), 'sair apaga o cookie');
  assert((await call('/bootstrap', { cookie })).status === 401, 'sessão encerrada no servidor');
  step('sair apaga o cookie e encerra a sessão no servidor');

  // ---------- login: captcha depois de erros ----------
  const UA1 = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36';
  const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
  for (let i = 0; i < 3; i++) {
    const r = await call('/auth/login', { body: { username: 'ana', password: 'errada-' + i }, headers: { 'user-agent': UA1 } });
    assert(r.status === 401, 'senha errada');
  }
  const needs = await call('/auth/login', { body: { username: 'ana', password: 'Azul-Forte-Lua-91' }, headers: { 'user-agent': UA1 } });
  assert(needs.status === 401 && needs.needCaptcha, 'depois de 3 erros pede captcha, mesmo com a senha certa');
  const ana = await call('/auth/login', { body: { username: 'ana', password: 'Azul-Forte-Lua-91', captcha: 'humano-ok' }, headers: { 'user-agent': UA1 } });
  assert(ana.status === 200 && ana.token, 'com captcha entra');
  step('login: depois de 3 senhas erradas, pede o captcha invisível');

  // ---------- e-mail confirmado ----------
  const wrongPw = await call('/me/email', { body: { email: 'ana@exemplo.com', password: 'errada' }, token: ana.token });
  assert(wrongPw.status === 403, 'adicionar e-mail pede a senha');
  const sent = await call('/me/email', { body: { email: 'Ana@Exemplo.com', password: 'Azul-Forte-Lua-91' }, token: ana.token });
  assert(sent.sentTo === 'an*@exemplo.com' || /^an\*+@exemplo\.com$/.test(sent.sentTo), `e-mail mascarado: ${sent.sentTo}`);
  const verifyMail = lastMail('ana@exemplo.com', 'Confirme');
  assert(/^\d{6}$/.test(verifyMail?.code), 'código de 6 dígitos no e-mail');
  assert(!/https?:\/\//.test(verifyMail.text), 'e-mail sem links (anti-golpe)');
  assert((await call('/me/email/verify', { body: { code: '000000' }, token: ana.token })).status === 400, 'código errado recusado');
  const ok = await call('/me/email/verify', { body: { code: verifyMail.code }, token: ana.token });
  assert(ok.email === 'ana@exemplo.com', 'e-mail confirmado');
  const sec = await call('/me/security', { token: ana.token });
  assert(sec.emailVerified && sec.checkup.find((c) => c.key === 'email').ok, 'checkup marca o e-mail');
  step('e-mail confirmado com código de 6 dígitos (pede a senha; e-mail sem links)');

  // ---------- alertas de novo aparelho ----------
  const before = mails().length;
  await call('/auth/login', { body: { username: 'ana', password: 'Azul-Forte-Lua-91', captcha: 'humano-ok' }, headers: { 'user-agent': UA1 } });
  assert(mails().length === before, 'mesmo aparelho não gera alerta');
  await call('/auth/login', { body: { username: 'ana', password: 'Azul-Forte-Lua-91', captcha: 'humano-ok' }, headers: { 'user-agent': UA2 } });
  const alert = lastMail('ana@exemplo.com', 'Novo acesso');
  assert(alert && /Safari no iPhone/.test(alert.text), 'alerta de aparelho novo com o nome do aparelho');
  step(`alerta por e-mail de acesso em aparelho novo ("${alert.subject}": Safari no iPhone)`);

  // ---------- senha que vazou depois ----------
  const bia = await call('/auth/register', { body: { username: 'bia', password: 'Roxo-Forte-Sol-77', acceptTerms: true, captcha: 'humano-ok' } });
  leaked.add('Roxo-Forte-Sol-77');
  // (o mesmo IP errou 3 vezes antes: o captcha continua sendo pedido para quem entra dali)
  const biaLogin = await call('/auth/login', { body: { username: 'bia', password: 'Roxo-Forte-Sol-77', captcha: 'humano-ok' } });
  assert(biaLogin.passwordLeaked === true, 'login avisa que a senha vazou');
  const biaSec = await call('/me/security', { token: biaLogin.token });
  assert(biaSec.passwordLeaked && !biaSec.checkup.find((c) => c.key === 'password').ok, 'checkup pede para trocar a senha');
  const change = await call('/me/password', { body: { current: 'Roxo-Forte-Sol-77', next: 'SenhaVazada#2024' }, token: biaLogin.token });
  assert(change.status === 400 && /vazamentos/.test(change.error), 'trocar para senha vazada recusado');
  const change2 = await call('/me/password', { body: { current: 'Roxo-Forte-Sol-77', next: 'Laranja-Nova-Mar-55' }, token: biaLogin.token });
  assert(change2.status === 200, 'troca para senha segura');
  assert(!(await call('/me/security', { token: biaLogin.token })).passwordLeaked, 'aviso some depois de trocar');
  step('senha que vazou depois é detectada no login, aparece no checkup e não pode ser reaproveitada');
  void bia;

  // ---------- 2FA + esqueci minha senha por e-mail ----------
  const setup = await call('/me/2fa/setup', { body: { password: 'Azul-Forte-Lua-91' }, token: ana.token });
  await call('/me/2fa/enable', { body: { code: totp(setup.secret) }, token: ana.token });
  assert(lastMail('ana@exemplo.com', 'duas etapas ativada'), 'alerta de 2FA ativada');
  const forgotNoCaptcha = await call('/auth/forgot', { body: { login: 'ana' } });
  assert(forgotNoCaptcha.status === 400, 'esqueci a senha pede captcha');
  const n0 = mails().length;
  const ghost = await call('/auth/forgot', { body: { login: 'ninguem@exemplo.com', captcha: 'humano-ok' } });
  const forgot = await call('/auth/forgot', { body: { login: 'ana@exemplo.com', captcha: 'humano-ok' } });
  assert(ghost.message === forgot.message, 'mesma resposta para quem existe e quem não existe');
  assert(mails().length === n0 + 1, 'só a conta real recebe e-mail');
  const resetMail = lastMail('ana@exemplo.com', 'senha nova');
  assert(/^\d{6}$/.test(resetMail.code), 'código para trocar a senha');
  const wrongCode = await call('/auth/reset', { body: { login: 'ana', code: '111111', password: 'Verde-Nova-Ceu-12' } });
  assert(wrongCode.status === 400, 'código errado');
  const need2 = await call('/auth/reset', { body: { login: 'ana', code: resetMail.code, password: 'Verde-Nova-Ceu-12' } });
  assert(need2.status === 401 && need2.need2fa, 'quem tem 2FA precisa do código do app também (só o e-mail não basta)');
  const reset = await call('/auth/reset', { body: { login: 'ana', code: resetMail.code, password: 'Verde-Nova-Ceu-12', totp: totp(setup.secret, 1) } });
  assert(reset.status === 200 && reset.token, `senha trocada: ${JSON.stringify(reset).slice(0, 200)}`);
  assert((await call('/bootstrap', { token: ana.token })).status === 401, 'aparelhos antigos desconectados');
  const reuse = await call('/auth/reset', { body: { login: 'ana', code: resetMail.code, password: 'Outra-Nova-Paz-34', totp: totp(setup.secret, 1) } });
  assert(reuse.status === 400, 'código do e-mail não vale duas vezes');
  assert(lastMail('ana@exemplo.com', 'senha foi trocada'), 'alerta de senha trocada');
  step('esqueci a senha por e-mail: captcha, não revela quem tem conta, pede o 2FA, derruba os outros aparelhos e avisa');

  // tentativas no código: 5 erros e o código morre
  const caio = await call('/auth/register', { body: { username: 'caio', password: 'Preto-Forte-Lago-31', acceptTerms: true, captcha: 'humano-ok' } });
  await call('/me/email', { body: { email: 'caio@exemplo.com', password: 'Preto-Forte-Lago-31' }, token: caio.token });
  await call('/me/email/verify', { body: { code: lastMail('caio@exemplo.com', 'Confirme').code }, token: caio.token });
  await call('/auth/forgot', { body: { login: 'caio', captcha: 'humano-ok' } });
  const fresh = lastMail('caio@exemplo.com', 'senha nova');
  for (let i = 0; i < 5; i++) {
    const r = await call('/auth/reset', { body: { login: 'caio', code: String(100000 + i), password: 'Verde-Nova-Ceu-12' } });
    assert(r.status === 400, `erro ${i + 1} recusado`);
  }
  const dead = await call('/auth/reset', { body: { login: 'caio', code: fresh.code, password: 'Verde-Nova-Ceu-12' } });
  assert(dead.status === 400, `depois de 5 erros, nem o código certo vale (${dead.status})`);
  step('código do e-mail morre depois de 5 tentativas erradas');

  // ---------- histórico ----------
  const events = await call('/me/security/events', { token: reset.token });
  const types = events.events.map((e) => e.type);
  for (const t of ['register', 'login', 'login_new_device', 'email_verified', '2fa_enabled', 'password_reset']) assert(types.includes(t), `histórico tem ${t}`);
  const other = await call('/me/security/events', { token: biaLogin.token });
  assert(!other.events.some((e) => e.type === 'email_verified'), 'cada um vê só o próprio histórico');
  step(`histórico de segurança: ${events.events.length} eventos (${[...new Set(types)].join(', ')})`);

  // ---------- no navegador ----------
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  // a Cloudflare não é acessível no teste: um Turnstile de mentira responde "humano-ok"
  await ctx.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback('humano-ok'), 50); return 'w1'; }, remove() {} };`,
    }),
  );
  // quem já estava logado na versão antiga (token no localStorage) migra sozinho para o cookie
  await ctx.addInitScript((t) => {
    if (!sessionStorage.getItem('ja-migrou')) {
      localStorage.setItem('resenha.token', t);
      sessionStorage.setItem('ja-migrou', '1');
    }
  }, biaLogin.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e));
  page.on('dialog', (d) => void d.accept());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Configurações' }).first().waitFor({ timeout: 15000 });
  const stored = await page.evaluate(() => ({ token: localStorage.getItem('resenha.token'), cookie: document.cookie }));
  assert(!stored.token, 'token antigo apagado do localStorage');
  assert(!/resenha_sid/.test(stored.cookie), 'o cookie da sessão é invisível para o JavaScript');
  await page.reload();
  await page.getByRole('button', { name: 'Configurações' }).first().waitFor({ timeout: 15000 });
  step('quem estava logado na versão antiga migra sozinho para o cookie protegido (e continua logado)');

  // checkup + adicionar e-mail pela tela
  await page.getByRole('button', { name: 'Configurações' }).first().click();
  await page.getByText('Checkup de segurança').waitFor();
  await page.getByText('Checkup de segurança').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'checkup-seguranca.png') });
  await page.getByRole('button', { name: 'Adicionar e-mail' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('bia@exemplo.com');
  await page.getByLabel('Sua senha do Resenha').fill('Laranja-Nova-Mar-55');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByText(/Enviamos um código para/).waitFor();
  await sleep(300);
  await page.getByLabel('Código', { exact: true }).fill(lastMail('bia@exemplo.com', 'Confirme').code);
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await page.getByText(/✅ bia@exemplo.com/).waitFor();
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await page.getByText('E-mail confirmado', { exact: true }).waitFor();
  await page.getByText('Histórico de segurança').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'historico-seguranca.png') });
  step('tela: checkup de segurança, e-mail confirmado pelo site e histórico visível');

  // sair e "esqueci minha senha" pela tela
  await page.keyboard.press('Escape');
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.evaluate(() => localStorage.removeItem('resenha.session'));
  await page.goto(`${BASE}/entrar`);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('Usuário ou e-mail').fill('bia@exemplo.com');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByText(/Se existir uma conta/).waitFor().catch(async (e) => {
    await page.screenshot({ path: path.join(shots, 'debug-esqueci.png') });
    throw e;
  });
  await page.getByLabel('Código do e-mail').fill(lastMail('bia@exemplo.com', 'senha nova').code);
  await page.getByLabel('Nova senha').fill('Cinza-Nova-Rio-88');
  await page.screenshot({ path: path.join(shots, 'esqueci-senha-email.png') });
  await page.getByRole('button', { name: 'Trocar senha e entrar' }).click();
  await page.getByRole('button', { name: 'Configurações' }).first().waitFor({ timeout: 15000 });
  step('tela: "Esqueci minha senha" por e-mail → código → senha nova → entra');

  console.log('\nTUDO CERTO (conta segura)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  mock.close();
}
