from PIL import Image, ImageFilter
L = Image.open('logo-oficial.png').convert('RGBA')
# (centro x, centro y, tamanho, inclinação em graus) de cada logo do boné/moletom/fone, nas imagens recortadas
POS = {
  'joinha':   [(165, 58, 44, 0), (268, 357, 40, 0)],
  'oculos':   [(160, 45, 42, -4), (258, 343, 40, 0)],
  'bandeira': [(126, 84, 40, -18), (238, 372, 42, 0)],
  'curioso':  [(181, 90, 42, -14)],
  'fone':     [(163, 75, 38, 0), (285, 194, 40, 0), (152, 330, 40, 0)],
  'dormindo': [(211, 128, 40, -8)],
  'bravo':    [(195, 62, 44, 0), (280, 386, 44, 0)],
  'coracao':  [(243, 42, 34, 8)],
}
def badge(size, ang):
    s = size * 4
    lg = L.resize((s, s), Image.LANCZOS)
    # traço escuro em volta (estilo do desenho)
    a = lg.getchannel('A').filter(ImageFilter.MaxFilter(9))
    out = Image.new('RGBA', (s + 16, s + 16), (0, 0, 0, 0))
    edge = Image.new('RGBA', (s + 16, s + 16), (10, 12, 14, 255)); ea = Image.new('L', (s + 16, s + 16), 0); ea.paste(a, (8, 8)); edge.putalpha(ea)
    out.alpha_composite(edge); out.alpha_composite(lg, (8, 8))
    out = out.rotate(ang, resample=Image.BICUBIC, expand=True)
    k = (size + 4) / s
    return out.resize((round(out.width * k), round(out.height * k)), Image.LANCZOS)
for n, items in POS.items():
    im = Image.open(f'orig-raw-{n}.png').convert('RGBA')
    for cx, cy, size, ang in items:
        b = badge(size, ang)
        im.alpha_composite(b, (cx - b.width // 2, cy - b.height // 2))
    im.save(f'raw-{n}.png')
print('ok')
