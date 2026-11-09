// Teste de segurança e privacidade: cabeçalhos, senha forte, aparelhos conectados, troca de senha,
// códigos de recuperação, verificação em duas etapas, baixar dados, excluir conta, páginas legais,
// limites contra abuso e bloqueio de conexões de outros sites.
// Uso: npm run build && node e2e/security.mjs
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const PORT = 3141;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-sec-')), PRIVACY_CONTACT: 'privacidade@exemplo.com' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
function totp(secret, offset = 0) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
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

  // ---------- cabeçalhos ----------
  const home = await fetch(BASE);
  const h = Object.fromEntries(home.headers);
  for (const k of ['content-security-policy', 'x-frame-options', 'referrer-policy', 'x-content-type-options', 'permissions-policy']) {
    if (!h[k]) throw new Error(`falta o cabeçalho ${k}`);
  }
  if (!/frame-ancestors 'none'/.test(h['content-security-policy']) || !/script-src 'self'/.test(h['content-security-policy'])) throw new Error('CSP fraca');
  step(`cabeçalhos de segurança: CSP sem scripts de fora, anti-clickjacking, no-referrer, nosniff`);

  // ---------- senha forte ----------
  const weak = await api('/auth/register', { username: 'fraco', password: '12345678' });
  const short = await api('/auth/register', { username: 'curto', password: 'abc12' });
  const named = await api('/auth/register', { username: 'joaozinho', password: 'joaozinho2026' });
  if (weak.status !== 400 || short.status !== 400 || named.status !== 400) throw new Error(`senha fraca aceita: ${weak.status} ${short.status} ${named.status}`);
  step(`senhas fracas recusadas ("${weak.error}")`);

  browser = await chromium.launch();
  const ctx = async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await c.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('console', (m) => m.type() === 'error' && /Content Security Policy|Refused/.test(m.text()) && console.error('[csp]', m.text()));
    await page.goto(BASE);
    return page;
  };

  // ---------- cadastro pela tela (termos obrigatórios) ----------
  const pa = await ctx();
  await pa.getByRole('tab', { name: 'Criar conta' }).click();
  await pa.getByLabel('Usuário').fill('ana');
  await pa.getByLabel('Senha').fill('Pao-de-Queijo-77');
  await pa.locator('.strength', { hasText: 'Forte' }).waitFor();
  const disabled = await pa.getByRole('button', { name: 'Criar conta' }).last().isDisabled();
  await pa.getByLabel(/li e aceito os Termos/).check();
  await pa.getByRole('button', { name: 'Criar conta' }).last().click();
  await pa.getByText('Bem-vindo à Resenha!').waitFor({ timeout: 10000 });
  if (!disabled) throw new Error('dava para criar conta sem aceitar os termos');
  await pa.screenshot({ path: `${shots}/28-cadastro-ok.png` });
  step('cadastro: medidor de força da senha e aceite dos termos obrigatório');

  // ---------- aparelhos conectados: sair dos outros ----------
  const pb = await ctx();
  await pb.getByLabel('Usuário').fill('ana');
  await pb.getByLabel('Senha').fill('Pao-de-Queijo-77');
  await pb.getByRole('button', { name: 'Entrar' }).last().click();
  await pb.getByText('Bem-vindo à Resenha!').waitFor({ timeout: 10000 });
  await pa.getByRole('button', { name: 'Configurações', exact: true }).click();
  await pa.locator('.sessions li').nth(1).waitFor();
  await pa.locator('.sessions li', { hasText: 'este aparelho' }).waitFor();
  await pa.getByRole('button', { name: 'Sair de todos os outros' }).click();
  await pa.getByText('1 aparelho(s) desconectado(s).').waitFor();
  await pb.getByRole('tab', { name: 'Entrar' }).waitFor({ timeout: 5000 });
  step('2 aparelhos listados; "Sair de todos os outros" derruba o outro na hora');

  // ---------- códigos de recuperação ----------
  await pa.getByRole('button', { name: 'Gerar códigos' }).click();
  await pa.locator('.sec-panel').getByLabel('Confirme sua senha').fill('Pao-de-Queijo-77');
  await pa.getByRole('button', { name: /Gerar códigos \(os antigos/ }).click();
  await pa.locator('.codes code').first().waitFor();
  const codes = await pa.locator('.codes code').allTextContents();
  if (codes.length !== 10) throw new Error(`esperava 10 códigos, veio ${codes.length}`);
  await pa.screenshot({ path: `${shots}/29-codigos-recuperacao.png` });
  await pa.getByRole('button', { name: 'Já guardei' }).click();
  await pa.getByText('10 códigos disponíveis').waitFor();
  step(`10 códigos de recuperação gerados (ex.: ${codes[0]})`);

  // ---------- verificação em duas etapas ----------
  await pa.getByRole('button', { name: 'Ativar', exact: true }).click();
  await pa.locator('.sec-panel').getByLabel('Confirme sua senha').fill('Pao-de-Queijo-77');
  await pa.getByRole('button', { name: 'Continuar' }).click();
  await pa.locator('img.qr').waitFor();
  const secret = (await pa.locator('code.secret').textContent()).replace(/\s/g, '');
  await pa.getByLabel(/Digite o código de 6 dígitos/).fill(totp(secret));
  await pa.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  await pa.locator('.codes code').first().waitFor();
  const codes2 = await pa.locator('.codes code').allTextContents();
  await pa.screenshot({ path: `${shots}/30-2fa-ativada.png` });
  await pa.getByRole('button', { name: 'Já guardei' }).click();
  await pa.getByText(/Ativada: além da senha/).waitFor();
  step('2FA ativada com QR code + app autenticador; vieram códigos de recuperação novos');

  // login com 2FA: pede o código; código de agora já usado não vale de novo (espera o próximo)
  const noCode = await api('/auth/login', { username: 'ana', password: 'Pao-de-Queijo-77' });
  if (noCode.status !== 401 || !noCode.need2fa) throw new Error('login sem código passou');
  const used = totp(secret);
  const replay = await api('/auth/login', { username: 'ana', password: 'Pao-de-Queijo-77', code: used });
  if (replay.status !== 401) throw new Error('o mesmo código de 2FA funcionou duas vezes');
  const wait = 30_000 - (Date.now() % 30_000) + 500;
  await sleep(wait);
  const pc = await ctx();
  await pc.getByLabel('Usuário').fill('ana');
  await pc.getByLabel('Senha').fill('Pao-de-Queijo-77');
  await pc.getByRole('button', { name: 'Entrar' }).last().click();
  await pc.getByLabel('Código de verificação').fill(totp(secret));
  await pc.screenshot({ path: `${shots}/31-login-2fa.png` });
  await pc.getByRole('button', { name: 'Confirmar' }).click();
  await pc.getByText('Bem-vindo à Resenha!').waitFor({ timeout: 10000 });
  step('login pede o código do app; o mesmo código não vale duas vezes (anti-replay)');

  // ---------- recuperar a conta com código (sem e-mail) ----------
  const pd = await ctx();
  await pd.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await pd.getByLabel('Usuário').fill('ana');
  await pd.getByLabel('Código de recuperação').fill(codes2[0].toLowerCase());
  await pd.getByLabel('Nova senha').fill('Nova-Senha-Forte-2026');
  await pd.getByRole('button', { name: 'Trocar senha e entrar' }).click();
  await pd.getByText('Bem-vindo à Resenha!').waitFor({ timeout: 10000 });
  await pc.getByRole('tab', { name: 'Entrar' }).waitFor({ timeout: 5000 }); // o outro aparelho caiu
  const reuse = await api('/auth/recover', { username: 'ana', code: codes2[0], password: 'Outra-Senha-Forte-1' });
  if (reuse.status !== 400) throw new Error('código de recuperação usado duas vezes');
  const oldPw = await api('/auth/login', { username: 'ana', password: 'Pao-de-Queijo-77', code: codes2[1] });
  if (oldPw.status !== 401) throw new Error('senha antiga ainda funciona');
  step('"Esqueci minha senha" com código de recuperação: senha nova, outros aparelhos desconectados, código não reaproveita');

  // ---------- trocar senha pela API derruba as outras sessões ----------
  const bia = await api('/auth/register', { username: 'bia', password: 'Rosa-Forte-Senha-9', acceptTerms: true });
  const bia2 = await api('/auth/login', { username: 'bia', password: 'Rosa-Forte-Senha-9' });
  const wrongCurrent = await api('/me/password', { current: 'errada', next: 'Azul-Nova-Senha-10' }, bia.token);
  const changed = await api('/me/password', { current: 'Rosa-Forte-Senha-9', next: 'Azul-Nova-Senha-10' }, bia.token);
  const after = await api('/me/security', null, bia2.token);
  const still = await api('/me/security', null, bia.token);
  if (wrongCurrent.status !== 403 || changed.endedOtherSessions !== 1 || after.status !== 401 || still.status !== 200) throw new Error('troca de senha não protegeu as sessões');
  step('trocar a senha exige a atual e desconecta os outros aparelhos');

  // ---------- baixar meus dados ----------
  const { guild } = await api('/guilds', { name: 'Servidor da Bia' }, bia.token);
  const caio = await api('/auth/register', { username: 'caio', password: 'Verde-Senha-Forte-3', acceptTerms: true });
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const text = guild.channels.find((c) => c.type === 'text');
  await api(`/channels/${text.id}/messages`, { content: 'mensagem da bia' }, bia.token);
  const exp = await fetch(`${BASE}/api/me/export`, { headers: { authorization: `Bearer ${bia.token}` } });
  const raw = await exp.text();
  const data = JSON.parse(raw);
  if (!/attachment/.test(exp.headers.get('content-disposition')) || data.profile.username !== 'bia' || !data.messages.some((m) => m.content === 'mensagem da bia')) throw new Error('exportação incompleta');
  if (/password|scrypt|token_hash|totp_secret/i.test(raw.replace(/sua senha/gi, ''))) throw new Error('exportação vazou dado sensível');
  if (!data.profile.termsAcceptedAt) throw new Error('aceite dos termos não registrado');
  step(`"Baixar meus dados": perfil, servidores, amigos, ${data.messages.length} mensagem(ns), aparelhos (sem senha nem tokens)`);

  // ---------- limite contra spam ----------
  let spam429 = 0;
  for (let i = 0; i < 15; i++) if ((await api(`/channels/${text.id}/messages`, { content: `spam ${i}` }, caio.token)).status === 429) spam429++;
  if (!spam429) throw new Error('spam de mensagens não foi limitado');
  step(`spam de mensagens limitado (${spam429} de 15 recusadas)`);

  // ---------- excluir conta ----------
  const noConfirm = await api('/me/delete', { password: 'Azul-Nova-Senha-10', confirm: 'sim' }, bia.token);
  if (noConfirm.status !== 400) throw new Error('excluiu sem digitar EXCLUIR');
  const del = await api('/me/delete', { password: 'Azul-Nova-Senha-10', confirm: 'EXCLUIR' }, bia.token);
  const login = await api('/auth/login', { username: 'bia', password: 'Azul-Nova-Senha-10' });
  const gone = await api(`/guilds/${guild.id}`, null, caio.token);
  if (del.status !== 200 || del.deletedServers !== 1 || login.status !== 401 || gone.status !== 404) throw new Error(`exclusão incompleta ${JSON.stringify({ del, login: login.status, gone: gone.status })}`);
  step('"Excluir minha conta": exige senha e "EXCLUIR"; apaga a conta e o servidor dela');

  // ---------- páginas legais ----------
  const pl = await ctx();
  await pl.goto(`${BASE}/privacidade`);
  await pl.getByRole('heading', { name: 'Política de Privacidade' }).waitFor();
  await pl.getByRole('link', { name: 'privacidade@exemplo.com' }).first().waitFor();
  await pl.screenshot({ path: `${shots}/32-privacidade.png`, fullPage: false });
  await pl.getByRole('link', { name: 'Termos de uso' }).click();
  await pl.getByRole('heading', { name: 'Termos de uso' }).waitFor();
  step('páginas públicas /privacidade e /termos (com o contato configurado)');

  // ---------- conexão em tempo real vinda de outro site ----------
  const evil = io(BASE, { auth: { token: caio.token }, transports: ['websocket'], extraHeaders: { Origin: 'https://site-malicioso.com' }, reconnection: false });
  const evilResult = await new Promise((r) => {
    evil.on('connect', () => r('conectou'));
    evil.on('connect_error', () => r('recusado'));
    setTimeout(() => r('timeout'), 5000);
  });
  evil.disconnect();
  if (evilResult === 'conectou') throw new Error('aceitou conexão em tempo real de outro site');
  step('conexão em tempo real de outro site é recusada');

  // ---------- força bruta numa conta ----------
  let locked = false;
  for (let i = 0; i < 9; i++) {
    const r = await api('/auth/login', { username: 'caio', password: `errada${i}` });
    if (r.status === 429) locked = true;
  }
  if (!locked) throw new Error('não travou após várias senhas erradas');
  step('várias senhas erradas seguidas travam as tentativas por 15 minutos');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
