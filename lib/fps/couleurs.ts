// Couleurs des joueurs au-delà de la palette de `match.ts` : le battle royale accueille 50 joueurs
// pour 16 couleurs. Fonctions PURES, sans hasard ni horloge : le rang décide de tout.

/** Pas d'angle d'or (degrés) : deux rangs voisins sont toujours loin l'un de l'autre sur le cercle des teintes. */
export const ANGLE_D_OR = 137.50776405003785;

/** Paliers de luminosité (%) parcourus en boucle, pour séparer les teintes proches d'un rang à l'autre. */
const LUMINOSITES: readonly number[] = [58, 46, 70, 52, 64];
/** Saturations (%) alternées, assez vives pour se détacher du fil de fer sombre de l'arène. */
const SATURATIONS: readonly number[] = [85, 70];

function hex2(n: number): string {
  return Math.round(n).toString(16).padStart(2, "0");
}

/** HSL (h en degrés, s et l en %) vers `#rrggbb`. */
export function hslVersHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lum = l / 100;
  const teinte = ((h % 360) + 360) % 360;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number): number => {
    const k = (n + teinte / 30) % 12;
    return 255 * (lum - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
}

/**
 * Couleur `#rrggbb` du joueur de rang `rang` (0 pour le premier). La teinte avance d'un angle d'or à
 * chaque rang ; luminosité et saturation alternent pour éviter les quasi-doublons. Un rang non entier
 * ou négatif est ramené à l'entier positif le plus proche.
 */
export function couleurJoueur(rang: number): string {
  const r = Number.isFinite(rang) ? Math.max(0, Math.floor(rang)) : 0;
  const h = (r * ANGLE_D_OR + 11) % 360;
  return hslVersHex(h, SATURATIONS[r % SATURATIONS.length], LUMINOSITES[r % LUMINOSITES.length]);
}
