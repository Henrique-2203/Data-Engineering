# Troca o logo que a IA inventou (balão verde com 3 pontinhos) pelo SÍMBOLO do Resenha (balão com os dois
# olhinhos), como estampa de verdade: o símbolo fica só no pano (moletom, frente do boné, concha do fone)
# e as linhas do desenho, as dobras e o contorno da figurinha passam POR CIMA dele.
import numpy as np
from collections import deque
from PIL import Image, ImageFilter
SYM = Image.open('simbolo.png').convert('RGBA')
# caixa do logo antigo (x0, y0, x1, y1), inclinação em graus, achatamento vertical (perspectiva)
POS = {
  'joinha':   [(154, 42, 197, 72, 0, 0.85), (248, 339, 295, 386, 0, 1.0)],
  'oculos':   [(141, 29, 191, 70, -4, 0.9), (240, 323, 292, 370, 0, 1.0)],
  'bandeira': [(102, 69, 145, 99, -14, 0.85), (218, 349, 263, 396, 0, 1.0)],
  'curioso':  [(156, 72, 206, 122, -12, 0.95)],
  'fone':     [(143, 64, 178, 91, 0, 0.85), (274, 183, 306, 221, 0, 1.0), (129, 315, 177, 349, 0, 1.0)],
  'dormindo': [(195, 117, 235, 147, -6, 0.85)],
  'bravo':    [(170, 42, 221, 86, 0, 0.9), (259, 368, 306, 416, 0, 1.0)],
  'coracao':  [(222, 37, 262, 71, 8, 0.85)],
}

