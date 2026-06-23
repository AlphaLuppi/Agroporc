import { tagsForPlat, type Famille, type Proteine } from "./quiz-tags";
import type { IngredientDetail } from "./db";

export type Mode = "sportif" | "goulaf";

/** Plat normalisé du pool (issu d'un plat du jour ou d'un plat de carte). */
export interface PoolPlat {
  plat: string;
  restaurant: string;
  prix: string;
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  ingredients_detail?: IngredientDetail[];
  /** Tags de classification générés par le LLM (prioritaires sur la déduction par mots-clés). */
  quiz_tags?: { envie?: string; cuisine?: string; lourdeur?: string };
}

export interface PlatCriteres {
  famille?: Famille;
  proteine?: Proteine;
}

export interface PlatResultat {
  resultat: PoolPlat | null;
  /** true = match exact des critères ; false = repli sur le plus proche. */
  exact: boolean;
}

// veau et agneau sont regroupés dans l'UI ("Veau / agneau") → critère interchangeable.
function memeProteine(a: Proteine, b: Proteine): boolean {
  if (a === b) return true;
  const groupe = new Set<Proteine>(["veau", "agneau"]);
  return groupe.has(a) && groupe.has(b);
}

function noteFor(p: PoolPlat, mode: Mode): number {
  const n = mode === "sportif" ? p.note : p.note_goulaf;
  return typeof n === "number" ? n : -1;
}

function meilleur(pool: PoolPlat[], mode: Mode): PoolPlat | null {
  if (pool.length === 0) return null;
  // Tri déterministe : note du mode, puis départage stable (restaurant, plat).
  return [...pool].sort(
    (a, b) =>
      noteFor(b, mode) - noteFor(a, mode) ||
      a.restaurant.localeCompare(b.restaurant) ||
      a.plat.localeCompare(b.plat)
  )[0];
}

/**
 * Filtre le pool par famille puis protéine, trie par note du mode, retourne le meilleur.
 * Repli : relâche la protéine, puis la famille (exact=false) si rien ne matche.
 */
export function choisirPlat(
  pool: PoolPlat[],
  criteres: PlatCriteres,
  mode: Mode
): PlatResultat {
  if (pool.length === 0) return { resultat: null, exact: false };

  const tagged = pool.map((p) => ({ p, tags: tagsForPlat(p) }));

  const matchFamille = (t: typeof tagged[number]) =>
    !criteres.famille || t.tags.famille === criteres.famille;
  const matchProteine = (t: typeof tagged[number]) =>
    !criteres.proteine || memeProteine(t.tags.proteine, criteres.proteine);

  const exact = tagged.filter((t) => matchFamille(t) && matchProteine(t));
  if (exact.length > 0) {
    return { resultat: meilleur(exact.map((t) => t.p), mode), exact: true };
  }

  const familleOnly = tagged.filter(matchFamille);
  if (familleOnly.length > 0) {
    return { resultat: meilleur(familleOnly.map((t) => t.p), mode), exact: false };
  }

  return { resultat: meilleur(pool, mode), exact: false };
}
