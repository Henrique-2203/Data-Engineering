// Teste das denúncias: denunciar mensagem, perfil e servidor; anonimato; cópia da prova mesmo se o
// autor apagar; fila da equipe com contador em tempo real; apagar, suspender conta e excluir servidor.
// Uso: npm run build && node e2e/reports.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3142;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-rep-')), PLATFORM_ADMINS: 'equipe', PRIVACY_CONTACT: '' },
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
  const reg = (u, d) => api('/auth/register', { username: u, password: 'segredo123', displayName: d, acceptTerms: true });
  const equipe = await reg('equipe', 'Equipe Resenha');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const bad = await api(`/channels/${geral.id}/messages`, { content: 'vou te achar na saída, otário' }, bia.token);

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'Ameaças a outro membro' : undefined));
    await page.goto(`${BASE}/app`);
    return page;
  };
  const pe = await open(equipe.token);
  await pe.getByRole('button', { name: 'Denúncias' }).waitFor();
  const pa = await open(ana.token);
  const pb = await open(bia.token);

  // ---------- denunciar mensagem ----------
  const msg = pa.locator('.message', { hasText: 'vou te achar na saída' });
  await msg.hover();
  await msg.getByRole('button', { name: 'Denunciar' }).click();
  await pa.getByLabel(/Assédio ou ameaça/).check();
  await pa.getByPlaceholder(/O que aconteceu/).fill('Ela ameaçou um membro do servidor.');
  await pa.screenshot({ path: `${shots}/33-denunciar.png` });
  await pa.getByRole('button', { name: 'Enviar denúncia' }).click();
  await pa.getByText('Denúncia enviada.').waitFor();
  await pa.getByRole('button', { name: 'Fechar' }).last().click();
  await pe.getByRole('button', { name: 'Denúncias (1 abertas)' }).waitFor({ timeout: 5000 });
  step('Ana denunciou a mensagem; o contador da equipe acendeu em tempo real');

  // regras: sem relação não denuncia, sem denúncia repetida, fila só para a equipe
  const stranger = await api('/reports', { type: 'message', id: bad.message.id, reason: 'spam' }, caio.token);
  const dup = await api('/reports', { type: 'message', id: bad.message.id, reason: 'spam' }, ana.token);
  const own = await api('/reports', { type: 'message', id: bad.message.id, reason: 'spam' }, bia.token);
  const notAdmin = await api('/admin/reports', null, ana.token);
  if (stranger.status !== 404 || dup.status !== 409 || own.status !== 400 || notAdmin.status !== 404) {
    throw new Error(`regras: ${stranger.status} ${dup.status} ${own.status} ${notAdmin.status}`);
  }
  step('quem não vê a mensagem não denuncia; sem denúncia repetida; ninguém denuncia a si mesmo; fila só da equipe');

  // a autora apaga a mensagem: a prova continua
  await api(`/messages/${bad.message.id}`, null, bia.token, 'DELETE');

  // ---------- denunciar perfil (motivo "alguém pode se machucar" mostra o CVV) ----------
  await pa.reload();
  await pa.locator('.members .member', { hasText: 'Bia' }).click();
  await pa.getByRole('button', { name: 'Denunciar Bia' }).click();
  await pa.getByLabel(/Alguém pode se machucar/).check();
  await pa.getByText(/CVV, ligue 188/).waitFor();
  await pa.getByLabel(/Spam ou golpe/).check();
  await pa.getByRole('button', { name: 'Enviar denúncia' }).click();
  await pa.getByText('Denúncia enviada.').waitFor();
  await pa.getByRole('button', { name: 'Fechar' }).last().click();
  step('denúncia de perfil pelo cartão; motivo de autolesão mostra o CVV (188)');

  // ---------- fila da equipe ----------
  await pe.getByRole('button', { name: /Denúncias \(2 abertas\)/ }).click();
  const queue = pe.getByRole('dialog', { name: 'Painel da equipe' });
  const item = queue.locator('.report-item', { hasText: 'Assédio ou ameaça' });
  await item.getByText('vou te achar na saída, otário').waitFor();
  await item.getByText(/já foi apagada; esta é a cópia guardada/).waitFor();
  await item.getByText('“Ela ameaçou um membro do servidor.”').waitFor();
  await queue.getByText('2 denúncias contra esta conta no total').first().waitFor();
  await pe.screenshot({ path: `${shots}/34-fila-denuncias.png` });
  step('a equipe vê a cópia da mensagem apagada, o motivo, os detalhes e o histórico da conta');

  // suspender a conta: cai na hora e não entra mais
  await item.getByRole('button', { name: 'Suspender conta' }).click();
  await pb.getByRole('tab', { name: 'Entrar' }).waitFor({ timeout: 5000 });
  const blocked = await api('/auth/login', { username: 'bia', password: 'segredo123' });
  if (blocked.status !== 403 || !/suspensa/.test(blocked.error)) throw new Error(`conta suspensa entrou: ${blocked.status}`);
  await queue.getByText('🎉 Nenhuma denúncia aberta.').waitFor({ timeout: 5000 });
  step(`conta suspensa: desconectada na hora e o login avisa ("${blocked.error.slice(0, 60)}…"); as 2 denúncias foram encerradas`);

  await queue.getByRole('tab', { name: 'Encerradas' }).click();
  await queue.getByText(/Conta suspensa: Ameaças a outro membro/).first().waitFor();
  await queue.getByRole('button', { name: 'Reativar conta' }).first().click();
  const back = await api('/auth/login', { username: 'bia', password: 'segredo123' });
  if (back.status !== 200) throw new Error('não reativou a conta');
  step('histórico das encerradas com a decisão; "Reativar conta" devolve o acesso');

  // ---------- denunciar servidor ----------
  const golpe = await api('/guilds', { name: 'Skins Grátis Free Fire' }, caio.token);
  await api(`/invites/${golpe.guild.inviteCode}/join`, {}, ana.token);
  await pa.reload();
  await pa.getByRole('button', { name: 'Skins Grátis Free Fire' }).first().click();
  await pa.locator('.guild-name').click();
  await pa.getByRole('button', { name: 'Denunciar servidor' }).click();
  await pa.getByLabel(/Spam ou golpe/).check();
  await pa.getByRole('button', { name: 'Enviar denúncia' }).click();
  await pa.getByText('Denúncia enviada.').waitFor();
  await pa.getByRole('button', { name: 'Fechar' }).last().click();
  await queue.getByRole('tab', { name: /^Denúncias/ }).click();
  await queue.locator('.report-item', { hasText: 'Skins Grátis Free Fire' }).getByRole('button', { name: 'Excluir servidor' }).click();
  await pa.locator('.rail-item[aria-label="Skins Grátis Free Fire"]').waitFor({ state: 'detached', timeout: 5000 });
  const gone = await api(`/guilds/${golpe.guild.id}`, null, caio.token);
  if (gone.status !== 404) throw new Error('servidor denunciado não foi excluído');
  step('servidor de golpe denunciado pelo menu e excluído pela equipe (some na hora para os membros)');

  // ---------- contato de privacidade padrão ----------
  await pa.goto(`${BASE}/privacidade`);
  await pa.getByRole('link', { name: 'resenha.brasilgames@gmail.com' }).first().waitFor();
  step('Política de Privacidade mostra o e-mail resenha.brasilgames@gmail.com');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
