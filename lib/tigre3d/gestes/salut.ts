/**
 * « Coucou ! » / « Salut, toi ! » : debout, presque de face, il lève haut une patte avant au-dessus
 * de l'épaule, coussinets vers nous, et l'AGITE (le poignet bat de gauche à droite, la patte suit
 * avec un temps de retard), tête penchée en rythme, petit rebond du corps à chaque battement ;
 * puis il la repose sur le sol.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import { patteCoteCamera, cote as coteDe, repos, solVersCorps, extremiteMonde, bosse, rampe, echelon, tete, oreilles, queue } from "./outils";
import type { CorpsGeste } from "./outils";
import type { Geste, PoseGeste } from "./types";

const DUREE = 2.5;

export const salut: Geste = {
  duree: DUREE,
  immobile: true,
  bulleTot: true,
  cap: (sens) => sens * 0.2,
  evenements: [{ t: DELAI_BULLE.salut / 1000, type: "bulle" }],
  echantillonner(t, ctx) {
    const patte = patteCoteCamera(ctx.sens);
    const c = coteDe(patte);
    // La patte monte (avec dépassement), s'agite trois fois et demie, redescend.
    const leve = echelon(t, 0.15, 10, 0.6) * (1 - rampe(t, DUREE - 0.75, DUREE - 0.25));
    const agite = bosse(t, 0.45, 0.6, 1.8, 2.0);
    const phase = (t - 0.45) * 2.4 * Math.PI * 2;
    const bat = Math.sin(phase);
    // La patte suit le poignet avec du retard (chaîne) : la cible bat en retard de phase.
    const batPatte = Math.sin(phase - 0.9);
    // Il se reporte sur les trois autres pattes, buste un peu relevé ; rebond à chaque battement.
    const co: CorpsGeste = {
      dy: -0.01 * leve + 0.006 * Math.abs(bat) * agite,
      tangage: 0.12 * leve, roulis: 0.08 * c * leve, pivot: "hanches",
    };
    const m = repos(patte === "avG" ? "mainG" : "mainD");
    const haut: [number, number, number] = [m[0] + c * (0.05 + 0.035 * batPatte * agite), 0.47 + 0.01 * Math.abs(batPatte) * agite, m[2] + 0.12];
    const u = Math.max(0, leve);
    const cible = solVersCorps(co, [m[0] + (haut[0] - m[0]) * Math.min(1, u), m[1] + (haut[1] - m[1]) * u, m[2] + (haut[2] - m[2]) * u - 0.05 * Math.sin(Math.PI * Math.min(1, u))]);
    const paume = extremiteMonde(co, [-1.7 * Math.min(1, u), c * 0.15 * u, c * (0.25 + 0.55 * bat * agite) * u]);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    tete(deltas, 0, 0.2 * c * leve - 0.12 * bat * agite, 0.08 * leve);
    oreilles(deltas, -0.4 * leve);
    queue(deltas, 0.25 * leve, 0, 0.35 * Math.sin(phase * 0.5) * agite);
    return {
      corps: co,
      pattes: { [patte]: { cible, extremite: paume } },
      deltas,
      regard: 1,
      poids: { corps: 1, [patte]: 1, cou: 1, tete: 1, oreilles: 1, queue: 1 },
    };
  },
};
