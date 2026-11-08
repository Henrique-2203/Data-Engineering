import type { Attachment } from '../../../shared/types';
import { ApiError, getToken } from './api';

const MAX_DIMENSION = 2560;
/** Abaixo disso (e já em tamanho razoável) a imagem vai como está. */
const KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const attachmentUrl = (a: Pick<Attachment, 'id' | 'name'>) => `/api/attachments/${a.id}/${encodeURIComponent(a.name)}`;

export const isImageFile = (f: File) => /^image\/(png|jpeg|gif|webp|avif)$/.test(f.type);

/**
 * Reduz fotos grandes no próprio navegador antes de enviar (economiza o espaço grátis do banco
 * e a internet de todo mundo). GIFs vão sem mexer, para manter a animação.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number; name: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Não foi possível ler essa imagem.');
  const { width, height } = bitmap;
  const fits = Math.max(width, height) <= MAX_DIMENSION;
  if (file.type === 'image/gif' || (fits && file.size <= KEEP_ORIGINAL_BYTES)) {
    bitmap.close();
    return { blob: file, width, height, name: file.name || 'imagem' };
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  // WebP onde o navegador suporta (menor e mantém transparência); senão JPEG
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir a imagem.'))), 'image/webp', 0.86),
  );
  const finalBlob =
    blob.type === 'image/webp'
      ? blob
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir a imagem.'))), 'image/jpeg', 0.86),
        );
  return { blob: finalBlob, width: w, height: h, name: file.name || 'imagem' };
}

export async function uploadImage(file: File): Promise<Attachment> {
  const { blob, width, height, name } = await prepareImage(file);
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Imagem grande demais (máx. 8 MB). GIFs grandes não podem ser reduzidos.');
  let res: Response;
  try {
    res = await fetch('/api/attachments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': blob.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(name),
        'X-Width': String(width),
        'X-Height': String(height),
      },
      body: blob,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status} ao enviar a imagem.`);
  return data.attachment as Attachment;
}

/**
 * Recorta no centro e reduz para o tamanho exato (ícone 256×256, banner 960×400), em WebP.
 * Fica com uns 15-80 KB: quase nada do espaço grátis do banco.
 */
export async function prepareCover(file: File, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Não foi possível ler essa imagem.');
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const sw = width / scale;
  const sh = height / scale;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height);
  bitmap.close();
  const toBlob = (type: string, q: number) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir.'))), type, q));
  const webp = await toBlob('image/webp', 0.82);
  return webp.type === 'image/webp' ? webp : toBlob('image/jpeg', 0.85);
}

export async function uploadGuildImage(guildId: string, kind: 'icon' | 'banner', file: File) {
  const blob = kind === 'icon' ? await prepareCover(file, 256, 256) : await prepareCover(file, 960, 400);
  const res = await fetch(`/api/guilds/${guildId}/${kind}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': blob.type },
    body: blob,
  }).catch(() => {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status} ao enviar a imagem.`);
  return { imageId: data.imageId as string, bytes: blob.size };
}

/**
 * Foto de perfil: GIF animado vai como está (até 1,5 MB); o resto é recortado em 256×256 WebP.
 * Banner de perfil: 960×340 WebP.
 */
export async function uploadProfileImage(kind: 'avatar' | 'banner', file: File) {
  let blob: Blob;
  if (kind === 'avatar' && file.type === 'image/gif') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('GIF muito grande (máx. 1,5 MB). Tente um GIF menor ou mais curto.');
    blob = file;
  } else {
    blob = kind === 'avatar' ? await prepareCover(file, 256, 256) : await prepareCover(file, 960, 340);
  }
  const res = await fetch(`/api/me/${kind}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  }).catch(() => {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status} ao enviar a imagem.`);
  return { imageId: data.imageId as string, bytes: blob.size };
}

// ---------- emojis, figurinhas e sons ----------

