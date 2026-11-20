import { readFile } from 'node:fs/promises';
import type { Router } from 'express';

/**
 * App Android: qual é a versão mais nova (android/release.json). O app instalado pergunta isto ao abrir e,
 * se o versionCode for maior que o dele, oferece baixar e instalar. versionCode 0 = nada publicado ainda
 * (versão em teste: o APK fica só nas Releases do GitHub até ser aprovado).
 */
export interface AndroidRelease {
  versionCode: number;
  versionName: string;
  url: string;
  notes: string;
}
const FILE = new URL('../../android/release.json', import.meta.url);
let cache: { at: number; value: AndroidRelease } | null = null;

export async function androidRelease(): Promise<AndroidRelease> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value: AndroidRelease = { versionCode: 0, versionName: '', url: '', notes: '' };
  try {
    const j = JSON.parse(await readFile(FILE, 'utf8')) as Partial<AndroidRelease>;
    value = {
      versionCode: Number(j.versionCode) || 0,
      versionName: String(j.versionName ?? ''),
      url: typeof j.url === 'string' && j.url.startsWith('https://') ? j.url : '',
      notes: String(j.notes ?? ''),
    };
  } catch {}
  cache = { at: Date.now(), value };
  return value;
}

export function registerAndroidRoutes(r: Router) {
  r.get('/app/android', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(await androidRelease());
  });
  /** link fixo do site e dos stories: sempre baixa a versão mais nova do APK */
  r.get('/download/android', async (_req, res) => {
    const rel = await androidRelease();
    if (!rel.versionCode || !rel.url) return res.redirect(302, '/');
    res.setHeader('Cache-Control', 'no-cache');
    res.redirect(302, rel.url);
  });
}
