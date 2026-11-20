// Boas-vindas do servidor: o dono escreve a explicação (janela para quem chega, com #canais clicáveis) e
// escolhe o canal do aviso "fulano chegou 👋" (com botão "Dar oi"). Vale para convite, Explorar e o
// servidor oficial. E quem estava com o app aberto quando o servidor oficial foi criado entra na hora.
// Uso: npm run build && node e2e/welcome.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3248;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-welcome-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const equipe = await reg('equipe', 'Equipe');
  const dono = await reg('dono', 'Dono');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };

  // ---------- servidor de alguém: o dono configura pela tela ----------
  const { guild } = await api('/guilds', { name: 'Clã do Bomb' }, dono.token);
  await api(`/guilds/${guild.id}/channels`, { name: 'boas-vindas', type: 'text' }, dono.token);
  await api(`/guilds/${guild.id}`, { rules: '1. Respeito.', rulesRequired: true }, dono.token, 'PATCH');
  const pd = await open(dono.token);
  await pd.getByRole('button', { name: 'Clã do Bomb' }).first().click();
  await pd.locator('.sidebar-header .guild-name').click();
  await pd.getByRole('button', { name: 'Configurações do servidor' }).click();
  await pd.getByRole('button', { name: 'Boas-vindas', exact: true }).click();
  await pd.getByRole('button', { name: 'Usar texto sugerido' }).click();
  await pd.getByLabel(/Mensagem de boas-vindas/).fill('Que bom ter você aqui, {usuario}! 💚\n\nNo {servidor} a gente joga CS toda noite.\n💬 Se apresenta no #geral\n📜 Leia as regras e clique em "Aceito".');
  await pd.getByLabel('Avisar no chat quando alguém chegar').selectOption({ label: '#boas-vindas' });
  await pd.getByText('No Clã do Bomb a gente joga CS toda noite.').waitFor();
  await pd.screenshot({ path: path.join(shots, 'boas-vindas-config.png') });
  await pd.getByRole('button', { name: 'Salvar' }).click();
  await pd.getByText('Boas-vindas salvas.').waitFor();
  let g = (await api(`/guilds/${guild.id}`, null, dono.token)).guild;
  const bv = g.channels.find((c) => c.name === 'boas-vindas');
  assert(g.welcomeText.includes('{usuario}') && g.welcomeChannelId === bv.id, 'salvou o texto e o canal');
  assert((await api(`/guilds/${guild.id}`, { welcomeText: 'x' }, ana.token, 'PATCH')).status >= 400, 'só quem gerencia o servidor muda');
  await pd.keyboard.press('Escape');
  step('dono escreve as boas-vindas (com {usuario}, {servidor} e prévia) e escolhe o canal do aviso');

  // ---------- a Ana entra por convite: janela + aviso no canal ----------
  const pa = await open(ana.token);
  await pa.getByRole('button', { name: 'Entrar com convite' }).first().click();
  await pa.getByLabel('Link ou código do convite').fill(g.inviteCode);
  await pa.getByRole('button', { name: 'Entrar', exact: true }).last().click();
  const wd = pa.getByRole('dialog', { name: 'Bem-vindo(a) ao Clã do Bomb! 🎉' });
  await wd.getByText('Que bom ter você aqui, Ana! 💚').waitFor();
  await wd.getByText('No Clã do Bomb a gente joga CS toda noite.').waitFor();
  await pa.screenshot({ path: path.join(shots, 'boas-vindas-janela.png') });
  // #geral vira botão que leva ao canal
  await wd.getByRole('button', { name: '#geral' }).click();
  await pa.getByRole('dialog').waitFor({ state: 'detached' });
  step('quem entra por convite vê a janela com a explicação (nome trocado, #canal clicável)');

  // aviso no #boas-vindas: o dono vê ao vivo e dá oi
  await pd.getByRole('button', { name: /^boas-vindas/ }).click();
  const line = pd.locator('.system-join', { hasText: 'Ana' });
  await line.waitFor({ timeout: 5000 });
  await pd.screenshot({ path: path.join(shots, 'boas-vindas-chat.png') });
  await line.getByRole('button', { name: '👋 Dar oi' }).click();
  await pd.getByText('👋 Bem-vindo(a), @ana!').waitFor();
  const msgs = (await api(`/channels/${bv.id}/messages`, null, dono.token)).messages;
  const join = msgs.find((m) => m.system === 'join');
  assert(join && join.author.id === ana.user.id, 'aviso automático salvo no canal');
  assert((await api(`/messages/${join.id}`, { content: 'editado' }, ana.token, 'PATCH')).status === 400, 'aviso automático não é editável');
  // a Ana vê o aviso dela com "Ver as boas-vindas"
  await pa.getByRole('button', { name: /^boas-vindas/ }).click();
  await pa.locator('.system-join', { hasText: 'Ana' }).getByRole('button', { name: 'Ver as boas-vindas' }).click();
  await pa.getByRole('dialog', { name: 'Bem-vindo(a) ao Clã do Bomb! 🎉' }).getByRole('button', { name: 'Ler as regras' }).click();
  await pa.getByRole('dialog', { name: 'Regras do Clã do Bomb' }).getByRole('button', { name: 'Aceito' }).click();
  step('aviso "Ana chegou 👋" no #boas-vindas, ao vivo, com "Dar oi"; a Ana revê as boas-vindas e vai para as regras');

  // sair e entrar de novo no mesmo dia não repete o aviso
  await api(`/guilds/${guild.id}/members/@me`, null, ana.token, 'DELETE');
  await api(`/invites/${g.inviteCode}/join`, {}, ana.token);
  const after = (await api(`/channels/${bv.id}/messages`, null, dono.token)).messages.filter((m) => m.system === 'join');
  assert(after.length === 1, `sai-e-entra não repete o aviso (${after.length})`);
  // sem canal escolhido: nada no chat; sem texto: sem janela
  await api(`/guilds/${guild.id}`, { welcomeChannelId: null, welcomeText: '' }, dono.token, 'PATCH');
  await api(`/invites/${g.inviteCode}/join`, {}, bia.token);
  assert((await api(`/channels/${bv.id}/messages`, null, dono.token)).messages.filter((m) => m.system === 'join').length === 1, 'sem canal: não avisa');
  step('sai-e-entra não repete o aviso; desligado, não avisa nem abre janela');

  // ---------- servidor oficial: quem já estava com o app aberto entra na hora ----------
  const caio = await reg('caio', 'Caio');
  const pc = await open(caio.token); // abriu o app ANTES de o servidor oficial existir
  await sleep(800);
  const ofc = await api('/admin/official', { name: 'Resenha Brasil OFC', moderators: [] }, equipe.token);
  assert(ofc.guildId, 'oficial criado');
  const ow = pc.getByRole('dialog', { name: 'Bem-vindo(a) ao Resenha Brasil OFC! 🎉' });
  await ow.getByText('Que bom ter você aqui, Caio!').waitFor({ timeout: 8000 });
  await ow.getByRole('button', { name: '#procurando-grupo' }).waitFor();
  await pc.screenshot({ path: path.join(shots, 'boas-vindas-oficial.png') });
  assert((await api('/bootstrap', null, caio.token)).guilds.some((x) => x.id === ofc.guildId), 'Caio entrou sem recarregar');
  const geralOfc = (await api(`/guilds/${ofc.guildId}`, null, equipe.token)).guild.channels.find((c) => c.name === 'geral');
  assert((await api(`/channels/${geralOfc.id}/messages`, null, equipe.token)).messages.some((m) => m.system === 'join' && m.author.id === caio.user.id), 'aviso no #geral do oficial');
  step('servidor oficial: quem estava com o app aberto entra na hora (sem recarregar), com a janela de boas-vindas e o aviso no #geral');

  console.log('\nTUDO CERTO (boas-vindas)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
