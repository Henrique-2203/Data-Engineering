// Layout novo (em teste), liberado só para contas escolhidas pela equipe:
//  - quem não está na lista não vê a opção (nem forçando no aparelho); só a equipe muda a lista
//  - computador: cada conversa aberta vira aba; não lidas na aba; clique do meio e X fecham; a call fica no topo
//  - celular: barra de baixo (Início, Servidores, Mensagens, Avisos, Você); some dentro da conversa
// Uso: npm run build && node e2e/layout-novo.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3218;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-novo-'), PLATFORM_ADMINS: 'equipe' },
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
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const clipes = await api(`/guilds/${guild.id}/channels`, { name: 'clipes', type: 'text' }, ana.token);
  const clipesId = clipes.channel?.id ?? clipes.id;
  await api('/dms', { userId: bia.user.id }, ana.token);

  // só a equipe muda a lista
  assert((await api('/admin/beta', { layout2: ['ana'] }, bia.token, 'PUT')).status === 404, 'quem não é da equipe não muda a lista');
  const set = await api('/admin/beta', { layout2: ['@Ana', 'mercurio_1411 ', 'x'] }, equipe.token, 'PUT');
  assert(JSON.stringify(set.beta.layout2) === JSON.stringify(['ana', 'mercurio_1411']), `lista limpa: sem @, minúsculas, sem inválidos (${JSON.stringify(set.beta.layout2)})`);
  assert((await api('/bootstrap', null, ana.token)).features?.includes('layout2'), 'a Ana tem o recurso');
  assert(!(await api('/bootstrap', null, bia.token)).features?.includes('layout2'), 'a Bia não tem');
  step('só a equipe libera; a lista aceita "@conta" e ignora nomes inválidos; só quem está nela recebe o recurso');

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const open = async (token, device, layout) => {
    const ctx = await browser.newContext(device ?? { viewport: { width: 1360, height: 820 } });
    await ctx.addInitScript(
      ([t, l]) => {
        localStorage.setItem('resenha.token', t);
        localStorage.setItem('resenha.androidBanner', '1');
        if (l) localStorage.setItem('resenha.layout', l);
      },
      [token, layout ?? null],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };

  // a Bia força o layout novo no aparelho: não vale (não está na lista)
  const pb = await open(bia.token, null, 'novo');
  await pb.getByRole('button', { name: 'Galera' }).first().waitFor();
  await sleep(500);
  assert((await pb.locator('.novo-tabsbar').count()) === 0, 'sem a liberação, nada muda (mesmo forçando no aparelho)');
  await pb.getByRole('button', { name: 'Configurações', exact: true }).click();
  await pb.getByRole('button', { name: 'Aparência', exact: true }).click();
  await pb.getByRole('heading', { name: 'Cor de destaque' }).waitFor();
  assert((await pb.getByRole('radiogroup', { name: 'Layout' }).count()) === 0, 'a Bia não vê a opção de layout');
  await pb.keyboard.press('Escape');
  step('quem não está na lista não vê a opção nem o layout novo');

  // ---------- computador ----------
  const pa = await open(ana.token);
  await pa.getByRole('button', { name: 'Galera' }).first().waitFor();
  assert((await pa.locator('.novo-tabsbar').count()) === 0, 'começa no clássico');
  await pa.getByRole('button', { name: 'Configurações', exact: true }).click();
  await pa.getByRole('button', { name: 'Aparência', exact: true }).click();
  await pa.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: /Novo/ }).click();
  await pa.keyboard.press('Escape');
  const tabs = pa.getByRole('navigation', { name: 'Abas abertas' });
  await tabs.waitFor();
  await pa.getByRole('button', { name: 'Galera' }).first().click();
  await pa.getByText('clipes', { exact: true }).first().click();
  await pa.getByText('geral', { exact: true }).first().click();
  await tabs.locator('.novo-tab', { hasText: 'clipes' }).waitFor();
  await tabs.locator('.novo-tab.active', { hasText: 'geral' }).waitFor();
  step('Aparência → Layout: Novo; cada canal aberto vira uma aba (com o nome do servidor)');

  // mensagem nova num canal que não está aberto: a aba mostra
  assert(clipesId, `id do canal clipes (${JSON.stringify(clipes).slice(0, 120)})`);
  for (let i = 0; i < 2; i++) await api(`/channels/${clipesId}/messages`, { content: `clipe novo ${i}` }, bia.token);
  await tabs.locator('.novo-tab', { hasText: 'clipes' }).locator('.novo-badge').waitFor({ timeout: 5000 });
  step('mensagens novas aparecem na aba que não está aberta');

  // a conversa com a Bia também vira aba; clicar nas abas troca
  await pa.getByRole('button', { name: 'Início' }).first().click();
  await pa.getByText('Bia', { exact: true }).first().click();
  await tabs.locator('.novo-tab.active', { hasText: 'Bia' }).waitFor({ timeout: 5000 });
  await tabs.locator('.novo-tab', { hasText: 'geral' }).locator('.novo-tab-btn').click();
  await pa.locator('.main').getByText('geral').first().waitFor();
  await sleep(300);
  await pa.screenshot({ path: path.join(shots, 'layout-novo-abas.png') });
  // clique do meio fecha; X na aba aberta fecha e vai para a vizinha
  await tabs.locator('.novo-tab', { hasText: 'clipes' }).locator('.novo-tab-btn').click({ button: 'middle' });
  await tabs.locator('.novo-tab', { hasText: 'clipes' }).waitFor({ state: 'detached' });
  await tabs.getByRole('button', { name: 'Fechar aba geral' }).click();
  await tabs.locator('.novo-tab', { hasText: 'geral' }).waitFor({ state: 'detached' });
  await tabs.locator('.novo-tab.active').waitFor();
  step('clicar troca de aba; clique do meio fecha; fechar a aba aberta vai para a vizinha');

  // a call fica no topo, em qualquer aba
  await pa.getByRole('button', { name: 'Galera' }).first().click();
  await pa.getByRole('button', { name: 'Sala de voz' }).first().click();
  await pa.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await pa.getByText('geral', { exact: true }).first().click();
  const call = pa.locator('.novo-tabsbar').getByRole('group', { name: 'Call em andamento' });
  await call.waitFor();
  await call.getByRole('button', { name: 'Silenciar microfone' }).click();
  await call.getByRole('button', { name: 'Ligar microfone' }).waitFor();
  await sleep(300);
  await pa.screenshot({ path: path.join(shots, 'layout-novo-call.png') });
  await call.getByRole('button', { name: 'Sair da call' }).click();
  await call.waitFor({ state: 'detached' });
  // as abas ficam guardadas no aparelho
  await pa.reload();
  await tabs.locator('.novo-tab', { hasText: 'Sala de voz' }).waitFor({ timeout: 10000 });
  step('a call fica no topo em qualquer aba (silenciar e sair); as abas voltam depois de recarregar');

  // ---------- celular ----------
  const pm = await open(ana.token, devices['Pixel 7'], 'novo');
  const bottom = pm.getByRole('navigation', { name: 'Seções do Resenha' });
  await bottom.waitFor();
  await bottom.getByRole('button', { name: 'Servidores' }).click();
  await pm.getByRole('button', { name: /Galera/ }).first().waitFor();
  await sleep(300);
  await pm.screenshot({ path: path.join(shots, 'layout-novo-celular-servidores.png') });
  await pm.locator('.novo-server-card', { hasText: 'Galera' }).click();
  await pm.locator('.nav-drawer').getByText('geral', { exact: true }).first().waitFor();
  assert(await pm.getByRole('button', { name: 'Voltar para os servidores' }).isVisible(), 'dentro do servidor tem o botão de voltar');
  await pm.locator('.nav-drawer').getByText('geral', { exact: true }).first().click();
  await pm.locator('.composer textarea').waitFor();
  assert((await bottom.count()) === 0, 'dentro da conversa a barra de baixo some');
  await pm.getByRole('button', { name: /menu/i }).first().click();
  await bottom.waitFor();
  await pm.getByRole('button', { name: 'Voltar para os servidores' }).click();
  await pm.locator('.novo-server-card').first().waitFor();
  step('celular: Servidores em cartões → canais (com voltar) → conversa sem a barra → volta');
  await bottom.getByRole('button', { name: 'Mensagens' }).click();
  await pm.locator('.novo-section').getByText('Bia').first().waitFor();
  await bottom.getByRole('button', { name: 'Avisos' }).click();
  await pm.locator('.novo-section').getByRole('heading', { name: 'Avisos' }).waitFor();
  await bottom.getByRole('button', { name: 'Você' }).click();
  await pm.locator('.novo-section').getByRole('button', { name: 'Sair' }).waitFor();
  await sleep(300);
  await pm.screenshot({ path: path.join(shots, 'layout-novo-celular-voce.png') });
  await bottom.getByRole('button', { name: 'Início' }).click();
  await pm.locator('.novo-section').waitFor({ state: 'detached' });
  await sleep(300);
  await pm.screenshot({ path: path.join(shots, 'layout-novo-celular-inicio.png') });
  step('celular: Mensagens, Avisos, Você (configurações e Sair) e Início pela barra de baixo');
  console.log('\nTUDO CERTO (layout novo)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
