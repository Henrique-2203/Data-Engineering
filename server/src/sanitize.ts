import sharp, { type Metadata } from 'sharp';
import { HttpError } from './http.ts';

/**
 * Limpeza de tudo que as pessoas enviam, feita NO SERVIDOR (não dá para confiar no navegador):
 *
 * - Fotos: remove EXIF/XMP/IPTC (localização GPS, modelo do celular, data, nome do autor...),
 *   aplicando antes a rotação da foto para ela não ficar de lado. Também confere que a imagem
 *   abre de verdade e não é gigante (proteção contra "bombas" de pixels).
 * - Vídeos MP4/MOV: apaga as coordenadas de GPS que celulares gravam no arquivo.
 * - Tipo real descoberto pelos primeiros bytes; programas (.exe e cia.) são recusados.
 */

sharp.cache(false);
sharp.concurrency(1);

/** até ~36 megapixels (6000×6000): mais que qualquer foto de celular, menos que uma "bomba" */
const MAX_PIXELS = 36_000_000;

export interface CleanImage {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
  /** a imagem tinha metadados (e eles foram removidos) */
  stripped: boolean;
}

export async function cleanImage(input: Buffer, mime: string): Promise<CleanImage> {
  const animated = mime === 'image/gif' || mime === 'image/webp';
  let meta: Metadata;
  try {
    meta = await sharp(input, { animated, limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
  } catch (err) {
    const msg = String((err as Error)?.message ?? '');
    if (/pixel limit/i.test(msg)) throw new HttpError(413, 'Imagem com resolução grande demais.');
    throw new HttpError(415, 'Não foi possível ler essa imagem. Ela pode estar corrompida.');
  }
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  const pages = meta.pages ?? 1;
  const hasMeta = !!(meta.exif || meta.xmp || meta.iptc || (meta.comments && meta.comments.length));
  if (!hasMeta) return { data: input, mime, width, height, stripped: false };

  // reescreve a imagem sem metadados (o perfil de cor é mantido para as cores não mudarem)
  const rotate = pages === 1 && (meta.orientation ?? 1) > 1;
  let img = sharp(input, { animated, limitInputPixels: MAX_PIXELS }).keepIccProfile();
  if (rotate) img = img.rotate();
  switch (mime) {
    case 'image/jpeg':
      img = img.jpeg({ quality: 92, mozjpeg: true });
      break;
    case 'image/png':
      img = img.png({ compressionLevel: 9 });
      break;
    case 'image/webp':
      img = img.webp({ quality: 92 });
      break;
    case 'image/avif':
      img = img.avif({ quality: 70 });
      break;
    case 'image/gif':
      img = img.gif();
      break;
  }
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const swap = rotate && (meta.orientation ?? 1) >= 5; // 5 a 8 = girada 90°
  return {
    data,
    mime,
    width: info.width ?? (swap ? height : width),
    height: (pages > 1 ? meta.pageHeight : info.height) ?? (swap ? width : height),
    stripped: true,
  };
}

// ---------- outros tipos de arquivo ----------

/** Descobre o tipo real pelos primeiros bytes (não confia no que o navegador diz). */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 12) === 'ftypavif') return 'image/avif';
  return null;
}

export type FileKind = 'image' | 'video' | 'audio' | 'file';

const has = (b: Buffer, at: number, s: string) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s;

