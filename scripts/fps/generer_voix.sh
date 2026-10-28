#!/usr/bin/env bash
# Régénère les annonces parlées du mode zombies (public/arene/sons/voix/<id>.mp3, registre VOIX_ANNONCES de
# lib/fps/sons-echantillons.ts) : synthèse vocale HORS LIGNE en français, puis traitement « annonceur de fête foraine
# hantée » (voix descendue, compressée, saturée juste ce qu'il faut, réverbération de hangar). Aucun son de Black Ops.
#
# Usage : scripts/fps/generer_voix.sh
# Dépendances (Ubuntu / Debian) : apt install espeak-ng mbrola mbrola-fr1 ffmpeg (ffmpeg avec rubberband)
#   espeak-ng (GPL-3, le son produit n'est pas couvert) pilote la voix diphone MBROLA « fr1 » (Faculté polytechnique de Mons :
#   utilisation et distribution gratuites, la base elle-même ne peut pas être vendue ; cf. public/arene/CREDITS.txt).
#
# Chaque ligne : id | texte prononcé (orthographe phonétique au besoin) | hauteur | écho (s, 0 = sans) | vitesse espeak
set -euo pipefail

DEPOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$DEPOT/public/arene/sons/voix"
VOIX="${VOIX:-mb-fr1}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v espeak-ng >/dev/null || { echo "espeak-ng introuvable (apt install espeak-ng mbrola mbrola-fr1)" >&2; exit 1; }

LIGNES=(
  "munitions|Munitions maxx !|0.72|0.11|130"
  "instakill|Insta kil !|0.68|0.13|125"
  "double|Double points !|0.72|0.11|130"
  "nuke|Ka boum !|0.62|0.18|115"
  "menuisier|Menuisier !|0.72|0.11|130"
  "soldes|Hapi aoueur ! Tout à dix balles !|0.8|0.09|150"
  "truck|Livraison du truc muche ! Ça va piquer !|0.6|0.16|125"
  "courant|Courant rétabli !|0.72|0.11|130"
  "recette_cuit|La recette ultime mijote. Tenez trente secondes !|0.74|0.1|140"
  "recette_servie|La recette ultime est servie !|0.72|0.12|130"
  "partie_perdue|Fin du service. Tout le monde à la plonge.|0.62|0.16|120"
)

for ligne in "${LIGNES[@]}"; do
  IFS='|' read -r id texte hauteur echo vitesse <<< "$ligne"
  espeak-ng -v "$VOIX" -s "$vitesse" -p 40 -a 180 -w "$TMP/$id.wav" "$texte"
  # voix descendue sans la ralentir (rubberband), passe-haut / passe-bas de haut-parleur, compression forte, légère saturation,
  # réverbération par deux échos, puis la crête à −1 dBFS
  ECHO=""
  if [ "$echo" != "0" ]; then
    MS1="$(awk -v e="$echo" 'BEGIN { printf "%d", e * 1000 }')"
    MS2="$(awk -v e="$echo" 'BEGIN { printf "%d", e * 1800 }')"
    ECHO=",apad=pad_dur=0.6,aecho=0.85:0.7:${MS1}|${MS2}:0.32|0.18"
  fi
  FILTRE="aresample=44100,rubberband=pitch=${hauteur}:formant=shifted,highpass=f=110,lowpass=f=6500,acompressor=threshold=-20dB:ratio=5:attack=4:release=90:makeup=4,asoftclip=type=tanh${ECHO}"
  FILTRE="$FILTRE" FREQUENCE=22050 DEBIT=48k DUREE_MAX=5 SEUIL=-50dB "$DEPOT/scripts/fps/importer_son.sh" "$TMP/$id.wav" "$OUT/$id.mp3"
done

du -ch "$OUT"/*.mp3 | tail -1
