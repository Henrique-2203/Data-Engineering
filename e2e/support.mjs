// Suporte (chamados), pop-up de novidades com "Entendi" e site separado do app.
// Uso: npm run build && node e2e/support.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3184;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-sup-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
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
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const equipe = await reg('equipe', 'Equipe');
  const caio = await reg('caio', 'Caio');
  await api('/guilds', { name: 'Galera' }, ana.token);

  // ---------- API ----------
  const bad = await api('/support', { category: 'call', subject: 'x', message: 'oi' }, ana.token);
  assert(bad.status === 400, 'título curto demais é recusado');
  const t = await api('/support', { category: 'call', subject: 'Transmissão trava', message: 'Quando transmito o Valorant cai o FPS.', device: 'navegador · Chrome · Windows' }, ana.token);
  assert(t.status === 200 && t.ticket.status === 'open' && /Aparelho: navegador/.test(t.ticket.messages[0].body), 'chamado aberto com o aparelho');
  assert((await api('/admin/support', null, ana.token)).status === 404, 'quem não é da equipe não vê a fila');
  assert((await api(`/support/${t.ticket.id}/messages`, { message: 'me intrometendo' }, caio.token)).status === 404, 'outra pessoa não entra no chamado');
  const queue = await api('/admin/support', null, equipe.token);
  assert(queue.tickets.length === 1 && queue.tickets[0].user.username === 'ana', 'equipe vê o chamado');
  step('API: abrir chamado, só a pessoa e a equipe enxergam');

  // ---------- novidades: conta nova não vê histórico; "Entendi" grava por conta ----------
  const boot = await api('/bootstrap', null, ana.token);
  assert(boot.changelog && boot.changelog.seen === null, 'novidade ainda não confirmada');
  // simula alguém que só confirmou a penúltima novidade
  await api('/me/changelog-seen', { id: '2026-11-09a' }, ana.token);

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await ctx.addInitScript((tk) => localStorage.setItem('resenha.token', tk), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    return page;
  };
  const pa = await open(ana.token);
  await pa.goto(`${BASE}/app`);
  const popup = pa.getByRole('dialog', { name: 'Novidades do Resenha' });
  await popup.waitFor();
  await popup.getByText('Modo desempenho').waitFor();
  assert(!(await popup.getByText('Chat da call').isVisible()), 'só mostra o que a pessoa ainda não viu');
  assert(!/vulnerab|CVE|falha de segurança|XSS|injeç/i.test(await popup.textContent()), 'novidades sem detalhes técnicos de segurança');
  await pa.screenshot({ path: path.join(shots, 'novidades.png') });
  await pa.keyboard.press('Escape');
  await sleep(300);
  assert(await popup.isVisible(), 'Esc não fecha: precisa confirmar');
  await popup.getByRole('button', { name: 'Entendi' }).click();
  await popup.waitFor({ state: 'detached' });
  await sleep(300);
  assert((await api('/bootstrap', null, ana.token)).changelog.seen === '2026-11-10f', 'confirmação gravada na conta (a mais nova)');
  await pa.reload();
  await pa.getByRole('button', { name: /^Suporte/ }).waitFor();
  await sleep(800);
  assert(!(await pa.getByRole('dialog', { name: 'Novidades do Resenha' }).isVisible()), 'não aparece de novo');
  step('novidades: pop-up com o resumo, só fecha com "Entendi", gravado na conta (não volta)');

  // ---------- suporte pela interface ----------
  await pa.getByRole('button', { name: /^Suporte/ }).click();
  await pa.getByText('Transmissão trava').click();
  await pa.getByText('Quando transmito o Valorant cai o FPS.').waitFor();
  await pa.getByRole('button', { name: 'Meus chamados' }).click();
  await pa.getByRole('button', { name: 'Novo chamado' }).click();
  await pa.getByLabel('Título').fill('Ruído de teclado');
  await pa.getByLabel('O que aconteceu?').fill('Meus amigos ouvem meu teclado na call.');
  await pa.getByRole('dialog', { name: 'Novo chamado' }).getByRole('button', { name: 'Enviar', exact: true }).click();
  await pa.getByText('Chamado aberto!').waitFor();
  await pa.getByText('Meus amigos ouvem meu teclado na call.').waitFor();
  await pa.keyboard.press('Escape');

  const pe = await open(equipe.token);
  await pe.goto(`${BASE}/app`);
  await pe.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click().catch(() => {});
  await pe.getByRole('button', { name: /^Denúncias/ }).click();
  await pe.getByRole('tab', { name: /^Suporte/ }).click();
  await pe.getByRole('button', { name: /Ruído de teclado/ }).click();
  await pe.getByLabel('Resposta da equipe').fill('Ligue a Supressão de ruído: Forte (IA) em Configurações → Voz e vídeo.');
  await pe.getByRole('button', { name: 'Responder' }).click();
  await pe.getByText('Resposta enviada.').waitFor();
  await pe.screenshot({ path: path.join(shots, 'suporte-equipe.png') });

  await pa.getByRole('button', { name: 'Suporte (1 resposta nova)' }).waitFor({ timeout: 8000 });
  await pa.getByRole('button', { name: /^Suporte/ }).click();
  await pa.getByRole('button', { name: /Ruído de teclado/ }).click();
  await pa.getByText('Equipe do Resenha').waitFor();
  await pa.getByText('Ligue a Supressão de ruído').waitFor();
  await pa.screenshot({ path: path.join(shots, 'suporte.png') });
  await pa.getByRole('button', { name: 'Suporte', exact: true }).waitFor({ timeout: 5000 });
  step('suporte: chamado pelo app, equipe responde no painel, aviso de resposta nova some ao ler');

  // ---------- site separado do app ----------
  await pa.goto(`${BASE}/suporte`);
  await pa.getByRole('heading', { name: 'Suporte', exact: true }).waitFor();
  await pa.getByText('A transmissão está tirando FPS do meu jogo').click();
  await pa.getByText('Modo desempenho', { exact: false }).first().waitFor();
  await pa.getByRole('link', { name: 'Abrir um chamado no Resenha' }).click();
  await pa.waitForURL(`${BASE}/app`);
  await pa.getByRole('dialog', { name: 'Suporte' }).waitFor();
  await pa.goto(BASE);
  await pa.getByRole('link', { name: 'Abrir o Resenha' }).waitFor();
  await pa.getByRole('link', { name: 'Suporte' }).first().waitFor();
  step('site: página /suporte com dúvidas comuns e "Abrir um chamado" (leva ao app); "/" é o site mesmo logado');

  const exp = await (await fetch(`${BASE}/api/me/export`, { headers: { authorization: `Bearer ${ana.token}` } })).json();
  assert(exp.support?.length === 2 && exp.support.some((s) => s.messages.some((m) => m.from === 'equipe')), '"Baixar meus dados" inclui os chamados');
  step('"Baixar meus dados" inclui os chamados de suporte');

  console.log('\nTUDO CERTO (suporte, novidades e site)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