/** Reduz para caber em `max`×`max` mantendo a proporção e a transparência (WebP). */
async function prepareContain(file: Blob, max: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Não foi possível ler essa imagem.');
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const toBlob = (type: string, q: number) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir.'))), type, q));
  const webp = await toBlob('image/webp', 0.9);
  return webp.type === 'image/webp' ? webp : toBlob('image/png', 1);
}

export const EXPRESSION_LIMITS = { emoji: 256 * 1024, sticker: 512 * 1024, sound: 400 * 1024 };
/** duração máxima de um som do soundboard (segundos) */
export const SOUND_MAX_SECONDS = 5;

/** Emoji: 128×128; figurinha: 320×320. GIF animado vai como está (se couber). */
export async function prepareExpressionImage(kind: 'emoji' | 'sticker', file: File): Promise<Blob> {
  const limit = EXPRESSION_LIMITS[kind];
  if (file.type === 'image/gif') {
    if (file.size > limit) throw new Error(`GIF muito grande (máx. ${Math.round(limit / 1024)} KB para ${kind === 'emoji' ? 'emoji' : 'figurinha'}).`);
    return file;
  }
  return prepareContain(file, kind === 'emoji' ? 128 : 320);
}

/** Lê a duração de um áudio (para avisar quando passa de 5 s). */
export async function audioDuration(file: Blob): Promise<number> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    return buf.duration;
  } catch {
    throw new Error('Não foi possível ler esse áudio. Tente MP3, OGG ou WAV.');
  } finally {
    void ctx.close();
  }
}

/**
 * Som do soundboard: se já for curto e leve, vai como está; senão recorta `SOUND_MAX_SECONDS`
 * a partir de `start` e regrava em Opus (~96 kbps, uns 60 KB). A regravação leva o tempo do trecho.
 */
export async function prepareSound(file: File, start = 0): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer()).catch(() => {
      throw new Error('Não foi possível ler esse áudio. Tente MP3, OGG ou WAV.');
    });
    const fits = buf.duration <= SOUND_MAX_SECONDS + 0.2 && start === 0;
    if (fits && file.size <= EXPRESSION_LIMITS.sound && /^audio\/(mpeg|mp3|ogg|wav|x-wav|wave|webm)$/.test(file.type)) return file;
    if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador não consegue recortar áudio. Envie um som de até 5 segundos.');
    const from = Math.max(0, Math.min(start, Math.max(0, buf.duration - 0.1)));
    const length = Math.min(SOUND_MAX_SECONDS, buf.duration - from);
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(dest.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 96_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    if (ctx.state === 'suspended') await ctx.resume();
    rec.start();
    src.start(0, from, length);
    src.onended = () => rec.state !== 'inactive' && rec.stop();
    await done;
    const blob = new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'audio/webm' });
    if (blob.size > EXPRESSION_LIMITS.sound) throw new Error('O som ficou grande demais. Tente um trecho mais curto.');
    return blob;
  } finally {
    void ctx.close();
  }
}

export async function uploadExpression(guildId: string, kind: 'emoji' | 'sticker' | 'sound', name: string, blob: Blob, emoji?: string | null) {
  const qs = new URLSearchParams({ kind, name, ...(emoji ? { emoji } : {}) });
  const res = await fetch(`/api/guilds/${guildId}/expressions?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  }).catch(() => {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status} ao enviar.`);
  return { bytes: blob.size };
}

/** Foto só deste servidor (mesmas regras da foto de perfil). */
export async function uploadGuildAvatar(guildId: string, file: File) {
  let blob: Blob;
  if (file.type === 'image/gif') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('GIF muito grande (máx. 1,5 MB).');
    blob = file;
  } else blob = await prepareCover(file, 256, 256);
  const res = await fetch(`/api/guilds/${guildId}/members/@me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  }).catch(() => {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status} ao enviar a imagem.`);
  return { bytes: blob.size };
}
