// Extrait le squelette de repos du GLB du tigre (chunk JSON seulement : les nœuds ne sont pas
// compressés par meshopt) vers lib/tigre3d/donnees/squelette.json, lu par les modules purs de
// lib/tigre3d (IK, locomotion, tests) sans charger le GLB.
//   node scripts/tigre/extraire_squelette.mjs [public/tigre/tigre.glb] [lib/tigre3d/donnees/squelette.json]
// lib/tigre3d/squelette.test.ts vérifie que le JSON correspond toujours au GLB.
import { readFileSync, writeFileSync } from "node:fs";
import { extraireSquelette } from "../../lib/tigre3d/extraction.mjs";

const source = process.argv[2] ?? "public/tigre/tigre.glb";
const sortie = process.argv[3] ?? "lib/tigre3d/donnees/squelette.json";
const donnees = extraireSquelette(readFileSync(source));
// Un os par ligne : diff lisible si le GLB change.
const lignes = donnees.os.map((o) => "  " + JSON.stringify(o));
const texte = `{\n "source": ${JSON.stringify(donnees.source)},\n "parentRacine": ${JSON.stringify(donnees.parentRacine)},\n "os": [\n${lignes.join(",\n")}\n ]\n}\n`;
writeFileSync(sortie, texte);
console.log(`${donnees.os.length} os → ${sortie}`);
