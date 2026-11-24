// Teste do lançamento oficial: a equipe abre o cadastro no painel (sem mexer no Render), qualquer pessoa cria
// conta sem código, quem usa um link de convite continua registrado como convidado, a página inicial
// mostra "Criar conta" no lugar da lista de espera e sem "beta", e o painel "Novas contas" lista quem
// entrou e quando. Fechar o cadastro volta a pedir código e a mostrar a lista de espera.
// Uso: npm run build && node e2e/launch.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3261;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-lancamento-'), PLATFORM_ADMINS: 'equipe', REGISTRATION_CODE: 'galera2026' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
let ipN = 1;
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${ipN++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const reg = (username, registrationCode) => api('/auth/register', { username, password: 'Pao-de-Queijo-77', registrationCode, acceptTerms: true });
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // antes do lançamento: pede código
  expect((await api('/config')).registrationRequiresCode === true, 'antes de abrir deveria pedir código');
  expect((await reg('semcodigo')).status === 403, 'sem código deveria falhar antes de abrir');
  const equipe = await reg('equipe', 'galera2026');
  expect(equipe.token, 'equipe');
  const lari = await reg('lari', 'galera2026');
  const lariCode = await api('/admin/signup-codes', { owner: '@lari', maxUses: 5 }, equipe.token);
  expect(lariCode.code, 'código da lari');

  // só a equipe abre o cadastro e vê as contas
  expect((await api('/admin/signup-open', { open: true }, lari.token, 'PUT')).status === 404, 'quem não é da equipe não abre o cadastro');
  expect((await api('/admin/signups', null, lari.token)).status === 404, 'quem não é da equipe não vê as contas');
  const opened = await api('/admin/signup-open', { open: true }, equipe.token, 'PUT');
  expect(opened.status === 200 && opened.needsCode === false, `abrir: ${JSON.stringify(opened)}`);
  expect((await api('/config')).registrationRequiresCode === false, '/config deveria dizer que não precisa de código');
  const livre = await reg('livre');
  expect(livre.status === 200 && livre.token, `sem código com cadastro aberto: ${JSON.stringify(livre)}`);
  const convidado = await reg('convidado', lariCode.code);
  expect(convidado.status === 200, 'com código continua entrando');
  const errado = await reg('codigoerrado', 'NADA-0000');
  expect(errado.status === 200, `código errado com cadastro aberto não deveria barrar: ${JSON.stringify(errado)}`);
  step('equipe abre o cadastro: entra sem código; código errado não barra; só a equipe pode abrir');

  const s = await api('/admin/signups', null, equipe.token);
  expect(s.status === 200 && s.open === true, `painel: ${JSON.stringify(s).slice(0, 200)}`);
  expect(s.totals.total === 5 && s.totals.today === 5, `totais: ${JSON.stringify(s.totals)}`);
  expect(s.byDay.length === 1 && s.byDay[0].n === 5, `por dia: ${JSON.stringify(s.byDay)}`);
  expect(s.users[0].username === 'codigoerrado' && s.users.length === 5, 'mais novas primeiro');
  const conv = s.users.find((u) => u.username === 'convidado');
  expect(conv.invitedBy === 'lari' && conv.signupCode === lariCode.code, `convidado pela lari: ${JSON.stringify(conv)}`);
  expect(s.users.find((u) => u.username === 'livre').signupCode === null, 'sem código fica sem código');
  expect((await api('/admin/signups?q=conv', null, equipe.token)).users.length === 1, 'busca');
  step('painel: 5 contas hoje, mais novas primeiro, quem convidou, busca');

  browser = await chromium.launch();
  const errors = [];
  // página inicial: sem beta e sem lista de espera
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/`);
  await page.getByText('Lançamento oficial!').waitFor();
  const body = await page.locator('body').innerText();
  expect(!/\bbeta\b/i.test(body.replace(/saiu do beta/gi, '')), 'a página inicial ainda fala em beta');
  expect((await page.getByRole('button', { name: 'Entrar na lista de espera' }).count()) === 0, 'ainda tem lista de espera');
  expect((await page.locator('#lista').count()) === 0, 'seção da lista ainda aparece');
  await page.screenshot({ path: `${shots}/launch-landing.png` });
  await page.getByRole('link', { name: 'Criar conta grátis' }).first().click();
  await page.waitForURL(/\/app\?cadastro=1/);
  await page.getByLabel('Nome de usuário').fill('pelosite');
  expect((await page.getByLabel('Código de convite').count()) === 0, 'cadastro aberto não deveria mostrar o campo de código');
  await page.getByLabel('Senha', { exact: true }).fill('Pao-de-Queijo-77');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Criar conta/ }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).waitFor({ timeout: 15000 });
  await ctx.close();
  step('página inicial: "Lançamento oficial", sem beta, "Criar conta grátis" abre o cadastro direto e sem campo de código');

  // painel "Novas contas"
  const ectx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ep = await ectx.newPage();
  ep.on('pageerror', (e) => errors.push(e.message));
  await ep.goto(`${BASE}/app`);
  await ep.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('equipe');
  await ep.getByLabel('Senha', { exact: true }).fill('Pao-de-Queijo-77');
  await ep.getByRole('button', { name: /^Entrar$/ }).click();
  await ep.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
  await ep.getByRole('button', { name: 'Denúncias' }).click();
  await ep.getByRole('tab', { name: 'Novas contas' }).click();
  await ep.locator('.signup-table').getByText('@pelosite').waitFor();
  const hoje = ep.locator('.stat-tile', { hasText: 'Hoje' });
  expect((await hoje.locator('.stat-value').innerText()).trim() === '6', 'Hoje deveria ser 6');
  expect(await ep.getByRole('checkbox', { name: /Cadastro aberto/ }).isChecked(), 'chave deveria estar ligada');
  expect(await ep.locator('.signup-table tr', { hasText: '@convidado' }).getByText('@lari').isVisible(), 'mostra quem convidou');
  await ep.screenshot({ path: `${shots}/launch-painel.png` });
  // fechar o cadastro pela chave
  ep.once('dialog', (d) => void d.accept());
  await ep.getByRole('checkbox', { name: /Cadastro aberto/ }).click();
  await ep.getByText('Cadastro fechado: só com código de convite.').waitFor();
  await ectx.close();
  step('painel "Novas contas": totais, lista com quem convidou, e a chave fecha o cadastro');

  // fechado de novo: volta a pedir código e a lista de espera
  await new Promise((r) => setTimeout(r, 300));
  expect((await api('/config')).registrationRequiresCode === true, 'fechado deveria pedir código');
  expect((await reg('depois')).status === 403, 'fechado sem código deveria falhar');
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/`);
  await lp.getByRole('button', { name: 'Entrar na lista de espera' }).first().waitFor();
  expect((await lp.getByText('Lançamento oficial!').count()) === 0, 'fechado não mostra o aviso de lançamento');
  await lctx.close();
  step('fechado de novo: pede código e a página volta a mostrar a lista de espera');

  expect(errors.length === 0, `erros na página: ${errors.join(' | ')}`);
  console.log('\nTudo certo com o lançamento.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
