/**
 * Tigre qui traverse le bas de l'écran (thème Tigre) : calendrier, tirage
 * des événements rares et trajet, purs pour être testés. Les `alea*` sont
 * dans [0, 1[ (Math.random en production).
 */

/** Écart entre deux départs : 10 à 15 s, soit 4 à 6 passages par minute. */
export const ECART_MIN_MS = 10_000;
export const ECART_MAX_MS = 15_000;

/** Part des passages de droite à gauche (le tigre est retourné). */
export const PART_RETOUR = 0.25;

/**
 * Événements rares : « eclair » = tigre lancé à pleine vitesse, « famille » =
 * une mère au petit trot suivie de ses petits. Le reste du temps, « normal ».
 */
export type Evenement = "normal" | "eclair" | "famille";
export const TAUX_ECLAIR = 0.1;
export const TAUX_FAMILLE = 0.1;

/**
 * Vitesse en largeurs de tigre (adulte) par seconde, tirée à chaque passage.
 * Au plus lent, la traversée d'un écran 2560 px dure moins que l'écart minimal,
 * famille comprise (le groupe est plus large qu'un tigre seul).
 */
export const VITESSES: Record<Evenement, readonly [number, number]> = {
  normal: [1.6, 3.4],
  eclair: [9, 12],
  famille: [1.9, 2.3],
};

/** Petits d'une famille : nombre, taille relative à la mère, écart entre eux. */
export const PETITS_MIN = 2;
export const PETITS_MAX = 4;
export const ECHELLE_PETIT = 0.36;

export function ecartAvantPassage(alea: number): number {
  return Math.round(ECART_MIN_MS + alea * (ECART_MAX_MS - ECART_MIN_MS));
}

export function tirerEvenement(alea: number): Evenement {
  if (alea < TAUX_ECLAIR) return "eclair";
  if (alea < TAUX_ECLAIR + TAUX_FAMILLE) return "famille";
  return "normal";
}

export function nombrePetits(alea: number): number {
  return PETITS_MIN + Math.floor(alea * (PETITS_MAX - PETITS_MIN + 1));
}

export interface Passage {
  /** 1 = vers la droite (sens du gif), -1 = vers la gauche. */
  sens: 1 | -1;
  deX: number;
  aX: number;
  dureeMs: number;
}

/**
 * Trajet d'un groupe large de `largeurGroupe` (le tigre seul, ou la mère et
 * ses petits) dont l'adulte mesure `largeurTigre`, sur un écran de
 * `largeurEcran` : départ et arrivée hors champ.
 */
export function passage(
  largeurEcran: number,
  largeurGroupe: number,
  largeurTigre: number,
  evenement: Evenement,
  aleaSens: number,
  aleaVitesse: number,
): Passage {
  const sens = aleaSens < PART_RETOUR ? -1 : 1;
  const [min, max] = VITESSES[evenement];
  const vitesse = min + aleaVitesse * (max - min);
  const gauche = -largeurGroupe;
  const droite = largeurEcran;
  return {
    sens,
    deX: sens === 1 ? gauche : droite,
    aX: sens === 1 ? droite : gauche,
    dureeMs: Math.round(((largeurEcran + largeurGroupe) / (largeurTigre * vitesse)) * 1000),
  };
}
