// Passa uma gravação pelo MESMO filtro de ruído do app ("Forte (IA)"), num navegador de verdade.
// Uso: node promo/reels2/denoise-offline.mjs entrada.wav saida.wav
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , inFile, outFile] = process.argv;
const root = path.resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = u === '/input.wav' ? path.resolve(inFile) : path.join(root, u);
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${server.address().port}/promo/reels2/denoise.html`);
await page.waitForFunction(() => window.ready);
const r = await page.evaluate(() => window.run('/input.wav'));
// original e filtrado gravados juntos (mesmo relógio): o "antes" e o "depois" ficam alinhados
await writeFile(outFile.replace(/\.wav$/, '-original.wav'), Buffer.from(r.raw, 'base64'));
await writeFile(outFile, Buffer.from(r.filtered, 'base64'));
await browser.close();
server.close();
console.log('ok', outFile);
