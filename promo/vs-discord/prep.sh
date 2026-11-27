#!/usr/bin/env bash
# Prepara a gravação do Henrique (Resenha em call assistindo uma transmissão) para o vídeo Resenha × Discord:
# corta o começo (OBS) e a barra de tarefas, pixeliza LEVE a gameplay (jogo de terceiros) e FORTE os
# rostos, nomes e banners dos amigos (privacidade). Mantém legível o selo de estatísticas da transmissão.
# Uso: bash promo/vs-discord/prep.sh <gravacao.mp4>
set -euo pipefail
IN="$1"
OUT=promo/out/vs-discord/shots/clip
mkdir -p "$OUT"
find "$OUT" -name '*.jpg' -delete
ffmpeg -loglevel error -y -ss 1.6 -t 16.8 -i "$IN" -filter_complex "
[0:v]split=6[base][g][t][m][u][st];
[g]crop=1495:795:330:83,pixelize=w=7:h=7[gp];
[t]crop=1590:82:330:889,pixelize=w=18:h=18[tp];
[m]crop=225:125:100:482,pixelize=w=14:h=14[mp];
[u]crop=110:60:72:970,pixelize=w=14:h=14[up];
[st]crop=262:30:338:85[stc];
[base][gp]overlay=330:83[a];[a][tp]overlay=330:889[b];[b][mp]overlay=100:482[c];[c][up]overlay=72:970[d];[d][stc]overlay=338:85,
crop=1920:1032:0:0,fps=30,scale=1600:-2" -q:v 3 "$OUT/%03d.jpg"
ls "$OUT" | wc -l
