import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lireCachettes, type FichierCachettes } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import { construireCircuits, flotte } from "./circulation";
import { construireMonde, pointsApparition } from "./collision";
import type { ServiceTigres } from "./match-contexte";
import { Salle, type JoueurSalle, type OptionsSalle, type Sortie } from "./match";
import { SILHOUETTE, type MessageClient, type Vec3 } from "./protocole";
import { TIGRE, capDeCachette } from "./tigre-arene";
import { EMPLACEMENTS_VOITURES, ROND_POINT, ZONE_APPARITION, positionElsa, trouverRondPoint } from "./zones";

/**
 * Test de charge avec les tigres, sur le modèle de `match.charge.test.ts` (16 joueurs, 6 voitures conduisibles, 12 PNJ, Elsa, tic à 60 Hz
 * pendant 10 s simulées) : un tigre sauvage en attaque et quatre tigres alliés en chasse en plus. Le coût moyen d'un tic doit rester
 * dans le même budget (1 ms) et le snap avec les tigres sous 5 000 octets.
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const monde = construireMonde(scene);
const apparitions = pointsApparition(scene, monde);
const fichier = JSON.parse(readFileSync("public/agroparc/cachettes.json", "utf8")) as FichierCachettes;
const cachettes = lireCachettes(fichier).map((c) => ({ x: c.x, z: c.z, cap: capDeCachette(c.cap) }));
const T0 = 1_700_000_000_000;
const DUREE_S = 10;
const TIC_MS = 1000 / 60;
/** Même budget que match.charge.test.ts (tic ET messages reçus pendant ce tic). */
const BUDGET_TIC_MOYEN_MS = 1;
/** Snap de 16 joueurs avec 5 tigres (≈ 3 500 octets sans tigre, ≈ 120 octets par tigre). */
const BUDGET_SNAP_OCTETS = 5000;

