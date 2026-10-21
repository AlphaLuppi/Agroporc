/**
 * « Prrr… » : il s'assoit de trois quarts, ferme à demi les yeux (tête basse et penchée, il n'a pas
 * de paupières), se frotte la joue dans le vide et PÉTRIT : les pattes avant poussent l'une après
 * l'autre, comme un chat qui ronronne sur un coussin. Le corps vibre à peine, la queue s'enroule
 * autour des pattes, les cœurs montent.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import { assis, patteAuSol, bosse, rampe, echelon, bruit, tete, oreilles, queue } from "./outils";
import type { Geste, PoseGeste } from "./types";
import type { Patte } from "../os";

const DUREE = 2.9;

export const ronron: Geste = {
  duree: DUREE,
  immobile: true,
  cap: (sens) => sens * 0.35,
  evenements: [
    { t: DELAI_BULLE.ronron / 1000, type: "bulle" },
    { t: DELAI_BULLE.ronron / 1000, type: "particules", genre: "ronron", nombre: 2 },
    { t: DELAI_BULLE.ronron / 1000 + 0.7, type: "particules", genre: "ronron", nombre: 2 },
    { t: DELAI_BULLE.ronron / 1000 + 1.4, type: "particules", genre: "ronron", nombre: 2 },
  ],
  echantillonner(t, ctx) {
    const s = ctx.sens;
    const releve = rampe(t, DUREE - 0.6, DUREE);
    const k = Math.min(1.03, echelon(t, 0, 6, 0.8)) * (1 - releve);
    // Ronronnement : une vibration à peine visible, et un balancement lent du buste.
    const balance = Math.sin(t * 2.4) * bosse(t, 0.5, 0.9, 2.2, 2.6);
    const co = assis(k, { roulis: 0.04 * balance, dy: 0.0015 * Math.sin(t * 150) * k });
    // Pétrissage : chaque patte avant pousse à son tour (≈ 1,7 poussée/s par patte).
    const petrit = bosse(t, 0.55, 0.75, 2.2, 2.4);
    const pattes: NonNullable<PoseGeste["pattes"]> = {};
    for (const [p, phase] of [["avG", 0], ["avD", Math.PI]] as Array<[Patte, number]>) {
      const recul = rampe(t, p === "avG" ? 0.05 : 0.18, p === "avG" ? 0.38 : 0.5);
      const pas = 0.03 * Math.sin(Math.PI * recul) * (1 - releve);
      const pousse = Math.max(0, Math.sin(t * 10.5 + phase)) * petrit;
      pattes[p] = patteAuSol(co, p, 0, -0.1 * k * recul + 0.012 * pousse, pas + 0.022 * pousse);
    }
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Tête basse et penchée (yeux mi-clos), joue qui se frotte : roulis lent, lacet vers nous.
    const frotte = Math.sin(t * 1.9 + 0.5) * bosse(t, 0.4, 0.8, 2.3, 2.7);
    tete(deltas, 0.12 * s * frotte, 0.3 * s * bosse(t, 0.2, 0.7, 2.3, 2.7) + 0.12 * frotte + 0.04 * bruit(ctx.temps * 0.6, 2), 0.5 * k + 0.22 * bosse(t, 0.3, 0.8, 2.2, 2.6));
    // Oreilles détendues, un peu sur le côté ; queue enroulée autour des pattes.
    oreilles(deltas, 0.22 * k);
    queue(deltas, 0.8 * k, 1.0 * s * k, 0.15 * Math.sin(t * 1.3));
    return {
      corps: co,
      pattes,
      deltas,
      regard: 0.8,
      poids: { corps: 1, avG: 1, avD: 1, cou: 1, tete: 1, oreilles: 1, queue: 1 },
    };
  },
};
