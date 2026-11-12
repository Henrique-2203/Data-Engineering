# Junta o roteiro (uma fala por linha) com as palavras reconhecidas no áudio da narração (na mesma
# ordem) e grava [{line, start, end, words: [[palavra do roteiro, início, fim]]}] para as legendas.
# Uso: python3 promo/narracao-json.py <modelo-asr> <narracao.wav> <roteiro.txt> <saida.json>
import sys, json, subprocess
import numpy as np, sherpa_onnx
model, audio, script, out = sys.argv[1:5]
rec = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=f'{model}/encoder.int8.onnx', decoder=f'{model}/decoder.int8.onnx', joiner=f'{model}/joiner.int8.onnx', tokens=f'{model}/tokens.txt', model_type='nemo_transducer', num_threads=4)
a = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True).stdout, dtype=np.float32)
s = rec.create_stream(); s.accept_waveform(16000, a); rec.decode_stream(s)
asr = []
for tok, ts in zip(s.result.tokens, s.result.timestamps):
    if tok.startswith(' ') or tok.startswith('▁') or not asr: asr.append([tok.strip(' ▁'), round(ts, 2)])
    else: asr[-1][0] += tok
lines = [l.strip() for l in open(script, encoding='utf8') if l.strip()]
words = [w for l in lines for w in l.split()]
assert len(words) == len(asr), f'roteiro tem {len(words)} palavras e o áudio {len(asr)}: {[w for w, _ in asr]}'
HOP = 160; n = len(a) // HOP
db = 20 * np.log10(np.array([np.sqrt(np.mean(a[i*HOP:(i+1)*HOP]**2) + 1e-12) for i in range(n)]))
TH = np.percentile(db, 98) - 32
def onset(t):
    f = int(t * 100)
    while f > 0 and db[f-1] > TH: f -= 1
    return f / 100
def offset(t, hi):
    f = int(t * 100)
    while f < min(n, int(hi * 100)):
        if all(db[f:f+12] < TH): return f / 100
        f += 1
    return hi
res, k = [], 0
for li, l in enumerate(lines):
    ws = l.split(); ts = [asr[k + i][1] for i in range(len(ws))]; k += len(ws)
    nxt = asr[k][1] if k < len(asr) else n / 100
    st = onset(ts[0]) if li else 0.0
    en = offset(ts[-1] + 0.15, nxt)
    res.append({'line': l, 'start': st, 'end': en, 'words': [[w, t, ts[i+1] if i+1 < len(ts) else en] for i, (w, t) in enumerate(zip(ws, ts))]})
    print(f'{li+1} {st:6.2f}-{en:6.2f} {l}')
json.dump(res, open(out, 'w'), ensure_ascii=False)
