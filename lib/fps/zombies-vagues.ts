/**
 * Mode zombies (tigres) : constantes et courbes de manche (PUR : aucune horloge, aucun hasard global, le hasard est injecté).
 * Toutes les fonctions prennent la manche `n` (à partir de 1) et, pour le nombre de tigres, le nombre de joueurs `j` (à partir de 1).
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Mode zombies — règles »)
 */

export const ZOMBIES = {
  // ---- salle et machine d'états ----
  /** joueurs au plus dans la salle zombies (lobby compris) */
  joueursMax: 8,
  /** durée du bilan avant le retour au lobby (ms) */
  finAffichageMs: 25_000,
  /** décompte de départ avant la manche 1 (ms) */
  decompteDepartMs: 8_000,
  /** les apparitions de la manche 1 attendent que tous les admis soient en jeu, au plus ce délai (ms), puis la grâce */
  attenteChargementMaxMs: 15_000,
  graceApresChargementMs: 3_000,
  /** pause entre deux manches (ms) */
  pauseMs: 10_000,
  /** argent de départ ($) */
  argentDepart: 500,
  /** un joueur à terre est éliminé au bout de ce délai (ms) s'il n'est pas relevé */
  terreMs: 45_000,
  /** relève : durée (s) en maintenant E, portée (m) d'armement, portée au-delà de laquelle elle s'annule */
  reanimationS: 3,
  reanimationPortee: 2.5,
  reanimationAnnulePortee: 3.2,
  /** PV d'un joueur relevé */
  reanimationPv: 50,
  /** tigres vivants au plus (client ET serveur) */
  plafondVivants: 24,
  // ---- tigres ----
  /** échelle du modèle du tigre (m de la carte par m du modèle) : ≈ 3 m du museau à la queue ; la brute est plus grosse */
  echelle: 2.7,
  echelleBrute: 3.4,
  /** grille de navigation : cases de 1,5 m, rayon de dégagement de 0,7 m */
  tailleCaseNav: 1.5,
  rayonNav: 0.7,
  /** rayon de collision d'un tigre (m) et hauteur passée à `resoudre` */
  rayonTigre: 0.6,
  hauteurTigre: 2,
  /** rotation maximale d'un tigre (rad/s) */
  rotationMax: 6,
  /** distance de séparation entre deux tigres (m) */
  separationM: 1.4,
  /** vision directe : un tigre qui voit un joueur à moins de cette distance (m) le vise sans suivre le champ */
  visionDirecteM: 15,
  /** intervalle (ms) entre deux contrôles de ligne de vue d'un tigre */
  periodeVisionMs: 150,
  /** champ de distance : recalcul au plus toutes les `periodeChampMs`, arrêt anticipé avec cette marge (unités de distance, 10 = 1 case) */
  periodeChampMs: 400,
  margeChamp: 100,
  /** durée (ms) du drapeau « en apparition » du snap */
  apparitionMs: 800,
  // ---- griffe ----
  /** le tigre arme sa griffe à moins de `griffePortee` m de la surface d'un joueur debout, la donne si le joueur est encore à `griffeMaxPortee` m */
  griffePortee: 1.7,
  griffeMaxPortee: 2.3,
  griffeArmeS: 0.4,
  griffeRechargeS: 1.0,
  // ---- touches ----
  /** marge (m) ajoutée à chaque sphère de touche (retard et mouvement du tigre) */
  margeTouche: 0.25,
  /** les dégâts à la tête sont multipliés par ce facteur (non cumulé avec le multiplicateur de tête de l'arme) */
  multTete: 1.5,
  /** historique de positions par tigre (ms), rejeu au plus (ms) d'un tir et d'un coup de mêlée, dédoublonnage des positions (m) */
  historiqueMs: 400,
  rejeuMs: 300,
  rejeuMeleeMs: 200,
  dedoublonnageM: 0.5,
  // ---- achats ----
  /** soin réutilisable après ce délai (s) par joueur */
  soinRechargeS: 20,
  /** chargeurs de réserve par arme (infinis dans l'arène) */
  ravitaillementChargeurs: 5,
  /** rayon d'action d'un achat (m) et portée d'achat d'une porte (m) */
  rayonAchat: 2.5,
  porteeAchatPorte: 3,
} as const;

/** Types de tigres : rôdeur (0), sprinteur (1), brute (2). */
export type TypeZombie = 0 | 1 | 2;

const arrondi10 = (x: number): number => Math.round(x / 10) * 10;

/** Nombre total de tigres de la manche `n` pour `j` joueurs : round((6 + 2,2 (n−1) + 0,12 (n−1)²) × (1 + 0,45 (j−1))). */
export function totalManche(n: number, j: number): number {
  const m = n - 1;
  return Math.round((6 + 2.2 * m + 0.12 * m * m) * (1 + 0.45 * (Math.max(1, j) - 1)));
}

