'use strict';
/**
 * Ícone do app escolhido pela pessoa (Configurações → Aparência → Ícone do app).
 * O site desenha o ícone e manda um PNG; aqui ele é conferido, guardado na pasta do app e aplicado
 * na janela, na bandeja e (no Windows) nos atalhos do Resenha: área de trabalho, Menu Iniciar e o
 * fixado na barra de tarefas. Só mexemos em atalhos que abrem ESTE Resenha.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage, shell } = require('electron');

const pngFile = () => path.join(app.getPath('userData'), 'app-icon.png');
const icoFile = () => path.join(app.getPath('userData'), 'app-icon.ico');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Monta um .ico (formato do Windows) com várias resoluções em PNG dentro. */
function toIco(img) {
  const pngs = ICO_SIZES.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícone
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const s = ICO_SIZES[i];
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e); // largura (0 = 256)
    header.writeUInt8(s >= 256 ? 0 : s, e + 1); // altura
    header.writeUInt8(0, e + 2); // paleta
    header.writeUInt8(0, e + 3); // reservado
    header.writeUInt16LE(1, e + 4); // planos
    header.writeUInt16LE(32, e + 6); // bits por pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** Confere o PNG que veio do site: tem que ser um PNG de verdade, quadrado, de 64 a 1024 px e leve. */
function parsePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 1_500_000) return null;
  const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null; // assinatura do PNG
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  if (width !== height || width < 64 || width > 1024) return null;
  return img;
}

/** Atalhos do Resenha que o instalador cria (só no Windows). */
function shortcutPaths() {
  if (process.platform !== 'win32') return [];
  const roaming = app.getPath('appData');
  return [
    path.join(app.getPath('desktop'), 'Resenha.lnk'),
    path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Resenha.lnk'),
    path.join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Resenha.lnk'),
  ];
}

/** Avisa o Windows que ícones mudaram (senão ele mostra o antigo do cache até reiniciar). */
function refreshShell() {
  try {
    const koffi = require('koffi');
    const shell32 = koffi.load('shell32.dll');
    const SHChangeNotify = shell32.func('void __stdcall SHChangeNotify(long wEventId, uint uFlags, void *a, void *b)');
    SHChangeNotify(0x08000000 /* SHCNE_ASSOCCHANGED */, 0, null, null);
  } catch {
    /* fora do Windows ou sem koffi: o Windows atualiza sozinho depois */
  }
}

/** Troca o ícone dos atalhos que abrem este Resenha (`ico` null = volta ao ícone original). Retorna quantos mudaram. */
function updateShortcuts(ico) {
  let changed = 0;
  const exe = path.resolve(process.execPath).toLowerCase();
  for (const p of shortcutPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const sc = shell.readShortcutLink(p);
      if (!sc.target || path.resolve(sc.target).toLowerCase() !== exe) continue; // atalho de outro programa: não mexe
      const want = ico ?? process.execPath;
      if ((sc.icon || '').toLowerCase() === want.toLowerCase()) continue;
      if (shell.writeShortcutLink(p, 'update', { icon: want, iconIndex: 0 })) changed++;
    } catch {
      /* sem permissão ou atalho quebrado: segue */
    }
  }
  if (changed) refreshShell();
  return changed;
}

/** Ícone atual (o escolhido, se tiver; senão o padrão). */
function currentIcon(defaultPath) {
  try {
    if (fs.existsSync(pngFile())) {
      const img = nativeImage.createFromPath(pngFile());
      if (!img.isEmpty()) return img;
    }
  } catch {
    /* usa o padrão */
  }
  return nativeImage.createFromPath(defaultPath);
}

/**
 * Aplica a escolha. `id` 'classic' volta ao original (apaga os arquivos e devolve os atalhos).
 * Retorna { ok, shortcuts } ou { ok: false, error }.
 */
function setIcon(id, dataUrl) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,30}$/.test(id)) return { ok: false, error: 'Ícone inválido.' };
  if (id === 'classic') {
    for (const f of [pngFile(), icoFile()]) fs.rmSync(f, { force: true });
    return { ok: true, shortcuts: updateShortcuts(null) };
  }
  const img = parsePng(dataUrl);
  if (!img) return { ok: false, error: 'Imagem do ícone inválida.' };
  const png256 = img.resize({ width: 256, height: 256, quality: 'best' });
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(pngFile(), png256.toPNG());
  fs.writeFileSync(icoFile(), toIco(png256));
  return { ok: true, shortcuts: updateShortcuts(icoFile()) };
}

/** Ao abrir: uma atualização do app recria os atalhos com o ícone original; põe o escolhido de novo. */
function reapplyShortcuts() {
  if (fs.existsSync(icoFile())) updateShortcuts(icoFile());
}

module.exports = { setIcon, currentIcon, reapplyShortcuts, toIco, parsePng, pngFile, icoFile };
