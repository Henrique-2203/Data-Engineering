#!/usr/bin/env bash
# Voz do Reels 2: -3 semitons (altura e timbre juntos, para não reconhecerem), 6% mais rápida,
# mais presença e um compressor (menos "cansada"). O efeito entra ANTES do filtro do app.
# Uso: promo/reels2/voz.sh entrada saida.wav [normalizar: sim|nao]
set -euo pipefail
P=$(python3 -c "print(2**(-3/12))"); T=$(python3 -c "print(1.06/(2**(-3/12)))")
FX="asetrate=48000*$P,aresample=48000,atempo=$T,highpass=f=90,equalizer=f=280:t=q:w=1:g=-2.5,equalizer=f=3200:t=q:w=1.2:g=4,equalizer=f=6500:t=q:w=1:g=2,acompressor=threshold=-22dB:ratio=3:attack=6:release=90:makeup=4"
if [ "${3:-sim}" = sim ]; then FX="$FX,loudnorm=I=-23:TP=-2:LRA=11"; fi
ffmpeg -loglevel error -y -i "$1" -af "$FX" -ar 48000 -ac 1 "$2"
