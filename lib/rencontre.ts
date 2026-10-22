/**
 * Rencontre du tigre (thème Tigre, app/components/Tigre3D.tsx) et de Macron (code « macron »,
 * app/components/MacronEasterEgg.tsx) : quand les deux sont à l'écran, le tigre court se poster
 * sur le trajet de Macron, se dresse et le frappe d'un coup de batte. Sans React ni three.
 *
 * Deux parties :
 * - un canal en mémoire (`canalRencontre`) où chaque scène publie à chaque image son état à
 *   l'écran (présence, centre en px de page, sens, vitesse, disponibilité), et où passent les
 *   messages ponctuels (impact du coup, annulation de la rencontre),
 * - des fonctions pures qui décident : `planEmbuscade` (où se poster, ou rien si aucun point
 *   n'est atteignable à temps dans l'écran) et `declencherFrappe` (quand lancer le coup).
 *
 * Le tigre attend Macron, et non l'inverse : la course de Macron ne sait que courir, elle n'a
 * aucune pose debout immobile. Le tigre arrive donc assez tôt pour s'arrêter, se tourner vers lui,
 * se dresser et armer la batte, puis lance le coup quand Macron entre à portée.
 */

export type Personnage = "tigre" | "macron";

/** Ce qu'une scène publie d'elle à chaque image. */
export interface EtatPersonnage {
  /** Au moins en partie à l'écran. */
  present: boolean;
  /** Abscisse du centre du corps (px de page). */
  x: number;
  /** Sens de course : 1 vers la droite, -1 vers la gauche. */
  sens: 1 | -1;
  /** Vitesse d'avance (px/s, ≥ 0). */
  vitesse: number;
  /**
   * Prêt pour une rencontre. Macron : pas encore frappé pendant ce passage. Tigre : aucune
   * réaction en cours (sauf la batte de cette rencontre).
   */
  disponible: boolean;
  /** Numéro du passage : une rencontre par passage de Macron. */
  passage: number;
  /** Demi-épaisseur du corps dans le sens de course (px) : la batte le touche à cette distance de son centre. */
  rayon: number;
}

export type MessageRencontre =
  | { type: "etat"; qui: Personnage; etat: EtatPersonnage | null }
  /** La batte touche Macron (publié par le tigre à l'instant du contact). */
  | { type: "impact" }
  /** Rencontre abandonnée (démontage, changement de thème, onglet caché) : chacun reprend son passage. */
  | { type: "annulation" };

export interface Canal {
  publier(m: MessageRencontre): void;
  /** Abonnement à tous les messages, retourne le désabonnement. */
  sur(f: (m: MessageRencontre) => void): () => void;
  /** Dernier état publié par un personnage (null : absent, ou jamais publié). */
  etat(qui: Personnage): EtatPersonnage | null;
  /** Oublie états et abonnés (tests). */
  reinitialiser(): void;
}

export function creerCanal(): Canal {
  let abonnes: Array<(m: MessageRencontre) => void> = [];
  const etats: Record<Personnage, EtatPersonnage | null> = { tigre: null, macron: null };
  return {
    publier(m) {
      if (m.type === "etat") etats[m.qui] = m.etat;
      // Copie : un abonné qui se désabonne pendant la diffusion n'en fait pas sauter un autre.
      for (const f of [...abonnes]) f(m);
    },
    sur(f) {
      abonnes.push(f);
      return () => { abonnes = abonnes.filter((x) => x !== f); };
    },
    etat: (qui) => etats[qui],
    reinitialiser() {
      abonnes = [];
      etats.tigre = null;
      etats.macron = null;
    },
  };
}

/** Le canal partagé par les deux scènes de la page. */
export const canalRencontre: Canal = creerCanal();

