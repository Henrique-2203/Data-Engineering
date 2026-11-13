// Renderiza os 3 posts fixados (1080x1440 cada, 3:4) e uma prévia de como fica no perfil.
// Uso: node promo/fixados/render.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('.');
const OUT = path.resolve('promo/out/fixados');
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
const page = await browser.newPage({ viewport: { width: 3240, height: 1440 } });
await page.goto(`http://localhost:${server.address().port}/promo/fixados/arte.html`);
await page.waitForFunction(() => window.ready);
await page.screenshot({ path: path.join(OUT, 'inteira.png') });
for (let i = 0; i < 3; i++) await page.screenshot({ path: path.join(OUT, `post-${i + 1}.png`), clip: { x: i * 1080, y: 0, width: 1080, height: 1440 } });
// prévia: os 3 posts no perfil (com a fresta branca entre eles, como no Instagram)
const prev = await browser.newPage({ viewport: { width: 1080, height: 470 } });
const imgs = [];
for (const i of [1, 2, 3]) imgs.push((await readFile(path.join(OUT, `post-${i}.png`))).toString('base64'));
await prev.setContent(`<body style="margin:0;background:#000;display:flex;gap:4px">${imgs
  .map((b64) => `<img src="data:image/png;base64,${b64}" style="width:357px;height:476px;object-fit:cover">`)
  .join('')}</body>`);
await prev.screenshot({ path: path.join(OUT, 'previa-perfil.png') });
await browser.close();
server.close();
console.log('pronto: promo/out/fixados');
