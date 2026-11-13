// Banner (1920x800), ícone (1024x1024) e story (1080x1920) do "Resenha Brasil OFC".
// Uso: node promo/oficial/render.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('.');
const OUT = path.resolve('promo/out/oficial');
await mkdir(OUT, { recursive: true });
const types = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) throw new Error('fora');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0);
const browser = await chromium.launch();
for (const [mode, w, h] of [['banner', 1920, 800], ['icon', 1024, 1024], ['story', 1080, 1920]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${server.address().port}/promo/oficial/arte.html?mode=${mode}`);
  await page.waitForFunction(() => window.ready);
  await page.screenshot({ path: path.join(OUT, `resenha-brasil-ofc-${mode}.png`) });
  await page.close();
}
await browser.close();
server.close();
console.log('pronto: promo/out/oficial');
