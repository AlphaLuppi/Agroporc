/**
 * Coup de patte du tigre zombie (mode zombies de l'arène, lib/fps/zombies-anim.ts) : 0,9 s. Armement lisible (0,45 s) : le tigre se cabre,
 * tête en arrière, oreilles plaquées, et lève la patte avant droite en arrière ; puis elle claque vers l'avant et vers le bas, épaules qui
 * plongent et le corps qui se jette en avant, gueule ouverte ; le CONTACT est à `CONTACT_GRIFFE` (0,55 s), l'instant où le serveur touche
 * (`ZOMBIES.griffeArmeS`, vérifié par lib/fps/zombies-anim.test.ts) ; puis la patte revient.
 * Jamais tirée au clic du thème Tigre (poids nul dans `POIDS_REACTIONS`) : seul l'animateur des zombies la lance, quand le drapeau « griffe
 * armée » du snap passe à 1.
 */
import { rampe, bosse, repos, solVersCorps, extremiteMonde, tete, oreilles, gueule, queue, lerp } from "./outils";
import type { CorpsGeste } from "./outils";
import type { Geste, PoseGeste, Vec3 } from "./types";

export const DUREE_GRIFFE = 0.9;
/** Instants (s) de la montée, de la frappe (le contact) et du retour. */
const T = { leve: 0.38, arme: 0.45, frappe: 0.55, retour: 0.9 } as const;
/** Instant (s) du contact de la patte : celui du serveur. */
export const CONTACT_GRIFFE = T.frappe;

export const griffe: Geste = {
  duree: DUREE_GRIFFE,
  immobile: false,
  evenements: [],
  echantillonner(t) {
    const m = repos("mainD");
    // trois points de la patte (repère du modèle, avant +Z) : repos, haut et en arrière, frappe devant et bas
    const haut: Vec3 = [m[0] - 0.03, 0.47, m[2] - 0.04];
    const frappe: Vec3 = [m[0] + 0.03, 0.12, m[2] + 0.32];
    const monte = rampe(t, 0, T.leve);
    const claque = rampe(t, T.arme, T.frappe);
    const revient = rampe(t, T.frappe + 0.02, T.retour);
    // armement (haut) → frappe → retour au repos
    const aller: Vec3 = [lerp(m[0], haut[0], monte), lerp(m[1], haut[1], monte), lerp(m[2], haut[2], monte)];
    const apres: Vec3 = [lerp(haut[0], frappe[0], claque), lerp(haut[1], frappe[1], claque), lerp(haut[2], frappe[2], claque)];
    const p: Vec3 = claque > 0 ? apres : aller;
    const cible0: Vec3 = revient > 0 ? [lerp(frappe[0], m[0], revient), lerp(frappe[1], m[1], revient), lerp(frappe[2], m[2], revient)] : p;
    // armement : le tigre se cabre (avant relevé, tête en arrière) ; frappe : l'épaule plonge et le corps se jette en avant
    const cabre = bosse(t, 0, T.leve, T.arme, T.frappe);
    const plonge = bosse(t, T.arme, T.frappe, T.frappe + 0.06, T.retour);
    const co: CorpsGeste = { dy: 0.03 * cabre - 0.03 * plonge, dz: -0.02 * cabre + 0.07 * plonge, tangage: 0.14 * cabre - 0.12 * plonge, pivot: "epaules" };
    const cible = solVersCorps(co, cible0);
    // griffes en arrière à l'armement, vers le bas à la frappe
    const extremite = extremiteMonde(co, [-0.9 * Math.min(monte, 1 - claque) - 0.5 * claque * (1 - revient), 0, 0]);
    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    tete(deltas, 0, 0, 0.35 * plonge - 0.25 * cabre);
    gueule(deltas, 0.5 * plonge + 0.35 * cabre);
    oreilles(deltas, 0.9 * Math.max(monte * (1 - claque), plonge));
    queue(deltas, 0.3 * plonge + 0.25 * cabre, 0, 0.3 * Math.sin(t * 40) * Math.max(plonge, cabre));
    return {
      corps: co,
      pattes: { avD: { cible, extremite } },
      deltas,
      poids: { corps: 1, avD: 1, cou: 1, tete: 1, machoire: 1, oreilles: 1, queue: 1 },
    };
  },
};
