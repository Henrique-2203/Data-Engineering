# Uma folha só com a mesma pose (joinha) em 6 estilos de traço e contorno, para escolher.
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageFont
exec(open('polish.py').read().split('def sticker')[0])  # limpa_borda
MINT = (61, 220, 151); DARK = (17, 19, 24)
base = limpa_borda(Image.open('raw-joinha.png').convert('RGBA'))
S = 460
def fit(im, size=S):
    k = size / max(im.size)
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
def ring(alpha, r):
    return alpha.point(lambda v: 255 if v > 60 else 0).filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.GaussianBlur(0.8))
def layers(art, rings, pad=40, shadow=True):
    """art no centro de um quadro, com contornos (cor, raio) de fora para dentro"""
    W = S + 2 * pad
    lay = Image.new('RGBA', (W, W), (255, 255, 255, 0)); lay.alpha_composite(art, ((W - art.width) // 2, (W - art.height) // 2))
    a = lay.getchannel('A'); out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    big = max(r for _, r in rings) if rings else 0
    if shadow:
        sh = ring(a, big).filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.4))
        s = Image.new('RGBA', (W, W), (0, 0, 0, 255)); s.putalpha(sh); out.alpha_composite(s, (0, 5))
    for color, r in sorted(rings, key=lambda x: -x[1]):
        c = Image.new('RGBA', (W, W), color + (255,)); c.putalpha(ring(a, r)); out.alpha_composite(c)
    out.alpha_composite(lay)
    return out

art = fit(ImageEnhance.Contrast(ImageEnhance.Color(base).enhance(1.08)).enhance(1.04))
# A) atual
A = layers(art, [((255, 255, 255), 7)])
# B) adesivo grosso: branco largo + fio escuro por fora
B = layers(art, [((255, 255, 255), 16), (DARK, 19)])
# C) contorno da marca: branco + verde Resenha por fora
C = layers(art, [((255, 255, 255), 6), (MINT, 13)])
# D) chapado (cel-shading): poucas cores, sem degradê, traço preto reforçado
rgb = art.convert('RGB')
q = rgb.quantize(colors=16, method=Image.Quantize.MEDIANCUT).convert('RGB').filter(ImageFilter.ModeFilter(5))
lum = np.asarray(rgb.convert('L')).astype(int)
qa = np.asarray(q).copy(); qa[lum < 45] = DARK
Dart = Image.fromarray(qa).convert('RGBA'); Dart.putalpha(art.getchannel('A'))
D = layers(Dart, [((255, 255, 255), 9)])
# E) neon: só o traço, brilhando, em fundo escuro
g = art.convert('L').filter(ImageFilter.GaussianBlur(0.8))
edges = np.asarray(g.filter(ImageFilter.FIND_EDGES)).astype(float)
e = np.clip((edges - 18) / 40, 0, 1)
col = np.asarray(ImageEnhance.Color(art.convert('RGB')).enhance(1.6)).astype(float)
col = col / np.maximum(col.max(axis=2, keepdims=True), 1) * 255  # cor no brilho máximo
col[(col.max(axis=2) - col.min(axis=2)) < 40] = MINT  # traço sem cor vira verde Resenha
lines = Image.fromarray(col.astype('uint8')).convert('RGBA'); lines.putalpha(Image.fromarray((e * 255).astype('uint8')))
out_line = ring(art.getchannel('A'), 4)
edge_ring = np.asarray(out_line).astype(float) - np.asarray(art.getchannel('A').point(lambda v: 255 if v > 60 else 0).filter(ImageFilter.MaxFilter(3))).astype(float)
neon_ring = Image.new('RGBA', art.size, MINT + (255,)); neon_ring.putalpha(Image.fromarray(np.clip(edge_ring, 0, 255).astype('uint8')))
Eart = Image.new('RGBA', art.size, (0, 0, 0, 0)); Eart.alpha_composite(neon_ring); Eart.alpha_composite(lines)
glow = Eart.filter(ImageFilter.GaussianBlur(6))
E = Image.new('RGBA', (S + 80, S + 80), (0, 0, 0, 0))
for _ in range(2): E.alpha_composite(glow, (40, 40 + (S - art.height) // 2) if False else ((S + 80 - art.width) // 2, (S + 80 - art.height) // 2))
E.alpha_composite(Eart, ((S + 80 - art.width) // 2, (S + 80 - art.height) // 2))
# F) pixel art (estilo jogo)
small = base.resize((76, round(76 * base.height / base.width)), Image.BOX)
sa = np.asarray(small).copy(); sa[..., 3] = np.where(sa[..., 3] > 128, 255, 0)
srgb = Image.fromarray(sa[..., :3]).quantize(colors=20, method=Image.Quantize.MEDIANCUT).convert('RGB')
sm = srgb.convert('RGBA'); sm.putalpha(Image.fromarray(sa[..., 3]))
al = sm.getchannel('A')
w1 = al.filter(ImageFilter.MaxFilter(3)); w2 = al.filter(ImageFilter.MaxFilter(5))
px = Image.new('RGBA', (sm.width + 4, sm.height + 4), (0, 0, 0, 0))
for color, m in ((DARK, w2), ((255, 255, 255), w1)):
    c = Image.new('RGBA', sm.size, color + (255,)); c.putalpha(m); px.alpha_composite(c, (2, 2))
px.alpha_composite(sm, (2, 2))
F = px.resize((px.width * 6, px.height * 6), Image.NEAREST)

# ---------- folha ----------
TW, TH = 600, 640
sheet = Image.new('RGB', (TW * 3, TH * 2 + 120), (236, 238, 242))
d = ImageDraw.Draw(sheet)
fb = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Black.otf', 46)
fl = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Bold.otf', 30)
fs = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 23)
d.text((40, 34), 'Mascote do Resenha: estilos de traço e contorno', font=fb, fill=DARK)
items = [
  (A, 'A · Atual', 'ilustração + contorno branco fino', False),
  (B, 'B · Adesivo grosso', 'branco largo + fio escuro (de recorte)', False),
  (C, 'C · Contorno da marca', 'branco + verde Resenha por fora', False),
  (D, 'D · Chapado', 'poucas cores, sem degradê, traço forte', False),
  (E, 'E · Neon', 'só o traço brilhando (fundo escuro)', True),
  (F, 'F · Pixel art', 'estilo jogo retrô', False),
]
for i, (img, title, sub, dark) in enumerate(items):
    x, y = (i % 3) * TW, 120 + (i // 3) * TH
    if dark: d.rounded_rectangle((x + 16, y + 6, x + TW - 16, y + TH - 10), 28, fill=(12, 14, 19))
    k = min(520 / img.width, 520 / img.height)
    im2 = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS) if img.width > 520 or img.height > 520 else img
    sheet.paste(im2, (x + (TW - im2.width) // 2, y + 10 + (520 - im2.height) // 2), im2)
    tc = (240, 242, 245) if dark else DARK
    d.text((x + TW // 2, y + 548), title, font=fl, fill=tc, anchor='mm')
    d.text((x + TW // 2, y + 590), sub, font=fs, fill=(150, 156, 168) if dark else (90, 96, 108), anchor='mm')
sheet.save('/home/user/Data-Engineering/promo/out/mascote/estilos.png')
print('ok', sheet.size)
