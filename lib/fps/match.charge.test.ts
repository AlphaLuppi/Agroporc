import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { construireCircuits, flotte } from "./circulation";
import { construireMonde, pointsApparition } from "./collision";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import { JEU, SILHOUETTE, type MessageClient, type Vec3 } from "./protocole";
import { EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION, positionElsa, trouverRondPoint } from "./zones";

/**
 * Test de charge de la salle (lot S1) : 16 joueurs, 6 voitures conduisibles, 12 voitures PNJ, Elsa, tic à 60 Hz pendant 10 s
 * simulées. Mesure le temps CPU d'un tic (le serveur en lance 60 par seconde sur 0,3 à 0,5 vCPU) et la taille d'un snap sérialisé.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde(scene);
const apparitions = pointsApparition(scene, monde);
const T0 = 1_700_000_000_000;
const DUREE_S = 10;
const TIC_MS = 1000 / 60;

/**
 * Budget CPU moyen par tic (ms), `tic` ET messages reçus pendant ce tic (états, conduite, tirs validés) : mesuré à ≈ 0,05 ms sur un portable
 * (≤ 1 ms attendu), le budget laisse une marge ×20 pour une machine de CI chargée.
 */
const BUDGET_TIC_MOYEN_MS = 1;
/** Un snap de 16 joueurs sérialisé (octets) : 4 500 en v1, ≈ 3 500 mesuré en v2. */
const BUDGET_SNAP_OCTETS = 4200;

function lcg(graine: number): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function salleDeCharge(): Salle {
  const circuits = construireCircuits();
  const rond = trouverRondPoint(scene) ?? ROND_POINT;
  const [elsaX, elsaZ] = positionElsa(scene);
  const options: OptionsSalle = {
    zoneApparition: { centre: rond.centre, ...ZONE_APPARITION },
    elsa: { x: elsaX, z: elsaZ, intervalle: { minMs: 2000, maxMs: 4000 } },
    circulation: { circuits, voitures: flotte(circuits) },
    vehicules: EMPLACEMENTS_VOITURES,
  };
  return new Salle(monde, apparitions, lcg(42), T0, options);
}

describe("charge : 16 joueurs, 6 voitures, 12 PNJ, 10 s à 60 Hz", () => {
  it("temps CPU moyen d'un tic et taille d'un snap dans le budget", () => {
    expect(flotte(construireCircuits())).toHaveLength(12);
    expect(EMPLACEMENTS_VOITURES).toHaveLength(6);
    const s = salleDeCharge();
    const alea = lcg(7);
    const ids = Array.from({ length: 16 }, (_, i) => `j${i.toString(36)}`);
    ids.forEach((id, i) => {
      s.connecter(id, `Agent${i}`, T0);
      s.recevoir(id, { t: "rejoindre", principale: "mitraillette", secondaire: "pistolet" }, T0);
    });
    const j = (id: string) => s.inspecter(id) as JoueurSalle;
    // six conducteurs : chacun monte dans la voiture la plus proche de son point d'apparition (téléporté devant la voiture)
    const conducteurs = ids.slice(0, 6);
    conducteurs.forEach((id, i) => {
      const [x, z] = EMPLACEMENTS_VOITURES[i].p;
      (j(id) as { p: Vec3 }).p = [x + 1, 0, z + 1];
      s.recevoir(id, { t: "monter", vehicule: i, siege: 0 }, T0 + 10);
    });
    const marcheurs = ids.slice(6);
    const seqs = new Map<string, number>(ids.map((id) => [id, 0]));

    let cpu = 0, tics = 0, pire = 0, plusGrosSnap = 0, messagesSortants = 0, snapsVus = 0, voituresDansSnap = 0, occupantsDansSnap = 0;
    const tirsEnvoyes = { n: 0 };
    const total = Math.round(DUREE_S * 1000 / TIC_MS);
    for (let k = 0; k < total; k++) {
      const maintenant = T0 + 1000 + Math.round(k * TIC_MS);
      const debutTic = performance.now();
      // entrées des clients : conduite (conducteurs, voiture à l'arrêt) et état (marcheurs) à 30 Hz, tirs à 13/s pour 6 marcheurs
      if (k % 2 === 0) {
        conducteurs.forEach((id, i) => {
          const [x, z] = EMPLACEMENTS_VOITURES[i].p;
          const m: MessageClient = { t: "conduite", seq: seqs.set(id, seqs.get(id)! + 1).get(id)!, vehicule: i, p: [x, 0, z], cap: EMPLACEMENTS_VOITURES[i].cap, v: 0, lacet: 0, tangage: 0 };
          s.recevoir(id, m, maintenant);
        });
        marcheurs.forEach((id, i) => {
          const a = j(id);
          const dx = (alea() - 0.5) * 0.4, dz = (alea() - 0.5) * 0.4;
          const p: Vec3 = [a.p[0] + dx, a.p[1], a.p[2] + dz];
          s.recevoir(id, { t: "etat", seq: seqs.set(id, seqs.get(id)! + 1).get(id)!, p, v: [dx * 30, 0, dz * 30], lacet: i, tangage: 0, posture: "sol", mur: 0 }, maintenant);
        });
      }
      if (k % 4 === 0) {
        for (const id of marcheurs.slice(0, 6)) {
          const a = j(id);
          const cible = j(marcheurs[(marcheurs.indexOf(id) + 1) % marcheurs.length]);
          const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
          const v = [cible.p[0] - o[0], cible.p[1] + SILHOUETTE.centreY - o[1], cible.p[2] - o[2]];
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
          a.lacet = Math.atan2(-d[0], -d[2]); a.tangage = Math.asin(d[1]);
          tirsEnvoyes.n++;
          s.recevoir(id, { t: "tir", arme: a.arme as "mitraillette", o, d: [d], touches: [{ cible: cible.id, zone: "corps", plomb: 0 }] }, maintenant);
        }
      }
      const sorties: Sortie[] = s.tic(maintenant);
      const dt = performance.now() - debutTic;
      cpu += dt; tics++; pire = Math.max(pire, dt);
      messagesSortants += sorties.length;
      for (const x of sorties) {
        if (x.m.t !== "snap" || x.a !== "joueurs") continue;
        plusGrosSnap = Math.max(plusGrosSnap, JSON.stringify(x.m).length);
        snapsVus++;
        voituresDansSnap = Math.max(voituresDansSnap, x.m.vehicules?.length ?? 0);
        occupantsDansSnap = Math.max(occupantsDansSnap, x.m.j.filter((e) => e.vehicule).length);
      }
    }
    const moyen = cpu / tics;
    // eslint-disable-next-line no-console
    console.log(`[charge] ${tics} tics : moyen ${moyen.toFixed(3)} ms, pire ${pire.toFixed(2)} ms ; plus gros snap ${plusGrosSnap} octets ; ${messagesSortants} sorties`);
    expect(tics).toBe(600);
    expect(s.nombreEnJeu()).toBe(16);
    expect(snapsVus).toBeGreaterThanOrEqual(190); // 20 Hz pendant 10 s
    expect(voituresDansSnap).toBe(6);
    expect(occupantsDansSnap).toBe(6); // les six conducteurs sont bien assis
    expect(plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
    expect(moyen).toBeLessThan(BUDGET_TIC_MOYEN_MS);
    expect(JEU.snapHz).toBe(20);
  });
});
