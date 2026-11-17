// Stories da campanha dos anéis de Fundador (1080x1920). Fundos: arte gerada no Gemini, em promo/out/fundador/bg-*.jpg.
// Uso: node promo/fundador/render-stories.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('.');
const OUT = path.resolve('promo/out/fundador/stories');
await mkdir(OUT, { recursive: true });
const types = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
for (const [mode, w, h] of [['1', 1080, 1920], ['2', 1080, 1920], ['3', 1080, 1920]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${server.address().port}/promo/fundador/stories.html?n=${mode}`);
  await page.waitForFunction(() => window.ready);
  await page.screenshot({ path: path.join(OUT, `fundador-story-${mode}.png`) });
  await page.close();
}
await browser.close();
server.close();
console.log('pronto: promo/out/fundador/stories');
