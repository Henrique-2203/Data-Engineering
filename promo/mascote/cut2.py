import numpy as np
from collections import deque
from PIL import Image, ImageFilter
exec(open('cut.py').read().split('for name, (x0')[0])  # B e label()
c = A
white = (c.min(axis=2) > 120)
wall = np.asarray(Image.fromarray((white * 255).astype('uint8')).filter(ImageFilter.MaxFilter(int(__import__('os').environ.get('DIL','9'))))) > 0
lab, n = label(~wall)
border = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1]); border.discard(0)
bg = np.isin(lab, list(border))
fg = ~bg | (c.max(axis=2) > 60)
flab, fn = label(fg)
sizes = np.bincount(flab.ravel())
# cada pedaço vai para a figura cujo retângulo contém o centro dele
ys, xs = np.nonzero(flab)
owner = {}
cy = np.bincount(flab.ravel(), weights=np.indices(flab.shape)[0].ravel()) / np.maximum(sizes, 1)
cx = np.bincount(flab.ravel(), weights=np.indices(flab.shape)[1].ravel()) / np.maximum(sizes, 1)
for i in range(1, fn + 1):
    if sizes[i] < 30: continue
    for name, (x0, y0, x1, y1) in B.items():
        if x0 <= cx[i] < x1 and y0 <= cy[i] < y1:
            owner[i] = name; break
ONLY = __import__('os').environ.get('ONLY')
for name in (ONLY.split(',') if ONLY else B):
    ids = [i for i, o in owner.items() if o == name]
    m = np.isin(flab, ids)
    alpha = Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7))
    rgba = Image.fromarray(c.astype('uint8')).convert('RGBA'); rgba.putalpha(alpha)
    rgba = rgba.crop(alpha.point(lambda v: 255 if v > 8 else 0).getbbox())
    rgba.save(f'raw-{name}.png'); print(name, rgba.size, len(ids))
