import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

let cached: string | null = null;

/**
 * Versão do site = hash do index.html compilado (ele aponta para os arquivos novos a cada build).
 * No Render também existe RENDER_GIT_COMMIT, mas o hash funciona em qualquer lugar.
 */
export function siteVersion(): string {
  if (cached) return cached;
  const index = path.join(config.clientDist, 'index.html');
  const source = existsSync(index) ? readFileSync(index) : (process.env.RENDER_GIT_COMMIT ?? 'dev');
  cached = createHash('sha256').update(source).digest('hex').slice(0, 12);
  return cached;
}
