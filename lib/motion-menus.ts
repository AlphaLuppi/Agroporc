/**
 * Logique pure des animations de l'accueil (lot « menus ») : direction de slide, count-up,
 * FLIP, drag-to-dismiss, trajectoires. Aucune dépendance au DOM : testée par vitest.
 */

/** Sens du slide quand on passe d'un jour à l'autre : 1 = vers la droite (jour suivant), -1 = précédent, 0 = rien. */
export function directionJour(precedent: number, actuel: number): -1 | 0 | 1 {
  if (actuel === precedent) return 0;
  return actuel > precedent ? 1 : -1;
}

/** Décalage d'entrée de la vue Jour : horizontal quand on change de jour, petite montée sinon. */
export function decalageEntree(dir: -1 | 0 | 1, distance = 24, montee = 8): { dx: number; dy: number } {
  return dir === 0 ? { dx: 0, dy: montee } : { dx: dir * distance, dy: 0 };
}

/** Easing « out cubic » borné à [0, 1]. */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Valeur affichée pendant un count-up, arrondie à une décimale. */
export function valeurCompteur(de: number, a: number, t: number): number {
  return Math.round((de + (a - de) * easeOutCubic(t)) * 10) / 10;
}

/** Format du compteur : toujours une décimale, virgule française (« 7,4 »). */
export function fmtCompteur(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

/** Lit la valeur calculée de `translate` (« none », « 12px », « 12px -4px », « 1px 2px 0px »). */
export function lireTranslate(valeur: string | null | undefined): { x: number; y: number } {
  if (!valeur || valeur === "none") return { x: 0, y: 0 };
  const [x = "0", y = "0"] = valeur.trim().split(/\s+/);
  const n = (s: string) => (s.endsWith("px") ? parseFloat(s) || 0 : 0);
  return { x: n(x), y: n(y) };
}

export interface Pos {
  x: number;
  y: number;
}

/**
 * Décalage FLIP d'un élément : de sa position visuelle précédente vers sa nouvelle position de
 * layout. `null` si l'élément est nouveau ou n'a (presque) pas bougé.
 */
export function deltaFlip(avant: Pos | undefined, apres: Pos, seuil = 1): Pos | null {
  if (!avant) return null;
  const dx = avant.x - apres.x;
  const dy = avant.y - apres.y;
  if (Math.abs(dx) < seuil && Math.abs(dy) < seuil) return null;
  return { x: dx, y: dy };
}

/** Position suivie par la feuille pendant le drag : libre vers le bas, résistance ×0,5 (plafonnée) vers le haut. */
export function suiviDoigt(dy: number, plafondHaut = 40): number {
  return dy >= 0 ? dy : Math.max(-plafondHaut, dy * 0.5);
}

/** Au relâché : on ferme au-delà de `seuil` px ou d'une vitesse vers le bas > `vitesseMin` px/ms. */
export function decisionLacher(dy: number, vitesse: number, seuil = 90, vitesseMin = 0.5): "fermer" | "retour" {
  return dy > seuil || (dy > 10 && vitesse > vitesseMin) ? "fermer" : "retour";
}

/**
 * Étincelles déterministes (pas de hasard : rendu identique serveur / client), réparties sur une
 * ellipse `rx` × `ry` (un bouton est plus large que haut). Une sur deux va un peu moins loin.
 */
export function etincelles(n = 8, rx = 58, ry = 30): { angle: number; x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (360 / n) * i;
    const k = i % 2 === 0 ? 1 : 0.72;
    const rad = (angle * Math.PI) / 180;
    const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
    return { angle, x: r1(Math.cos(rad) * rx * k), y: r1(Math.sin(rad) * ry * k) };
  });
}

/** Point d'une courbe de Bézier quadratique de `a` à `b`, dont le sommet monte de `hauteur` px. */
export function pointArc(a: Pos, b: Pos, t: number, hauteur = 80): Pos {
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - hauteur };
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Rang d'entrée plafonné : au-delà de `max`, tout arrive en même temps. */
export function rangStagger(i: number, max = 8): number {
  return Math.max(0, Math.min(i, max));
}
