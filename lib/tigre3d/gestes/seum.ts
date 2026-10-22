/**
 * « J'ai le seum ! » : pris au lasso, le tigre pend au bout de la corde et se débat. Ce n'est pas
 * une réaction au clic (pas dans le registre GESTES) : l'animateur le pose tant que le tigre est
 * tenu (`attraper` → `relacher`), sans durée propre. Pattes qui pédalent dans le vide, dos qui se
 * tord, queue qui fouette, oreilles plaquées, gueule qui grogne ; il nous regarde, furieux.
 */
import { ajouter, oreilles, queue, repos, tete, rampe } from "./outils";
import type { Geste, PoseGeste } from "./types";
import type { Patte } from "../os";

const PATTES: Patte[] = ["avG", "avD", "arG", "arD"];
const EXTREMITE: Record<Patte, "mainG" | "mainD" | "piedG" | "piedD"> = { avG: "mainG", avD: "mainD", arG: "piedG", arD: "piedD" };
/** Déphasage de chaque patte (tours) : jamais deux pattes ensemble, ça gigote. */
const PHASE: Record<Patte, number> = { avG: 0, avD: 0.5, arG: 0.25, arD: 0.75 };

export const seum: Geste = {
  duree: Infinity,
  immobile: false,
  freine: true,
  // La bulle est émise par l'animateur au moment de la capture.
  evenements: [],
  echantillonner(t) {
    const k = rampe(t, 0, 0.25);
    // Accès de rage : il se débat par salves (vite), puis souffle un instant (lent).
    const rage = 0.65 + 0.35 * Math.sin(t * 2.3);
    const w = 2 * Math.PI * (2.4 + 1.6 * rage);
    const torsion = Math.sin(t * 5.1) * rage;

    const deltas: NonNullable<PoseGeste["deltas"]> = {};
    // Dos qui se tord et se cambre, tête qui secoue de colère.
    ajouter(deltas, "thorax", [-0.12 * k + 0.1 * torsion, 0.12 * torsion, 0]);
    ajouter(deltas, "lombaires", [-0.15 * k - 0.1 * torsion, -0.15 * torsion, 0]);
    tete(deltas, 0.18 * Math.sin(t * 7.3), 0.2 * Math.sin(t * 3.1), -0.1 * k);
    oreilles(deltas, 1.1 * k);
    // Grognement : la gueule s'ouvre et se ferme.
    ajouter(deltas, "machoire", [k * (0.12 + 0.1 * Math.max(0, Math.sin(t * 6.2))), 0, 0]);
    queue(deltas, 0.5 * k, 0.4 * Math.sin(t * 4.2), 0.6 * Math.sin(t * 11));

    // Pattes qui pédalent dans le vide, en petits cercles autour de leur place de repos.
    const pattes: NonNullable<PoseGeste["pattes"]> = {};
    for (const p of PATTES) {
      const r = repos(EXTREMITE[p]);
      const a = w * t + 2 * Math.PI * PHASE[p];
      const avant = p.startsWith("av") ? 1 : -1;
      pattes[p] = {
        cible: [r[0], r[1] + 0.07 + 0.045 * Math.sin(a), r[2] + avant * 0.03 + 0.06 * Math.cos(a)],
        extremite: [0.5 * Math.sin(a + 1) * avant, 0, 0],
      };
    }
    return {
      corps: { roulis: 0.1 * torsion * k, tangage: 0.05 * Math.sin(t * 3.7) * k },
      deltas,
      pattes,
      regard: 0.8,
      poids: { corps: k, colonne: k, cou: k, tete: k, machoire: k, oreilles: k, queue: k, avG: k, avD: k, arG: k, arD: k },
    };
  },
};
