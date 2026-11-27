"""
Gera áudios de teste para a supressão de ruído (48 kHz, mono):
  python3 make-keyboard-wav.py saida.wav teclado        -> só cliques de teclado mecânico
  python3 make-keyboard-wav.py saida.wav voz voz.wav    -> só a voz (de um wav qualquer, ex.: espeak-ng)
  python3 make-keyboard-wav.py saida.wav ambos voz.wav  -> voz com o teclado por baixo
"""
import math, random, struct, sys, wave

RATE = 48000


def keyboard(n):
    random.seed(7)
    out = [0.0] * n
    t = 0.05
    while t < n / RATE - 0.05:
        start = int(t * RATE)
        amp = random.uniform(0.35, 0.7)
        for i in range(int(0.012 * RATE)):  # 12 ms por tecla: ataque forte e queda rápida
            out[start + i] += amp * random.uniform(-1, 1) * math.exp(-i / (0.0025 * RATE))
        t += random.uniform(0.07, 0.16)  # digitando rápido
    return out


def read_voice(path, n):
    with wave.open(path) as w:
        rate, width, ch = w.getframerate(), w.getsampwidth(), w.getnchannels()
        raw = w.readframes(w.getnframes())
    vals = struct.unpack('<%dh' % (len(raw) // 2), raw)[::ch]
    src = [v / 32768 for v in vals]
    peak = max(abs(x) for x in src) or 1
    src = [x / peak * 0.6 for x in src]  # voz num volume normal de microfone
    out = []
    for i in range(n):  # reamostra para 48 kHz e repete
        pos = (i * rate / RATE) % len(src)
        j = int(pos)
        out.append(src[j] + (src[(j + 1) % len(src)] - src[j]) * (pos - j))
    return out


secs = 6
n = RATE * secs
kind = sys.argv[2] if len(sys.argv) > 2 else 'teclado'
if kind == 'teclado':
    samples = keyboard(n)
elif kind == 'voz':
    samples = read_voice(sys.argv[3], n)
else:
    samples = [a + b * 0.8 for a, b in zip(read_voice(sys.argv[3], n), keyboard(n))]
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x)) * 32767)) for x in samples))
