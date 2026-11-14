from PIL import Image, ImageFilter, ImageEnhance, ImageChops
import os
os.makedirs('out/figurinhas', exist_ok=True); os.makedirs('out/emojis', exist_ok=True)
names = ['joinha','oculos','bandeira','curioso','fone','dormindo','bravo','coracao','logo-texto']
def limpa_borda(im, protege=()):
    """Borda da figurinha. O recorte deixou, por fora do contorno branco do desenho, uma faixa de 4-5 px
    do fundo preto. Ela sai: só o que dá para alcançar vindo de fora SEM atravessar nenhum branco, até
    5 px e perto de um branco. A borda preta do próprio desenho (ex.: topo do boné) fica atrás do
    contorno branco e não é alcançada. Depois a beirada fica branca e lisa (nunca clareia o preto)."""
    import numpy as np
    from cut_label import label
    a = np.asarray(im).copy()
    rgb, al = a[..., :3].astype(int), a[..., 3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    dil = lambda m, r: np.asarray(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0
    bg = al < 128
    # o limite da imagem conta como fundo (a faixa escura do rodapé encosta nele)
    frame = np.zeros_like(bg); frame[0, :] = frame[-1, :] = True; frame[:, 0] = frame[:, -1] = True
    bg |= frame & (mx < 120)
    white = mn > 150
    # o contorno de verdade é o branco grande e contínuo em volta; brilhos pequenos do desenho não contam
    from cut_label import label as _lab
    lw, nw = _lab(white)
    big = np.zeros_like(white)
    if nw:
        sz = np.bincount(lw.ravel())
        big = (sz[lw] > 200) & (lw > 0)
    near_w = dil(big, 6)
    # só a faixa FINA (a sobra do fundo tem 3-4 px); o preto grosso do desenho (pontas do boné) fica
    ero = lambda m, r: ~dil(~m, r)
    darkm = (mx < 120) & ~bg
    thin = darkm & ~dil(ero(darkm, 2), 2)
    perto_fundo = dil(bg, 5)
    # partes pontudas do próprio desenho que encostam na borda (ex.: a ponta do boné do joinha): não mexe
    for x0, y0, x1, y1 in protege:
        thin[y0:y1, x0:x1] = False
    for _ in range(6):
        grow = dil(bg, 1) & thin & near_w & perto_fundo & ~bg
        if not grow.any(): break
        bg |= grow
    # pedacinhos escuros pequenos cercados só de branco/fundo: sujeira do recorte (o traço de verdade
    # sempre encosta em outras cores do desenho)
    lab, n = label((mx < 120) & ~bg)
    if n:
        sizes = np.bincount(lab.ravel())
        for i in np.nonzero((sizes < 80) & (np.arange(len(sizes)) > 0))[0]:
            comp = lab == i
            ys, xs = np.nonzero(comp)
            y0, y1, x0, x1 = max(0, ys.min() - 3), ys.max() + 4, max(0, xs.min() - 3), xs.max() + 4
            c = comp[y0:y1, x0:x1]
            ringm = dil(c, 2) & ~c
            around = (white | bg)[y0:y1, x0:x1][ringm]
            if around.size and around.mean() > 0.85:
                bg[y0:y1, x0:x1] |= c & dil(bg[y0:y1, x0:x1], 3)
                white_fix = c & ~bg[y0:y1, x0:x1]
                a[y0:y1, x0:x1, :3][white_fix] = 255
                mx[y0:y1, x0:x1][white_fix] = 255; mn[y0:y1, x0:x1][white_fix] = 255
                white[y0:y1, x0:x1] |= white_fix
    # rabiscos e pontilhados escuros finos no meio do branco (sobra do fundo entre o contorno da figura e
    # o dos enfeites, ou em volta do "?"): saem. O traço do desenho é largo ou encosta no corpo escuro.
    vivid = ((mx - mn) > 70) & (mx > 120)
    dk = (mx < 110) & ~bg
    lab, n = label(dk)
    if n:
        sizes = np.bincount(lab.ravel())
        core = ero(dk, 1)  # o que sobra com 3 px de largura
        has_core = np.bincount(lab[core].ravel(), minlength=n + 1) > 0
        for i in np.nonzero((sizes < 1500) & (np.arange(len(sizes)) > 0))[0]:
            comp = lab == i
            ys, xs = np.nonzero(comp)
            y0, y1, x0, x1 = max(0, ys.min() - 3), ys.max() + 4, max(0, xs.min() - 3), xs.max() + 4
            c = comp[y0:y1, x0:x1]
            ringm = dil(c, 2) & ~c
            r_white = (white | bg)[y0:y1, x0:x1][ringm].mean() if ringm.any() else 0
            r_ok = (white | bg | vivid)[y0:y1, x0:x1][ringm].mean() if ringm.any() else 0
            fino = not has_core[i] or sizes[i] < 120
            if (fino and r_ok > 0.9 and r_white > 0.35) or r_white > 0.9:
                sub = a[y0:y1, x0:x1, :3]
                sub[c] = 255
                mx[y0:y1, x0:x1][c] = 255; mn[y0:y1, x0:x1][c] = 255
                white[y0:y1, x0:x1] |= c
    # farelos finos grudados na silhueta (fiapos de 1-2 px, menta/cinza/preto): saem; o pau da bandeira
    # (marrom) e as partes grossas ficam
    keep = ~bg
    opened = dil(ero(keep, 1), 1)
    sat = mx - mn
    teal_or_neutral = (sat < 40) | ((rgb[..., 1] - rgb[..., 0] > 30) & (rgb[..., 2] > 60))
    crumbs = keep & ~opened & teal_or_neutral & dil(bg, 2)
    for x0, y0, x1, y1 in protege:
        crumbs[y0:y1, x0:x1] = False
    bg |= crumbs
    neutral = (mx - mn) < 40
    band = dil(bg, 3) & ~bg
    fix = band & (neutral | (mn > 110)) & (mx >= 50)  # cinza de transição e menta clarinho viram branco
    # pontinhos escuros soltos dentro do branco da borda (ilhas pequenas cercadas de branco)
    lab, n = label(dil(bg, 8) & ~bg & ~white)
    if n:
        sizes = np.bincount(lab.ravel())
        small = (sizes[lab] < 25) & (lab > 0)
        fix |= small & dil(white, 1)
    rgb2 = a[..., :3].copy()
    rgb2[fix] = 255
    # fio cinza pontilhado dentro do contorno branco original (cinza neutro, perto da borda)
    gray = ((mx - mn) < 40) & (mn > 35) & (mn < 245) & ~bg
    rgb2[gray & dil(white, 2) & dil(bg, 10)] = 255
    # beirada semi-transparente do recorte original (pontilhado cinza em volta dos enfeites)
    rgb2[(al < 250) & ~bg & dil(white, 3)] = 255
    # última passada: sujeirinhas que sobraram no branco (grupos pequenos não brancos cercados de branco)
    W2 = (rgb2.min(axis=2) > 235) | bg
    lab, n = label(~W2 & dil(bg, 14))
    if n:
        sizes = np.bincount(lab.ravel())
        for i in np.nonzero((sizes < 90) & (np.arange(len(sizes)) > 0))[0]:
            comp = lab == i
            ys, xs = np.nonzero(comp)
            y0, y1, x0, x1 = max(0, ys.min() - 3), ys.max() + 4, max(0, xs.min() - 3), xs.max() + 4
            c = comp[y0:y1, x0:x1]
            ringm = dil(c, 2) & ~c
            if ringm.any() and W2[y0:y1, x0:x1][ringm].mean() > 0.75:
                rgb2[y0:y1, x0:x1][c] = 255
    rgb2[bg] = 255  # o transparente não guarda mais o preto do fundo (vazava ao reduzir a imagem)
    alpha = Image.fromarray(np.where(bg, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.6))
    out = Image.fromarray(rgb2.astype('uint8')).convert('RGBA'); out.putalpha(alpha)
    return out
# cantos do desenho que a limpeza da borda não deve tocar (x0, y0, x1, y1 no recorte)
PROTEGE = {'joinha': [(85, 0, 230, 45)]}
def sticker(src, size, outline, pad):
    nome = src.split('raw-')[-1].split('.')[0]
    im = limpa_borda(Image.open(src).convert('RGBA'), PROTEGE.get(nome, ()))
    # cor um pouco mais viva e nítida
    rgb = ImageEnhance.Color(im.convert('RGB')).enhance(1.08)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.04)
    a = im.getchannel('A')
    im = rgb.convert('RGBA'); im.putalpha(a)
    inner = size - 2 * pad
    k = inner / max(im.size)
    # a cor é reduzida e afiada já "chapada" no branco (a beirada da figura é branca); a transparência é
    # reduzida à parte e sem nitidez extra. Afiar com transparência junto escurecia a beirada (pontilhado).
    size2 = (round(im.width * k), round(im.height * k))
    flat = Image.new('RGBA', im.size, (255, 255, 255, 255)); flat.alpha_composite(im)
    col = flat.convert('RGB').resize(size2, Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
    alp = im.getchannel('A').resize(size2, Image.LANCZOS)
    im = col.convert('RGBA'); im.putalpha(alp)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ox, oy = (size - im.width) // 2, (size - im.height) // 2
    layer = Image.new('RGBA', (size, size), (255, 255, 255, 0)); layer.alpha_composite(im, (ox, oy))  # sem misturar a beirada com preto
    a = layer.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    # contorno branco uniforme (estilo figurinha) + sombra suave
    # contorno arredondado e liso (o filtro quadrado deixava as diagonais em "degrauzinhos")
    import numpy as np
    d = np.asarray(a.filter(ImageFilter.GaussianBlur(outline * 0.55))).astype(float) / 255
    ring = Image.fromarray((np.clip((d - 0.04) / 0.10, 0, 1) * 255).astype('uint8'))
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