export interface ParamsEmbuscade {
  /**
   * Tigre : centre, sens de course, vitesse maximale (px/s), et distance d'arrêt (px) : lancé, il
   * ne peut pas s'arrêter plus près que `arret` devant lui (il dépasserait le point).
   */
  tigre: { x: number; sens: 1 | -1; vitesseMax: number; arret?: number };
  macron: { x: number; sens: 1 | -1; vitesse: number };
  largeurEcran: number;
  /** Distance (px) entre le centre du tigre et le centre de Macron au contact. */
  portee: number;
  /** Marges (px) : le tigre posté reste entier à l'écran, Macron est à l'écran au contact. */
  margeTigre: number;
  margeMacron: number;
  /** Arrêt, se tourner vers Macron, se dresser et armer la batte (s), accélération comprise. */
  tPreparation: number;
  /** Un demi-tour en plus (s) : pour repartir vers le point, ou pour faire face à Macron une fois arrivé. */
  tDemiTour: number;
  /** Du signal du coup au contact (s). */
  tElan: number;
  /** Avance de sécurité (s) : le tigre est armé au moins ce temps avant le signal. */
  tMarge: number;
  /** Pas de l'échantillonnage du trajet de Macron (px). */
  pas?: number;
}

export interface PlanEmbuscade {
  /** Où se poster (centre du tigre, px de page). */
  x: number;
  /** Sens dans lequel il frappe : vers Macron (l'inverse du sens de course de Macron). */
  face: 1 | -1;
  /** Arrivée de Macron au contact et préparation du tigre (s depuis maintenant). */
  tContact: number;
  tTigre: number;
}

/**
 * Point d'embuscade sur le trajet de Macron, devant lui : le plus proche de Macron (la rencontre
 * la plus tôt) que le tigre atteint à temps, galop ou éclair compris, demi-tours comptés. Null si
 * aucun point de l'écran ne convient : pas de rencontre, chacun continue son passage.
 */
export function planEmbuscade(p: ParamsEmbuscade): PlanEmbuscade | null {
  const { tigre: T, macron: M } = p;
  if (!(M.vitesse > 1) || !(T.vitesseMax > 1)) return null;
  const sM = M.sens;
  const face: 1 | -1 = sM === 1 ? -1 : 1;
  const pas = p.pas ?? 2;
  // Bornes du point P (centre du tigre) : tigre entier à l'écran, Macron à l'écran au contact
  // (centre de Macron au contact : P − sM · portée).
  let min = p.margeTigre, max = p.largeurEcran - p.margeTigre;
  min = Math.max(min, p.margeMacron + sM * p.portee);
  max = Math.min(max, p.largeurEcran - p.margeMacron + sM * p.portee);
  if (min > max) return null;
  // Du plus proche de Macron au plus loin, dans son sens de course.
  const n = Math.floor((max - min) / pas);
  for (let k = 0; k <= n; k++) {
    const P = sM === 1 ? min + k * pas : max - k * pas;
    const contact = P - sM * p.portee;
    const avant = (contact - M.x) * sM;
    if (avant <= 0) continue;
    const tContact = avant / M.vitesse;
    const d = P - T.x;
    const devant = d * T.sens, arret = T.arret ?? 0;
    // Devant lui mais plus près que sa distance d'arrêt : il le dépasserait.
    if (devant >= 0 && devant < arret - 1) continue;
    const dir: 1 | -1 = Math.abs(d) < 1 ? T.sens : d > 0 ? 1 : -1;
    // Demi-tours : repartir dans l'autre sens (après s'être arrêté), puis se tourner vers Macron
    // une fois arrivé.
    const demiTours = (dir !== T.sens ? 1 : 0) + (dir !== face ? 1 : 0);
    const chemin = devant >= 0 ? devant : -devant + 2 * arret;
    const tTigre = chemin / T.vitesseMax + p.tPreparation + demiTours * p.tDemiTour;
    if (tTigre + p.tElan + p.tMarge <= tContact) return { x: P, face, tContact, tTigre };
  }
  return null;
}

export type DecisionFrappe = "attendre" | "frapper" | "trop-tard";

/**
 * Tigre posté et armé : lance le coup quand d − v × t atteint la portée (d : distance du tigre à
 * Macron devant lui, v : vitesse de Macron, t : élan du coup jusqu'au contact), pour que le corps
 * de Macron arrive sur la batte pendant le coup. Trop tard si Macron l'a dépassé, ou s'il est
 * déjà si près que la batte arriverait derrière lui.
 */
export function declencherFrappe(p: {
  xTigre: number; face: 1 | -1; xMacron: number; vitesseMacron: number; tElan: number; portee: number;
}): DecisionFrappe {
  const d = (p.xMacron - p.xTigre) * p.face;
  const restant = d - p.vitesseMacron * p.tElan;
  if (d <= 0 || restant < p.portee * 0.5) return "trop-tard";
  return restant <= p.portee ? "frapper" : "attendre";
}