def dilate(m, r):
    return np.asarray(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0

def fill_holes(m):
    """preenche o que fica fechado dentro da máscara (o miolo do balão antigo)"""
    h, w = m.shape
    out = np.zeros_like(m)
    q = deque([(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)])
    for y, x in q: out[y, x] = not m[y, x]
    q = deque((y, x) for y, x in q if out[y, x])
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not out[ny, nx] and not m[ny, nx]:
                out[ny, nx] = True; q.append((ny, nx))
    return ~out

def inpaint(arr, mask, known, iters=500):
    """preenche `mask` espalhando só as cores `known` (o pano), sem puxar linha preta nem branco"""
    out = arr.copy()
    have = known & ~mask
    for _ in range(iters):
        acc = np.zeros_like(out); cnt = np.zeros(mask.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(np.roll(out * have[..., None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(have, dy, 0), dx, 1)
        fill = acc / np.maximum(cnt, 1)[..., None]
        newly = mask & ~have & (cnt > 0)
        out[mask & (cnt > 0)] = fill[mask & (cnt > 0)]
        have = have | newly
    return out

def surface(rgb, seed, green_ok):
    """o pano em volta do centro: para nas linhas pretas, no branco e (fora do boné verde) no verde"""
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    gr = rgb[..., 1] - rgb[..., 0]
    ok = (mx >= 9) & (mn < 120) & ((gr < 45) | green_ok)
    h, w = mx.shape
    out = np.zeros((h, w), bool)
    q = deque(zip(*np.nonzero(seed & ok)))
    for y, x in q: out[y, x] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not out[ny, nx] and ok[ny, nx]:
                out[ny, nx] = True; q.append((ny, nx))
    return out

for n, items in POS.items():
    im = Image.open(f'orig-raw-{n}.png').convert('RGBA')
    A = np.asarray(im).astype(float)
    rgb = A[..., :3].copy()
    alpha = A[..., 3]
    for bx0, by0, bx1, by1, ang, squash in items:
        P = 16
        ry0, ry1 = max(0, by0 - P), min(rgb.shape[0], by1 + P + 1)
        rx0, rx1 = max(0, bx0 - P), min(rgb.shape[1], bx1 + P + 1)
        reg = rgb[ry0:ry1, rx0:rx1]
        H, W = reg.shape[:2]
        inbox = np.zeros((H, W), bool)
        inbox[by0 - ry0 - 3:by1 - ry0 + 4, bx0 - rx0 - 3:bx1 - rx0 + 4] = True
        gr = reg[..., 1] - reg[..., 0]
        mx, mn = reg.max(axis=2), reg.min(axis=2)
        # 1) o logo antigo: traço verde/menta (e, nos logos "de linha" do boné, o traço claro) + o miolo dele
        tight = np.zeros((H, W), bool)
        tight[by0 - ry0:by1 - ry0 + 1, bx0 - rx0:bx1 - rx0 + 1] = True
        green = (reg[..., 1] > 90) & (gr > 45)
        # traço claro do logo antigo; mas traço claro que continua para fora da caixa é brilho/costura do desenho
        from cut_label import label
        def mostly_inside(m, frac):
            lab, nl = label(m)
            if nl == 0: return m & False
            tot = np.bincount(lab.ravel(), minlength=nl + 1)
            ins = np.bincount(lab[inbox].ravel(), minlength=nl + 1)
            keep = ins >= frac * np.maximum(tot, 1); keep[0] = False
            return keep[lab]
        light = mn > 150
        light_logo = mostly_inside(light, 0.98)      # traço branco do logo (o brilho/costura sai da caixa)
        green_logo = mostly_inside(green, 0.7)       # balão verde do logo (o verde do boné é quase todo fora)
        stroke = inbox & (green_logo | light_logo)
        # o logo antigo = traço + miolo + o contorno preto dele (tudo que é escuro dentro da caixa)
        old = fill_holes(dilate(stroke, 2)) | (tight & ((mx < 12) | stroke))
        old = dilate(old, 1) & inbox & ~(light & ~light_logo)
        old &= alpha[ry0:ry1, rx0:rx1] > 200
        # 2) reconstrói o pano ali, só com a cor do pano (nem linha preta, nem branco)
        fabric = (mx >= 9) & (mx <= 70)
        reg[:] = inpaint(reg, old, fabric)
        # 3) a estampa no tamanho do logo antigo
        w, h = bx1 - bx0 + 1, by1 - by0 + 1
        ccx, ccy = (bx0 + bx1) / 2 - rx0, (by0 + by1) / 2 - ry0
        k = max(w, h) * 1.02 / max(SYM.size)
        s = SYM.resize((max(1, round(SYM.width * k)), max(1, round(SYM.height * k * squash))), Image.LANCZOS)
        s = s.rotate(ang, resample=Image.BICUBIC, expand=True)
        ox, oy = round(ccx - s.width / 2), round(ccy - s.height / 2)
        lay = np.zeros((H, W, 4))
        sx0, sy0 = max(0, -ox), max(0, -oy)
        sx1, sy1 = min(s.width, W - ox), min(s.height, H - oy)
        lay[oy + sy0:oy + sy1, ox + sx0:ox + sx1] = np.asarray(s).astype(float)[sy0:sy1, sx0:sx1] / 255
        # 4) só no pano: as linhas e bordas ficam por cima da estampa
        seed = np.zeros((H, W), bool); seed[int(ccy) - 2:int(ccy) + 3, int(ccx) - 2:int(ccx) + 3] = True
        seed |= old
        green_ok = (reg[seed].mean(axis=0)[1] - reg[seed].mean(axis=0)[0]) > 45  # pano verde (ex.: boné verde)
        surf = surface(reg, seed | old, green_ok)
        surf_soft = np.asarray(Image.fromarray((surf * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.6))).astype(float)[..., None] / 255
        a = lay[..., 3:4] * surf_soft * 0.95
        # tinta acompanha a sombra do pano
        lum = reg.mean(axis=2)[..., None]
        ink = lay[..., :3] * 255 * np.clip(0.75 + lum / 80, 0.75, 1.1) * 0.95
        glow = np.asarray(Image.fromarray((lay[..., 3] * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(2))).astype(float)[..., None] / 255 * 0.12 * surf_soft
        reg[:] = reg * (1 - glow) + np.array([61, 220, 151]) * glow
        reg[:] = reg * (1 - a) + ink * a
        rgb[ry0:ry1, rx0:rx1] = reg
    A[..., :3] = rgb
    Image.fromarray(np.clip(A, 0, 255).astype('uint8')).save(f'raw-{n}.png')
    print('ok', n)
