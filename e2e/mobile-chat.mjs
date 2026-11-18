// Chat no celular: um toque não abre ações sem querer; segurar a mensagem abre o menu grande (reagir,
// responder, copiar, editar, excluir); editar tem caixa grande com Cancelar e Salvar. No computador continua
// a barrinha no mouse. Também: ícone de som no servidor da call e "Canal de avisos" já ao criar o canal.
// Uso: npm run build && node e2e/mobile-chat.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3203;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-mobchat-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};

/** segura o dedo na mensagem (eventos de toque) */
async function longPress(page, locator, ms = 650) {
  const box = await locator.boundingBox();
  const opts = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: box.x + 40, clientY: box.y + box.height / 2 };
  await locator.dispatchEvent('pointerdown', opts);
  await sleep(ms);
  await locator.dispatchEvent('pointerup', opts);
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
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  await api(`/channels/${geral.id}/messages`, { content: 'oi galera, bora jogar hoje?' }, bia.token);
  await api(`/channels/${geral.id}/messages`, { content: 'bora! mensagem para editar' }, ana.token);

  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${BASE}/app`);
  await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
  await page.getByRole('button', { name: 'Galera' }).first().click();
  await page.getByText('geral', { exact: true }).first().click();
  await page.locator('.message', { hasText: 'mensagem para editar' }).waitFor();
  // pelo id: durante a edição o texto some da mensagem (vira a caixa de edição)
  const mine = page.locator(`#${await page.locator('.message', { hasText: 'mensagem para editar' }).getAttribute('id')}`);

  // um toque não mostra ações (antes abria e o próximo toque disparava a ação sem querer)
  await mine.tap();
  await sleep(300);
  assert(!(await mine.locator('.message-actions').isVisible().catch(() => false)), 'toque simples não mostra a barrinha de ações');
  step('no celular, um toque na mensagem não abre ações');

  // segurar abre o menu grande
  await longPress(page, mine);
  const sheet = page.getByRole('dialog', { name: 'Ações da mensagem' });
  await sheet.waitFor({ timeout: 3000 });
  for (const b of ['Responder', 'Copiar texto', 'Editar', 'Excluir', 'Fechar']) await sheet.getByRole('button', { name: b }).waitFor();
  const h = (await sheet.getByRole('button', { name: 'Editar' }).boundingBox()).height;
  assert(h >= 48, `botões grandes no menu (${h}px)`);
  await sleep(250);
  await page.screenshot({ path: path.join(shots, 'mobile-menu-mensagem.png') });
  // reagir pelo menu
  await sheet.getByRole('button', { name: 'Reagir com 👍' }).click();
  await mine.locator('.reaction', { hasText: '👍' }).waitFor();
  step(`segurar a mensagem abre o menu com reações rápidas e botões de ${Math.round(h)}px; reagir funciona`);

  // editar: caixa grande, Cancelar sai sem salvar
  await longPress(page, mine);
  await sheet.getByRole('button', { name: 'Editar' }).click();
  const box = mine.getByRole('textbox', { name: 'Editar mensagem' });
  await box.waitFor();
  const bb = await box.boundingBox();
  assert(bb.height >= 90 && bb.width > 250, `caixa de edição grande (${Math.round(bb.width)}x${Math.round(bb.height)})`);
  const fs = await box.evaluate((e) => getComputedStyle(e).fontSize);
  assert(fs === '16px', `letra de 16px na edição (sem zoom do celular): ${fs}`);
  await box.fill('texto que não deve salvar');
  await mine.getByRole('button', { name: 'Cancelar' }).click();
  await mine.getByText('bora! mensagem para editar').waitFor();
  // editar e salvar
  await longPress(page, mine);
  await sheet.getByRole('button', { name: 'Editar' }).click();
  await box.fill('mensagem editada pelo celular');
  await page.screenshot({ path: path.join(shots, 'mobile-editar.png') });
  await mine.getByRole('button', { name: 'Salvar' }).click();
  await page.locator('.message', { hasText: 'mensagem editada pelo celular' }).getByText('(editada)').waitFor();
  step('editar no celular: caixa grande com letra de 16px, Cancelar sai sem salvar e Salvar salva');

  // mensagem de outra pessoa: Denunciar, sem Editar
  const other = page.locator('.message', { hasText: 'oi galera' });
  await longPress(page, other);
  await sheet.getByRole('button', { name: 'Denunciar' }).waitFor();
  assert((await sheet.getByRole('button', { name: 'Editar' }).count()) === 0, 'não edita mensagem dos outros');
  await sheet.getByRole('button', { name: 'Fechar' }).click();
  await sheet.waitFor({ state: 'detached' });
  step('na mensagem dos outros aparece Denunciar e não Editar; Fechar fecha');

  // caixa de mensagem: "+" abre as bolhas; Formatar põe **negrito**; a formatação aparece na mensagem
  await page.getByRole('button', { name: 'Mais opções' }).click();
  for (const n of ['Foto, vídeo ou arquivo', 'Enquete', 'Figurinha', 'Formatar texto']) await page.getByRole('menuitem', { name: n }).waitFor();
  await page.getByRole('menuitem', { name: 'Formatar texto' }).click();
  const input = page.locator('.composer textarea');
  await input.fill('aviso importante');
  await input.evaluate((e) => e.setSelectionRange(6, 16));
  await page.getByRole('button', { name: 'Negrito' }).click();
  assert((await input.inputValue()) === 'aviso **importante**', `negrito pela barra (${await input.inputValue()})`);
  const send = page.getByRole('button', { name: 'Enviar', exact: true });
  const sb = await send.boundingBox();
  assert(sb.width >= 44 && sb.height >= 44, `botão de enviar grande (${sb.width}x${sb.height})`);
  await send.click();
  await page.locator('.message strong', { hasText: 'importante' }).waitFor();
  await api(`/channels/${geral.id}/messages`, { content: '# Regras\n- uma\n- duas\n> citação\n||segredo||' }, bia.token);
  await page.locator('.md-h1', { hasText: 'Regras' }).waitFor();
  assert((await page.locator('.md-li').count()) >= 2 && (await page.locator('.md-quote').count()) >= 1 && (await page.locator('.md-spoiler').count()) >= 1, 'título, lista, citação e spoiler');
  step('"+" abre as bolhas (arquivo, enquete, figurinha, formatar); a barra de formatação põe negrito; enviar com 44px; mensagens com título, lista, citação e spoiler');

  // ícone de som no servidor da call
  await page.getByRole('button', { name: /menu/i }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Sala de voz' }).first().click();
  await page.getByText('Voz conectada').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Galera' }).first().locator('.rail-voice').waitFor({ timeout: 5000 });
  step('em call: ícone de som no servidor da call, na coluna de servidores');
  await page.getByRole('button', { name: 'Sair da chamada' }).click().catch(() => {});

  // computador: continua a barrinha com o mouse
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await pc.context().addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  await pc.goto(`${BASE}/app`);
  await pc.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
  await pc.getByRole('button', { name: 'Galera' }).first().click();
  const m2 = pc.locator('.message', { hasText: 'editada pelo celular' });
  await m2.hover();
  await m2.locator('.message-actions').getByRole('button', { name: 'Editar' }).waitFor();
  await m2.locator('.message-actions').getByRole('button', { name: 'Editar' }).click();
  await m2.getByRole('button', { name: 'Cancelar' }).waitFor();
  await pc.keyboard.press('Escape');
  step('no computador continua a barrinha ao passar o mouse, e a edição também tem Cancelar');

  // criar canal já como canal de avisos
  await pc.getByRole('button', { name: /Criar em Canais de texto/ }).first().click();
  await pc.getByLabel('Nome do canal').fill('novidades');
  await pc.getByLabel(/Canal de avisos/).check();
  await pc.getByRole('button', { name: 'Criar canal' }).click();
  await sleep(600);
  const g = (await api('/bootstrap', null, ana.token)).guilds?.find?.((x) => x.id === guild.id);
  const created = g?.channels?.find((c) => c.name === 'novidades');
  assert(created?.announce === true, `canal criado já como aviso (${JSON.stringify(created ?? null)})`);
  step('criar canal com "📢 Canal de avisos" marcado já na criação');
  console.log('\nTUDO CERTO (chat no celular)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
