// Fluxo do dono do bot pela tela: criar, GERAR NOVO TOKEN e APAGAR BOT (senha + confirmação do próprio app + resultado).
// Antes essas ações usavam o confirm() do navegador: onde ele não aparece (app Android, Electron, janelas embutidas, automação)
// devolvia "não" e NADA acontecia, sem aviso. Uso: npm run build && node e2e/bots-dev-flow.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3309;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Cor-Forte-Xis-42';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-botflow-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method, auth = 'Bearer') => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.14.0.${ip++ % 250}`, ...(token ? { authorization: `${auth} ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u) => api('/auth/register', { username: u, password: PASS, displayName: u, acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  await api('/guilds', { name: 'Galera' }, ana.token);
  await api('/admin/beta', { botdev: ['ana'] }, equipe.token, 'PUT');

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  // o confirm() nativo NÃO pode ser usado: se alguém voltar a chamá-lo, o teste acusa
  let nativo = 0;
  page.on('dialog', (d) => (nativo++, d.dismiss()));
  await page.goto(`${BASE}/app`);
  await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('ana');
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: /^Entrar$/ }).click();
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Galera' }).first().click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Desenvolvedor' }).click();

  // criar
  await page.getByLabel(/Sua senha/).fill(PASS);
  await page.getByLabel('Nome do bot').fill('Bot Fluxo');
  await page.getByRole('button', { name: 'Criar bot' }).click();
  const secretBox = page.locator('.dev-secret');
  await secretBox.waitFor({ timeout: 8000 });
  const token1 = await secretBox.locator('code').nth(0).innerText();
  await secretBox.getByRole('button', { name: 'Já guardei' }).click();
  assert((await api('/bot/me', null, token1, 'GET', 'Bot')).status === 200, 'o token do bot criado funciona');
  const listOf = async () => (await api('/bot-apps', null, ana.token)).bots ?? [];
  assert((await listOf()).length === 1, 'o bot foi criado');

  // ---- gerar novo token ----
  await page.getByLabel(/Sua senha/).fill('');
  await page.getByRole('button', { name: 'Gerar novo token' }).click();
  await page.getByText(/Digite a sua senha/).waitFor({ timeout: 4000 });
  assert((await page.getByRole('alertdialog').count()) === 0, 'sem senha: avisa e nem abre a confirmação');
  step('gerar token sem senha: aviso claro (não fica parado em silêncio)');

  await page.getByLabel(/Sua senha/).fill(PASS);
  await page.getByRole('button', { name: 'Gerar novo token' }).click();
  const c1 = page.getByRole('alertdialog');
  await c1.waitFor({ timeout: 4000 });
  assert(/token antigo para de funcionar/.test(await c1.innerText()), 'a confirmação explica que o token antigo morre');
  assert(await c1.getByRole('button', { name: 'Cancelar' }).evaluate((el) => el === document.activeElement), 'o foco começa no botão seguro (Cancelar)');
  await page.keyboard.press('Escape');
  await c1.waitFor({ state: 'detached' });
  await page.getByText(/Cancelado: o token continua o mesmo/).waitFor({ timeout: 4000 });
  assert((await api('/bot/me', null, token1, 'GET', 'Bot')).status === 200, 'cancelando (Esc), o token antigo continua valendo');
  step('gerar token: Esc cancela, avisa "Cancelado" e nada muda');

  await page.getByRole('button', { name: 'Gerar novo token' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Gerar', exact: true }).click();
  await secretBox.waitFor({ timeout: 8000 });
  const token2 = await secretBox.locator('code').nth(0).innerText();
  assert(token2 !== token1 && /^bot_[a-f0-9]{16}\./.test(token2), 'o token novo aparece na tela');
  assert((await api('/bot/me', null, token1, 'GET', 'Bot')).status === 401, 'o token ANTIGO morreu na hora');
  assert((await api('/bot/me', null, token2, 'GET', 'Bot')).status === 200, 'o token NOVO funciona');
  await secretBox.getByRole('button', { name: 'Já guardei' }).click();
  step('gerar token: senha + confirmação → token novo na tela, o antigo para de funcionar');

  // senha errada: a confirmação passa, o servidor recusa e a tela AVISA
  await page.getByLabel(/Sua senha/).fill('senha-errada-123');
  await page.getByRole('button', { name: 'Gerar novo token' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Gerar', exact: true }).click();
  await page.locator('.toast, [role=status]').filter({ hasText: /senha/i }).first().waitFor({ timeout: 6000 });
  assert((await api('/bot/me', null, token2, 'GET', 'Bot')).status === 200, 'senha errada: o token não mudou');
  step('gerar token com senha errada: erro claro e nada muda');

  // ---- apagar bot ----
  await page.getByLabel(/Sua senha/).fill(PASS);
  await page.getByRole('button', { name: 'Apagar bot' }).click();
  const c2 = page.getByRole('alertdialog');
  await c2.waitFor({ timeout: 4000 });
  assert(/Bot Fluxo/.test(await c2.innerText()), 'a confirmação cita o nome do bot');
  await c2.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByText(/Cancelado: o bot não foi apagado/).waitFor({ timeout: 4000 });
  assert((await listOf()).length === 1, 'cancelando, o bot continua existindo');
  step('apagar bot: Cancelar avisa e nada é apagado');

  await page.getByRole('button', { name: 'Apagar bot' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apagar', exact: true }).click();
  await page.getByText('Bot apagado.').waitFor({ timeout: 6000 });
  await sleep(300);
  assert((await listOf()).length === 0, 'o bot sumiu da lista');
  assert((await api('/bot/me', null, token2, 'GET', 'Bot')).status === 401, 'o token do bot apagado deixou de existir');
  assert((await page.locator('.dev-bot').count()) === 0, 'o cartão do bot sumiu da tela');
  step('apagar bot: senha + confirmação → bot e token deixam de existir');

  assert(nativo === 0, `o app abriu ${nativo} janela(s) nativa(s) de confirm()/alert(): use askConfirm`);
  console.log('\nTUDO CERTO (gerar token e apagar bot pela tela)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
