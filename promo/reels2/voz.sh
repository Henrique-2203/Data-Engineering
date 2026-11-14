#!/usr/bin/env bash
# Voz do Reels 2: só -1,5 semitom (altura e timbre juntos, para não reconhecerem), mesma velocidade.
# O efeito entra ANTES do filtro do app; as duas gravações (falando e só teclado) usam o mesmo ajuste
# de volume (-1 dB), porque foram gravadas do mesmo jeito.
# Uso: promo/reels2/voz.sh entrada saida.wav
set -euo pipefail
P=$(python3 -c "print(2**(-1.5/12))"); T=$(python3 -c "print(1/(2**(-1.5/12)))")
FX="volume=-1dB,asetrate=48000*$P,aresample=48000,atempo=$T"
ffmpeg -loglevel error -y -i "$1" -af "$FX" -ar 48000 -ac 1 "$2"
