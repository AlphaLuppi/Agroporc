import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import { SILHOUETTE, decoderZombies, type Vec3 } from "./protocole";
import { DEPARTS, construireMondeZombies, porteDeId } from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

/**
 * Charge du mode zombies : 8 puis 4 joueurs, 24 tigres vivants (plafond), tic à 60 Hz pendant 10 s simulées. Mesure le temps CPU d'un tic (le
 * serveur en lance 60 par seconde sur 1 vCPU, pour les deux salles), la taille d'un snap et d'un `zombies{etat}` sérialisés, et (v8) l'achat
 * d'une porte en pleine manche : la navigation des tigres n'est plus recalculée en entier (40 à 80 ms qui gelaient tout le serveur). À lancer
 * SEUL pour la mesure nominale : sous vitesse parallèle de toute la machine, les budgets laissent la marge (comme `match.charge.test.ts`).
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 1_700_000_000_000;
const DUREE_S = 10;
const TIC_MS = 1000 / 60;
/** Budget nominal 1 ms (mesure seule) ; 2 ms toléré sous charge parallèle. */
const BUDGET_TIC_MOYEN_MS = 2;
/** Un snap de 8 joueurs + 24 tigres sérialisé (octets). */
const BUDGET_SNAP_OCTETS = 4200;
/**
 * Un `zombies{etat}` sérialisé (octets) : il part EN ENTIER à toute la salle à chaque changement immédiat (lancer de grenade, effet du secret,
 * boîte du Happy hour…). Mesuré à ≈ 2,2 ko à 8 joueurs ; une régression de taille fait échouer le test.
 */
const BUDGET_ETAT_OCTETS = 3200;
/**
 * `zombies{etat}` émis par seconde pendant la mesure (≈ 3,5/s, tirs et morts de tigres compris ; chaque joueur lance aussi ses grenades, une
 * toutes les 2,5 s jusqu'à épuisement de son stock) : un événement fréquent passé en `immediat` ferait partir plusieurs états complets par
 * seconde à chacun.
 */
const BUDGET_ETATS_PAR_S = 6;
/** Achat d'une porte + le tic qui suit (champs de distance recalculés) : sans le recalcul complet des grilles (40 à 80 ms avant la v8). */
const BUDGET_PORTE_MS = 10;

function lcg(graine: number): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

interface Mesure { moyen: number; pire: number; plusGrosSnap: number; plusGrosEtat: number; etatsParS: number; lancers: number; porteMs: number[] }

