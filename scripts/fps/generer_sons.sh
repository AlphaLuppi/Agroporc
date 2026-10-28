#!/usr/bin/env bash
# Régénère les effets sonores échantillonnés du mode zombies dans public/arene/sons/ (registre : lib/fps/sons-echantillons.ts,
# crédits : public/arene/CREDITS.txt). Les annonces parlées sont faites à part par scripts/fps/generer_voix.sh.
#
# Usage : scripts/fps/generer_sons.sh <dossier des sources>
# Le dossier contient les fichiers d'origine, rangés comme à leur téléchargement (licences dans CREDITS.txt) :
#   sfx-kit-wyzowl/               wyzowl/sfx-kit (CC0)          raw.githubusercontent.com/wyzowl/sfx-kit/main/sounds/…
#   kenney-voiceover-explosions/  Kenney (CC0)                  raw.githubusercontent.com/Cy4nWare/sfx-api/main/sounds/…
#   oculus-audio-pack-meta/       Oculus Audio Pack 1 (CC BY 4.0) raw.githubusercontent.com/facebookincubator/Meta-open-sound/main/corpora/oculus-audio-pack/ogg/…
#   inexor-audioaugust-thunder/   Inexor AudioAugust (CC BY 4.0)  raw.githubusercontent.com/inexorgame/audioaugust/master/thunder/…
# Le micro-ondes n'existe pas en licence libre : il est synthétisé ici par ffmpeg (aucune source).
set -euo pipefail

DEPOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${1:?usage : scripts/fps/generer_sons.sh <dossier des sources>}"
OUT="$DEPOT/public/arene/sons"
IMPORTER="$DEPOT/scripts/fps/importer_son.sh"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

imp() { # imp <source> <sortie> [filtre] [durée max]
  FILTRE="${3:-}" DUREE_MAX="${4:-6}" DEBIT=64k "$IMPORTER" "$1" "$OUT/$2"
}

# Tonnerre (manche du Truck Muche, éclair) : le grand coup du premier enregistrement Inexor, 5 s à partir de 16,6 s
imp "$SRC/inexor-audioaugust-thunder/thunder_big.flac" tonnerre.mp3 "atrim=16.6:21.6,asetpts=PTS-STARTPTS,afade=t=in:d=0.02" 5

# Rire du Truck Muche enragé : le rire maléfique d'Oculus, une quarte plus bas (rubberband garde le tempo) et un écho de hangar
imp "$SRC/oculus-audio-pack-meta/VOXLaff_EvilLaugh_OS_01.ogg" rire-truck.mp3 "rubberband=pitch=0.75:formant=preserved,aecho=0.8:0.6:90|170:0.3|0.18,apad=pad_dur=0.4"

# Explosion de grenade : le craquement de Kenney sur le grave d'une explosion basse fréquence
ffmpeg -hide_banner -loglevel error -y -i "$SRC/kenney-voiceover-explosions/explosioncrunch-004.ogg" \
  -i "$SRC/kenney-voiceover-explosions/lowfrequency-explosion-001.ogg" \
  -filter_complex "[0:a]aresample=44100,pan=mono|c0=c0[a];[1:a]aresample=44100,pan=mono|c0=c0,volume=0.8[b];[a][b]amix=inputs=2:duration=longest:normalize=0" \
  -c:a pcm_f32le "$TMP/grenade.wav"
imp "$TMP/grenade.wav" explosion-grenade.mp3 "" 2.2

# Rebond de grenade : petit choc métallique de Kenney
imp "$SRC/kenney-voiceover-explosions/impactmetal-light-000.ogg" rebond-grenade.mp3 "" 0.5

# Fanfare d'un bonus ramassé : montée « power-up » d'Oculus
imp "$SRC/oculus-audio-pack-meta/UIMisc_Powerup_OS_01.ogg" fanfare-bonus.mp3 "" 1.8

# Grognement du tigre chef : effort de géant d'Oculus, plus grave
imp "$SRC/oculus-audio-pack-meta/CREAHmn_GiantEffort_OS_01.ogg" grognement-chef.mp3 "rubberband=pitch=0.7,atrim=0:1.8" 1.8

# Coup de patte du tigre chef (son PROVISOIRE, à remplacer par celui du joueur avec importer_son.sh) : effort d'ogre ralenti et grave
# (il monte jusqu'au coup, qui tombe vers 0,5 s), sur un claquement sourd
imp "$SRC/oculus-audio-pack-meta/CREAHmn_OgreEffort_OS_01.ogg" griffe-chef.mp3 "asetrate=44100*0.72,aresample=44100,lowpass=f=5000" 1.6

# Micro-ondes, synthétisé (rien de libre n'existe) :
#  - cuisson (3,4 s) : la porte claque, le magnétron bourdonne (120 Hz et harmoniques, ronflement de secteur à 60 Hz), le ventilateur souffle
#    et le plateau fait onduler le tout ;
#  - bip : les trois bips piézo à 1 kHz de fin de cuisson, puis le loquet de la porte qui s'ouvre.
PORTE="anoisesrc=d=0.14:c=brown:a=0.9,lowpass=f=1100,afade=t=out:st=0.01:d=0.13[pb];sine=f=85:d=0.14,volume=0.9,afade=t=out:st=0.01:d=0.13[pt];anoisesrc=d=0.02:c=white:a=0.5,highpass=f=2500[pc];[pb][pt][pc]amix=inputs=3:normalize=0"
ffmpeg -hide_banner -loglevel error -y -filter_complex "
  ${PORTE}[porte];
  aevalsrc='0.30*sin(2*PI*120*t)+0.16*sin(2*PI*240*t)+0.08*sin(2*PI*360*t)+0.05*sin(2*PI*60*t)+0.03*sin(2*PI*1200*t)':d=3.3:s=44100,tremolo=f=0.7:d=0.18,afade=t=in:d=0.25,afade=t=out:st=3.0:d=0.3[hum];
  anoisesrc=d=3.3:c=pink:a=0.12:r=44100,lowpass=f=1600,highpass=f=200,afade=t=in:d=0.4,afade=t=out:st=2.9:d=0.4[ventilo];
  [hum][ventilo]amix=inputs=2:normalize=0,adelay=120[cuisson];
  [porte][cuisson]amix=inputs=2:duration=longest:normalize=0" -c:a pcm_f32le "$TMP/cuisson.wav"
imp "$TMP/cuisson.wav" microondes-cuisson.mp3 "" 3.6

BIP="aevalsrc='0.5*sin(2*PI*1000*t)+0.18*sin(2*PI*3000*t)':d=0.17:s=44100,afade=t=in:d=0.005,afade=t=out:st=0.155:d=0.015"
ffmpeg -hide_banner -loglevel error -y -filter_complex "
  ${BIP}[b1];${BIP},adelay=300[b2];${BIP},adelay=600[b3];
  anoisesrc=d=0.05:c=white:a=0.6,bandpass=f=1800,afade=t=out:st=0.005:d=0.045,adelay=1050[loquet];
  sine=f=140:d=0.06,afade=t=out:st=0.01:d=0.05,adelay=1050,volume=0.6[loquet2];
  [b1][b2][b3][loquet][loquet2]amix=inputs=5:duration=longest:normalize=0" -c:a pcm_f32le "$TMP/bip.wav"
imp "$TMP/bip.wav" microondes-bip.mp3 "" 1.4

du -ch "$OUT"/*.mp3 | tail -1
