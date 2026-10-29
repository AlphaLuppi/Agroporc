/**
 * Durée de vie des débris (PUR, testé) : chaque bloc projeté par `rendu-debris.ts` vit `vie` s, puis rétrécit et s'enfonce dans le sol
 * pendant `fondu` s avant de disparaître (sa place dans l'anneau est alors libre). Les débris n'ont aucune collision : ils ne gênent que
 * la vue, d'où une durée de vie toujours bornée, courte pour les portes du mode zombies.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md (débris), 2026-10-28-zombies-bo1-design.md (portes)
 */

/** Profils de vie (s) : effondrement ou brèche de l'arène (gravats qui restent un moment), éclats d'une porte payante des zombies. */
export const VIE_DEBRIS = {
  effondrement: { vie: 35, fondu: 2.5 },
  porte: { vie: 2.2, fondu: 0.8 },
} as const;

export interface EtatVieDebris {
  /** facteur d'échelle du bloc (1 tant qu'il vit, puis vers 0) */
  echelle: number;
  /** de combien (m) le bloc s'enfonce sous sa position, en part de sa hauteur */
  enfoncement: number;
  /** le bloc a disparu : sa place peut resservir */
  fini: boolean;
}

/** État d'un bloc d'âge `age` (s) pour une vie de `vie` s et un fondu de `fondu` s (une vie infinie ne finit jamais). */
export function etatVieDebris(age: number, vie: number, fondu: number): EtatVieDebris {
  if (!Number.isFinite(vie) || age <= vie) return { echelle: 1, enfoncement: 0, fini: false };
  const k = fondu > 0 ? (age - vie) / fondu : 1;
  if (k >= 1) return { echelle: 0, enfoncement: 1, fini: true };
  // rétrécit en douceur et s'enfonce d'une demi-hauteur
  return { echelle: 1 - k * k, enfoncement: 0.5 * k, fini: false };
}
