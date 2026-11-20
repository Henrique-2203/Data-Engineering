# Pixeliza nas prints reais do Henrique o que é de terceiros ou pessoal: arte do GTA (banner),
# arte anime do amigo, fotos de perfil, ícone do servidor e o nome do amigo.
# Uso: python3 promo/privacidade/prep-prints.py <print-janela.webp> <print-cadeado.webp>
import sys
from PIL import Image

def pix(im, box, block):
    x0, y0, x1, y1 = box
    r = im.crop(box)
    w, h = r.size
    r = r.resize((max(1, w // block), max(1, h // block)), Image.BILINEAR).resize((w, h), Image.NEAREST)
    im.paste(r, (x0, y0))

def save(im, name):
    im.save(f'promo/out/privacidade/shots/{name}.png')
    print('✓', name)

# 1) janela "Transmitir tela" por cima do quadro do Henrique (banner com arte do GTA)
a = Image.open(sys.argv[1]).convert('RGB')
modal = a.crop((681, 206, 1239, 849))
pix(a, (328, 83, 1912, 946), 22)          # banner (arte de terceiros)
a.paste(modal, (681, 206))                # a janela fica nítida
for box in [(8, 96, 64, 152), (108, 362, 140, 392), (108, 517, 140, 548), (76, 984, 122, 1026)]:
    pix(a, box, 8)                        # ícone do servidor e fotos de perfil
pix(a, (138, 520, 200, 546), 7)           # nome do amigo na lista
save(a, 'print-janela')

# 2) a visão de quem ficou de fora (cadeado)
b = Image.open(sys.argv[2]).convert('RGB')
for box in [(859, 83, 1382, 946), (1389, 83, 1912, 946)]:
    pix(b, box, 26)                       # banners (anime do amigo, GTA + foto do Henrique)
for box in [(8, 96, 64, 152), (108, 484, 140, 514), (106, 512, 140, 546), (76, 984, 122, 1026)]:
    pix(b, box, 8)
pix(b, (138, 487, 200, 510), 7)           # nome do amigo na lista
pix(b, (402, 914, 494, 934), 6)           # "Tela de <amigo>"
pix(b, (438, 525, 492, 547), 6)           # nome no aviso do cadeado
save(b, 'print-cadeado')
