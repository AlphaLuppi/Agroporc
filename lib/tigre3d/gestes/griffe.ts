/**
 * Coup de griffe du tigre zombie (mode zombies de l'arène, lib/fps/zombies-anim.ts) : 0,55 s, il ne s'arrête pas. La patte avant droite se
 * lève et part en arrière (armement), puis claque vers l'avant et vers le bas (la frappe), gueule ouverte, épaules qui plongent, et revient.
 * Jamais tirée au clic du thème Tigre (poids nul dans `POIDS_REACTIONS`) : seul l'animateur des zombies la lance, quand le drapeau « griffe
 * armée » du snap passe à 1.
 */
import { rampe, bosse, repos, solVersCorps, extremiteMonde, tete, oreilles, gueule, queue, lerp } from "./outils";
import type { CorpsGeste } from "./outils";
import type { Geste, PoseGeste, Vec3 } from "./types";

export const DUREE_GRIFFE = 0.55;
/** Instants (s) de la montée, de la frappe et du retour. */
const T = { leve: 0.2, arme: 0.3, frappe: 0.4, retour: 0.55 } as const;

export const griffe: Geste = {
  duree: DUREE_GRIFFE,
  immobile: false,
  evenements: [],
  echantillonner(t) {
    const m = repos("mainD");
    // trois points de la patte (repère du modèle, avant +Z) : repos, haut et en arrière, frappe devant et bas
    const haut: Vec3 = [m[0] - 0.03, 0.47, m[2] - 0.04];
    const frappe: Vec3 = [m[0] + 0.02, 0.1, m[2] + 0.27];
    const monte = rampe(t, 0, T.leve);
    const claque = rampe(t, T.arme, T.frappe);
    const revient = rampe(t, T.frappe + 0.02, T.retour);
    // armement (haut) → frappe → retour au repos
    const aller: Vec3 = [lerp(m[0], haut[0], monte), lerp(m[1], haut[1], monte), lerp(m[2], haut[2], monte)];
    const apres: Vec3 = [lerp(haut[0], frappe[0], claque), lerp(haut[1], frappe[1], claque), lerp(haut[2], frappe[2], claque)];
    const p: Vec3 = claque > 0 ? apres : aller;
    const cible0: Vec3 = revient > 0 ? [lerp(frappe[0], m[0], revient), lerp(frappe[1], m[1], revient), lerp(frappe[2], m[2], revient)] : p;
    // l'épaule plonge avec la frappe
    const plonge = bosse(t, T.arme, T.frappe, T.frappe + 0.04, T.retour);
    const co: CorpsGeste = { dy: -0.025 * plonge, dz: 0.03 * plonge, tangage: -0.1 * plonge, pivot: "epaules" };
    const cible = solVersCorps(co, cible0);
    // griffes en arrière à l'armement, vers le bas à la frappe
    const extremite = extremiteMonde(co, [-0.9 * Math.min(monte, 1 - claque) - 0.5 * claque * (1 - revient), 0, 0]);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    tete(deltas, 0, 0, 0.35 * plonge);
    gueule(deltas, 0.5 * plonge);
    oreilles(deltas, 0.9 * Math.max(monte * (1 - claque), plonge));
    queue(deltas, 0.3 * plonge, 0, 0.3 * Math.sin(t * 40) * plonge);
    return {
      corps: co,
      pattes: { avD: { cible, extremite } },
      deltas,
      poids: { corps: 1, avD: 1, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1 },
    };
  },
};
