// Recursos em teste liberados por conta (layout2, phonecam, bots) e o servidor de testes da equipe:
//  - salvar uma lista não apaga as outras; só a equipe muda; nomes limpos
//  - o servidor barra quem não tem o recurso (requireFeature)
//  - "Criar servidor de testes": privado, dono = equipe, entram só as contas liberadas, pode repetir
//  - a tela do painel mostra os 3 campos e o botão
// Uso: npm run build && node e2e/beta-features.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const PORT = 3267;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-beta-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
let ip = 1;
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${ip++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  const reg = (u) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', acceptTerms: true });
  const equipe = await reg('equipe');
  const ana = await reg('ana');
  const bia = await reg('bia');
  const caio = await reg('caio');
  const dudu0 = await reg('dudu0');

  // salvar uma lista não apaga as outras
  // padrão: layout novo e câmera do celular já lançados para todos; aqui testamos o modo "só as listas"
  const def = await api('/admin/beta', null, equipe.token);
  assert(JSON.stringify(def.beta.open) === JSON.stringify(['layout2', 'phonecam']), `padrão: lançados para todos (${JSON.stringify(def.beta.open)})`);
  assert(JSON.stringify(await api('/bootstrap', null, bia.token).then((r) => r.features)) === JSON.stringify(['layout2', 'phonecam']), 'sem lista, a conta comum já tem os dois lançados');
  await api('/admin/beta', { open: [] }, equipe.token, 'PUT');
  await api('/admin/beta', { layout2: ['ana'] }, equipe.token, 'PUT');
  const p1 = await api('/admin/beta', { phonecam: ['@Bia', 'x'] }, equipe.token, 'PUT');
  assert(JSON.stringify(p1.beta) === JSON.stringify({ layout2: ['ana'], phonecam: ['bia'], bots: [], open: [] }), `mescla: ${JSON.stringify(p1.beta)}`);
  const p2 = await api('/admin/beta', { bots: ['ana', 'caio'] }, equipe.token, 'PUT');
  assert(p2.beta.layout2[0] === 'ana' && p2.beta.phonecam[0] === 'bia' && p2.beta.bots.length === 2, 'as três listas ficam');
  assert((await api('/admin/beta', { bots: ['bia'] }, bia.token, 'PUT')).status === 404, 'só a equipe muda');
  assert((await api('/admin/test-guild', {}, bia.token)).status === 404, 'só a equipe cria o servidor de testes');
  const bf = (t) => api('/bootstrap', null, t).then((r) => r.features);
  assert(JSON.stringify(await bf(ana.token)) === JSON.stringify(['layout2', 'bots']), 'ana: layout2 e bots');
  assert(JSON.stringify(await bf(bia.token)) === JSON.stringify(['phonecam']), 'bia: phonecam');
  assert((await bf(equipe.token)).length === 0, 'a equipe não ganha recurso sozinha: precisa estar na lista');
  step('salvar uma lista mantém as outras; só a equipe muda; cada conta recebe só os seus recursos');

  // liberar para todos / voltar atrás pelo painel (a API)
  assert((await api('/admin/beta', { open: ['phonecam'] }, bia.token, 'PUT')).status === 404, 'só a equipe libera para todos');
  assert((await api('/admin/beta', { open: ['nao-existe'] }, equipe.token, 'PUT')).status === 400, 'recurso inválido');
  await api('/admin/beta', { open: ['phonecam'] }, equipe.token, 'PUT');
  assert((await bf(caio.token)).includes('phonecam'), 'liberado para todos: o Caio (fora da lista) recebe');
  assert((await bf(caio.token)).includes('bots'), 'caio está na lista dos bots');
  assert(!(await bf(dudu0.token)).includes('bots'), 'bots continuam só da lista');
  await api('/admin/beta', { open: [] }, equipe.token, 'PUT');
  assert(!(await bf(dudu0.token)).includes('phonecam'), 'desligou: volta a ser só da lista');
  step('"Para todos": libera um recurso para todas as contas e dá para desfazer; os outros seguem só nas listas');

  // servidor de testes (os aplicativos abertos recebem o aviso para mostrar o servidor na hora)
  const watch = (token) =>
    new Promise((resolve) => {
      const s = io(BASE, { auth: { token }, transports: ['websocket'] });
      const got = [];
      s.onAny((ev, d) => ev === 'guild:refresh' && got.push(d.guildId));
      s.on('ready', () => resolve({ s, got }));
    });
  const wEquipe = await watch(equipe.token);
  const wBia = await watch(bia.token);
  const t1 = await api('/admin/test-guild', {}, equipe.token);
  await sleep(500);
  assert(wEquipe.got.includes(t1.guildId), 'quem clicou recebe o aviso de servidor novo');
  assert(wBia.got.includes(t1.guildId), 'quem foi adicionado recebe o aviso de servidor novo');
  wEquipe.s.close();
  wBia.s.close();
  assert(t1.status === 200 && t1.created && t1.guildId, `criou: ${JSON.stringify(t1)}`);
  assert([...t1.added].sort().join() === 'ana,bia,caio', `entraram as 3 contas liberadas: ${t1.added}`);
  const g = await api(`/guilds/${t1.guildId}`, null, equipe.token);
  assert(g.guild.name === 'Laboratório Resenha' && g.guild.ownerId === equipe.user.id, 'nome e dono');
  assert(g.guild.members.length === 4, `4 membros: ${g.guild.members.length}`);
  assert(g.guild.channels.some((c) => c.type === 'voice') && g.guild.channels.some((c) => c.type === 'text'), 'canal de texto e de voz');
  assert((await api(`/guilds/${t1.guildId}`, null, (await reg('dudu')).token)).status === 404, 'privado: quem não entrou não acessa');
  assert(!(await api('/explore', null, ana.token)).guilds?.some((x) => x.id === t1.guildId), 'não aparece em Explorar');
  const t2 = await api('/admin/test-guild', {}, equipe.token);
  assert(!t2.created && t2.guildId === t1.guildId && t2.added.length === 0, `repetir não duplica: ${JSON.stringify(t2)}`);
  const dudu2 = await reg('leo');
  await api('/admin/beta', { phonecam: ['bia', 'leo'] }, equipe.token, 'PUT');
  const t3 = await api('/admin/test-guild', {}, equipe.token);
  assert(t3.added.join() === 'leo' && !t3.created, `só entra quem foi liberado depois: ${JSON.stringify(t3)}`);
  assert((await api(`/guilds/${t1.guildId}`, null, dudu2.token)).status === 200, 'leo já entrou');
  step('servidor de testes: privado, só com as contas liberadas, repetir não duplica e acrescenta quem foi liberado depois');

  // quem está com o app aberto vê o servidor aparecer sozinho, sem recarregar
  browser = await chromium.launch();
  await reg('mia');
  const mctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const mpage = await mctx.newPage();
  await mpage.goto(`${BASE}/app`);
  await mpage.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('mia');
  await mpage.getByLabel('Senha', { exact: true }).fill('Cor-Forte-Xis-42');
  await mpage.getByRole('button', { name: /^Entrar$/ }).click();
  await mpage.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
  await mpage.getByRole('button', { name: 'Criar servidor' }).first().waitFor();
  await api('/admin/beta', { phonecam: ['bia', 'leo', 'mia'] }, equipe.token, 'PUT');
  await api('/admin/test-guild', {}, equipe.token);
  await mpage.getByRole('button', { name: 'Laboratório Resenha' }).first().waitFor({ timeout: 10000 });
  await mctx.close();
  step('quem está com o app aberto vê o Laboratório Resenha aparecer na coluna de servidores, sem recarregar');

  // tela do painel
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/app`);
  await page.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('equipe');
  await page.getByLabel('Senha', { exact: true }).fill('Cor-Forte-Xis-42');
  await page.getByRole('button', { name: /^Entrar$/ }).click();
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: 'Denúncias' }).click();
  await page.getByRole('tab', { name: 'Saúde' }).click();
  const pc = page.getByLabel('Contas com a câmera do celular');
  await pc.waitFor();
  assert((await pc.inputValue()).includes('@bia'), 'campo mostra a lista salva');
  await pc.fill('@bia, @caio');
  await page.getByRole('button', { name: 'Salvar Câmera do celular' }).click();
  await page.getByText('Câmera do celular liberado para 2 conta(s).').waitFor();
  assert((await api('/admin/beta', null, equipe.token)).beta.bots.length === 2, 'salvar pela tela não apagou os bots');
  await page.screenshot({ path: `${shots}/beta-painel.png` });
  await page.getByRole('button', { name: 'Criar servidor de testes' }).click();
  await page.getByText(/Laboratório Resenha já está pronto|Entraram no Laboratório/).waitFor();
  assert(errors.length === 0, `erros na página: ${errors.join(' | ')}`);
  step('painel da equipe: 3 campos, salvar pela tela mantém as outras listas, botão do servidor de testes');

  console.log('\nTudo certo com os recursos em teste.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
