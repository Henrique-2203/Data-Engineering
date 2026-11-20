// Telas de segurança e privacidade para o vídeo da conversa: aparelhos conectados, baixar dados /
// excluir conta, resumo da Política de Privacidade e a lista de espera. Uso: node promo/capture-v3.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const PORT = 3152, BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('promo/out/shots3');
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-v3-')), PRIVACY_CONTACT: 'resenha.brasilgames@gmail.com' },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body, token) => (await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(500); }
  const reg = await api('/auth/register', { username: 'henrique', password: 'Pao-de-Queijo-77', displayName: 'Henrique', acceptTerms: true });
  await api('/guilds', { name: 'Resenha dos Crias' }, reg.token);
  browser = await chromium.launch();
  // outro aparelho conectado (celular), para a lista ficar realista
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  await phone.goto(`${BASE}/entrar`);
  await phone.getByLabel('Usuário').fill('henrique');
  await phone.getByLabel('Senha').fill('Pao-de-Queijo-77');
  await phone.getByRole('button', { name: 'Entrar' }).last().click();
  await sleep(1500);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/entrar`);
  await p.getByLabel('Usuário').fill('henrique');
  await p.getByLabel('Senha').fill('Pao-de-Queijo-77');
  await p.getByRole('button', { name: 'Entrar' }).last().click();
  await p.getByText('Resenha dos Crias').first().waitFor();
  await p.getByRole('button', { name: 'Configurações', exact: true }).click();
  const sec = p.locator('.security');
  await sec.scrollIntoViewIfNeeded();
  await sleep(800);
  await sec.locator('.sec-row.column').screenshot({ path: `${OUT}/aparelhos.png` });
  await sec.locator('.sec-row').filter({ hasText: 'Seus dados' }).screenshot({ path: `${OUT}/dados.png` });
  await sec.locator('.sec-row').filter({ hasText: 'Excluir minha conta' }).screenshot({ path: `${OUT}/excluir.png` });
  await sec.locator('.sec-row').filter({ hasText: 'Senha' }).first().screenshot({ path: `${OUT}/senha.png` });
  // limite de tentativas: a mensagem real de bloqueio
  for (let i = 0; i < 9; i++) await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'henrique', password: `errada${i}` }) });
  const lp = await (await browser.newContext({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await lp.goto(`${BASE}/entrar`);
  await lp.getByLabel('Usuário').fill('henrique');
  await lp.getByLabel('Senha').fill('tentativa');
  await lp.getByRole('button', { name: 'Entrar' }).last().click();
  await lp.locator('.error').waitFor();
  await lp.locator('.auth-card').screenshot({ path: `${OUT}/bloqueio.png` });
  // Política de Privacidade (resumo) e lista de espera
  const pv = await (await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pv.goto(`${BASE}/privacidade`);
  await pv.locator('.legal-summary').screenshot({ path: `${OUT}/privacidade.png` });
  const lw = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await lw.goto(BASE);
  await lw.evaluate(() => document.querySelectorAll('.lp-reveal').forEach((e) => e.classList.add('in')));
  await lw.locator('#lista').scrollIntoViewIfNeeded();
  await sleep(900);
  await lw.locator('#lista').screenshot({ path: `${OUT}/lista.png` });
  console.log('telas em promo/out/shots3');
} catch (e) {
  console.error('✗ FALHOU:', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 300);
}
