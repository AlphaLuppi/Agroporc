/**
 * « Tope là ! » / « Tape-m'en cinq ! » : arrêté FACE à nous, il s'assoit (la patte d'appui recule
 * d'un petit pas sous le poitrail), lève une patte avant à hauteur de joue, coussinets tournés vers
 * l'écran, et la tient en attendant (petits rebonds d'impatience, tête qui penche).
 * - Second clic (ctx.tClap) : la patte part vers l'écran (« Clap ! »), choc qui secoue tout le
 *   corps, rebond, puis il baisse la patte, se relève et repart content (l'animateur accélère).
 * - Personne ne tape (ctx.tVexe) : la patte retombe lentement, il détourne la tête, oreilles en
 *   arrière (« Hmpf. »), se relève et repart au ralenti.
 * Les instants du clap / de l'abandon sont décidés par l'animateur (FENETRE_TAPE).
 */
import { DELAI_BULLE, DUREES } from "../../tigre-reactions";
import {
  assis, pattesAssis, patteAuSol, solVersCorps, extremiteMonde, repos, cote as coteDe,
  rampe, bosse, echelon, impact, bruit, lerp, tete, oreilles, ajouter, queue, patteCoteCamera,
} from "./outils";
import type { Geste, PoseGeste, Vec3 } from "./types";

/** Patte levée (repère du sol, côté droit du tigre ; x est inversé pour la gauche). */
const LEVEE: Vec3 = [-0.09, 0.48, 0.24];
/** Orientation voulue de la main levée (coussinets vers +Z, un peu ouverte vers l'extérieur). */
const PAUME: Vec3 = [-1.75, 0.2, 0.2];

export const tape: Geste = {
  duree: (DUREES.entreeTape + DUREES.fenetreTape) / 1000,
  immobile: true,
  bulleTot: true,
  cap: () => 0,
  evenements: [{ t: DELAI_BULLE.tape / 1000, type: "bulle" }],
  echantillonner(t, ctx) {
    const patte = patteCoteCamera(ctx.sens);
    const c = coteDe(patte);
    const { tClap, tVexe } = ctx;
    const tFin = tClap ?? tVexe;
    // Assise : s'assoit en 0,5 s (léger tassement), se relève à la fin.
    const releve = tClap != null ? rampe(t, tClap + 0.55, tClap + 1.05) : tVexe != null ? rampe(t, tVexe + 0.5, tVexe + 1.05) : 0;
    const k = Math.min(1.04, echelon(t, 0, 7, 0.75)) * (1 - releve);
    // Patte levée : monte (anticipation : elle recule d'abord un peu), dépasse, se pose en l'air.
    let leve = echelon(t, 0.3, 11, 0.6);
    if (tClap != null) leve *= 1 - rampe(t, tClap + 0.4, tClap + 0.75);
    if (tVexe != null) leve *= 1 - rampe(t, tVexe + 0.05, tVexe + 0.6);
    // Impatience : petits rebonds de la patte, plus marqués quand l'attente dure.
    // Après le clap ou l'abandon, l'impatience s'éteint en 0,25 s (pas d'un coup : la tête et la
    // patte ne sautent pas à l'instant du clic).
    const eteint = tFin == null ? 1 : 1 - rampe(t, tFin, tFin + 0.25);
    const attente = rampe(t, 1.6, 2.2) * eteint;
    const rebond = eteint * rampe(t, 0.9, 1.2) * (0.012 * bruit(ctx.temps * 1.3, 5) + 0.018 * attente * Math.max(0, Math.sin((t - 1.6) * 13)));
    // Clap : la patte part vers l'écran (rapide), rebondit, revient.
    const frappe = tClap != null ? echelon(t, tClap, 34, 0.45) - echelon(t, tClap + 0.1, 16, 0.6) : 0;
    const choc = tClap != null ? impact(t, tClap + 0.06, 20, 0.3) : 0;

    // Patte gauche levée (c = 1) : il se penche sur sa droite (roulis > 0), le choc le fait reculer.
    const co = assis(k, { roulis: 0.07 * c * leve + 0.02 * choc * c, tangage: -0.08 * choc, dz: 0.03 * frappe });
    const p0 = repos(patte === "avG" ? "mainG" : "mainD");
    const haut: Vec3 = [p0[0] + c * -LEVEE[0], LEVEE[1] + rebond + 0.02 * frappe, LEVEE[2] + 0.16 * frappe];
    const sol = patteAuSol(co, patte, 0, -0.03 * k, 0);
    // Trajet de la patte : elle quitte le sol en reculant, passe près du poitrail, monte devant la joue.
    const u = Math.max(0, Math.min(1.08, leve));
    const arc: Vec3 = [
      lerp(p0[0], haut[0], Math.min(1, u)),
      lerp(p0[1], haut[1], u),
      lerp(p0[2] - 0.03 * k, haut[2], u) - 0.06 * Math.sin(Math.PI * Math.min(1, u)),
    ];
    const paume: Vec3 = [PAUME[0] * Math.min(1, u) - 0.15 * frappe, c * PAUME[1] * u, c * PAUME[2] * u];
    const levee = { cible: solVersCorps(co, arc), extremite: extremiteMonde(co, paume) };
    const pattes: NonNullable<PoseGeste["pattes"]> = {
      ...pattesAssis(co, k, () => rampe(t, 0.2, 0.55), [patte]),
      [patte]: u > 0.001 ? levee : sol,
    };

    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Tête de niveau malgré le poitrail redressé, penchée vers la patte levée, curieuse.
    const vexe = tVexe != null ? rampe(t, tVexe, tVexe + 0.35) * (1 - rampe(t, tVexe + 0.8, tVexe + 1.1)) : 0;
    const penche = (0.18 * c * leve + 0.06 * bruit(ctx.temps * 0.7, 9)) * (1 - vexe) + 0.12 * attente * Math.sin((t - 1.6) * 3);
    tete(deltas, -c * 0.75 * vexe, penche, 0.42 * k - 0.15 * vexe - 0.12 * choc);
    oreilles(deltas, -0.35 * leve * (1 - vexe) + 0.8 * vexe + 0.4 * choc);
    // Clap : la mâchoire s'entrouvre (sourire), la queue fouette.
    ajouter(deltas, "machoire", [0.12 * bosse(t, (tClap ?? 99) + 0.05, (tClap ?? 99) + 0.15, (tClap ?? 99) + 0.5, (tClap ?? 99) + 0.8), 0, 0]);
    // Assis, la queue s'enroule sur le côté (elle ne s'écrase pas au sol) ; le clap la fait fouetter.
    queue(deltas, 0.8 * k, 1.0 * c * k, 0.5 * choc);
    return {
      corps: co,
      pattes,
      deltas,
      regard: 1 - vexe,
      poids: { corps: 1, avG: 1, avD: 1, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1 },
    };
  },
};
