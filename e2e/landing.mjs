// Teste da página inicial: apresentação com vídeo, recursos com prints, download, lista de espera
// (inscrição, posição, repetida, robô), painel da equipe e exportação. Uso: npm run build && node e2e/landing.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 3143;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-lp-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);

  // ---------- apresentação ----------
  await page.getByRole('heading', { name: /Sua call\. Sua tela\./ }).waitFor();
  await page.getByText('O Resenha está em desenvolvimento (beta).').waitFor();
  const video = await page.waitForFunction(() => {
    const v = document.querySelector('.lp-trailer video');
    return v && v.readyState >= 2 && !v.paused ? `${v.videoWidth}x${v.videoHeight}, ${Math.round(v.duration)} s` : null;
  }, null, { timeout: 10000 });
  await page.screenshot({ path: `${shots}/35-pagina-inicial.png` });
  step(`página inicial com aviso de beta e vídeo tocando sozinho (${await video.jsonValue()})`);

  // prints dos recursos carregam (rola a página para animar a entrada)
  await page.evaluate(async () => {
    const el = document.querySelector('.lp');
    for (let y = 0; y < el.scrollHeight; y += 500) {
      el.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  const imgs = await page.$$eval('.lp-feature img', (els) => els.map((i) => (i.complete && i.naturalWidth > 0 ? 'ok' : i.src)));
  if (imgs.length !== 5 || imgs.some((x) => x !== 'ok')) throw new Error(`prints não carregaram: ${imgs}`);
  const revealed = await page.$$eval('.lp-reveal', (els) => els.filter((e) => e.classList.contains('in')).length);
  step(`5 prints reais do app nos recursos; ${revealed} blocos animados ao rolar`);

  // download do Windows
  const dl = await fetch(`${BASE}/api/download/windows`, { redirect: 'manual' });
  if (dl.status !== 302 || !/github\.com/.test(dl.headers.get('location'))) throw new Error(`download: ${dl.status} ${dl.headers.get('location')}`);
  step(`"Baixar para Windows" leva ao instalador mais recente (${dl.headers.get('location').split('/').slice(-2).join('/')})`);

  // ---------- lista de espera ----------
  await page.getByRole('button', { name: 'Entrar na lista de espera' }).first().click();
  const form = page.locator('.lp-form');
  await form.getByLabel('Nome').fill('Marcos');
  await form.getByLabel('E-mail').fill('Marcos.Gamer@Email.com');
  await form.getByLabel(/WhatsApp/).fill('(11) 91234-5678');
  await form.getByRole('button', { name: 'Android' }).click();
  await form.getByLabel(/Como conheceu/).selectOption('instagram');
  const disabledBefore = await form.getByRole('button', { name: 'Quero meu convite' }).isDisabled();
  await form.getByLabel(/Quero receber o convite/).check();
  await page.screenshot({ path: `${shots}/36-lista-de-espera.png` });
  await form.getByRole('button', { name: 'Quero meu convite' }).click();
  await page.getByText('Você está na lista!').waitFor();
  await page.getByText('nº 1').waitFor();
  if (!disabledBefore) throw new Error('dava para enviar sem consentimento');
  step('inscrição na lista de espera (consentimento obrigatório) mostra a posição nº 1');

  const again = await api('/waitlist', { name: 'Marcos', email: 'marcos.gamer@email.com', platforms: ['windows'], consent: true });
  const bot = await api('/waitlist', { name: 'Robô', email: 'robo@spam.com', platforms: ['windows'], consent: true, website: 'http://spam' });
  const badMail = await api('/waitlist', { name: 'Ana', email: 'ana@', platforms: ['windows'], consent: true });
  const noConsent = await api('/waitlist', { name: 'Ana', email: 'ana@x.com', platforms: ['windows'] });
  if (!again.already || again.position !== 1 || bot.status !== 400 || badMail.status !== 400 || noConsent.status !== 400) {
    throw new Error(`validações: ${JSON.stringify({ again, bot: bot.status, badMail: badMail.status, noConsent: noConsent.status })}`);
  }
  await api('/waitlist', { name: 'Bia', email: 'bia@x.com', platforms: ['iphone', 'navegador'], consent: true, source: 'tiktok' });
  step('mesmo e-mail não duplica; robôs (campo invisível), e-mail inválido e sem consentimento são recusados');

  // ---------- painel da equipe ----------
  const equipe = await api('/auth/register', { username: 'equipe', password: 'segredo123', acceptTerms: true });
  const notAdmin = await api('/admin/waitlist', null, (await api('/auth/register', { username: 'zeca', password: 'segredo123' })).token);
  if (notAdmin.status !== 404) throw new Error('lista de espera visível para quem não é da equipe');
  const pa = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  await pa.addInitScript((t) => localStorage.setItem('resenha.token', t), equipe.token);
  await pa.goto(`${BASE}/app`);
  await pa.getByRole('button', { name: 'Denúncias' }).click();
  await pa.getByRole('tab', { name: 'Lista de espera' }).click();
  await pa.getByText('2 inscritos · 2 esperando convite').waitFor();
  await pa.locator('.wait-item', { hasText: 'Marcos' }).getByText('marcos.gamer@email.com').waitFor();
  await pa.locator('.wait-item', { hasText: 'Marcos' }).getByLabel('Convite enviado').click();
  await pa.getByText('2 inscritos · 1 esperando convite').waitFor();
  await pa.screenshot({ path: `${shots}/37-painel-lista.png` });
  const csv = await (await fetch(`${BASE}/api/admin/waitlist?format=csv`, { headers: { authorization: `Bearer ${equipe.token}` } })).text();
  if (!csv.includes('marcos.gamer@email.com') || !csv.includes('bia@x.com') || !csv.includes('11912345678')) throw new Error('CSV incompleto');
  step('equipe vê a lista no painel, marca "convite enviado" e exporta a planilha (.csv)');

  // logado, "/app" abre o app; "/" continua sendo o site de apresentação, com "Abrir o Resenha"
  await pa.getByRole('heading', { name: /Sua call/ }).waitFor({ state: 'detached', timeout: 2000 });
  await pa.goto(BASE);
  await pa.getByRole('heading', { name: /Sua call/ }).waitFor();
  await pa.getByRole('link', { name: 'Abrir o Resenha' }).click();
  await pa.waitForURL(`${BASE}/app`);
  await pa.getByRole('button', { name: 'Denúncias' }).waitFor();
  const pe = await (await browser.newContext()).newPage();
  await pe.goto(`${BASE}/entrar`);
  await pe.getByRole('tab', { name: 'Criar conta' }).waitFor();
  await pe.goto(`${BASE}/invite/abc123`);
  await pe.getByRole('tab', { name: 'Criar conta' }).waitFor();
  await pe.getByText('Você recebeu um convite!').waitFor();
  step('site de apresentação aberto também para quem está logado ("Abrir o Resenha" leva ao app em /app); "/entrar" abre o login; link de convite abre o cadastro');

  // ---------- celular ----------
  const phone = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  await phone.goto(`${BASE}/?src=ig_bio`);
  await phone.getByRole('heading', { name: /Sua call/ }).waitFor();
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${shots}/38-pagina-celular.png` });
  const overflow = await phone.evaluate(() => document.querySelector('.lp').scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('a página estoura a largura no celular');
  step('layout do celular sem rolagem para os lados');

  // ---------- painel de números ----------
  await fetch(`${BASE}/api/stats/view`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'facebookexternalhit/1.1' }, body: '{}' });
  await new Promise((r) => setTimeout(r, 500));
  const st = await api('/admin/stats?days=7', null, equipe.token);
  const today = st.days[st.days.length - 1];
  const src = Object.fromEntries(st.sources.landing_view.map((x) => [x.key, x.total]));
  const wsrc = Object.fromEntries(st.sources.waitlist.map((x) => [x.key, x.total]));
  if (today.landing_view !== 1 || src.instagram !== 1 || src.direto) throw new Error(`visitas: ${JSON.stringify({ today, src })}`);
  if (today.waitlist !== 2 || wsrc.instagram !== 1 || wsrc.tiktok !== 1 || today.download_windows !== 1 || today.signup !== 2) throw new Error(`contadores: ${JSON.stringify({ today, wsrc })}`);
  if (st.totals.active7 < 1 || today.active_user < 1) throw new Error('ativos não contados');
  const statsDenied = await api('/admin/stats', null, (await api('/auth/login', { username: 'zeca', password: 'segredo123' })).token);
  if (statsDenied.status !== 404) throw new Error('números visíveis para quem não é da equipe');
  if (!(await pa.getByRole('tab', { name: 'Números' }).isVisible())) await pa.getByRole('button', { name: /^Denúncias/ }).click();
  await pa.getByRole('tab', { name: 'Números' }).click();
  await pa.locator('.stat-tile', { hasText: 'Visitas à página' }).getByText('1', { exact: true }).waitFor();
  await pa.locator('.stat-source', { hasText: 'De onde vêm as visitas' }).getByText('Instagram').waitFor();
  await pa.locator('.stat-bars svg').hover();
  await pa.screenshot({ path: `${shots}/39-painel-numeros.png` });
  step('painel de números: visita do celular contada como Instagram; robôs (navegador automático e prévia de link) ignorados; 1 download, 2 inscritos por origem, contas e ativos');

  // aparelho da equipe não conta visita: o mesmo navegador do painel abre a página inicial deslogado
  const before = (await api('/admin/stats?days=7', null, equipe.token)).days.at(-1).landing_view;
  const flag = await pa.evaluate(() => localStorage.getItem('resenha.noStats'));
  const teamCtx = await browser.newContext({ ...devices['Pixel 7'] });
  await teamCtx.addInitScript(() => localStorage.setItem('resenha.noStats', '1'));
  const pt = await teamCtx.newPage();
  await pt.goto(`${BASE}/?src=ig_bio`);
  await pt.getByRole('heading', { name: /Sua call/ }).waitFor();
  await new Promise((r) => setTimeout(r, 800));
  const after = (await api('/admin/stats?days=7', null, equipe.token)).days.at(-1).landing_view;
  if (flag !== '1' || after !== before) throw new Error(`visita da equipe contou (${flag}, ${before} -> ${after})`);
  step('as visitas dos aparelhos da equipe não entram no painel');

  const relevant = errors.filter((e) => !/favicon|ERR_ABORTED|net::/.test(e));
  if (relevant.length) throw new Error(`erros no navegador: ${relevant.join(' | ')}`);
  step('nenhum erro no navegador (inclusive de Content-Security-Policy)');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
