/**
 * « Aaah, la sieste… » / « Hmmm, ça fait du bien… » : le grand étirement du chat. De trois quarts,
 * il avance les pattes avant d'un pas chacune, descend le poitrail jusqu'au sol, arrière-train
 * haut et queue dressée, griffes plantées ; au plus bas il bâille (tête levée, menton grand
 * ouvert, oreilles en arrière), les « Z » montent ; puis il ramène ses pattes et se relève.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import { patteAuSol, bosse, rampe, echelon, tete, oreilles, gueule, ajouter, queue } from "./outils";
import type { CorpsGeste } from "./outils";
import type { Geste, PoseGeste } from "./types";
import type { Patte } from "../os";

const DUREE = 3.2;
/** Bâillement (s). */
const BAILLE = 0.95;

export const etirement: Geste = {
  duree: DUREE,
  immobile: true,
  cap: (sens) => sens * 0.6,
  evenements: [
    { t: DELAI_BULLE.etirement / 1000, type: "bulle" },
    { t: 0.4 + DELAI_BULLE.etirement / 1000, type: "particules", genre: "zzz", nombre: 1 },
    { t: 1.0 + DELAI_BULLE.etirement / 1000, type: "particules", genre: "zzz", nombre: 1 },
    { t: 1.6 + DELAI_BULLE.etirement / 1000, type: "particules", genre: "zzz", nombre: 1 },
  ],
  echantillonner(t, ctx) {
    // Pas des pattes avant : G puis D à l'aller, D puis G au retour.
    const aller = (p: Patte) => rampe(t, p === "avG" ? 0.0 : 0.2, p === "avG" ? 0.3 : 0.5);
    const retour = (p: Patte) => rampe(t, p === "avD" ? DUREE - 0.95 : DUREE - 0.75, p === "avD" ? DUREE - 0.65 : DUREE - 0.45);
    // Descente du poitrail (lente, il savoure), petit tressaillement d'effort au plus bas.
    const bas = echelon(t, 0.3, 4.5, 0.9) * (1 - rampe(t, DUREE - 1.1, DUREE - 0.55));
    const effort = Math.sin(t * 31) * bosse(t, 0.9, 1.1, 1.9, 2.1) * 0.004;
    const co: CorpsGeste = { tangage: -0.34 * bas, dy: -0.01 * bas + effort, pivot: "hanches" };
    const pattes: NonNullable<PoseGeste["pattes"]> = {};
    for (const p of ["avG", "avD"] as Patte[]) {
      const a = aller(p), r = retour(p);
      const avance = 0.13 * a * (1 - r);
      const h = 0.04 * (Math.sin(Math.PI * a) + Math.sin(Math.PI * r));
      pattes[p] = patteAuSol(co, p, 0, avance, h);
    }
    const baille = bosse(t, BAILLE, BAILLE + 0.3, BAILLE + 0.75, BAILLE + 1.05);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Tête : relevée pour regarder devant malgré le poitrail bas ; au bâillement, levée et gueule ouverte.
    tete(deltas, 0, 0.1 * baille * ctx.sens, -0.5 * bas - 0.3 * baille);
    gueule(deltas, 0.5 * baille);
    oreilles(deltas, 0.6 * baille - 0.2 * bas);
    // Dos creusé, queue dressée qui ondule au bout.
    ajouter(deltas, "lombaires", [0.1 * bas, 0, 0]);
    queue(deltas, 0.9 * bas, 0, 0.3 * Math.sin(t * 3) * bas);
    return {
      corps: co,
      pattes,
      deltas,
      regard: 0.7 - 0.4 * baille,
      poids: { corps: 1, colonne: 1, avG: 1, avD: 1, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1 },
    };
  },
};
