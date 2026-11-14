import numpy as np
from collections import deque
from PIL import Image, ImageFilter
im = Image.open('original.png').convert('RGB')
A = np.asarray(im).astype(int)
B = {'joinha':(10,8,415,448),'oculos':(418,25,795,425),'bandeira':(790,20,1245,425),'curioso':(12,470,350,835),'fone':(880,465,1245,820),'dormindo':(8,835,432,1245),'bravo':(430,785,835,1245),'coracao':(850,825,1245,1245),'logo-texto':(366,428,880,700)}

def label(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), int); n = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not lab[y, x]:
                n += 1; q = deque([(y, x)]); lab[y, x] = n
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
    return lab, n

for name, (x0, y0, x1, y1) in B.items():
    c = A[y0:y1, x0:x1]
    # o contorno branco das figurinhas é a "parede": o fundo é tudo que dá para alcançar da borda sem atravessá-lo
    white = (c.min(axis=2) > 170)
    wall = np.asarray(Image.fromarray((white * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))) > 0
    lab, n = label(~wall)
    border = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    bg = np.isin(lab, list(border))
    # enfeites fora do contorno (?, zzz, corações, notas): tudo que tem cor também fica
    fg = ~bg | (c.max(axis=2) > 60)
    # tira pedaços das figuras vizinhas (encostam na borda do recorte) e sujeirinhas pequenas
    flab, fn = label(fg)
    sizes = np.bincount(flab.ravel())
    fb = set(flab[0]) | set(flab[-1]) | set(flab[:, 0]) | set(flab[:, -1]); fb.discard(0)
    keep = np.zeros(fn + 1, bool)
    for i in range(1, fn + 1):
        keep[i] = sizes[i] > 40 and (i not in fb or sizes[i] > 20000)
    fg = keep[flab]
    alpha = Image.fromarray((fg * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7))
    rgba = Image.fromarray(c.astype('uint8')).convert('RGBA'); rgba.putalpha(alpha)
    bb = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    rgba = rgba.crop(bb)
    rgba.save(f'raw-{name}.png'); print(name, rgba.size, fn)
