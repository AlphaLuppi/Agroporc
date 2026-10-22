/**
 * Cibles du lasso : tout personnage 3D à l'écran qui peut être attrapé (le tigre du thème Tigre,
 * le coureur de l'easter egg « macron »). Le lasso (app/components/LassoTigre.tsx) ne connaît que
 * cette interface : chaque personnage s'enregistre tant qu'il est à l'écran et fait lui-même le
 * lien avec sa scène (repères, collier, canvas déplacé). Tout est en px de la fenêtre.
 */

export interface Point { x: number; y: number }

/** Repères du personnage au moment de la prise, fixes pendant toute la capture. */
export interface PriseLasso {
  /** Pivot du personnage pendu (son centre de gravité, à l'œil). */
  centre: Point;
  /** Centre de la boucle une fois serrée (autour du cou du tigre, du poignet levé du coureur). */
  cou: Point;
  /** Nœud de la boucle : la corde en part, le personnage y est pendu. */
  noeud: Point;
  /** Axe de ce qu'elle serre à l'écran (unitaire) et rayon de la boucle serrée (px). */
  axe: Point;
  rayon: number;
}

/** Position imposée au personnage attrapé : son pivot et sa rotation à l'écran (rad, sens horaire). */
export interface TenueLasso { x: number; y: number; angle: number }

/** Ce que le lasso donne au personnage attrapé. */
export interface LienLasso {
  /** Appelée à chaque image de la scène du personnage, avant le dessin : la simulation y avance. */
  image(dt: number): TenueLasso | null;
  /** Le personnage disparaît (passage coupé, changement de thème) : le lasso lâche tout. */
  perdu(): void;
}

export interface CibleLasso {
  /** Taille du personnage à l'écran (px) : longueur de la corde, rayon de rebond. */
  taille(): number;
  /** Zone où la boucle l'attrape, null s'il n'est pas attrapable maintenant. */
  zone(): { x: number; y: number; w: number; h: number } | null;
  /** Attrape-le : sa scène appellera `lien.image` à chaque image ; null s'il ne se laisse pas prendre. */
  attraper(lien: LienLasso): PriseLasso | null;
  /** Nœud serré : la boucle de corde apparaît dans sa scène (autour du cou, du poignet). */
  serrer(): void;
  /** Retombé au sol, pivot en `x` : il se dégage et repart. */
  relacher(x: number): void;
  /** Tests en développement : geler la scène, avancer d'une image à la main. */
  geler?(v: boolean): void;
  avancer?(dt: number): void;
}

const cibles = new Set<CibleLasso>();

/** Enregistre une cible ; rend la fonction qui la retire. */
export function enregistrerCible(c: CibleLasso): () => void {
  cibles.add(c);
  return () => { cibles.delete(c); };
}

/** La cible sous la boucle arrivée en `p`, la plus récente d'abord (celle dessinée au-dessus). */
export function cibleSous(p: Point, touche: (p: Point, z: { x: number; y: number; w: number; h: number }) => boolean): CibleLasso | null {
  for (const c of [...cibles].reverse()) {
    const z = c.zone();
    if (z && z.w > 0 && touche(p, z)) return c;
  }
  return null;
}
