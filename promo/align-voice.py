# Alinha um áudio narrado com o roteiro (uma fala por linha) usando reconhecimento de fala de verdade.
# Modelo: Parakeet TDT 0.6B v3 (multilíngue, inclui português) do sherpa-onnx, baixado do GitHub:
#   pip install sherpa-onnx numpy
#   curl -L -o m.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 && tar xjf m.tar.bz2
# Uso: python3 promo/align-voice.py <pasta-do-modelo> <audio> <roteiro.txt> <saida.json>
# Saída: [{line, start, end, words: [[palavra do roteiro, início, fim]], asr}] (formato usado por build-conversation.mjs)
import sys, json, re, subprocess, unicodedata
import numpy as np, sherpa_onnx
model, audio, script, out = sys.argv[1:5]
rec = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=f'{model}/encoder.int8.onnx', decoder=f'{model}/decoder.int8.onnx', joiner=f'{model}/joiner.int8.onnx', tokens=f'{model}/tokens.txt', model_type='nemo_transducer', num_threads=4)
SR = 16000
a = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout, dtype=np.float32)
s = rec.create_stream(); s.accept_waveform(SR, a); rec.decode_stream(s)
asr = []  # [[palavra reconhecida, início]]
for tok, ts in zip(s.result.tokens, s.result.timestamps):
    if tok.startswith(' ') or tok.startswith('▁') or not asr: asr.append([tok.strip(' ▁'), ts])
    else: asr[-1][0] += tok
lines = [l.strip() for l in open(script, encoding='utf8') if l.strip()]

dur = len(a) / SR
HOP = 160  # 10 ms
n = len(a)//HOP
rms = np.array([np.sqrt(np.mean(a[i*HOP:(i+1)*HOP]**2)+1e-12) for i in range(n)])
db = 20*np.log10(rms)
peak = np.percentile(db, 98)
TH = peak - 32
def norm(w):
    w = unicodedata.normalize('NFD', w.lower()); w = ''.join(c for c in w if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]', '', w)
# índice da primeira palavra reconhecida de cada fala
starts, k = [], 0
for li, l in enumerate(lines):
    sw = [norm(x) for x in l.split()][:2]
    best = None
    for j in range(k, len(asr)):
        a0 = norm(asr[j][0]); a1 = norm(asr[j+1][0]) if j+1 < len(asr) else ''
        if a0 == sw[0] and (len(sw) < 2 or a1 == sw[1]): best = j; break
    if best is None:  # aceita só o 2º ou só o 1º termo (ex.: "Chama" -> "Chão")
        for j in range(k, len(asr)):
            if j+1 < len(asr) and norm(asr[j+1][0]) == sw[1] and (li == len(lines)-1 or j > k): best = j; break
    if li == 0: best = 0
    assert best is not None, l
    starts.append(best); k = best + 1
def onset(t, lo):
    # volta do tempo do token até achar silêncio (início real da fala)
    f = int(t*100)
    while f > int(lo*100) and db[f-1] > TH: f -= 1
    return max(lo, f/100)
def offset(t, hi):
    # anda a partir de t até o som ficar abaixo do limiar por 120 ms
    f = int(t*100)
    while f < min(n, int(hi*100)):
        if all(db[f:f+12] < TH): return f/100
        f += 1
    return hi
res = []
for li, l in enumerate(lines):
    j0 = starts[li]; j1 = starts[li+1] if li+1 < len(lines) else len(asr)
    nxt = asr[j1][0+1] if j1 < len(asr) else dur
    ws = asr[j0:j1]
    st = onset(ws[0][1], res[-1]['end'] if res else 0)
    en = offset(ws[-1][1] + 0.12, nxt - 0.02)
    # tempos por palavra do roteiro: mapeia 1:1 se bater, senão proporcional às reconhecidas
    sw = l.split()
    times = [w[1] for w in ws]
    if len(times) == len(sw): tt = times
    else: tt = list(np.interp(np.linspace(0, len(times)-1, len(sw)), np.arange(len(times)), times))
    tt[0] = max(st, tt[0]) if tt[0] - st < 0.25 else st
    wl = []
    for i, w in enumerate(sw):
        b = tt[i+1] - 0.02 if i+1 < len(sw) else en
        wl.append([w, round(float(tt[i]), 3), round(float(max(b, tt[i] + 0.08)), 3)])
    res.append({'line': l, 'start': round(st, 3), 'end': round(en, 3), 'words': wl, 'asr': ' '.join(w[0] for w in ws)})
for r in res: print(f"{r['start']:6.2f}-{r['end']:6.2f}  {r['line'][:50]:50s} | {r['asr'][:50]}")
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
