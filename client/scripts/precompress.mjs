// Depois do build: grava uma cópia compactada (.br e .gz) de cada arquivo de texto do site.
// O servidor entrega a cópia compactada para quem aceita (todo navegador e o app), gastando
// ~4x menos internet do Render a cada vez que alguém abre o Resenha ou chega uma versão nova.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../dist');
const TEXT = /\.(js|mjs|css|html|svg|json|webmanifest|wasm|txt)$/;
let before = 0;
let after = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (TEXT.test(name) && statSync(file).size > 1024) {
      const buf = readFileSync(file);
      const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      writeFileSync(`${file}.br`, br);
      writeFileSync(`${file}.gz`, gzipSync(buf, { level: 9 }));
      before += buf.length;
      after += br.length;
    }
  }
}
walk(root);
console.log(`[precompress] ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (brotli)`);
