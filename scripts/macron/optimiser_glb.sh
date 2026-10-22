#!/usr/bin/env bash
# Optimise le personnage 3D de l'easter egg « macron » pour le web : public/macron/macron.glb.
#
# Source : « Emmanuel M. » par jamray747 (Sketchfab, CC BY 4.0)
#   https://sketchfab.com/3d-models/emmanuel-m-0ede7d2d38454ad190f643315196ff26
# Crédit visible obligatoire sur le site (auteur + lien + licence + « allégé et animé ») tant que le modèle est affiché.
#
# Usage : scripts/macron/optimiser_glb.sh [source.glb] [sortie.glb]
#   source par défaut : ~/Downloads/emmanuel_m..glb
#   sortie par défaut : public/macron/macron.glb
# Variables : TEX_TETE (couleur du visage, défaut 1024), TEX_COSTUME (couleur du costume, défaut 1024),
#             TEX_MAINS (couleur des mains, défaut 512), TEX_NORMALES (cartes de normales, défaut 1024),
#             TEX_YEUX (globes et cornées, défaut 256), QUALITE_WEBP (défaut 82),
#             SIMPLIFIER (ratio de triangles gardés, défaut 0.5 ; 1 = pas de simplification),
#             ERREUR_SIMPLIF (erreur max relative à la taille du modèle, défaut 0.0006).
#
# Étapes (gltf-transform 4.1.1, via npx, aucune installation) :
#   0. JSON seul, à la main : retire les dents (AvatarTeethUpper/Lower : bouche fermée, sans mâchoire ni
#      morph, invisibles), TEXCOORD_1 (aucune texture ne l'utilise) et TANGENT (three calcule les
#      tangentes des cartes de normales par dérivées d'écran) ; nomme les images (motif de resize) ;
#   1. prune : maillages, accesseurs, textures et nœuds orphelins ;
#   2. resize + webp : 12 textures (dont une normale PNG 2048² de 7,6 Mo) → WebP (EXT_texture_webp),
#      taille par rôle (le visage reste net en gros plan) ;
#   3. weld + simplify : simplification légère, bords UV, coutures entre maillages et silhouette gardés ;
#   4. meshopt : quantification + EXT_meshopt_compression,
#      décodée par three/examples/jsm/libs/meshopt_decoder.module.js.
# Le skin (74 os, T-pose), les yeux (os LeftEye/RightEye) et les cils sont gardés. Aucune animation dans la source.
set -euo pipefail

DEPOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="${1:-$HOME/Downloads/emmanuel_m..glb}"
SORTIE="${2:-$DEPOT/public/macron/macron.glb}"
TEX_TETE="${TEX_TETE:-1024}"
TEX_COSTUME="${TEX_COSTUME:-1024}"
TEX_MAINS="${TEX_MAINS:-512}"
TEX_NORMALES="${TEX_NORMALES:-1024}"
TEX_YEUX="${TEX_YEUX:-256}"
QUALITE_WEBP="${QUALITE_WEBP:-82}"
SIMPLIFIER="${SIMPLIFIER:-0.5}"
ERREUR_SIMPLIF="${ERREUR_SIMPLIF:-0.0006}"
GT=(npx -y @gltf-transform/cli@4.1.1)

[ -f "$SOURCE" ] || { echo "Source introuvable : $SOURCE" >&2; exit 1; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/macron-glb.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$(dirname "$SORTIE")"

node -e '
const fs = require("fs");
const [src, dst] = process.argv.slice(1);
const d = fs.readFileSync(src);
const lj = d.readUInt32LE(12);
const js = JSON.parse(d.subarray(20, 20 + lj).toString("utf8"));
// Dents : nœuds détachés de leur maillage (prune retire ensuite maillage, accesseurs et textures).
const dents = new Set(js.materials.map((m, i) => (/Teeth/.test(m.name) ? i : -1)).filter((i) => i >= 0));
const mDents = new Set(js.meshes.map((m, i) => (m.primitives.every((p) => dents.has(p.material)) ? i : -1)).filter((i) => i >= 0));
for (const n of js.nodes) if (mDents.has(n.mesh)) { delete n.mesh; delete n.skin; }
for (const m of js.meshes) for (const p of m.primitives) for (const a of ["TEXCOORD_1", "TANGENT"]) delete p.attributes[a];
// Nom de chaque image d après son matériau et son emplacement : motif de --pattern pour resize.
const ROLE = { AvatarBody: "mains", AvatarHead: "tete", outfit: "costume", AvatarLeftCornea: "yeux", AvatarRightCornea: "yeux",
  AvatarLeftEyeball: "yeux", AvatarRightEyeball: "yeux", AvatarTeethLower: "dents", AvatarTeethUpper: "dents" };
for (const m of js.materials) {
  const role = ROLE[m.name] || "autre";
  const nommer = (t, slot) => { if (t) js.images[js.textures[t.index].source].name = role === "yeux" ? "yeux_" + slot + "_" + m.name : role + "_" + slot; };
  nommer(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture, "couleur");
  nommer(m.normalTexture, "normale");
}
let j = Buffer.from(JSON.stringify(js), "utf8");
j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
const reste = d.subarray(20 + lj);
const tete = Buffer.alloc(20);
tete.writeUInt32LE(0x46546c67, 0); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(20 + j.length + reste.length, 8);
tete.writeUInt32LE(j.length, 12); tete.writeUInt32LE(0x4e4f534a, 16);
fs.writeFileSync(dst, Buffer.concat([tete, j, reste]));
' "$SOURCE" "$TMP/0.glb"
"${GT[@]}" prune "$TMP/0.glb" "$TMP/1.glb" --keep-attributes true
cp "$TMP/1.glb" "$TMP/r.glb"
redimensionner() { # motif côté
  "${GT[@]}" resize "$TMP/r.glb" "$TMP/r2.glb" --pattern "$1" --width "$2" --height "$2"
  mv "$TMP/r2.glb" "$TMP/r.glb"
}
redimensionner "tete_couleur" "$TEX_TETE"
redimensionner "costume_couleur" "$TEX_COSTUME"
redimensionner "mains_couleur" "$TEX_MAINS"
redimensionner "*_normale" "$TEX_NORMALES"
redimensionner "yeux_*" "$TEX_YEUX"
"${GT[@]}" webp "$TMP/r.glb" "$TMP/4.glb" --quality "$QUALITE_WEBP"
if [ "$SIMPLIFIER" != "1" ]; then
  "${GT[@]}" weld "$TMP/4.glb" "$TMP/5.glb"
  "${GT[@]}" simplify "$TMP/5.glb" "$TMP/6.glb" --ratio "$SIMPLIFIER" --error "$ERREUR_SIMPLIF" --lock-border
else
  cp "$TMP/4.glb" "$TMP/6.glb"
fi
"${GT[@]}" meshopt "$TMP/6.glb" "$SORTIE" --level medium
echo "Écrit : $SORTIE ($(wc -c < "$SORTIE" | tr -d ' ') octets)"
