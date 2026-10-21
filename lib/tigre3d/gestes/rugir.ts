/**
 * « ROAAR ! » / « GRRROAAR ! » : de trois quarts vers nous, il se ramasse (épaules basses, tête
 * rentrée : l'anticipation), puis se dresse en avant d'un coup, poitrail bombé, tête projetée vers
 * l'écran, menton grand ouvert (le modèle n'a pas d'intérieur de gueule : c'est la mâchoire qui
 * tombe), oreilles plaquées, la tête qui tremble du cri ; l'écran tremble aussi (« secousse »).
 * Il finit par s'ébrouer.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import {
  bosse, rampe, echelon, impact, tete, oreilles, gueule, ajouter, queue, patteCoteCamera, cote as coteDe,
  repos, solVersCorps, extremiteMonde, lerp,
} from "./outils";
import type { CorpsGeste } from "./outils";
import type { Geste, PoseGeste } from "./types";

const DUREE = 2.4;
/** Début du cri (s) : la bulle et la secousse tombent dessus. */
const CRI = DELAI_BULLE.rugir / 1000;

export const rugir: Geste = {
  duree: DUREE,
  immobile: true,
  cap: (sens) => sens * 0.3,
  evenements: [{ t: CRI, type: "bulle" }, { t: CRI + 0.03, type: "secousse", duree: 0.8 }],
  echantillonner(t, ctx) {
    const s = ctx.sens;
    // Anticipation (il se ramasse), cri (il se projette, dépasse, tient), relâchement.
    const ramasse = bosse(t, 0, 0.3, CRI - 0.05, CRI + 0.08);
    const cri = echelon(t, CRI - 0.02, 16, 0.45) * (1 - rampe(t, 1.45, 1.85));
    const tremble = Math.sin(t * 52) * bosse(t, CRI + 0.05, CRI + 0.15, 1.3, 1.5);
    // Ébrouement après le cri : la tête secoue de gauche à droite, amortie.
    const ebroue = Math.sin((t - 1.75) * 24) * Math.exp(-Math.max(0, t - 1.75) * 5) * (t > 1.75 ? 1 : 0);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Tête : rentrée et basse à l'anticipation ; au cri, cou tendu vers l'écran, menton à peine
    // relevé (le poitrail cabré la relève déjà) : il rugit VERS nous, pas vers le ciel.
    tete(deltas, 0.18 * ebroue, 0.1 * s * cri + 0.12 * ebroue, 0.3 * ramasse + 0.1 * cri + 0.02 * tremble);
    ajouter(deltas, "cou", [0.12 * cri, 0, 0]);
    gueule(deltas, 0.45 * cri + 0.04 * tremble);
    ajouter(deltas, "tete", [-0.12 * cri, 0, 0]);
    oreilles(deltas, 0.5 * ramasse + 1.0 * cri);
    // Dos : rentré à l'anticipation, cambré au cri.
    ajouter(deltas, "thorax", [0.06 * ramasse - 0.08 * cri, 0, 0]);
    queue(deltas, 0.35 * cri, 0, 0.5 * Math.sin(t * 7) * cri);
    const k = bosse(t, 0, 0.2, DUREE - 0.4, DUREE);
    const co: CorpsGeste = {
      dy: -0.045 * ramasse + 0.025 * cri, dz: -0.035 * ramasse + 0.05 * cri - 0.012 * impact(t, CRI, 14, 0.4),
      tangage: -0.1 * ramasse + 0.2 * cri, pivot: "hanches",
    };
    // Coup de patte : la patte côté caméra se lève haut, griffes vers nous, et retombe en fin de cri.
    const patte = patteCoteCamera(s);
    const c = coteDe(patte);
    const griffe = echelon(t, CRI - 0.06, 13, 0.55) * (1 - rampe(t, 1.3, 1.7));
    const m = repos(patte === "avG" ? "mainG" : "mainD");
    const u = Math.max(0, griffe);
    const cible = solVersCorps(co, [lerp(m[0], m[0] + c * 0.03, u), lerp(m[1], 0.33, u), lerp(m[2], m[2] + 0.16, u) - 0.05 * Math.sin(Math.PI * Math.min(1, u))]);
    return {
      corps: co,
      pattes: { [patte]: { cible, extremite: extremiteMonde(co, [-1.1 * Math.min(1, u), 0, c * 0.2 * u]) } },
      deltas,
      regard: 1,
      poids: { corps: 1, [patte]: 1, colonne: k, cou: k, tete: k, machoire: k, oreilles: k, queue: k },
    };
  },
};
