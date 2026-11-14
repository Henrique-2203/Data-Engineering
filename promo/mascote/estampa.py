# Tira o logo "parecido" que a IA desenhou (balão verde com 3 pontinhos) e estampa o SÍMBOLO do Resenha
# (o balão com os dois olhinhos) na roupa, no boné e no fone, como tinta: o tecido aparece no miolo,
# acompanha a sombra do pano e tem o mesmo brilho verde do desenho.
import numpy as np
from PIL import Image, ImageFilter
SYM = Image.open('simbolo.png').convert('RGBA')
# caixa exata do logo da IA (x0, y0, x1, y1), inclinação em graus e achatamento (perspectiva)
POS = {
  'joinha':   [(154, 42, 197, 72, 0, 0.85), (248, 339, 295, 386, 0, 1.0)],
  'oculos':   [(141, 29, 191, 70, -4, 0.9), (240, 323, 292, 370, 0, 1.0)],
  'bandeira': [(102, 69, 145, 99, -14, 0.85), (216, 349, 265, 402, 0, 1.0)],
  'curioso':  [(156, 72, 206, 122, -12, 0.95)],
  'fone':     [(143, 64, 178, 91, 0, 0.85), (274, 183, 306, 221, 0, 1.0), (129, 315, 177, 349, 0, 1.0)],
  'dormindo': [(195, 117, 235, 147, -6, 0.85)],
  'bravo':    [(170, 42, 221, 86, 0, 0.9), (259, 368, 306, 416, 0, 1.0)],
  'coracao':  [(222, 37, 262, 71, 8, 0.85)],
}
def inpaint(arr, mask, iters=400):
    """preenche a área marcada espalhando a cor do tecido em volta (difusão)"""
    out = arr.copy()
    # o contorno branco da figurinha não serve de "tecido"
    known = ~mask & (arr.min(axis=2) < 150)
    out[mask] = 0
    for _ in range(iters):
        acc = np.zeros_like(out); cnt = np.zeros(mask.shape)
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ok = known | (mask & (out.sum(2) > 0))
            acc += np.roll(np.roll(out * ok[..., None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(ok, dy, 0), dx, 1)
        fill = acc / np.maximum(cnt, 1)[..., None]
        out[mask] = fill[mask]
    return out
for n, items in POS.items():
    im = Image.open(f'orig-raw-{n}.png').convert('RGBA')
    A = np.asarray(im).astype(float)
    rgb = A[..., :3].copy()
    for bx0, by0, bx1, by1, ang, squash in items:
        w, h = bx1 - bx0 + 1, by1 - by0 + 1
        ccx, ccy = (bx0 + bx1) / 2, (by0 + by1) / 2
        # apaga o balão da IA (+ o brilho em volta) e reconstrói o tecido
        m = np.zeros(rgb.shape[:2], bool)
        yy, xx = np.ogrid[:rgb.shape[0], :rgb.shape[1]]
        m |= ((xx - ccx) / (w / 2 + 3)) ** 2 + ((yy - ccy) / (h / 2 + 3)) ** 2 <= 1
        m &= A[..., 3] > 200
        # reconstrói só a região em volta (rápido)
        P = 14
        ry0, ry1, rx0, rx1 = max(0, by0 - P), min(rgb.shape[0], by1 + P), max(0, bx0 - P), min(rgb.shape[1], bx1 + P)
        rgb[ry0:ry1, rx0:rx1] = inpaint(rgb[ry0:ry1, rx0:rx1].copy(), m[ry0:ry1, rx0:rx1])
        # a estampa: mesmo tamanho do balão da IA
        size = max(w, h) * 1.02
        k = size / max(SYM.size)
        s = SYM.resize((max(1, round(SYM.width * k)), max(1, round(SYM.height * k * squash))), Image.LANCZOS)
        s = s.rotate(ang, resample=Image.BICUBIC, expand=True)
        sa = np.asarray(s).astype(float) / 255
        ox, oy = round(ccx - s.width / 2), round(ccy - s.height / 2)
        # sombra do pano: a tinta fica mais escura onde o tecido é mais escuro (dobras)
        base = rgb[oy:oy + s.height, ox:ox + s.width]
        lum = base.mean(axis=2)
        shade = np.clip(0.75 + lum / 80, 0.75, 1.1)[..., None]
        ink = sa[..., :3] * 255 * shade * 0.95
        a = sa[..., 3:4] * 0.95
        # brilho verde suave em volta (como os olhos do personagem)
        glow = np.asarray(s.getchannel('A').filter(ImageFilter.GaussianBlur(3))).astype(float)[..., None] / 255 * 0.25
        base[:] = base * (1 - glow) + np.array([61, 220, 151]) * glow
        base[:] = base * (1 - a) + ink * a
    A[..., :3] = rgb
    Image.fromarray(np.clip(A, 0, 255).astype('uint8')).save(f'raw-{n}.png')
    print('ok', n)
