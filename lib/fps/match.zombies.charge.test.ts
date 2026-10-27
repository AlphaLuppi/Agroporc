import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SceneData } from "../agroparc3d/types";
import { Salle, type JoueurSalle, type Sortie } from "./match";
import { SILHOUETTE, decoderZombies, type Vec3 } from "./protocole";
import { DEPARTS, construireMondeZombies } from "./zombies-carte";
import { ZOMBIES } from "./zombies-vagues";

/**
 * Charge du mode zombies : 8 joueurs, 24 tigres vivants (plafond), tic à 60 Hz pendant 10 s simulées. Mesure le temps CPU d'un tic (le serveur en
 * lance 60 par seconde sur 0,3 vCPU) et la taille d'un snap sérialisé. À lancer SEUL pour la mesure nominale (1 ms) : sous vitesse parallèle de toute
 * la machine, le budget de 2 ms laisse la marge (comme `match.charge.test.ts`, qui dépasse déjà son budget quand vitest tourne en parallèle).
 */

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const T0 = 1_700_000_000_000;
const DUREE_S = 10;
const TIC_MS = 1000 / 60;
/** Budget nominal 1 ms (mesure seule) ; 2 ms toléré sous charge parallèle. */
const BUDGET_TIC_MOYEN_MS = 2;
/** Un snap de 8 joueurs + 24 tigres sérialisé (octets). */
const BUDGET_SNAP_OCTETS = 4200;

function lcg(graine: number): () => number {
  let k = graine;
  return () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe("charge zombies : 8 joueurs, 24 tigres, 10 s à 60 Hz", () => {
  it("temps CPU moyen d'un tic et taille d'un snap dans le budget", () => {
    const monde = construireMondeZombies(scene);
    // griffes sans effet : les 8 joueurs restent debout pendant toute la mesure ; beaucoup de tigres à faire naître
    const s = new Salle(monde, DEPARTS.map((d) => [d[0], d[1]] as [number, number]), lcg(42), T0, {
      zombies: { pauseMs: 500, degatsGriffe: 0, total1: 400 },
    });
    const ids = Array.from({ length: 8 }, (_, i) => `j${i.toString(36)}`);
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

    const seqs = new Map<string, number>(ids.map((id) => [id, 0]));
    let cpu = 0, tics = 0, pire = 0, plusGrosSnap = 0, snapsVus = 0, tigresMax = 0, entrees = 0;
    const total = Math.round(DUREE_S * 1000 / TIC_MS);
    for (let k = 0; k < total; k++) {
      const maintenant = t + 1000 + Math.round(k * TIC_MS);
      const debut = performance.now();
      // entrées des clients : états à 30 Hz (petits déplacements), un tir sur un tigre par joueur toutes les 15 images (validé par le serveur)
      if (k % 2 === 0) {
        for (const id of ids) {
          const a = j(id);
          const dx = (alea() - 0.5) * 0.2, dz = (alea() - 0.5) * 0.2;
          s.recevoir(id, { t: "etat", seq: ++entrees, p: [a.p[0] + dx, 0, a.p[2] + dz] as Vec3, v: [dx * 30, 0, dz * 30], lacet: 0, tangage: 0, posture: "sol", mur: 0 }, maintenant);
        }
      }
      void seqs;
      const sorties: Sortie[] = s.tic(maintenant);
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
        if (x.m.t !== "snap" || x.a !== "joueurs") continue;
        plusGrosSnap = Math.max(plusGrosSnap, JSON.stringify(x.m).length);
        snapsVus++;
        tigresMax = Math.max(tigresMax, x.m.zombies ? decoderZombies(x.m.zombies).length : 0);
      }
    }
    const moyen = cpu / tics;
    // eslint-disable-next-line no-console
    console.log(`[charge zombies] ${tics} tics : moyen ${moyen.toFixed(3)} ms, pire ${pire.toFixed(2)} ms ; plus gros snap ${plusGrosSnap} octets ; ${tigresMax} tigres`);
    expect(tics).toBe(600);
    expect(s.nombreEnJeu()).toBe(8);
    expect(s.resumeZombies()!.phase).toBe("manche");
    expect(snapsVus).toBeGreaterThanOrEqual(190); // 20 Hz pendant 10 s
    expect(tigresMax).toBe(ZOMBIES.plafondVivants);
    expect(plusGrosSnap).toBeLessThanOrEqual(BUDGET_SNAP_OCTETS);
    expect(moyen).toBeLessThan(BUDGET_TIC_MOYEN_MS);
  });
});