/** Partie de `n` joueurs portée au plafond de 24 tigres, puis 10 s mesurées à 60 Hz, puis trois portes achetées (D1, D2, G3). */
function mesurer(n: number): Mesure {
  const monde = construireMondeZombies(scene);
  // griffes sans effet : les joueurs restent debout pendant toute la mesure ; beaucoup de tigres à faire naître ; de quoi payer les portes
  const s = new Salle(monde, DEPARTS.map((d) => [d[0], d[1]] as [number, number]), lcg(42), T0, {
    zombies: { pauseMs: 500, degatsGriffe: 0, total1: 400, argentDepart: 20_000 },
  });
  const ids = Array.from({ length: n }, (_, i) => `j${i.toString(36)}`);
  ids.forEach((id, i) => s.connecter(id, `Agent${i}`, T0));
  s.recevoir(ids[0], { t: "lancerPartie" }, T0);
  ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
  const j = (id: string) => s.inspecter(id) as JoueurSalle;
  const alea = lcg(7);

  // échauffement hors mesure (tics espacés de 250 ms, pas de 60 Hz) jusqu'au plafond de 24 tigres vivants
  let t = T0;
  let tigres = 0;
  for (let k = 0; k < 400 && tigres < ZOMBIES.plafondVivants; k++) {
    t += 250;
    for (const id of ids) { j(id).etatT = t; j(id).protegeJusqua = 0; }
    for (const x of s.tic(t)) {
      if (x.m.t === "snap" && x.m.zombies) tigres = decoderZombies(x.m.zombies).length;
    }
  }
  expect(tigres).toBe(ZOMBIES.plafondVivants);

  let cpu = 0, tics = 0, pire = 0, plusGrosSnap = 0, plusGrosEtat = 0, snapsVus = 0, tigresMax = 0, entrees = 0, etats = 0, lancers = 0;
  const total = Math.round(DUREE_S * 1000 / TIC_MS);
  let maintenant = t;
  for (let k = 0; k < total; k++) {
    maintenant = t + 1000 + Math.round(k * TIC_MS);
    const debut = performance.now();
    // entrées des clients : états à 30 Hz (petits déplacements), un tir sur un tigre par joueur toutes les 15 images (validé par le serveur)
    if (k % 2 === 0) {
      for (const id of ids) {
        const a = j(id);
        const dx = (alea() - 0.5) * 0.2, dz = (alea() - 0.5) * 0.2;
        s.recevoir(id, { t: "etat", seq: ++entrees, p: [a.p[0] + dx, 0, a.p[2] + dz] as Vec3, v: [dx * 30, 0, dz * 30], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, maintenant);
      }
    }
    const sorties: Sortie[] = s.tic(maintenant);
    // une grenade par joueur toutes les 2,5 s (décalées), lancée devant lui vers le sol, tant qu'il lui en reste
    const lance = ids.findIndex((_, i) => (k + i * 19) % 150 === 0);
    if (lance >= 0) {
      const a = j(ids[lance]);
      const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
      const avant = s.recevoir(ids[lance], { t: "lancerGrenade", genre: "frag", o, d: [0, -0.6, -0.8] }, maintenant);
      if (avant.some((x) => x.m.t === "grenade")) lancers++;
      sorties.push(...avant);
    }
    if (k % 15 === 0) {
      const vu = sorties.filter((x) => x.m.t === "snap" && x.m.zombies).map((x) => x.m).at(-1);
      const liste = vu && vu.t === "snap" && vu.zombies ? decoderZombies(vu.zombies) : [];
      if (liste.length) {
        for (const [i, id] of ids.entries()) {
          const z = liste[i % liste.length];
          const a = j(id);
          const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
          const v = [z.x - o[0], 1 - o[1], z.z - o[2]];
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
          a.lacet = Math.atan2(-d[0], -d[2]); a.tangage = Math.asin(d[1]);
          s.recevoir(id, { t: "tir", arme: "pistolet", o, d: [d], touches: [{ cible: `z${z.id}`, zone: "corps", plomb: 0 }] }, maintenant);
        }
      }
    }
    const dt = performance.now() - debut;
    cpu += dt; tics++; pire = Math.max(pire, dt);
    for (const x of sorties) {
      if (x.m.t === "zombies") { plusGrosEtat = Math.max(plusGrosEtat, JSON.stringify(x.m).length); if (x.a === "tous" || x.a === "joueurs") etats++; }
      if (x.m.t !== "snap" || x.a !== "joueurs") continue;
      plusGrosSnap = Math.max(plusGrosSnap, JSON.stringify(x.m).length);
      snapsVus++;
      tigresMax = Math.max(tigresMax, x.m.zombies ? decoderZombies(x.m.zombies).length : 0);
    }
  }
  expect(tics).toBe(600);
  expect(s.nombreEnJeu()).toBe(n);
  expect(s.resumeZombies()!.phase).toBe("manche");
  expect(snapsVus).toBeGreaterThanOrEqual(190); // 20 Hz pendant 10 s
  expect(tigresMax).toBe(ZOMBIES.plafondVivants);

  // trois portes achetées en pleine manche : achat + tic suivant (le champ de distance des tigres est recalculé sur la grille mise à jour)
  const porteMs: number[] = [];
  const acheteur = j(ids[0]);
  for (const id of ["D1", "D2", "G3"] as const) {
    const porte = porteDeId(id)!;
    let ok = false;
    for (let r = 1.0; r <= 2.8 && !ok; r += 0.2) {
      for (let a = 0; a < 360 && !ok; a += 10) {
        acheteur.p = [porte.point[0] + Math.cos((a * Math.PI) / 180) * r, 0, porte.point[1] + Math.sin((a * Math.PI) / 180) * r];
        maintenant += 17;
        const debut = performance.now();
        const sorties = s.recevoir(ids[0], { t: "acheter", id }, maintenant);
        ok = sorties.some((x) => x.m.t === "achat" && x.m.ok);
        if (ok) {
          s.tic(maintenant + 1);
          porteMs.push(performance.now() - debut);
        }
      }
    }
    expect(ok, `porte ${id}`).toBe(true);
  }
  return { moyen: cpu / tics, pire, plusGrosSnap, plusGrosEtat, etatsParS: etats / DUREE_S, lancers, porteMs };
}

describe("charge zombies : 24 tigres, 10 s à 60 Hz, portes achetées en pleine manche", () => {
  for (const n of [8, 4]) {
    it(`${n} joueurs : temps CPU moyen d'un tic, taille d'un snap, achat d'une porte dans le budget`, () => {
      const r = mesurer(n);
      // eslint-disable-next-line no-console
      console.log(`[charge zombies ${n} joueurs] tic moyen ${r.moyen.toFixed(3)} ms, pire ${r.pire.toFixed(2)} ms ; snap ${r.plusGrosSnap} o, `
        + `zombies{etat} ${r.plusGrosEtat} o, ${r.etatsParS.toFixed(1)}/s (${r.lancers} grenades) ; portes D1 / D2 / G3 : ${r.porteMs.map((x) => x.toFixed(2)).join(" / ")} ms`);
      expect(r.plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
      expect(r.plusGrosEtat).toBeLessThanOrEqual(BUDGET_ETAT_OCTETS);
      expect(r.lancers).toBeGreaterThan(0);
      expect(r.etatsParS).toBeLessThanOrEqual(BUDGET_ETATS_PAR_S);
      expect(r.moyen).toBeLessThan(BUDGET_TIC_MOYEN_MS);
      for (const ms of r.porteMs) expect(ms).toBeLessThan(BUDGET_PORTE_MS);
    });
  }
});

describe("(v8) charge d'une manche du Truck Muche : 4 joueurs, 16 ennemis vivants (plafond 4 + 3 j), 5 s à 60 Hz", () => {
  it("foudre, petits, mini Trucks qui sautent : temps CPU moyen d'un tic dans le budget", () => {
    const monde = construireMondeZombies(scene);
    const s = new Salle(monde, DEPARTS.map((d) => [d[0], d[1]] as [number, number]), lcg(5), T0, {
      zombies: { pauseMs: 500, degatsGriffe: 0, total1: 300, mancheTruck: 1 },
    });
    const ids = ["j0", "j1", "j2", "j3"];
    ids.forEach((id, i) => s.connecter(id, `Agent${i}`, T0));
    s.recevoir(ids[0], { t: "lancerPartie" }, T0);
    ids.forEach((id) => s.recevoir(id, { t: "rejoindre" }, T0));
    const j = (id: string) => s.inspecter(id) as JoueurSalle;
    let t = T0, vivants = 0;
    for (let k = 0; k < 400 && vivants < 16; k++) {
      t += 100;
      for (const id of ids) { j(id).etatT = t; j(id).protegeJusqua = 0; }
      for (const x of s.tic(t)) if (x.m.t === "snap" && x.m.zombies) vivants = decoderZombies(x.m.zombies).length;
    }
    expect(vivants).toBe(16);
    let cpu = 0, tics = 0, pire = 0;
    for (let k = 0; k < 300; k++) {
      const maintenant = t + 100 + Math.round(k * TIC_MS);
      for (const id of ids) j(id).etatT = maintenant;
      const debut = performance.now();
      s.tic(maintenant);
      const dt = performance.now() - debut;
      cpu += dt; tics++; pire = Math.max(pire, dt);
    }
    // eslint-disable-next-line no-console
    console.log(`[charge Truck 4 joueurs] tic moyen ${(cpu / tics).toFixed(3)} ms, pire ${pire.toFixed(2)} ms`);
    expect(s.resumeZombies()!.phase).toBe("manche");
    expect(cpu / tics).toBeLessThan(BUDGET_TIC_MOYEN_MS);
  });
});
