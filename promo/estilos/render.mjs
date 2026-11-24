// Renderiza os testes de estilo 2D e 3D (6 s, 1080x1920, sem áudio). Uso: node promo/estilos/render.mjs 2d|3d
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const which = process.argv[2] ?? '2d';
const root = path.resolve('promo/estilos');
const out = path.resolve('promo/out/estilos', which);
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = createServer(async (req, res) => {
  try {
    const f = path.join(root, new URL(req.url, 'http://x').pathname);
    res.setHeader('Content-Type', types[path.extname(f)] ?? 'application/octet-stream');
    res.end(await readFile(f));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
await page.goto(`http://localhost:${srv.address().port}/${which}.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const FPS = 30, N = 6 * FPS;
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.seek(t), f / FPS);
  await page.screenshot({ path: path.join(out, `${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
}
await b.close(); srv.close();
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(out, '%04d.jpg'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', path.join(out, `teste-${which}.mp4`)], { stdio: 'inherit' });
if (r.status) process.exit(1);
console.log('pronto', path.join(out, `teste-${which}.mp4`));
