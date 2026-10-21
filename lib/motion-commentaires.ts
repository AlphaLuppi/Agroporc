/**
 * Logique pure des animations du lot « commentaires » (CommentSection, CommentForm,
 * MacrosPanel) : easing du count-up, formatage intermédiaire,
 * répartition des calories, gerbe de particules, compteur de caractères.
 * Aucune valeur aléatoire : tout est dérivé des entrées (pas de mismatch SSR).
 */

/** Vrai si le visiteur demande moins d'animations (toujours faux côté serveur). */
export function prefereMoinsDeMouvement(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Ease-out cubique, borné à [0, 1]. */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Nombre de décimales d'une valeur (0 pour un entier, au plus 2). */
export function decimales(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(2, s.length - i - 1);
}

/**
 * Valeur affichée pendant un count-up de 0 à `cible`, à la progression `t` (0 → 1).
 * Garde la précision de la cible (pas de « 12.3456 » transitoire) et vaut exactement
 * `cible` à t = 1.
 */
export function valeurCountUp(cible: number, t: number): string {
  if (!Number.isFinite(cible)) return String(cible);
  if (t >= 1) return String(cible);
  const d = decimales(cible);
  const v = cible * easeOutCubic(t);
  return d === 0 ? String(Math.round(v)) : v.toFixed(d);
}

export interface RepartitionCalories {
  proteines: number;
  glucides: number;
  lipides: number;
}

/**
 * Part des calories apportée par chaque macro (P ×4, G ×4, L ×9), en pourcentages
 * entiers dont la somme fait 100 (méthode du plus fort reste).
 * `null` si une valeur manque, est négative ou si le total est nul.
 */
export function repartitionCalories(
  proteines_g: number | null | undefined,
  glucides_g: number | null | undefined,
  lipides_g: number | null | undefined
): RepartitionCalories | null {
  const vals = [proteines_g, glucides_g, lipides_g];
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return null;
  const kcal = [(proteines_g as number) * 4, (glucides_g as number) * 4, (lipides_g as number) * 9];
  const total = kcal[0] + kcal[1] + kcal[2];
  if (total <= 0) return null;
  const bruts = kcal.map((k) => (k / total) * 100);
  const entiers = bruts.map(Math.floor);
  let reste = 100 - entiers.reduce((a, b) => a + b, 0);
  const ordre = bruts
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; reste > 0; k = (k + 1) % ordre.length, reste--) entiers[ordre[k].i]++;
  return { proteines: entiers[0], glucides: entiers[1], lipides: entiers[2] };
}

/** Délai d'un élément dans une entrée en cascade, plafonné (en ms). */
export function delaiCascade(index: number, pasMs: number, plafondMs: number): number {
  return Math.min(Math.max(0, index) * pasMs, plafondMs);
}

/** Particules d'une gerbe : n directions régulières (i × 360/n degrés), arrondies au pixel. */
export function gerbe(n: number, rayon: number): { dx: number; dy: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    // `+ 0` évite les -0 (rendu « -0px »)
    return { dx: Math.round(Math.cos(a) * rayon) + 0, dy: Math.round(Math.sin(a) * rayon) + 0 };
  });
}

export type EtatCompteur = "cache" | "visible" | "limite";

/** Compteur « N/500 » : caché jusqu'à `seuil`, en alerte à partir de `max - 20`. */
export function etatCompteur(longueur: number, max = 500, seuil = 400): EtatCompteur {
  if (longueur <= seuil) return "cache";
  return longueur >= max - 20 ? "limite" : "visible";
}
