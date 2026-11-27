// Avisos que a pessoa PRECISA ler (quantos códigos de recuperação restam; conta excluída): eram alert() do navegador,
// que some em Android/Electron/janelas embutidas. Agora são janelas do app que NÃO somem sozinhas. O teste também FALHA
// se qualquer alert()/confirm()/prompt() nativo abrir nesses fluxos. Uso: npm run build && node e2e/notices-ui.mjs
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3311;
const BASE = `http://localhost:${PORT}`;
const PASS = 'Pao-de-Queijo-77';
const NEW = 'Nova-Senha-Forte-2026';
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-notices-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
function totp(secret) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) (bytes.push((value >>> (bits - 8)) & 255), (bits -= 8));
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
let ip = 1;
const api = async (p, body, token) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.15.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
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
  const ana = await api('/auth/register', { username: 'ana', password: PASS, displayName: 'Ana', acceptTerms: true });
  // com a verificação em duas etapas ligada, cada login com um código de recuperação GASTA o código (e a API de
  // recuperação limita 6 por conta a cada 15 min: por isso gastamos 7 por aqui e o 8º pela TELA, deixando 2)
  const setup = await api('/me/2fa/setup', { password: PASS }, ana.token);
  const enabled = await api('/me/2fa/enable', { code: totp(setup.secret) }, ana.token);
  const codes = enabled.codes ?? enabled.recoveryCodes;
  assert(codes?.length === 10, `setup: 10 códigos de recuperação (${JSON.stringify(enabled).slice(0, 120)})`);
  for (let i = 0; i < 7; i++) assert((await api('/auth/login', { username: 'ana', password: PASS, code: codes[i] })).status === 200, `setup: login com o código de recuperação ${i + 1}`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const nativos = [];
  page.on('dialog', (d) => (nativos.push(`${d.type()}: ${d.message()}`), d.dismiss()));

  // ---- 1) recuperar a senha pela tela com poucos códigos restantes ----
  await page.goto(`${BASE}/app`);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('Usuário').fill('ana');
  await page.getByLabel('Código de recuperação').fill(codes[7].toLowerCase());
  await page.getByLabel('Nova senha').fill(NEW);
  await page.getByRole('button', { name: 'Trocar senha e entrar' }).click();
  const aviso = page.getByRole('dialog', { name: 'Senha trocada!' });
  await aviso.waitFor({ timeout: 10000 });
  assert(/Restam 2 códigos de recuperação/.test(await aviso.innerText()), `o aviso diz quantos códigos restam (${await aviso.innerText()})`);
  await page.screenshot({ path: 'e2e/screenshots/aviso-codigos.png' });
  await sleep(5000); // mais que o tempo de um toast: o aviso NÃO pode sumir sozinho
  assert(await aviso.isVisible(), 'o aviso continua na tela depois de 5 s (não some sozinho)');
  await aviso.getByRole('button', { name: 'Entendi' }).click();
  await page.getByText('Bem-vindo à Resenha!').waitFor({ timeout: 10000 });
  step('recuperar senha: o aviso "Restam 2 códigos" aparece, não some sozinho e só segue quando a pessoa clica em Entendi');

  // ---- 2) excluir a conta pela tela ----
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('navigation', { name: 'Categorias' }).getByRole('button', { name: 'Privacidade e dados', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir conta' }).click();
  await page.getByLabel('Senha', { exact: true }).last().fill(NEW);
  await page.getByLabel(/Código do app autenticador/).fill(codes[8]); // (a conta tem 2FA: um código de recuperação vale)
  await page.getByLabel(/Digite EXCLUIR/).fill('EXCLUIR');
  await page.getByRole('button', { name: 'Excluir minha conta para sempre' }).click();
  const fim = page.getByRole('dialog', { name: 'Conta excluída' });
  await fim.waitFor({ timeout: 10000 });
  assert(/Obrigado por ter usado o Resenha/.test(await fim.innerText()), 'a mensagem de despedida aparece');
  await sleep(4500);
  assert(await fim.isVisible(), 'o aviso de conta excluída também não some sozinho');
  await fim.getByRole('button', { name: 'Entendi' }).click();
  await page.getByRole('tab', { name: 'Entrar' }).waitFor({ timeout: 8000 });
  assert((await api('/auth/login', { username: 'ana', password: NEW })).status === 401, 'a conta foi mesmo excluída');
  step('excluir conta: despedida na tela até a pessoa fechar, depois volta para o login');

  assert(nativos.length === 0, `abriu janela(s) nativa(s) do navegador: ${nativos.join(' | ')}`);
  step('nenhum alert()/confirm()/prompt() nativo abriu nesses fluxos');
  console.log('\nTUDO CERTO (avisos do app, sem alert() nativo)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