/** Tipo real pelo conteúdo. Vídeos e áudios que o navegador toca viram player; o resto é arquivo para baixar. */
export function sniffFile(b: Buffer): { kind: FileKind; mime: string } {
  const img = sniffImage(b);
  if (img) return { kind: 'image', mime: img };
  if (has(b, 4, 'ftyp')) {
    const brand = b.toString('latin1', 8, 12);
    if (/^(M4A |M4B )/.test(brand)) return { kind: 'audio', mime: 'audio/mp4' };
    if (/^(qt  )/.test(brand)) return { kind: 'video', mime: 'video/quicktime' };
    if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|dash|M4V |MSNV|3gp)/.test(brand)) return { kind: 'video', mime: 'video/mp4' };
    if (/^(heic|heix|mif1|msf1|hevc)/.test(brand)) return { kind: 'file', mime: 'image/heic' };
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return { kind: 'video', mime: 'video/webm' };
  if (has(b, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (has(b, 0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac' };
  if (has(b, 0, 'RIFF') && has(b, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  if (has(b, 0, 'ID3') || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (has(b, 0, '%PDF-')) return { kind: 'file', mime: 'application/pdf' };
  if (has(b, 0, 'PK\x03\x04') || has(b, 0, 'PK\x05\x06')) return { kind: 'file', mime: 'application/zip' };
  if (has(b, 0, 'Rar!\x1a\x07')) return { kind: 'file', mime: 'application/vnd.rar' };
  if (has(b, 0, '7z\xbc\xaf\x27\x1c')) return { kind: 'file', mime: 'application/x-7z-compressed' };
  return { kind: 'file', mime: 'application/octet-stream' };
}

/** Programas e scripts: o jeito mais comum de espalhar vírus. Não entram, nem renomeados. */
const BLOCKED_EXT = new Set(
  'exe msi msix msp bat cmd com scr pif cpl ps1 psm1 vbs vbe js jse wsf wsh hta jar apk xapk aab app ipa dll sys drv ocx lnk url reg inf scf iso img vhd vhdx dmg pkg deb rpm sh run elf appimage gadget msc chm application settingcontent-ms'.split(' '),
);

export function blockedReason(b: Buffer, filename: string): string | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9-]+)$/)?.[1] ?? '';
  if (BLOCKED_EXT.has(ext)) return `Por segurança, arquivos .${ext} (programas e scripts) não podem ser enviados.`;
  if (has(b, 0, 'MZ')) return 'Por segurança, programas do Windows não podem ser enviados.';
  if (has(b, 0, '\x7fELF') || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0)) {
    return 'Por segurança, programas não podem ser enviados.';
  }
  if (has(b, 0x8001, 'CD001')) return 'Por segurança, imagens de disco (.iso) não podem ser enviadas.';
  return null;
}

/**
 * Vídeos de celular (MP4/MOV) guardam onde foram gravados: "©xyz" (Android), a chave
 * "com.apple.quicktime.location.ISO6709" (iPhone) ou "loci" (3GPP). Lê a estrutura do arquivo
 * e troca as coordenadas por zeros no lugar, sem mudar nenhum tamanho (o vídeo continua igual).
 * Só mexe nas caixas de metadados: a parte com o vídeo em si nunca é tocada.
 */
export function scrubVideoLocation(b: Buffer): { data: Buffer; found: number } {
  const out = Buffer.from(b);
  let found = 0;
  const ISO6709 = /^[+-]\d{1,2}(\.\d+)?[+-]\d{1,3}(\.\d+)?([+-]\d+(\.\d+)?)?(CRS[^/]*)?\/?$/;
  const CONTAINERS = new Set(['moov', 'udta', 'meta', 'ilst', 'trak']);
  const zeroDigits = (from: number, to: number) => {
    const text = out.toString('latin1', from, to).replace(/\0+$/, '');
    if (!ISO6709.test(text.trim())) return;
    out.write(text.replace(/\d/g, '0'), from, 'latin1');
    found++;
  };
  const walk = (from: number, to: number, parent: string, depth: number) => {
    let pos = from;
    while (pos + 8 <= to && depth < 8) {
      let size = out.readUInt32BE(pos);
      const type = out.toString('latin1', pos + 4, pos + 8);
      let header = 8;
      if (size === 1 && pos + 16 <= to) {
        size = Number(out.readBigUInt64BE(pos + 8));
        header = 16;
      } else if (size === 0) size = to - pos;
      if (size < header || pos + size > to) return;
      const body = pos + header;
      const end = pos + size;
      if (type === '\xa9xyz') {
        // tamanho do texto (2) + idioma (2) + texto
        if (body + 4 <= end) zeroDigits(body + 4, Math.min(end, body + 4 + out.readUInt16BE(body)));
      } else if (type === 'loci') {
        // versão/flags (4) + idioma (2) + nome terminado em 0 + papel (1) + longitude, latitude, altitude (3 × 4)
        let p = body + 6;
        while (p < end && out[p] !== 0) p++;
        p += 2;
        if (p + 12 <= end) {
          out.fill(0, p, p + 12);
          found++;
        }
      } else if (type === 'data' && depth >= 3) {
        // valor de um item de metadados (tipo (4) + idioma (4) + valor): só zera se for uma coordenada
        if (body + 8 <= end) zeroDigits(body + 8, end);
      } else if (CONTAINERS.has(type) || (parent === 'ilst' && depth >= 2)) {
        // "meta" no padrão ISO tem 4 bytes de versão antes dos filhos; no QuickTime, não
        let child = body;
        if (type === 'meta' && body + 8 <= end && out.toString('latin1', body + 4, body + 8) !== 'hdlr') child += 4;
        walk(child, end, type, depth + 1);
      }
      pos = end;
    }
  };
  walk(0, out.length, '', 0);
  return { data: out, found };
}
