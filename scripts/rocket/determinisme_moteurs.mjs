#!/usr/bin/env node
/**
 * Rocket Muche en ligne : le déterminisme de la physique ENTRE MOTEURS JavaScript (spec § 10 et § 12, critique netcode 13).
 *
 * Le client prédit en rejouant `pasMonde` avec les mêmes entrées que le serveur. Si Node (serveur) et le navigateur (client) n'évaluaient pas
 * `Math.hypot`, `Math.exp`, `Math.atan2`, `Math.sin`/`cos`… à l'identique, un écart d'un ulp pourrait grandir (rebonds contre le champ de
 * distance, flips). Ce script MESURE cet écart sans le présumer : il compile à la volée (esbuild, bundle, dossier temporaire hors du dépôt)
 * `creerMondeEnLigne` + `pasMonde` + `empreinteMonde`, joue 3 000 pas d'entrées scriptées à graine fixe, puis compare l'`empreinteMonde` et l'écart
 * maximal de position (voitures et balle, échantillonnés tous les 50 pas) entre Node et chaque moteur de Playwright installé (Chromium, Firefox,
 * WebKit ; ceux qui manquent sont signalés « non installé », pas en échec).
 *
 * Deux scénarios, 2v2 (quatre voitures : contacts, démolitions, flips) :
 *  - « ouvert » : entrées pseudo-aléatoires (générateur à graine), constantes sur 20 à 60 pas, indépendantes de l'état du monde ;
 *  - « fermé » : chaque voiture poursuit la balle (direction déduite de son repère), boost, saut régulier : une divergence d'un ulp est AMPLIFIÉE.
 *
 * Usage : node scripts/rocket/determinisme_moteurs.mjs [--strict]   (Playwright : `npm i --no-save playwright` ou PLAYWRIGHT_DIR=…)
 * Code de sortie : 0 si Node est cohérent avec lui-même (deux exécutions identiques) et que chaque moteur trouvé est identique à Node ; avec
 * `--strict` seulement, une divergence d'un moteur donne 1 (sans `--strict` elle est rapportée en avertissement : elle ne casse pas la mise en ligne,
 * le rollback à chaque instantané reste la garantie, cf. § 12).
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(RACINE, "serveur-fps/package.json"));
const esbuild = require("esbuild");
const STRICT = process.argv.includes("--strict");
const PAS = 3000;
const ECHANTILLON = 50;

let echecs = 0;
const ok = (c, m) => { console.log(`${c ? "OK  " : "ÉCHEC"} ${m}`); if (!c) echecs++; return c; };
const avert = (m) => console.log(`AVERT ${m}`);

// ------------------------------------------------------------------------------------------------------------------------------------
// Le programme joué partout (même source pour Node et les navigateurs)
// ------------------------------------------------------------------------------------------------------------------------------------

const PROGRAMME = `
import { NOMS_EQUIPES_DEFAUT, PAS_S, joueursParEquipe } from "lib/rocket/contrat";
import { creerMondeEnLigne } from "lib/rocket/reseau/monde-ligne";
import { dequantifierEntrees, quantifierEntrees } from "lib/rocket/reseau/serialisation";
import { empreinteMonde, pasMonde } from "lib/rocket/match";

function lcg(graine) {
  let s = graine >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const borne = (x, a, b) => (x < a ? a : x > b ? b : x);

function monde() {
  const cap = joueursParEquipe("2v2");
  const config = { format: "2v2", equipeJoueur: "bleue", niveauAllies: "pro", niveauAdversaires: "pro", dureeS: 300, graine: 20261108, nomsEquipes: { ...NOMS_EQUIPES_DEFAUT }, nomJoueur: "" };
  const statiques = [];
  for (const equipe of ["bleue", "orange"]) for (let slot = 0; slot < cap; slot++) statiques.push({ id: statiques.length, equipe, slot, humain: true, nom: "J" + statiques.length, joueur: statiques.length + 1 });
  return creerMondeEnLigne(config, statiques, -1);
}

/** entrées pseudo-aléatoires, constantes 20 à 60 pas, indépendantes du monde */
function ouvert(n) {
  const alea = lcg(77);
  const courantes = []; const jusqua = [];
  return (m, pas) => m.voitures.map((v, i) => {
    if (!courantes[i] || pas >= jusqua[i]) {
      const a = alea;
      courantes[i] = {
        accel: a() < 0.2 ? 0 : a() < 0.15 ? -1 : 1, direction: a() * 2 - 1, tangage: a() < 0.3 ? a() * 2 - 1 : 0, lacet: a() < 0.3 ? a() * 2 - 1 : 0,
        roulis: a() < 0.2 ? a() * 2 - 1 : 0, saut: a() < 0.12, boost: a() < 0.5, derapage: a() < 0.12,
      };
      jusqua[i] = pas + 20 + Math.floor(a() * 40);
    }
    return courantes[i];
  });
}

