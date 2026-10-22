/**
 * Géométrie d'un passage du coureur (pur, testé) : taille à l'écran, canvas, trajet d'un bord à
 * l'autre, durée, fenêtre de la bulle. Le canvas (transparent, en bas de l'écran) suit le coureur
 * par translation CSS : en 3D, la scène retranche l'avance du coureur (il reste au centre du
 * canvas) et le canvas avance d'autant de pixels, donc un pied posé reste immobile à l'écran.
 */

/** Taille du modèle (sommet des cheveux, m). */
export const TAILLE_M = 1.81;
/** Cadre du canvas en mètres de modèle : largeur (foulée + bras), hauteur (sol → au-dessus de la tête, rebond compris). */
export const CADRE_M = { largeur: 2.5, hauteur: 2.15, sousLeSol: 0.1 } as const;
/** Lacet du coureur vers la caméra (rad) : un léger 3/4 qui montre le visage sans casser le profil. */
export const LACET_CAMERA = (20 * Math.PI) / 180;

export interface Ecran { largeur: number; hauteur: number }

/** Hauteur du coureur à l'écran (px) : ≈ 22 % de la hauteur de fenêtre, bornée (mobile compris). */
export function hauteurCoureurPx(e: Ecran): number {
  const h = Math.round(e.hauteur * 0.22);
  return Math.max(110, Math.min(230, h, Math.round(e.largeur * 0.45)));
}

export interface PlanPassage {
  sens: 1 | -1;
  /** Pixels par mètre de modèle. */
  pxm: number;
  largeurCanvas: number;
  hauteurCanvas: number;
  /** Bord gauche du canvas (px) au départ et à l'arrivée : hors écran aux deux bouts. */
  depart: number;
  arrivee: number;
  /** Pixels d'écran par mètre d'avance du coureur (son axe est tourné de LACET_CAMERA). */
  pxParMetreAvance: number;
  /** Avance (m) au bout de laquelle le canvas est sorti de l'écran (comptée depuis `origine`). */
  avanceTotale: number;
  /** Avance (m) du coureur au départ du plan (≠ 0 après un redimensionnement en plein passage). */
  origine: number;
}

export function planPassage(e: Ecran, sens: 1 | -1): PlanPassage {
  const pxm = hauteurCoureurPx(e) / TAILLE_M;
  const largeurCanvas = Math.round(CADRE_M.largeur * pxm);
  const hauteurCanvas = Math.round(CADRE_M.hauteur * pxm);
  const depart = sens === 1 ? -largeurCanvas : e.largeur;
  const arrivee = sens === 1 ? e.largeur : -largeurCanvas;
  const pxParMetreAvance = pxm * Math.cos(LACET_CAMERA);
  return {
    sens, pxm, largeurCanvas, hauteurCanvas, depart, arrivee, pxParMetreAvance,
    avanceTotale: Math.abs(arrivee - depart) / pxParMetreAvance,
    origine: 0,
  };
}

/**
 * Fenêtre redimensionnée (ou écran tourné) en plein passage : nouveau plan pour le nouvel écran,
 * à la même part du trajet. Le coureur saute à la position équivalente au lieu de disparaître
 * en plein écran (ou de finir sa course hors de vue).
 */
export function replanifier(ancien: PlanPassage, e: Ecran, avance: number): PlanPassage {
  const p = planPassage(e, ancien.sens);
  return { ...p, origine: avance - avancement(ancien, avance) * p.avanceTotale };
}

/** Le canvas est sorti de l'écran. */
export function passageFini(p: PlanPassage, avance: number): boolean {
  return avance - p.origine >= p.avanceTotale;
}

/** Bord gauche du canvas pour une avance donnée (m). */
export function gaucheCanvas(p: PlanPassage, avance: number): number {
  return p.depart + p.sens * (avance - p.origine) * p.pxParMetreAvance;
}

/** Part du trajet parcourue, 0 → 1. */
export function avancement(p: PlanPassage, avance: number): number {
  return Math.max(0, Math.min(1, (avance - p.origine) / p.avanceTotale));
}

/**
 * La bulle « En marche ! » : une seule fois, pendant que le coureur traverse le premier tiers
 * de l'écran (assez tôt pour qu'on la lise avant qu'il sorte, même sur mobile).
 */
export const BULLE = { texte: "En marche !", debut: 0.18, fin: 0.5 } as const;
export function bulleVisible(p: PlanPassage, avance: number): boolean {
  const a = avancement(p, avance);
  return a >= BULLE.debut && a <= BULLE.fin;
}
