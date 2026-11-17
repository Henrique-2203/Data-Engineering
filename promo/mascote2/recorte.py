"""Figurinhas das poses novas do mascote (folha do Gemini com fundo branco, promo/out/mascote2/folha.jpg).
Separa cada pose, tira o fundo branco, coloca contorno branco + sombra (estilo das figurinhas) e salva
512 px (figurinha) e 128 px (emoji) em promo/out/mascote2/. Uso: python3 promo/mascote2/recorte.py
Precisa de numpy, scipy e Pillow."""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
from scipy import ndimage as nd
import os

OUT = 'promo/out/mascote2'
NOMES = ['oi', 'kkk', 'ganhei', 'jogando', 'uhul', 'triste', 'falando', 'surpreso', 'pensando', 'pipoca']
os.makedirs(f'{OUT}/figurinhas', exist_ok=True)
os.makedirs(f'{OUT}/emojis', exist_ok=True)

im = Image.open(f'{OUT}/folha.jpg').convert('RGB')
a = np.asarray(im).astype(float)
W, H = im.size
# fundo = branco ligado à borda da folha (brilhos brancos dentro do desenho não são fundo)
near_white = a.min(2) > 225
lab, n = nd.label(near_white)
borda = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
fundo = np.isin(lab, list(borda))
fig = ~fundo
fig = nd.binary_opening(fig, iterations=1)
lab, n = nd.label(fig)
tam = nd.sum(np.ones_like(fig), lab, range(1, n + 1))
grandes = [i + 1 for i in range(n) if tam[i] > 20000]
caixas = {i: nd.find_objects((lab == i).astype(int))[0] for i in grandes}
# pedacinhos (gotas de choro, pipoca voando) vão para a pose mais perto
for i in range(1, n + 1):
    if i in grandes or tam[i - 1] < 30:
        continue
    ys, xs = np.nonzero(lab == i)
    cy, cx = ys.mean(), xs.mean()
    melhor = min(grandes, key=lambda g: (max(caixas[g][1].start - cx, 0, cx - caixas[g][1].stop) ** 2 + max(caixas[g][0].start - cy, 0, cy - caixas[g][0].stop) ** 2))
    lab[lab == i] = melhor
# ordem de leitura: linha de cima e depois a de baixo, da esquerda para a direita
cent = {g: nd.center_of_mass(lab == g) for g in grandes}
ordem = sorted(grandes, key=lambda g: (cent[g][0] > H / 2, cent[g][1]))
print('poses encontradas:', len(ordem))

for nome, g in zip(NOMES, ordem):
    m = lab == g
    sl = nd.find_objects(m.astype(int))[0]
    pad = 40
    y0, y1 = max(0, sl[0].start - pad), min(H, sl[0].stop + pad)
    x0, x1 = max(0, sl[1].start - pad), min(W, sl[1].stop + pad)
    crop = a[y0:y1, x0:x1]
    mm = m[y0:y1, x0:x1]
    # borda suave: perto do fundo, a transparência acompanha o quanto o pixel é "branco"
    soft = np.clip((255 - crop.min(2)) / 60, 0, 1)
    edge = nd.binary_dilation(mm, iterations=2) & ~nd.binary_erosion(mm, iterations=2)
    alpha = np.where(edge, soft, mm.astype(float))
    alpha = nd.binary_fill_holes(alpha > 0.5) * np.maximum(alpha, nd.binary_fill_holes(mm))
    rgba = np.dstack([crop, alpha * 255]).astype('uint8')
    fig_im = Image.fromarray(rgba, 'RGBA')
    # tamanho final: cabe em 512 com espaço para o contorno
    S = 512
    esc = (S - 64) / max(fig_im.size)
    fig_im = fig_im.resize((max(1, round(fig_im.width * esc)), max(1, round(fig_im.height * esc))), Image.LANCZOS)
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ox, oy = (S - fig_im.width) // 2, (S - fig_im.height) // 2
    canvas.alpha_composite(fig_im, (ox, oy))
    al = canvas.getchannel('A')
    contorno = al.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.GaussianBlur(1.2))
    sombra = contorno.filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * 0.35))
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0)); sh.putalpha(sombra)
    out.alpha_composite(sh, (0, 6))
    branco = Image.new('RGBA', (S, S), (255, 255, 255, 0)); branco.putalpha(contorno)
    out.alpha_composite(branco)
    out.alpha_composite(canvas)
    out.save(f'{OUT}/figurinhas/resenha-{nome}.png')
    out.resize((128, 128), Image.LANCZOS).save(f'{OUT}/emojis/resenha-{nome}.png')
    print('ok', nome)

# prévia num fundo escuro e num claro
prev = Image.new('RGB', (5 * 260 + 20, 2 * 260 * 2 + 30), (17, 19, 24))
claro = Image.new('RGB', (5 * 260, 2 * 260), (242, 243, 246))
for k, nome in enumerate(NOMES):
    f = Image.open(f'{OUT}/figurinhas/resenha-{nome}.png').resize((250, 250), Image.LANCZOS)
    prev.paste(f, (10 + (k % 5) * 260, 10 + (k // 5) * 260), f)
    claro.paste(f, ((k % 5) * 260, (k // 5) * 260), f)
prev.paste(claro, (10, 2 * 260 + 20))
prev.save(f'{OUT}/previa.png')