/** PV d'un tigre de la manche `n` : base 100 + 50 (n−1) jusqu'à la 9ᵉ, puis 550 × 1,1^(n−9) ; × 0,8 pour un sprinteur, × 4 pour une brute. */
export function pvZombie(n: number, type: TypeZombie = 0): number {
  const base = n <= 9 ? 100 + 50 * (n - 1) : Math.round(550 * 1.1 ** (n - 9));
  return Math.round(type === 1 ? base * 0.8 : type === 2 ? base * 4 : base);
}

/**
 * Vitesse de marche (m/s) d'un tigre de la manche `n` : 4,2 (n ≤ 2), 5,5 (3–4), 7 (5–8), 8,6 (≥ 9), ± 8 % selon `alea` ∈ [0, 1[ (injecté),
 * × 1,2 pour un sprinteur, × 0,8 pour une brute. Toujours sous le sprint des joueurs (12,5).
 */
export function vitesseZombie(n: number, type: TypeZombie, alea: number): number {
  const base = n <= 2 ? 4.2 : n <= 4 ? 5.5 : n <= 8 ? 7 : 8.6;
  const a = Math.min(1, Math.max(0, alea));
  return base * (1 + 0.08 * (2 * a - 1)) * (type === 1 ? 1.2 : type === 2 ? 0.8 : 1);
}

/** Part de sprinteurs parmi les tigres de la manche `n` (hors brutes) : 0 avant la manche 3, puis min(0,5 ; 0,1 (n−2)). */
export function proportionSprinteurs(n: number): number {
  return n < 3 ? 0 : Math.min(0.5, 0.1 * (n - 2));
}

/** Brutes de la manche `n` : floor(n / 5) à partir de la manche 5 (elles apparaissent en dernier). */
export function nbBrutes(n: number): number {
  return n < 5 ? 0 : Math.floor(n / 5);
}

/** Dégâts d'une griffe à la manche `n` : min(55, 30 + 2 (n−1)). */
export function degatsGriffe(n: number): number {
  return Math.min(55, 30 + 2 * (n - 1));
}

/** Intervalle (s) entre deux apparitions : max(0,35 ; 2,0 − 0,12 n). */
export function intervalleApparition(n: number): number {
  return Math.max(0.35, 2.0 - 0.12 * n);
}

/** Tigres vivants au plus : min(24, 6 + 3 j + 2 n). */
export function plafondVivantsManche(n: number, j: number): number {
  return Math.min(ZOMBIES.plafondVivants, 6 + 3 * Math.max(1, j) + 2 * n);
}

/** Coefficient d'argent de la manche : min(2, 1 + 0,04 (n−1)). */
export function coefGain(n: number): number {
  return Math.min(2, 1 + 0.04 * (n - 1));
}

export interface OptionsGain { tete?: boolean; melee?: boolean }

/** Gain d'un tir (une fois par tir) ou d'un coup de mêlée qui touche un tigre : 10 $ × coefficient, arrondi à 10. */
export function gainTouche(n: number, _opts: OptionsGain = {}): number {
  return arrondi10(10 * coefGain(n));
}

/** Gain d'un kill : 60 $ au corps, 100 $ à la tête ou à la mêlée, × coefficient, arrondi à 10. */
export function gainKill(n: number, opts: OptionsGain = {}): number {
  return arrondi10((opts.tete || opts.melee ? 100 : 60) * coefGain(n));
}

/** Bonus de fin de manche, versé à chaque joueur debout : 100 + 25 n. */
export function bonusFinManche(n: number): number {
  return 100 + 25 * n;
}

/** Échelle du modèle d'un tigre selon son type (la brute est plus grosse). */
export function echelleZombie(type: TypeZombie): number {
  return type === 2 ? ZOMBIES.echelleBrute : ZOMBIES.echelle;
}

export interface CompositionManche { total: number; rodeurs: number; sprinteurs: number; brutes: number }

/** Répartition des tigres de la manche `n` pour `j` joueurs : brutes d'abord retirées du total, puis la part de sprinteurs du reste. */
export function compositionManche(n: number, j: number): CompositionManche {
  const total = totalManche(n, j);
  const brutes = Math.min(nbBrutes(n), total);
  const sprinteurs = Math.round((total - brutes) * proportionSprinteurs(n));
  return { total, rodeurs: total - brutes - sprinteurs, sprinteurs, brutes };
}

/**
 * Ordre d'apparition des types d'une manche : rôdeurs et sprinteurs mêlés (mélange de Fisher-Yates avec le hasard injecté `alea`),
 * brutes en dernier.
 */
export function typesManche(n: number, j: number, alea: () => number): TypeZombie[] {
  const c = compositionManche(n, j);
  const types: TypeZombie[] = [];
  for (let i = 0; i < c.rodeurs; i++) types.push(0);
  for (let i = 0; i < c.sprinteurs; i++) types.push(1);
  for (let i = types.length - 1; i > 0; i--) {
    const k = Math.min(i, Math.floor(alea() * (i + 1)));
    [types[i], types[k]] = [types[k], types[i]];
  }
  for (let i = 0; i < c.brutes; i++) types.push(2);
  return types;
}
