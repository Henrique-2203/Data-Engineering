// Teste das telas de cargos e personalização do servidor (dono + membro, dois navegadores):
// ícone e banner, criar cargo e dar ao membro (nome colorido e menu novo para ele), canal privado,
// categoria com arrastar e soltar, limite de voz e castigo.
// Uso: npm run build && node e2e/server-settings.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3133;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-settings-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana' });
  const bia = await api('/auth/register', { username: 'bia', password: 'segredo123', displayName: 'Bia' });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && console.error('[console]', m.text()));
    await page.goto(BASE);
    return page;
  };
  const pa = await open(ana.token);
  const pb = await open(bia.token);
  await pa.getByPlaceholder('Conversar em #geral').waitFor();
  await pb.getByPlaceholder('Conversar em #geral').waitFor();

  // imagens de teste geradas no navegador
  const makeImage = (page, w, h, color) =>
    page.evaluate(
      async ({ w, h, color }) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        g.font = `bold ${Math.round(h / 3)}px sans-serif`;
        g.fillText('RESENHA', w * 0.1, h * 0.6);
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        return Array.from(new Uint8Array(await b.arrayBuffer()));
      },
      { w, h, color },
    );
  const tmp = mkdtempSync(path.join(tmpdir(), 'resenha-img-'));
  const iconFile = path.join(tmp, 'icone.png');
  const bannerFile = path.join(tmp, 'banner.png');
  writeFileSync(iconFile, Buffer.from(await makeImage(pa, 1200, 900, '#5865f2')));
  writeFileSync(bannerFile, Buffer.from(await makeImage(pa, 3000, 1200, '#eb459e')));

  // ---- visão geral: ícone e banner ----
  await pa.locator('.guild-name').click();
  await pa.getByRole('button', { name: 'Configurações do servidor' }).click();
  await pa.locator('.settings-page input[type=file]').first().setInputFiles(iconFile);
  await pa.getByText(/Ícone atualizado \(\d+ KB\)/).waitFor({ timeout: 10000 });
  await pa.locator('.settings-page input[type=file]').nth(1).setInputFiles(bannerFile);
  const bannerToast = await pa.getByText(/Banner atualizado \(\d+ KB\)/).textContent({ timeout: 10000 });
  await pa.getByLabel('Descrição').fill('A resenha da galera 🎮');
  await pa.getByRole('button', { name: 'Salvar', exact: true }).click();
  await pa.getByText('Servidor atualizado.').waitFor();
  await pa.getByText(/MB de \d+ MB usados/).waitFor();
  await pa.screenshot({ path: `${shots}/19-config-visao-geral.png` });
  await pb.locator('.rail-item img.rail-img').waitFor({ timeout: 5000 });
  await pb.locator('.sidebar-header.with-banner').waitFor();
  await pb.getByText('A resenha da galera 🎮').waitFor();
  step(`ícone, banner e descrição salvos e aparecem para a Bia em tempo real (${bannerToast})`);

  // ---- cargos ----
  await pa.locator('.settings-nav').getByRole('button', { name: 'Cargos', exact: true }).click();
  await pa.getByRole('button', { name: '+ Criar' }).click();
  await pa.getByLabel('Nome do cargo').fill('Mod');
  await pa.getByLabel('Cor #3ba55d').click();
  await pa.getByLabel('Gerenciar canais').check();
  await pa.getByRole('button', { name: 'Salvar alterações' }).click();
  await pa.getByText('Cargo salvo.').waitFor();
  await pa.screenshot({ path: `${shots}/20-config-cargos.png` });
  await pa.locator('.settings-nav').getByRole('button', { name: 'Membros', exact: true }).click();
  await pa.locator('.member-admin-row', { hasText: 'Bia' }).getByRole('button', { name: 'Mod' }).click();
  await pa.locator('.member-admin-row', { hasText: 'Bia' }).locator('.role-pill.on', { hasText: 'Mod' }).waitFor();
  await pa.getByRole('button', { name: 'Fechar' }).click();
  // Bia: nome verde e opção de criar canal
  await pb.waitForFunction(() => {
    const el = [...document.querySelectorAll('.members .member .ellipsis')].find((e) => e.textContent.trim() === 'Bia');
    return el && getComputedStyle(el).color === 'rgb(59, 165, 93)';
  }, null, { timeout: 5000 });
  await pb.locator('.guild-name').click();
  await pb.getByRole('button', { name: 'Criar canal' }).waitFor();
  await pb.keyboard.press('Escape');
  await pb.locator('body').click({ position: { x: 700, y: 400 } });
  step('cargo "Mod" criado com cor e permissão; a Bia ganha o cargo, fica com o nome verde e pode criar canais');

  // ---- canal privado ----
  await pa.locator('.guild-name').click();
  await pa.getByRole('button', { name: 'Criar canal' }).click();
  await pa.getByLabel('Nome do canal').fill('segredos');
  await pa.getByText('🔒 Canal privado').click();
  await pa.getByRole('button', { name: 'Criar canal' }).last().click();
  await pa.getByPlaceholder('Conversar em #segredos').waitFor();
  await pa.locator('.channel', { hasText: 'segredos' }).locator('.private-icon').waitFor();
  await pb.waitForTimeout(800);
  if (await pb.locator('.channel', { hasText: 'segredos' }).count()) throw new Error('canal privado apareceu para a Bia');
  step('canal privado aparece com cadeado para a Ana e não aparece para a Bia');

  // ---- categoria + arrastar e soltar ----
  await pa.locator('.guild-name').click();
  await pa.getByRole('button', { name: 'Criar categoria' }).click();
  await pa.getByLabel('Nome da categoria').fill('Jogos');
  await pa.getByRole('button', { name: 'Criar categoria' }).last().click();
  const target = pa.locator('.channel-group', { hasText: 'Jogos' });
  await target.waitFor();
  await pa.locator('.channel', { hasText: 'Sala de voz' }).dragTo(target);
  await target.locator('.channel', { hasText: 'Sala de voz' }).waitFor({ timeout: 5000 });
  await pb.locator('.channel-group', { hasText: 'Jogos' }).locator('.channel', { hasText: 'Sala de voz' }).waitFor({ timeout: 5000 });
  step('categoria "Jogos" criada e o canal de voz arrastado para dentro dela (a Bia vê igual)');

  // ---- canal de voz: limite e qualidade ----
  await pa.locator('.channel', { hasText: 'Sala de voz' }).hover();
  await pa.locator('.channel', { hasText: 'Sala de voz' }).getByRole('button', { name: 'Editar canal' }).click();
  await pa.getByLabel('Qualidade do áudio').selectOption('256');
  await pa.getByLabel('Limite de pessoas').fill('4');
  await pa.getByRole('button', { name: 'Salvar' }).click();
  await pb.locator('.channel', { hasText: 'Sala de voz' }).locator('.voice-limit', { hasText: '0/4' }).waitFor({ timeout: 5000 });
  await pa.screenshot({ path: `${shots}/21-sidebar-categorias.png` });
  step('canal de voz com 256 kbps e limite de 4 pessoas (a Bia vê "0/4")');

  // ---- castigo pelo cartão do membro ----
  await pa.locator('.members').getByRole('button', { name: /Bia/ }).click();
  await pa.locator('.member-card').getByLabel('Castigar Bia').selectOption('5');
  await pb.getByText(/Você está de castigo neste servidor até/).waitFor({ timeout: 5000 });
  await pb.screenshot({ path: `${shots}/22-castigo.png` });
  await pa.locator('.member-card').getByRole('button', { name: 'Tirar castigo' }).click();
  await pb.getByPlaceholder('Conversar em #geral').waitFor({ timeout: 5000 });
  step('castigo pelo cartão do membro: o campo de texto da Bia trava e destrava em tempo real');

  console.log('\nTudo certo!');
} catch (err) {
  console.error('\n✗ FALHOU:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
