// Cachettes du tigre de la vue Palantir, précalculées HORS LIGNE.
//
// Usage : node scripts/agroparc/generer_cachettes.mjs [scene.json] [sortie]
// (défauts : public/agroparc/scene.json, public/agroparc/cachettes.json). À relancer quand
// scene.json ou REST (lib/agroparc3d/scene.ts) changent. lib/agroparc3d/cachettes.test.ts vérifie
// que le fichier se régénère à l'octet.
//
// Pourquoi hors ligne : le calcul (lib/agroparc3d/cachettes.ts) prend de 110 à 150 ms au premier
// appel sur la machine de développement, au-delà des 100 ms admis au chargement de la vue.
// Le module pur est importé tel quel (.ts) : Node retire les types (Node 22.18 ou plus récent).
import { readFileSync, writeFileSync } from "node:fs";
import { genererCachettes, serialiserCachettes } from "../../lib/agroparc3d/cachettes.ts";

const ENTREE = process.argv[2] ?? "public/agroparc/scene.json";
const SORTIE = process.argv[3] ?? "public/agroparc/cachettes.json";

// REST n'existe qu'à un endroit, lib/agroparc3d/scene.ts (qui importe three, que ce script
// n'importe pas) : on relit sa valeur dans le source.
const source = readFileSync(new URL("../../lib/agroparc3d/scene.ts", import.meta.url), "utf8");
const m = source.match(/export const REST = \{ dx: (-?[\d.]+), y: (-?[\d.]+), dz: (-?[\d.]+) \}/);
if (!m) throw new Error("REST introuvable dans lib/agroparc3d/scene.ts");
const REST = { dx: Number(m[1]), y: Number(m[2]), dz: Number(m[3]) };

const t0 = performance.now();
const cachettes = genererCachettes(JSON.parse(readFileSync(ENTREE, "utf8")), REST);
const duree = performance.now() - t0;
const texte = serialiserCachettes(cachettes, REST);
writeFileSync(SORTIE, texte);
console.log(`${cachettes.length} cachettes en ${duree.toFixed(0)} ms → ${SORTIE} (${(texte.length / 1024).toFixed(0)} Ko)`);
