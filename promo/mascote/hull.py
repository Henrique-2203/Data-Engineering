import numpy as np
from PIL import Image, ImageDraw, ImageFilter
im = Image.open('original.png').convert('RGB'); A = np.asarray(im).astype(int)
B = {'oculos':(418,25,795,425),'bandeira':(790,20,1245,425)}
def hull(pts):
    pts = sorted(set(pts))
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
for name, (x0, y0, x1, y1) in B.items():
    c = A[y0:y1, x0:x1]
    white = c.min(axis=2) > 120
    ys, xs = np.nonzero(white)
    poly = hull(list(zip(xs.tolist(), ys.tolist())))
    m = Image.new('L', (x1-x0, y1-y0), 0); ImageDraw.Draw(m).polygon(poly, fill=255)
    inside = np.asarray(m) > 0
    # o fundo é quase-preto (3-6); o traço do desenho é preto puro (0): o fundo "escorre" de fora pra dentro só por ele
    mx = c.max(axis=2)
    bgish = (mx >= 1) & (mx <= 8)
    from collections import deque
    h, w = mx.shape
    seen = ~inside.copy()
    q = deque(zip(*np.nonzero(~inside)))
    bg = ~inside.copy()
    while q:
        y, x = q.popleft()
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and bgish[ny, nx]:
                bg[ny, nx] = True; q.append((ny, nx))
    fg = (~bg) | (mx > 60)
    # fiapos soltos sem cor (pedaços do contorno das figuras vizinhas) saem
    exec(open('cut.py').read().split('for name, (x0')[0].split('im = Image.open')[0])
    from cut_label import label
    lab, n = label(fg)
    sizes = np.bincount(lab.ravel())
    sat = (c.max(axis=2) - c.min(axis=2)) > 60
    satc = np.bincount(lab.ravel(), weights=sat.ravel())
    big = sizes.argsort()[-2]  # o maior depois do 0... (o 0 é fundo)
    keep = np.zeros(n + 1, bool)
    for i in range(1, n + 1):
        keep[i] = sizes[i] > 20000 or (sizes[i] > 60 and satc[i] / sizes[i] > 0.5)
    fg = keep[lab]
    # fora do contorno só ficam enfeites de verdade (não o fundo quase preto)
    alpha = Image.fromarray((fg * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7))
    rgba = Image.fromarray(c.astype('uint8')).convert('RGBA'); rgba.putalpha(alpha)
    rgba = rgba.crop(alpha.point(lambda v: 255 if v > 8 else 0).getbbox())
    rgba.save(f'raw-{name}.png'); print(name, rgba.size)
