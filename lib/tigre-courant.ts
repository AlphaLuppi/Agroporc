/**
 * Tigre qui traverse le bas de l'écran (thème Tigre) : calendrier et trajet,
 * purs pour être testés. `alea` ∈ [0, 1[ (Math.random en production).
 */

/** Écart entre deux départs : 10 à 15 s, soit 4 à 6 passages par minute. */
export const ECART_MIN_MS = 10_000;
export const ECART_MAX_MS = 15_000;

/** Part des passages de droite à gauche (le tigre est retourné). */
export const PART_RETOUR = 0.25;

/** Vitesse en largeurs de tigre par seconde, tirée à chaque passage : du
 * petit trot (pattes qui glissent un peu) au sprint. Au plus lent, la
 * traversée d'un écran 2560 px dure ~9 s : moins que l'écart minimal. */
export const VITESSE_MIN = 1.6;
export const VITESSE_MAX = 3.4;

export function ecartAvantPassage(alea: number): number {
  return Math.round(ECART_MIN_MS + alea * (ECART_MAX_MS - ECART_MIN_MS));
}

export interface Passage {
  /** 1 = vers la droite (sens du gif), -1 = vers la gauche. */
  sens: 1 | -1;
  deX: number;
  aX: number;
  dureeMs: number;
}

/** Trajet d'un tigre de largeur `largeur` sur un écran de `largeurEcran`, départ et arrivée hors champ. */
export function passage(largeurEcran: number, largeur: number, aleaSens: number, aleaVitesse: number): Passage {
  const sens = aleaSens < PART_RETOUR ? -1 : 1;
  const vitesse = VITESSE_MIN + aleaVitesse * (VITESSE_MAX - VITESSE_MIN);
  const gauche = -largeur;
  const droite = largeurEcran;
  return {
    sens,
    deX: sens === 1 ? gauche : droite,
    aX: sens === 1 ? droite : gauche,
    dureeMs: Math.round(((largeurEcran + largeur) / (largeur * vitesse)) * 1000),
  };
}
