// Ver imagem com zoom: rodinha do mouse aproxima onde está o cursor, arrastar move, duplo clique alterna,
// botões − / + / caber na tela, teclas + − 0, Esc fecha; no celular, pinça com dois dedos.
// Uso: npm run build && node e2e/image-viewer.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3219;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-viewer-') },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token) => {
  const res = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
/** solta no chat um print de celular (alto e estreito, como o que a pessoa mandou) */
const dropPhonePrint = (page) =>
  page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1170;
    c.height = 2532;
    const g = c.getContext('2d');
    g.fillStyle = '#111318';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#3ddc97';
    g.font = 'bold 90px sans-serif';
    for (let i = 0; i < 20; i++) g.fillText(`linha ${i + 1} do print`, 60, 160 + i * 120);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'IMG_2942.png', { type: 'image/png' }));
    const chat = document.querySelector('.chat');
    chat.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    chat.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
const transform = (page) =>
  page.locator('.viewer-stage img').evaluate((img) => {
    const m = new DOMMatrix(getComputedStyle(img).transform);
    return { s: Math.round(m.a * 100) / 100, x: Math.round(m.e), y: Math.round(m.f) };
  });

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const ana = await api('/auth/register', { username: 'ana', password: 'Cor-Forte-Xis-42', displayName: 'Ana', acceptTerms: true });
  await api('/guilds', { name: 'Galera' }, ana.token);
  browser = await chromium.launch();
  const open = async (device) => {
    const ctx = await browser.newContext(device ?? { viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript((t) => {
      localStorage.setItem('resenha.token', t);
      localStorage.setItem('resenha.androidBanner', '1');
    }, ana.token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    await page.getByRole('button', { name: 'Galera' }).first().click();
    return page;
  };

  const pa = await open();
  await pa.locator('.composer textarea').waitFor();
  await dropPhonePrint(pa);
  await pa.locator('.pending.done').waitFor({ timeout: 20000 });
  await pa.locator('.composer textarea').fill('olha o print');
  await pa.locator('.composer textarea').press('Enter');
  const msg = pa.locator('.message', { hasText: 'olha o print' });
  await msg.locator('.attachment img').waitFor({ timeout: 10000 });
  await msg.locator('.attachment').click();
  const viewer = pa.getByRole('dialog', { name: /IMG_2942/ });
  await viewer.waitFor();
  await pa.waitForFunction(() => document.querySelector('.viewer-stage img')?.complete);
  const box = await pa.locator('.viewer-stage img').boundingBox();
  assert(box && box.height > 700, `cabe na tela usando quase toda a altura (${Math.round(box?.height ?? 0)} px)`);
  await viewer.getByText('100%').waitFor();
  step(`abre caber na tela (${Math.round(box.width)}×${Math.round(box.height)} px) com 100%`);

  // rodinha: aproxima onde o cursor está (o ponto embaixo do cursor fica parado)
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.2;
  await pa.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) {
    await pa.mouse.wheel(0, -240);
    await sleep(60);
  }
  await sleep(250);
  let t = await transform(pa);
  assert(t.s > 2, `rodinha aproxima (${t.s}x)`);
  assert(t.y > 100, `aproximou perto do topo (onde estava o cursor), a imagem desceu (${t.y}px)`);
  const pct = Number((await viewer.locator('.viewer-pct').innerText()).replace('%', ''));
  assert(pct > 200, `mostra a porcentagem (${pct}%)`);
  step(`rodinha do mouse aproxima onde está o cursor (${t.s}x, ${pct}%)`);

  // arrastar com o mouse move a imagem
  const before = t;
  await pa.mouse.move(cx, cy + 200);
  await pa.mouse.down();
  await pa.mouse.move(cx + 40, cy - 100, { steps: 8 });
  await pa.mouse.up();
  await sleep(200);
  t = await transform(pa);
  assert(t.y < before.y - 150, `arrastar para cima mostra o resto da imagem (${before.y} → ${t.y})`);
  assert(await viewer.isVisible(), 'arrastar não fecha');
  await pa.screenshot({ path: path.join(shots, 'imagem-zoom.png') });
  step('arrastar com o mouse move a imagem (sem fechar)');

  // teclas e botões
  await pa.keyboard.press('0');
  await sleep(200);
  t = await transform(pa);
  assert(t.s === 1 && t.x === 0 && t.y === 0, `0 volta a caber na tela (${JSON.stringify(t)})`);
  await viewer.getByRole('button', { name: 'Aumentar' }).click();
  await viewer.getByRole('button', { name: 'Aumentar' }).click();
  await sleep(200);
  assert((await transform(pa)).s > 1.9, 'botão + aproxima');
  await viewer.getByRole('button', { name: 'Caber na tela' }).click();
  await sleep(200);
  assert((await transform(pa)).s === 1, 'caber na tela');
  await pa.locator('.viewer-stage img').dblclick();
  await sleep(250);
  assert((await transform(pa)).s === 2.5, 'duplo clique aproxima 2,5x');
  await pa.locator('.viewer-stage img').dblclick();
  await sleep(250);
  assert((await transform(pa)).s === 1, 'duplo clique de novo volta');
  step('teclas 0/+/−, botões +/caber na tela e duplo clique');

  // clique fora da imagem fecha (sem zoom); Esc também
  await pa.mouse.click(20, 20);
  await viewer.waitFor({ state: 'detached', timeout: 3000 });
  await msg.locator('.attachment').click();
  await viewer.waitFor();
  await pa.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  step('clicar fora (sem zoom) e Esc fecham');

  // celular: pinça com dois dedos
  const pm = await open(devices['Pixel 7']);
  await pm.getByText('olha o print').first().waitFor({ timeout: 10000 }).catch(async () => {
    await pm.getByText('geral', { exact: true }).first().click();
  });
  await pm.getByText('geral', { exact: true }).first().click().catch(() => {});
  await pm.locator('.message', { hasText: 'olha o print' }).locator('.attachment').click();
  const mv = pm.getByRole('dialog', { name: /IMG_2942/ });
  await mv.waitFor();
  await pm.waitForFunction(() => document.querySelector('.viewer-stage img')?.complete);
  const mb = await pm.locator('.viewer-stage img').boundingBox();
  const mx = mb.x + mb.width / 2;
  const my = mb.y + mb.height / 2;
  const cdp = await pm.context().newCDPSession(pm);
  const pts = (d) => [{ x: mx - d, y: my, id: 1 }, { x: mx + d, y: my, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(30 + i * 9) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const tm = await transform(pm);
  assert(tm.s > 2, `pinça com dois dedos aproxima (${tm.s}x)`);
  assert(await mv.isVisible(), 'a pinça não fecha');
  await pm.screenshot({ path: path.join(shots, 'imagem-zoom-celular.png') });
  step(`celular: pinça com dois dedos aproxima (${tm.s}x)`);
  console.log('\nTUDO CERTO (ver imagem com zoom)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
