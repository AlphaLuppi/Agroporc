#!/usr/bin/env bash
# Importe un son pour l'arène / le mode zombies : extrait la piste audio (MP4, MOV, WAV, OGG, FLAC…), la passe en mono,
# coupe le silence au début et à la fin, normalise la crête à −1 dBFS et l'encode en MP3 (lu partout, Safari compris).
#
# Usage : scripts/fps/importer_son.sh <entrée> <sortie.mp3>
#   ex. : scripts/fps/importer_son.sh ~/Downloads/griffe.mp4 public/arene/sons/griffe-chef.mp3
#
# Variables facultatives :
#   FILTRE      chaîne de filtres ffmpeg appliquée AVANT la normalisation (ex. "rubberband=pitch=0.8", "atrim=0:2")
#   DUREE_MAX   durée gardée au plus, en s (défaut 6), avec un fondu de sortie de 0,25 s
#   FREQUENCE   fréquence d'échantillonnage de sortie (défaut 44100 ; 22050 pour une voix)
#   DEBIT       débit MP3 (défaut 96k ; 48k pour une voix)
#   SEUIL       seuil du silence coupé (défaut -45dB)
#
# Le jeu cale lui-même le son sur le coup : `sons.ts` cherche à la lecture l'instant du maximum (`instantPic` de
# lib/fps/sons-echantillons.ts) et le fait tomber au contact de la griffe (`ZOMBIES.griffeArmeS`). Remplacer le fichier suffit,
# sans toucher au code. Penser à mettre à jour public/arene/CREDITS.txt (origine et licence du son).
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
ENTREE="$1"
SORTIE="$2"
FILTRE="${FILTRE:-}"
DUREE_MAX="${DUREE_MAX:-6}"
FREQUENCE="${FREQUENCE:-44100}"
DEBIT="${DEBIT:-96k}"
SEUIL="${SEUIL:--45dB}"

command -v ffmpeg >/dev/null || { echo "ffmpeg introuvable (apt install ffmpeg)" >&2; exit 1; }
[ -f "$ENTREE" ] || { echo "entrée introuvable : $ENTREE" >&2; exit 1; }
mkdir -p "$(dirname "$SORTIE")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. audio seul, mono, flottant 44,1 kHz ; filtre facultatif ; silence coupé aux deux bouts (le second passage sur le son retourné) ;
#    durée bornée avec un fondu de sortie
COUPE="silenceremove=start_periods=1:start_threshold=${SEUIL}:start_silence=0.01,areverse,silenceremove=start_periods=1:start_threshold=${SEUIL}:start_silence=0.05,areverse"
CHAINE="aresample=44100${FILTRE:+,$FILTRE},${COUPE},atrim=0:${DUREE_MAX}"
ffmpeg -hide_banner -loglevel error -y -i "$ENTREE" -vn -ac 1 -af "$CHAINE" -c:a pcm_f32le "$TMP/brut.wav"
DUREE="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/brut.wav")"
FONDU_DEBUT="$(awk -v d="$DUREE" 'BEGIN { x = d - 0.25; if (x < 0) x = 0; printf "%.3f", x }')"

# 2. crête mesurée puis ramenée à −1 dBFS
CRETE="$(ffmpeg -hide_banner -nostats -i "$TMP/brut.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\{0,1\}[0-9.]*\) dB.*/\1/p')"
GAIN="$(awk -v c="${CRETE:-0}" 'BEGIN { printf "%.2f", -1 - c }')"

# 3. MP3 mono
ffmpeg -hide_banner -loglevel error -y -i "$TMP/brut.wav" \
  -af "afade=t=out:st=${FONDU_DEBUT}:d=0.25,volume=${GAIN}dB,aresample=${FREQUENCE}" \
  -ac 1 -c:a libmp3lame -b:a "$DEBIT" "$SORTIE"

TAILLE="$(wc -c < "$SORTIE")"
printf '%s : %.2f s, %s octets (crête %s dB → −1 dB)\n' "$SORTIE" "$DUREE" "$TAILLE" "${CRETE:-?}"
