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