/** chaque voiture poursuit la balle : le monde influence les entrées, une divergence est amplifiée */
function ferme() {
  const alea = lcg(91);
  return (m, pas) => m.voitures.map((v, i) => {
    const dx = m.balle.p[0] - v.p[0], dz = m.balle.p[2] - v.p[2];
    const d = Math.hypot(dx, dz) || 1;
    const f = v.base.avant;
    const cross = (f[2] * dx - f[0] * dz) / d;
    const dot = (f[0] * dx + f[2] * dz) / d;
    return {
      accel: dot < -0.3 ? -1 : 1, direction: borne(cross * 3, -1, 1) * (dot < -0.3 ? -1 : 1), tangage: (pas + i * 37) % 300 < 40 ? 0.7 : 0,
      lacet: (pas + i * 53) % 400 < 30 ? borne(cross * 2, -1, 1) : 0, roulis: 0,
      saut: (pas + i * 61) % 200 === 0 || alea() < 0.003, boost: dot > 0.7, derapage: Math.abs(cross) > 0.8 && d < 20,
    };
  });
}

export function executer(scenario) {
  const m = monde();
  const choix = scenario === "ouvert" ? ouvert() : ferme();
  const empreintes = [];
  const positions = [];
  let evenements = 0;
  for (let pas = 0; pas < ${PAS}; pas++) {
    const entrees = choix(m, pas).map((e) => dequantifierEntrees(quantifierEntrees(e)));
    evenements += pasMonde(m, entrees).length;
    if ((pas + 1) % ${ECHANTILLON} === 0) {
      empreintes.push(empreinteMonde(m));
      for (const v of m.voitures) positions.push(v.p[0], v.p[1], v.p[2]);
      positions.push(m.balle.p[0], m.balle.p[1], m.balle.p[2]);
    }
  }
  return { empreinteFinale: empreinteMonde(m), empreintes, positions, nbEntites: m.voitures.length + 1, evenements, tick: m.tick, score: m.score, phase: m.phase };
}
`;

const dossier = mkdtempSync(join(tmpdir(), "pdj-rocket-determinisme-"));
process.on("exit", () => { try { rmSync(dossier, { recursive: true, force: true }); } catch { /* tant pis */ } });
const communs = { stdin: { contents: PROGRAMME, resolveDir: RACINE, sourcefile: "determinisme.ts", loader: "ts" }, bundle: true, logLevel: "error", alias: { lib: join(RACINE, "lib") } };
const sortieEsm = join(dossier, "node.mjs"), sortieIife = join(dossier, "navigateur.js");
await esbuild.build({ ...communs, platform: "node", format: "esm", target: "node20", outfile: sortieEsm });
await esbuild.build({ ...communs, platform: "browser", format: "iife", globalName: "Determinisme", target: "es2020", outfile: sortieIife });
const sourceNavigateur = readFileSync(sortieIife, "utf8");
const { executer } = await import(pathToFileURL(sortieEsm).href);

// ------------------------------------------------------------------------------------------------------------------------------------
// Comparaison
// ------------------------------------------------------------------------------------------------------------------------------------

function comparer(ref, autre) {
  const egal = ref.empreinteFinale === autre.empreinteFinale && ref.empreintes.every((e, i) => e === autre.empreintes[i]);
  let ecartMax = 0, premier = -1;
  const n = ref.nbEntites;
  for (let i = 0; i < ref.positions.length; i += 3) {
    const e = Math.hypot(ref.positions[i] - autre.positions[i], ref.positions[i + 1] - autre.positions[i + 1], ref.positions[i + 2] - autre.positions[i + 2]);
    if (e > ecartMax) ecartMax = e;
    if (e > 0 && premier < 0) premier = Math.floor(i / 3 / n) * ECHANTILLON + ECHANTILLON;
  }
  return { egal, ecartMax, premierEcartAuPas: premier };
}


/**
 * Sonde des fonctions `Math` du chemin chaud : 20 000 valeurs par fonction, empreinte des bits du résultat. Sert à dire QUELLES fonctions
 * diffèrent entre moteurs (information, jamais un échec) : `sqrt` et `hypot` sont exactes, les transcendantes dépendent de l'implémentation.
 */
const SONDE = `(() => {
  let s = 12345; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const fns = {
    hypot: (a, b) => Math.hypot(a, b), sqrt: (a) => Math.sqrt(Math.abs(a)), exp: (a) => Math.exp(a), log: (a) => Math.log(Math.abs(a) + 1e-3),
    pow: (a, b) => Math.pow(Math.abs(a) + 0.01, b * 3), atan2: (a, b) => Math.atan2(a, b), sin: (a) => Math.sin(a * 10), cos: (a) => Math.cos(a * 10),
    acos: (a) => Math.acos(Math.max(-1, Math.min(1, a))), asin: (a) => Math.asin(Math.max(-1, Math.min(1, a))), tanh: (a) => Math.tanh(a * 3),
  };
  const dv = new DataView(new ArrayBuffer(8)); const h = {};
  for (const k in fns) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < 20000; i++) { dv.setFloat64(0, fns[k](r() * 4 - 2, r() * 4 - 2)); for (let j = 0; j < 8; j++) { hash ^= dv.getUint8(j); hash = Math.imul(hash, 0x01000193) >>> 0; } }
    h[k] = hash >>> 0;
  }
  return h;
})()`;

const SCENARIOS = ["ouvert", "ferme"];
const reference = {};
console.log(`Node ${process.version}, V8 ${process.versions.v8}`);
for (const sc of SCENARIOS) {
  const a = executer(sc), b = executer(sc);
  reference[sc] = a;
  const memeNode = a.empreinteFinale === b.empreinteFinale && a.empreintes.every((e, i) => e === b.empreintes[i]) && a.positions.every((x, i) => x === b.positions[i]);
  ok(memeNode, `Node est cohérent avec lui-même (scénario ${sc}, deux exécutions identiques, empreinte ${a.empreinteFinale.toString(16)})`);
  console.log(`      scénario ${sc} : ${a.tick} pas, ${a.evenements} événements, score ${a.score.bleue}-${a.score.orange}, phase ${a.phase}`);
  ok(a.evenements > 50, `le scénario ${sc} est assez riche (${a.evenements} événements : touches, sauts, flips…)`);
}

function chargerPlaywright() {
  for (const base of [process.env.PLAYWRIGHT_DIR, RACINE, process.cwd()].filter(Boolean)) {
    try { return createRequire(join(base, "x.js"))("playwright"); } catch { /* suivant */ }
  }
  return null;
}
const pw = chargerPlaywright();
const resultats = [];
if (!pw) {
  avert("Playwright introuvable (`npm i --no-save playwright`, ou PLAYWRIGHT_DIR) : seul Node a été mesuré");
} else {
  for (const nom of ["chromium", "firefox", "webkit"]) {
    let navigateur;
    try {
      navigateur = await pw[nom].launch({ headless: true });
    } catch (e) {
      console.log(`--   ${nom} : non installé (${String(e.message).split("\n")[0].slice(0, 90)})`);
      resultats.push({ nom, etat: "non installé" });
      continue;
    }
    try {
      const page = await navigateur.newPage();
      await page.setContent("<!doctype html><title>determinisme</title>");
      await page.addScriptTag({ content: sourceNavigateur });
      const version = navigateur.version();
      const ua = await page.evaluate(() => navigator.userAgent);
      const sondeNode = (0, eval)(SONDE), sondeNav = await page.evaluate(SONDE);
      const diff = Object.keys(sondeNode).filter((k) => sondeNode[k] !== sondeNav[k]);
      console.log(`      fonctions Math qui diffèrent de Node (résultat bit à bit) : ${diff.join(", ") || "aucune"} ; identiques : ${Object.keys(sondeNode).filter((k) => !diff.includes(k)).join(", ") || "aucune"}`);
      console.log(`${nom} ${version} (${ua.slice(0, 80)})`);
      for (const sc of SCENARIOS) {
        const r = await page.evaluate((s) => window.Determinisme.executer(s), sc);
        const c = comparer(reference[sc], r);
        resultats.push({ nom, scenario: sc, ...c });
        if (c.egal) ok(true, `${nom} (${sc}) : empreintes identiques à Node sur ${PAS} pas (écart de position ${c.ecartMax} m)`);
        else {
          const msg = `${nom} (${sc}) : DIVERGE de Node, écart de position max ${c.ecartMax.toExponential(2)} m, premier écart vers le pas ${c.premierEcartAuPas}`;
          if (STRICT) ok(false, msg); else avert(msg);
        }
      }
    } finally {
      await navigateur.close();
    }
  }
}

console.log(`\nRésumé : ${resultats.map((r) => (r.etat ? `${r.nom} ${r.etat}` : `${r.nom}/${r.scenario} ${r.egal ? "identique" : `écart ${r.ecartMax.toExponential(1)} m`}`)).join(" ; ") || "Node seul"}`);
console.log(echecs === 0 ? "\nTout est vert." : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