function lcg(graine: number): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe("charge avec tigres : 16 joueurs, 6 voitures, 12 PNJ, un tigre sauvage et 4 tigres alliés, 10 s à 60 Hz", () => {
  it("temps CPU moyen d'un tic et taille d'un snap dans le budget", () => {
    const circuits = construireCircuits();
    const rond = trouverRondPoint(scene) ?? ROND_POINT;
    const [elsaX, elsaZ] = positionElsa(scene);
    const options: OptionsSalle = {
      zoneApparition: { centre: rond.centre, ...ZONE_APPARITION },
      elsa: { x: elsaX, z: elsaZ, intervalle: { minMs: 2000, maxMs: 4000 } },
      circulation: { circuits, voitures: flotte(circuits) },
      vehicules: EMPLACEMENTS_VOITURES,
      tigres: { cachettes, intervalle: { minMs: 1000, maxMs: 1000 } },
    };
    const s = new Salle(monde, apparitions, lcg(42), T0, options);
    const tigres = (s as unknown as { tigres: ServiceTigres }).tigres;
    const alea = lcg(7);
    const ids = Array.from({ length: 16 }, (_, i) => `j${i.toString(36)}`);
    ids.forEach((id, i) => {
      s.connecter(id, `Agent${i}`, T0);
      s.recevoir(id, { t: "rejoindre", principale: "fusil_assaut", secondaire: "pistolet" }, T0);
    });
    const j = (id: string) => s.inspecter(id) as JoueurSalle;
    const seqs = new Map<string, number>(ids.map((id) => [id, 0]));
    const etat = (id: string, maintenant: number, bouger: boolean) => {
      const a = j(id);
      if (!a.vivant) return;
      const dx = bouger ? (alea() - 0.5) * 0.4 : 0, dz = bouger ? (alea() - 0.5) * 0.4 : 0;
      const p: Vec3 = [a.p[0] + dx, a.p[1], a.p[2] + dz];
      const m: MessageClient = { t: "etat", seq: seqs.set(id, seqs.get(id)! + 1).get(id)!, p, v: [dx * 30, 0, dz * 30], lacet: a.lacet, tangage: 0, posture: "sol", mur: 0 };
      s.recevoir(id, m, maintenant);
    };

    // préparation (non mesurée) : avion, largage, atterrissage du tigre sauvage
    let maintenant = T0;
    let sauvage: string | null = null;
    for (let k = 0; k < 60 * 60 && !sauvage; k++) {
      maintenant = T0 + Math.round(k * TIC_MS);
      if (k % 2 === 0) ids.forEach((id) => etat(id, maintenant, false));
      for (const x of s.tic(maintenant)) if (x.m.t === "avion" && x.m.tigre) sauvage = x.m.tigre;
    }
    expect(sauvage).not.toBeNull();
    for (let k = 1; k <= Math.ceil(TIGRE.descenteMs / TIC_MS) + 2; k++) {
      maintenant += Math.round(TIC_MS);
      if (k % 2 === 0) ids.forEach((id) => etat(id, maintenant, false));
      s.tic(maintenant);
    }
    expect(tigres.tigre(sauvage!)?.etat).toBe("tapi");
    // le joueur le plus proche le blesse : il attaque
    const t = tigres.tigre(sauvage!)!;
    const proche = ids.reduce((a, b) => (Math.hypot(j(a).p[0] - t.p[0], j(a).p[2] - t.p[2]) < Math.hypot(j(b).p[0] - t.p[0], j(b).p[2] - t.p[2]) ? a : b));
    tigres.blesser(sauvage!, 10, j(proche), "corps", maintenant);
    // quatre lanceurs invoquent leur tigre allié, chacun avec un ennemi posé sur un point d'apparition à 8 à 16 m (cible du tigre allié)
    ids.slice(0, 4).forEach((id, i) => {
      const l = j(id);
      const pres = apparitions.find(([x, z]) => { const d = Math.hypot(x - l.p[0], z - l.p[2]); return d >= 8 && d <= 16; });
      if (pres) j(ids[12 + i]).p = [pres[0], 0, pres[1]];
      tigres.accorderCharge(id);
      s.recevoir(id, { t: "invoquer" }, maintenant);
    });
    expect(tigres.snap().length).toBe(5);

    let cpu = 0, tics = 0, pire = 0, plusGrosSnap = 0, tigresDansSnap = 0, coupsDeTigre = 0;
    const total = Math.round(DUREE_S * 1000 / TIC_MS);
    const debut = maintenant;
    for (let k = 1; k <= total; k++) {
      maintenant = debut + Math.round(k * TIC_MS);
      const t0 = performance.now();
      if (k % 2 === 0) ids.forEach((id) => etat(id, maintenant, true));
      if (k % 4 === 0) {
        // six joueurs tirent sur leur voisin, comme match.charge.test.ts
        for (const id of ids.slice(6, 12)) {
          const a = j(id), cible = j(ids[(ids.indexOf(id) + 1) % 16]);
          if (!a.vivant || !cible.vivant) continue;
          const o: Vec3 = [a.p[0], a.p[1] + SILHOUETTE.oeil, a.p[2]];
          const v = [cible.p[0] - o[0], cible.p[1] + SILHOUETTE.centreY - o[1], cible.p[2] - o[2]];
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          const d: Vec3 = [v[0] / l, v[1] / l, v[2] / l];
          a.lacet = Math.atan2(-d[0], -d[2]); a.tangage = Math.asin(d[1]);
          s.recevoir(id, { t: "tir", arme: "fusil_assaut", o, d: [d], touches: [{ cible: cible.id, zone: "corps", plomb: 0 }] }, maintenant);
        }
      }
      const sorties: Sortie[] = s.tic(maintenant);
      const dt = performance.now() - t0;
      cpu += dt; tics++; pire = Math.max(pire, dt);
      for (const x of sorties) {
        if (x.m.t === "degats" && (x.m.degats === 15 || x.m.degats === 25 || x.m.degats === 40)) coupsDeTigre++;
        if (x.m.t !== "snap" || x.a !== "joueurs") continue;
        plusGrosSnap = Math.max(plusGrosSnap, JSON.stringify(x.m).length);
        tigresDansSnap = Math.max(tigresDansSnap, x.m.tigres?.length ?? 0);
      }
    }
    const moyen = cpu / tics;
    // eslint-disable-next-line no-console
    const etats = tigres.snap().map((x) => x.etat).join(" ");
    console.log(`[charge tigres] ${tics} tics : moyen ${moyen.toFixed(3)} ms, pire ${pire.toFixed(2)} ms, plus gros snap ${plusGrosSnap} octets, ${tigresDansSnap} tigres (${etats}), ${coupsDeTigre} coups de tigre`);
    expect(tics).toBe(600);
    expect(tigresDansSnap).toBeGreaterThanOrEqual(4);
    expect(coupsDeTigre).toBeGreaterThan(0); // les tigres chassent vraiment pendant la mesure
    expect(plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
    expect(moyen).toBeLessThan(BUDGET_TIC_MOYEN_MS);
  });
});
