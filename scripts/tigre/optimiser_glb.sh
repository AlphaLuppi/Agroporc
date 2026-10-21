#!/usr/bin/env bash
# Optimise le tigre 3D du thème Tigre pour le web : public/tigre/tigre.glb.
#
# Source : « Stylized Bengal Tiger with 4 animations » par Jungle Jim (Sketchfab, CC BY 4.0)
#   https://sketchfab.com/3d-models/stylized-bengal-tiger-with-4-animations-d87e750f18aa416dbccdd5ca7b81f751
# Crédit visible obligatoire sur le site (auteur + lien + licence) tant que le modèle est affiché.
#
# Usage : scripts/tigre/optimiser_glb.sh [source.glb] [sortie.glb]
#   source par défaut : ~/Downloads/stylized_bengal_tiger_with_4_animations.glb
#   sortie par défaut : public/tigre/tigre.glb
# Variables : TEXTURE (côté en px, défaut 1024), QUALITE_WEBP (défaut 82),
#             SIMPLIFIER (ratio de triangles gardés, défaut 0.5 ; 1 = pas de simplification),
#             ERREUR_SIMPLIF (erreur max relative à la taille du modèle, défaut 0.0006).
#
# Étapes (gltf-transform 4.1.1, via npx, aucune installation) :
#   1. retire TEXCOORD_1 et TEXCOORD_2 (inutilisés par le matériau), puis prune (nœuds vides) ;
#   2. resample  : supprime les clés d'animation redondantes (sans perte visible) ;
#   3. resize + webp : texture 4096² PNG (9,8 Mo) → 1024² WebP (EXT_texture_webp) ;
#   4. weld + simplify : simplification légère, bords UV et silhouette conservés ;
#   5. meshopt   : quantification + EXT_meshopt_compression (géométrie ET animations),
#                  décodée par three/examples/jsm/libs/meshopt_decoder.module.js.
# Les 4 clips (Walking, Curious, Trick, Attack jump), le skin (39 os) et KHR_materials_unlit sont gardés.
set -euo pipefail

DEPOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="${1:-$HOME/Downloads/stylized_bengal_tiger_with_4_animations.glb}"
SORTIE="${2:-$DEPOT/public/tigre/tigre.glb}"
TEXTURE="${TEXTURE:-1024}"
QUALITE_WEBP="${QUALITE_WEBP:-82}"
SIMPLIFIER="${SIMPLIFIER:-0.5}"
ERREUR_SIMPLIF="${ERREUR_SIMPLIF:-0.0006}"
GT=(npx -y @gltf-transform/cli@4.1.1)

[ -f "$SOURCE" ] || { echo "Source introuvable : $SOURCE" >&2; exit 1; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tigre-glb.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$(dirname "$SORTIE")"

# TEXCOORD_1 / TEXCOORD_2 retirés à la main (le JSON seulement) : prune garde ensuite les normales
# (--keep-attributes true), utiles pour un contour ou un éclairage même si le matériau est unlit.
node -e '
const fs = require("fs");
const [src, dst] = process.argv.slice(1);
const d = fs.readFileSync(src);
const lj = d.readUInt32LE(12);
const js = JSON.parse(d.subarray(20, 20 + lj).toString("utf8"));
for (const m of js.meshes) for (const p of m.primitives) for (const a of ["TEXCOORD_1", "TEXCOORD_2"]) delete p.attributes[a];
let j = Buffer.from(JSON.stringify(js), "utf8");
j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
const reste = d.subarray(20 + lj);
const tete = Buffer.alloc(20);
tete.writeUInt32LE(0x46546c67, 0); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(20 + j.length + reste.length, 8);
tete.writeUInt32LE(j.length, 12); tete.writeUInt32LE(0x4e4f534a, 16);
fs.writeFileSync(dst, Buffer.concat([tete, j, reste]));
' "$SOURCE" "$TMP/0.glb"
"${GT[@]}" prune "$TMP/0.glb" "$TMP/1.glb" --keep-attributes true
"${GT[@]}" resample "$TMP/1.glb" "$TMP/2.glb"
"${GT[@]}" resize "$TMP/2.glb" "$TMP/3.glb" --width "$TEXTURE" --height "$TEXTURE"
"${GT[@]}" webp "$TMP/3.glb" "$TMP/4.glb" --quality "$QUALITE_WEBP"
if [ "$SIMPLIFIER" != "1" ]; then
  "${GT[@]}" weld "$TMP/4.glb" "$TMP/5.glb"
  "${GT[@]}" simplify "$TMP/5.glb" "$TMP/6.glb" --ratio "$SIMPLIFIER" --error "$ERREUR_SIMPLIF" --lock-border
else
  cp "$TMP/4.glb" "$TMP/6.glb"
fi
"${GT[@]}" meshopt "$TMP/6.glb" "$SORTIE" --level medium
echo "Écrit : $SORTIE ($(wc -c < "$SORTIE" | tr -d ' ') octets)"
