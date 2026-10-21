/**
 * Motion « Service de midi » — logique pure du lot global (quiz V2) :
 * sens de glissement entre questions, count-up des notes, confettis
 * déterministes (aucun Math.random : rendu identique serveur / client).
 */

/** Nombre d'éléments qui reçoivent un délai de stagger ; au-delà, tout arrive ensemble. */
export const PLAFOND_STAGGER = 8;

/** Index de stagger à poser en `--i`, ou `undefined` au-delà du plafond. */
export function indiceStagger(i: number, plafond = PLAFOND_STAGGER): number | undefined {
  return i >= 0 && i < plafond ? i : undefined;
}

/** Sens du glissement de la question suivante : +1 en avançant, −1 en revenant. */
export type Sens = 1 | -1;
export function sensNavigation(action: "repondre" | "revenir"): Sens {
  return action === "revenir" ? -1 : 1;
}

/** Easing « out-expo » (même courbe que --ease-out-expo, approximée). */
export function easeOutExpo(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

/** Nombre de décimales affichées pour une note (7 → 0, 7.5 → 1, 7.25 → 2). */
export function decimalesDe(note: number): number {
  const s = String(note);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(2, s.length - i - 1);
}

/** Valeur intermédiaire du count-up de `depart` à `cible` à l'instant t ∈ [0, 1]. */
export function valeurCompteur(depart: number, cible: number, t: number): number {
  return depart + (cible - depart) * easeOutExpo(t);
}

/** Texte français d'une note (virgule décimale), au même format que la valeur finale. */
export function texteNote(v: number, decimales: number): string {
  return v.toFixed(decimales).replace(".", ",");
}

export interface Confetti {
  /** Position horizontale de départ, en % de la largeur. */
  gauche: number;
  /** Dérive horizontale finale (px). */
  cx: number;
  /** Chute verticale finale (px). */
  cy: number;
  /** Rotation finale (deg). */
  cr: number;
  /** Délai d'animation (ms). */
  delai: number;
  /** Index de couleur parmi 4 (accent, good, ok, bad). */
  couleur: number;
}

/** Paramètres déterministes du i-ème confetti. */
export function confetti(i: number): Confetti {
  return {
    gauche: 8 + ((i * 61) % 84),
    cx: ((i * 37) % 120) - 60,
    cy: 90 + ((i * 23) % 60),
    cr: (i % 2 ? 1 : -1) * (180 + i * 25),
    delai: (i % 5) * 30,
    couleur: i % 4,
  };
}
