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
  const set = await api('/admin/beta', { layout2: ['@Ana', 'conta_teste ', 'x'] }, equipe.token, 'PUT');
  assert(JSON.stringify(set.beta.layout2) === JSON.stringify(['ana', 'conta_teste']), `lista limpa: sem @, minúsculas, sem inválidos (${JSON.stringify(set.beta.layout2)})`);
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
  const tabs = pa.getByRole('navigation', { name: 'Abas fixadas' });
  await tabs.waitFor();
  const pinned = () => tabs.locator('.novo-tab:not(.home)');
  const tab = (name) => pinned().filter({ has: pa.locator('.novo-tab-label', { hasText: new RegExp(`^${name}$`) }) });
  await pa.getByRole('button', { name: 'Galera' }).first().click();
  await pa.locator('.sidebar').getByText('clipes', { exact: true }).first().click();
  await pa.locator('.sidebar').getByText('geral', { exact: true }).first().click();
  await sleep(300);
  assert((await pinned().count()) === 0, 'abrir canais não cria aba sozinho');
  await tabs.getByText('Arraste um servidor, canal, call ou conversa para cá para fixar').waitFor();
  step('Aparência → Layout: Novo; abrir canais NÃO cria abas (só o Início e a dica de arrastar)');

  // arrastar para fixar: canal, servidor e conversa
  const bar = pa.locator('.novo-tabsbar');
  await pa.locator('.sidebar .channel[data-tab]', { hasText: 'clipes' }).dragTo(bar);
  await tab('clipes').waitFor();
  // servidor com foto: o arraste começa na imagem (o navegador arrastaria só a imagem)
  await pa.evaluate(() => {
    const icon = document.querySelector('.rail-item[data-tab] .rail-icon');
    const img = document.createElement('img');
    img.src = '/icon.svg';
    img.className = 'rail-img';
    img.setAttribute('draggable', 'false');
    icon.replaceChildren(img);
  });
  await pa.locator('.rail-item[data-tab] .rail-img').first().dragTo(bar);
  await tab('Galera').waitFor();
  // estou no #geral (não fixado): a aba acesa é a do servidor
  await tabs.locator('.novo-tab.active', { hasText: 'Galera' }).waitFor();
  await pa.getByRole('button', { name: 'Início' }).first().click();
  await pa.locator('.dm-item[data-tab]', { hasText: 'Bia' }).dragTo(bar);
  await tab('Bia').waitFor();
  assert((await pinned().count()) === 3, 'três abas fixadas');
  step('arrastar um canal, um servidor ou uma conversa até a barra fixa a aba');

  // mensagem nova num canal fixado que não está aberto: a aba mostra
  assert(clipesId, `id do canal clipes (${JSON.stringify(clipes).slice(0, 120)})`);
  for (let i = 0; i < 2; i++) await api(`/channels/${clipesId}/messages`, { content: `clipe novo ${i}` }, bia.token);
  await tab('clipes').locator('.novo-badge').waitFor({ timeout: 5000 });
  // clicar troca; arrastar uma aba para antes de outra muda a ordem
  await tab('Galera').locator('.novo-tab-btn').click();
  await pa.locator('.sidebar').getByText('geral', { exact: true }).first().waitFor();
  await tab('Bia').dragTo(tab('clipes'));
  const order = await pinned().locator('.novo-tab-label').allInnerTexts();
  assert(order.join(',') === 'Bia,clipes,Galera', `reordenar arrastando (${order.join(',')})`);
  await sleep(300);
  await pa.screenshot({ path: path.join(shots, 'layout-novo-abas.png') });
  // desafixar: clique do meio ou X (a conversa continua aberta)
  await tab('clipes').locator('.novo-tab-btn').click({ button: 'middle' });
  await tab('clipes').waitFor({ state: 'detached' });
  await tabs.getByRole('button', { name: 'Desafixar aba Galera' }).click();
  await tab('Galera').waitFor({ state: 'detached' });
  assert(await pa.locator('.sidebar').getByText('geral', { exact: true }).first().isVisible(), 'desafixar não fecha a conversa aberta');
  step('mensagens novas na aba; clicar troca; arrastar reordena; clique do meio ou X desafixa (sem fechar a conversa)');

  // ---------- Início novo ----------
  await tabs.locator('.novo-tab.home .novo-tab-btn').click();
  await pa.getByRole('heading', { name: /Bora pra resenha\?/ }).waitFor();
  const cont = pa.getByRole('region', { name: 'Continuar de onde parou' });
  await cont.getByText('geral', { exact: true }).waitFor();
  await cont.getByText('clipes', { exact: true }).waitFor();
  await pa.getByRole('region', { name: 'Acontecendo agora' }).first().waitFor();
  await sleep(300);
  await pa.screenshot({ path: path.join(shots, 'layout-novo-inicio.png') });
  await pa.locator('.novo-home-head').getByRole('button', { name: /Amigos/ }).click();
  await pa.getByRole('button', { name: 'Voltar ao Início' }).click();
  await cont.getByText('geral', { exact: true }).click();
  await pa.locator('.composer textarea').waitFor();
  step('Início novo: "Continuar de onde parou" (com as conversas abertas), "Acontecendo agora" e Amigos');

  // ---------- duas conversas lado a lado ----------
  // arrastar a aba da Bia para a direita da tela abre ao lado
  const src = await tab('Bia').boundingBox();
  const mainBox = await pa.locator('.main').boundingBox();
  await pa.mouse.move(src.x + 20, src.y + src.height / 2);
  await pa.mouse.down();
  await pa.mouse.move(src.x + 40, src.y + 40, { steps: 4 });
  await pa.locator('.novo-split-drop').waitFor();
  await pa.mouse.move(mainBox.x + mainBox.width * 0.8, mainBox.y + mainBox.height / 2, { steps: 8 });
  await pa.mouse.up();
  const side = pa.getByRole('region', { name: 'Conversa ao lado' });
  await side.waitFor();
  await side.locator('.novo-pane-title', { hasText: 'Bia' }).waitFor();
  await pa.locator('.novo-pane').first().getByPlaceholder(/#geral/).waitFor();
  // escrever na conversa ao lado
  await side.locator('.composer textarea').fill('oi do lado');
  await side.locator('.composer textarea').press('Enter');
  await side.locator('.message', { hasText: 'oi do lado' }).waitFor();
  // o que chega ao lado conta como lido
  const dmBia = (await api('/dms', null, ana.token)).dms.find((d) => d.recipient.username === 'bia');
  await api(`/channels/${dmBia.id}/messages`, { content: 'respondendo do outro lado' }, bia.token);
  await side.locator('.message', { hasText: 'respondendo do outro lado' }).waitFor();
  await sleep(1200);
  assert((await tab('Bia').locator('.novo-badge').count()) === 0, 'a conversa ao lado não fica com mensagens não lidas');
  await pa.screenshot({ path: path.join(shots, 'layout-novo-lado-a-lado.png') });
  step('arrastar uma aba para a direita abre a conversa ao lado; dá para escrever nela e o que chega conta como lido');

  // divisória: arrastar muda o tamanho
  const div = await pa.locator('.novo-divider').boundingBox();
  const before = await pa.locator('.novo-pane').first().boundingBox();
  await pa.mouse.move(div.x + 4, div.y + div.height / 2);
  await pa.mouse.down();
  await pa.mouse.move(div.x - 150, div.y + div.height / 2, { steps: 6 });
  await pa.mouse.up();
  const after = await pa.locator('.novo-pane').first().boundingBox();
  assert(after.width < before.width - 100, `a divisória muda o tamanho (${Math.round(before.width)} → ${Math.round(after.width)})`);
  // trocar de lado e fechar
  await side.getByRole('button', { name: 'Trocar de lado' }).click();
  await side.locator('.novo-pane-title', { hasText: 'geral' }).waitFor();
  await pa.locator('.novo-pane').first().getByText('oi do lado').waitFor();
  await side.getByRole('button', { name: 'Fechar a conversa ao lado' }).click();
  await side.waitFor({ state: 'detached' });
  // pelo botão da aba
  // pelo botão da aba (estou na conversa da Bia: abre o #geral ao lado não; abre a Bia ao lado estando no servidor)
  await pa.getByRole('button', { name: 'Galera' }).first().click();
  await pa.locator('.sidebar').getByText('geral', { exact: true }).first().click();
  await tab('Bia').hover();
  await pa.getByRole('button', { name: 'Abrir Bia ao lado' }).click();
  await side.locator('.novo-pane-title', { hasText: 'Bia' }).waitFor();
  await side.getByRole('button', { name: 'Fechar a conversa ao lado' }).click();
  step('a divisória muda o tamanho; "trocar de lado" e fechar; botão "abrir ao lado" na aba');

  // a call fica no topo, em qualquer tela
  await pa.getByRole('button', { name: 'Sala de voz' }).first().click();
  await pa.getByText('Voz conectada').waitFor({ timeout: 15000 });
  await pa.locator('.sidebar').getByText('geral', { exact: true }).first().click();
  const call = pa.locator('.novo-tabsbar').getByRole('group', { name: 'Call em andamento' });
  await call.waitFor();
  // clicar no nome da call abre a call
  await call.getByRole('button', { name: /Sala de voz/ }).click();
  await pa.locator('.voice-stage').first().waitFor({ timeout: 5000 });
  await pa.locator('.sidebar').getByText('geral', { exact: true }).first().click();
  await call.getByRole('button', { name: 'Silenciar microfone' }).click();
  await call.getByRole('button', { name: 'Ligar microfone' }).waitFor();
  await sleep(300);
  await pa.screenshot({ path: path.join(shots, 'layout-novo-call.png') });
  await call.getByRole('button', { name: 'Sair da call' }).click();
  await call.waitFor({ state: 'detached' });
  // as abas fixadas ficam guardadas no aparelho
  await pa.reload();
  await tab('Bia').waitFor({ timeout: 10000 });
  step('a call fica no topo (silenciar e sair); as abas fixadas voltam depois de recarregar');

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
  // dentro de um servidor, ir para outra seção e voltar em Servidores mostra a lista de servidores
  await pm.locator('.novo-server-card', { hasText: 'Galera' }).click();
  await pm.getByRole('button', { name: 'Voltar para os servidores' }).waitFor();
  await bottom.getByRole('button', { name: 'Mensagens' }).click();
  await bottom.getByRole('button', { name: 'Servidores' }).click();
  await pm.locator('.novo-server-card').first().waitFor({ timeout: 2000 });
  // um toque com o dedo escorregando um pouco para o lado não é "arrastar a tela"
  const nb = await bottom.getByRole('button', { name: 'Avisos' }).boundingBox();
  const cdp = await pm.context().newCDPSession(pm);
  const tx = nb.x + nb.width / 2;
  const ty = nb.y + nb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 1 }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx - i * 8, y: ty, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  assert((await bottom.count()) === 1, 'o toque escorregado não fecha a barra de baixo');
  await bottom.getByRole('button', { name: 'Avisos' }).tap();
  await pm.locator('.novo-section').getByRole('heading', { name: 'Avisos' }).waitFor({ timeout: 2000 });
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
