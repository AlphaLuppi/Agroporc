/**
 * « Slurp. » / « Un brin de toilette… » : il s'assoit de trois quarts, porte une patte avant à sa
 * bouche, coussinets tournés vers lui, baisse la tête dessus et la lèche à petits coups (la tête
 * remonte le long de la patte, la mâchoire s'entrouvre à chaque coup de langue), puis se passe la
 * patte sur la joue jusqu'à l'oreille, comme un chat qui fait sa toilette, et la repose.
 */
import { DELAI_BULLE } from "../../tigre-reactions";
import {
  assis, pattesAssis, patteCoteCamera, cote as coteDe, repos, solVersCorps, extremiteMonde,
  bosse, rampe, echelon, lerp, tete, oreilles, gueule, queue,
} from "./outils";
import type { Geste, PoseGeste, Vec3 } from "./types";

const DUREE = 3.4;
/** Coups de langue : de LECHE à FROTTE (s). */
const LECHE = 0.8, FROTTE = 1.85;

export const lecher: Geste = {
  duree: DUREE,
  immobile: true,
  cap: (sens) => sens * 0.45,
  evenements: [{ t: DELAI_BULLE.lecher / 1000, type: "bulle" }],
  echantillonner(t, ctx) {
    const patte = patteCoteCamera(ctx.sens);
    const c = coteDe(patte);
    const releve = rampe(t, DUREE - 0.55, DUREE);
    const k = Math.min(1.03, echelon(t, 0, 6.5, 0.8)) * (1 - releve);
    const co = assis(k, { roulis: -0.03 * c });
    const leve = echelon(t, 0.3, 9, 0.75) * (1 - rampe(t, DUREE - 0.7, DUREE - 0.3));
    // Coups de langue : ~3,2 par seconde, la tête descend le long de la patte puis remonte.
    const lechage = bosse(t, LECHE - 0.1, LECHE, FROTTE - 0.1, FROTTE);
    const coup = Math.max(0, Math.sin((t - LECHE) * 20)) * lechage;
    // Toilette : la patte remonte de la bouche à l'oreille, deux passages.
    const frotte = bosse(t, FROTTE - 0.05, FROTTE + 0.15, DUREE - 0.75, DUREE - 0.55);
    const passe = 0.5 - 0.5 * Math.cos((t - FROTTE) * 9);
    const m = repos(patte === "avG" ? "mainG" : "mainD");
    // Devant la bouche (repère du sol), puis sur la joue.
    const bouche: Vec3 = [c * 0.03, 0.415, 0.25];
    const joue: Vec3 = [c * 0.08, 0.43 + 0.05 * passe, 0.245 - 0.02 * passe];
    const haut: Vec3 = [lerp(bouche[0], joue[0], frotte), lerp(bouche[1], joue[1], frotte), lerp(bouche[2], joue[2], frotte)];
    const u = Math.max(0, leve);
    const p0: Vec3 = [m[0], m[1], m[2] - 0.1 * k];
    const cible = solVersCorps(co, [lerp(p0[0], haut[0], Math.min(1, u)), lerp(p0[1], haut[1], u), lerp(p0[2], haut[2], u) - 0.04 * Math.sin(Math.PI * Math.min(1, u))]);
    // Coussinets vers la bouche (patte repliée), puis contre la joue.
    const ext = extremiteMonde(co, [lerp(0, lerp(1.6, 1.0, frotte), Math.min(1, u)), c * -0.3 * u, c * lerp(0.2, -0.9, frotte) * u]);
    const pattes: NonNullable<PoseGeste["pattes"]> = {
      ...pattesAssis(co, k, (p) => rampe(t, p === patte ? 0.15 : 0.3, p === patte ? 0.45 : 0.65), [patte]),
      [patte]: { cible, extremite: ext },
    };
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Tête : baissée vers la patte (côté patte), qui dodeline à chaque coup ; penchée pendant la toilette.
    tete(deltas, c * (0.3 * leve - 0.15 * frotte), c * (0.12 * leve + 0.3 * frotte), 0.42 * k + 0.55 * leve * (1 - frotte) + 0.14 * coup - 0.05 * frotte);
    gueule(deltas, 0.2 * coup + 0.05 * lechage);
    oreilles(deltas, 0.15 * leve + 0.5 * frotte * passe, c > 0 ? 1.4 : 0.6, c > 0 ? 0.6 : 1.4);
    queue(deltas, 0.8 * k, 1.0 * ctx.sens * k);
    return {
      corps: co,
      pattes,
      deltas,
      regard: 0.15 * (1 - leve) + 0.6 * bosse(t, DUREE - 0.7, DUREE - 0.5, DUREE, DUREE + 1),
      poids: { corps: 1, avG: 1, avD: 1, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1 },
    };
  },
};
