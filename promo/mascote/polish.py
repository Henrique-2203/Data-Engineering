from PIL import Image, ImageFilter, ImageEnhance, ImageChops
import os
os.makedirs('out/figurinhas', exist_ok=True); os.makedirs('out/emojis', exist_ok=True)
names = ['joinha','oculos','bandeira','curioso','fone','dormindo','bravo','coracao','logo-texto']
def limpa_borda(im, passos=7):
    """tira a faixa de fundo preto que sobrou do lado de fora do contorno branco do desenho:
    a partir do transparente, 'come' só pixels escuros, no máximo `passos` pixels para dentro"""
    import numpy as np
    a = np.asarray(im).copy()
    rgb, al = a[..., :3].astype(int), a[..., 3]
    dark = rgb.max(axis=2) < 70
    bg = al < 128
    for _ in range(passos):
        grow = np.asarray(Image.fromarray((bg * 255).astype('uint8')).filter(ImageFilter.MaxFilter(3))) > 0
        new = grow & dark & ~bg
        if not new.any(): break
        bg |= new
    alpha = Image.fromarray(np.where(bg, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.6))
    out = Image.fromarray(a[..., :3].astype('uint8')).convert('RGBA'); out.putalpha(alpha)
    return out
def sticker(src, size, outline, pad):
    im = limpa_borda(Image.open(src).convert('RGBA'))
    # cor um pouco mais viva e nítida
    rgb = ImageEnhance.Color(im.convert('RGB')).enhance(1.08)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.04)
    a = im.getchannel('A')
    im = rgb.convert('RGBA'); im.putalpha(a)
    inner = size - 2 * pad
    k = inner / max(im.size)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ox, oy = (size - im.width) // 2, (size - im.height) // 2
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0)); layer.paste(im, (ox, oy), im)
    a = layer.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    # contorno branco uniforme (estilo figurinha) + sombra suave
    ring = a.filter(ImageFilter.MaxFilter(outline * 2 + 1)).filter(ImageFilter.GaussianBlur(0.8))
    shadow = ring.filter(ImageFilter.GaussianBlur(outline * 1.2)).point(lambda v: int(v * 0.45))
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 255)); sh.putalpha(shadow)
    canvas.alpha_composite(sh, (0, max(2, outline // 2)))
    white = Image.new('RGBA', (size, size), (255, 255, 255, 255)); white.putalpha(ring)
    canvas.alpha_composite(white)
    canvas.alpha_composite(layer)
    return canvas
for n in names:
    sticker(f'raw-{n}.png', 512, 7, 30).save(f'out/figurinhas/resenha-{n}.png')
    if n != 'logo-texto': sticker(f'raw-{n}.png', 128, 3, 6).save(f'out/emojis/resenha-{n}.png')
# prévia: fundo escuro e claro
for bgc, tag in [((17,19,24), 'escuro'), ((242,243,245), 'claro')]:
    sheet = Image.new('RGB', (5 * 260, 2 * 260), bgc)
    for i, n in enumerate(names):
        s = Image.open(f'out/figurinhas/resenha-{n}.png').resize((250, 250), Image.LANCZOS)
        sheet.paste(s, ((i % 5) * 260 + 5, (i // 5) * 260 + 5), s)
    e = [Image.open(f'out/emojis/resenha-{n}.png') for n in names if n != 'logo-texto']
    for j, s in enumerate(e):
        s2 = s.resize((48, 48), Image.LANCZOS)
        sheet.paste(s2, (4 * 260 + 10 + (j % 4) * 60, 260 + 30 + (j // 4) * 60), s2)
    sheet.save(f'previa-{tag}.png')
