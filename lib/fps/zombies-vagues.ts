/**
 * Mode zombies (tigres) : constantes et courbes de manche (PUR : aucune horloge, aucun hasard global, le hasard est injecté).
 * Toutes les fonctions prennent la manche `n` (à partir de 1) et, pour le nombre de tigres, le nombre de joueurs `j` (à partir de 1).
 * v7 : règles de Call of Duty Black Ops 1 Zombies, relevées dans ses scripts (`_zombiemode.gsc`, `_zombiemode_spawner.gsc`,
 * `_zombiemode_powerups.gsc`, `_zombiemode_ai_dogs.gsc`), plus les tigres dorés, les tigres chefs et les difficultés.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Équilibrage », « Points », « Bonus », « Manches du Truck Muche »)
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
  /** pause entre deux manches (ms, BO1 `zombie_between_round_time`) */
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
  /** tigres vivants au plus (client ET serveur, BO1 `zombie_ai_limit`) */
  plafondVivants: 24,
  // ---- santé des joueurs (salle zombies) ----
  /** PV max sans atout, avec le Gratin (Juggernog) */
  pvMax: 100,
  pvMaxGratin: 250,
  /** régénération : délai sans dégât (ms), PV par seconde */
  regenDelaiMs: 3_000,
  regenPvParS: 60,
  // ---- tigres ----
  /** échelle du modèle du tigre (m de la carte par m du modèle) : ≈ 3 m du museau à la queue ; le chef est plus gros, le petit plus petit */
  echelle: 2.7,
  echelleBrute: 3.4,
  echellePetit: 1.5,
  /** grille de navigation : cases de 1 m, rayon de dégagement de 0,55 m (les portes intérieures font 2,6 m, le passage Ouest est étroit) */
  tailleCaseNav: 1.0,
  rayonNav: 0.55,
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
  /** durée (ms) du drapeau « en apparition » du snap (tigre arrivé par une fenêtre ou par un quai) */
  apparitionMs: 800,
  /** sortie du sol : le tigre émerge pendant cette durée (ms), immobile et intouchable par les griffes */
  sortieSolMs: 1_600,
  /** saut d'une fenêtre (ms), du point dehors au point dedans */
  sautFenetreMs: 1_000,
  /** vitesses (m/s) : marche, course, sprint, rampant (BO1 : un sprinteur va à peu près à la course du joueur) ; ± 6 % par tigre */
  vitesses: [3.0, 6.2, 8.4, 1.4] as readonly number[],
  variationVitesse: 0.06,
  /**
   * Petits du Truck Muche (les chiens de BO1, qui sprintent dès l'apparition) : vitesse (m/s) au-dessus du sprint du joueur (12,5 m/s : on ne
   * les sème plus qu'en glissade), morsure (dégâts « plat du jour »), armement court de la morsure (s) et recharge (s) : ≈ 1,5 morsure par
   * seconde, deux petits couchent 100 PV en 2 s. Pendant l'armement, le petit suit sa cible à `morsureRotationMax` (rad/s) ; hors armement il
   * vire à `rotationPetit` (rayon de virage ≈ 1,2 m) ; deux petits se serrent jusqu'à `separationPetitM`.
   */
  vitessePetit: 13.5,
  morsurePetit: 30,
  morsureArmeS: 0.22,
  morsureRechargeS: 0.45,
  morsureRotationMax: 5,
  rotationPetit: 11,
  separationPetitM: 0.9,
  /**
   * Mini Truck Muche (les chiens de feu de BO1, qui explosent) : un petit camion qui fonce sur le joueur le plus proche sans ralentir, vire
   * mal (rayon de virage ≈ 5,6 m : un pas de côté le fait passer à côté, son souffle seul vous rattrape), allume sa mèche (klaxon aigu) à `contactM` m d'un joueur, ralentit à `vitesseMeche` × sa vitesse et saute
   * `mecheS` s plus tard, ou aussitôt à `contactImmediatM` m. Abattu, il saute aussi (souffle d'autant plus dangereux qu'on l'a laissé
   * approcher). Souffle de `souffleM` m : `souffleJoueur` PV au centre à `souffleJoueurBord` au bord (difficulté « plat du jour »),
   * `souffleTigre` à `souffleTigreBord` pour les tigres (un mini Truck abattu au milieu des petits les emporte, et les autres mini Trucks).
   * L'échelle de 3 cale le corps (`capsuleTigre`, ≈ 2 m de long) sur le modèle : le Truck Muche réduit à 0,3.
   */
  miniTruck: {
    vitesse: 14,
    rotation: 2.5,
    separationM: 1.8,
    contactM: 2.2,
    contactImmediatM: 1.5,
    mecheS: 0.3,
    vitesseMeche: 0.55,
    souffleM: 4.5,
    souffleJoueur: 80,
    souffleJoueurBord: 15,
    souffleTigre: 1600,
    souffleTigreBord: 400,
    echelle: 3,
    /** PV : cette part de ceux d'un petit de la même livraison */
    partPv: 0.5,
  },
  // ---- griffe (coup de patte qu'on voit venir et qu'on esquive, comme les attaques des zombies de BO1) ----
  /**
   * Instant (s) du contact après le début du coup : le tigre se cabre et lève la patte pendant cet armement (le geste `griffe` du client
   * claque à ce même instant), puis la patte frappe. Le serveur ne touche qu'à cet instant, là où est la patte : reculer ou s'écarter
   * pendant l'armement esquive.
   */
  griffeArmeS: 0.55,
  /** pendant l'armement, le tigre suit sa cible à cette vitesse de rotation au plus (rad/s, ≈ 19° sur l'armement) : un pas de côté l'esquive */
  griffeRotationMax: 0.6,
  /**
   * La patte balaie l'axe du tigre de `griffePatteA[0]` à `griffePatteA[1]` (unités du modèle, × l'échelle du tigre, depuis son centre) ;
   * le coup touche un joueur dont l'axe passe à moins de `griffeRayonM` m + `griffeRayonPatte` × échelle de ce segment.
   */
  griffePatteA: [0.18, 0.5] as readonly number[],
  griffeRayonM: 0.4,
  griffeRayonPatte: 0.06,
  /** le tigre lance son coup quand le joueur est à moins de la portée de la patte moins cette marge (m) : immobile, il est touché */
  griffeMargeDepartM: 0.25,
  /** à la fenêtre, le tigre passe la patte entre les planches : portée allongée d'autant (m), le mur le tient à 1,7 m du bord */
  allongeFenetreM: 1.0,
  griffeRechargeS: 1.0,
  /** dégâts de griffe (difficulté « plat du jour ») et du tigre chef */
  griffe: 50,
  griffeChef: 80,
  // ---- barricades ----
  /**
   * planches par fenêtre ; arrachage d'une planche (s) selon l'allure ; repose (BO1 `blocker_trigger_think` : une planche, puis `wait(1)`,
   * tant que la touche est tenue) : la première `reposePremiereS` après l'appui, les suivantes toutes les `reposeS` s (jamais plus vite,
   * même en relâchant et réappuyant) ; portée (m)
   */
  planches: 6,
  arrachageS: [1.4, 1.1, 0.9, 1.6] as readonly number[],
  reposeS: 0.9,
  reposePremiereS: 0.2,
  reposePortee: 2.2,
  /** un tigre « à la fenêtre » à moins de cette distance (m) du point dehors */
  fenetreArriveeM: 0.8,
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
  /** chargeurs de réserve par arme (amélioré : plus), infinis dans l'arène */
  ravitaillementChargeurs: 5,
  ravitaillementChargeursAmeliore: 8,
  /** rayon d'action d'un achat (m) et portée d'achat d'une porte (m) */
  rayonAchat: 2.5,
  porteeAchatPorte: 3,
  // ---- bonus ----
  /** un bonus reste au sol `bonusSolideMs` puis clignote `bonusClignoteMs` ; ramassé à `bonusRayon` m ; insta-kill, double points, soldes */
  bonusSolideMs: 15_000,
  bonusClignoteMs: 11_000,
  bonusRayon: 1.6,
  bonusDureeMs: 30_000,
  bonusParManche: 4,
  /** BO1 : un bonus quand le total gagné dépasse `j × 500 + incrément`, incrément de 2 000 × 1,14 à chaque bonus ; 2 % au hasard */
  incrementBonus: 2_000,
  facteurIncrement: 1.14,
  probaBonusHasard: 0.02,
} as const;

/**
 * Types de tigres : tigre (0), tigre doré porteur d'un bonus (1), tigre chef (2), petit des manches du Truck Muche (3), mini Truck Muche
 * explosif des mêmes manches (4, pas un tigre : un petit camion qui fonce et saute, cf. `ZOMBIES.miniTruck`).
 */
export type TypeZombie = 0 | 1 | 2 | 3 | 4;
/** Ennemi des seules manches du Truck Muche (petit ou mini Truck) : lâché par le Truck ou par la foudre, il franchit les fenêtres. */
export const estLivraison = (type: number): boolean => type === 3 || type === 4;
/** Allure d'un tigre : marche (0), course (1), sprint (2), rampant (3). */
export type Allure = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------------------------
// Difficultés
// ---------------------------------------------------------------------------------------------

export type Difficulte = "entree" | "plat" | "goulaf";
export const DIFFICULTES_LISTE: readonly Difficulte[] = ["entree", "plat", "goulaf"];
export const estDifficulte = (x: unknown): x is Difficulte => (DIFFICULTES_LISTE as readonly unknown[]).includes(x);
export interface ProfilDifficulte {
  nom: string;
  description: string;
  /** multiplicateur des PV des tigres */
  pv: number;
  /** décalage de la valeur d'allure de BO1 (plus = plus de sprinteurs plus tôt) */
  allure: number;
  /** dégâts de griffe d'un tigre (le chef garde son surplus) */
  griffe: number;
}
export const DIFFICULTES: Readonly<Record<Difficulte, ProfilDifficulte>> = {
  entree: { nom: "Entrée", description: "Tigres moins coriaces et plus lents à s'énerver.", pv: 0.7, allure: -10, griffe: 40 },
  plat: { nom: "Plat du jour", description: "Les règles de Black Ops 1.", pv: 1, allure: 0, griffe: ZOMBIES.griffe },
  goulaf: { nom: "Goulaf", description: "Plus de PV, sprinteurs plus tôt, griffes plus lourdes.", pv: 1.3, allure: 10, griffe: 60 },
};

// ---------------------------------------------------------------------------------------------
// Vagues (BO1)
// ---------------------------------------------------------------------------------------------

/**
 * Nombre de tigres de la manche `n` pour `j` joueurs (BO1 `round_spawning` + `default_max_zombie_func`) : 24 de base, +3 m (seul) ou
 * +6 (j − 1) m avec m = max(1, n/5), × 0,15 n à partir de la manche 10, puis × 0,25 / 0,3 / 0,5 / 0,7 / 0,9 aux manches 1 à 5.
 * Solo : 6, 8, 13, 18, 24, 27, 28, 28, 29, 33.
 */
export function totalManche(n: number, j: number): number {
  const joueurs = Math.max(1, Math.floor(j));
  let m = Math.max(1, n / 5);
  if (n >= 10) m *= n * 0.15;
  let max = 24 + (joueurs === 1 ? Math.floor(0.5 * 6 * m) : Math.floor((joueurs - 1) * 6 * m));
  const facteurs = [0.25, 0.3, 0.5, 0.7, 0.9];
  if (n >= 1 && n <= 5) max = Math.floor(max * facteurs[n - 1]);
  return max;
}

/** PV d'un tigre (BO1 `ai_calculate_health`) : 150, +100 par manche jusqu'à la 9 (950), puis +10 % (entier) par manche ; plafond 1 000 000. */
export function pvBase(n: number): number {
  let pv = 150;
  for (let i = 2; i <= n; i++) {
    pv = i >= 10 ? pv + Math.floor(pv * 0.1) : pv + 100;
    if (pv > 1_000_000) return 1_000_000;
  }
  return pv;
}

/** PV d'un petit du Truck Muche (BO1, chiens) selon le numéro de la manche du Truck (1, 2, 3, 4+). */
export function pvPetit(numeroTruck: number): number {
  return numeroTruck <= 1 ? 400 : numeroTruck === 2 ? 900 : numeroTruck === 3 ? 1300 : 1600;
}

/** PV d'un tigre de la manche `n` selon son type et la difficulté : doré × 1,5, chef × 4 ; un petit suit `pvPetit`, un mini Truck la moitié. */
export function pvZombie(n: number, type: TypeZombie = 0, difficulte: Difficulte = "plat", numeroTruck = 1): number {
  const base = type === 3 ? pvPetit(numeroTruck) : type === 4 ? pvPetit(numeroTruck) * ZOMBIES.miniTruck.partPv : pvBase(n);
  const k = type === 1 ? 1.5 : type === 2 ? 4 : 1;
  return Math.max(1, Math.round(base * k * DIFFICULTES[difficulte].pv));
}

/** Délai (s) entre deux apparitions (BO1 : 2 s × 0,95 par manche, plancher 0,08 s). */
export function delaiApparition(n: number): number {
  return Math.max(0.08, 2 * 0.95 ** Math.max(0, n - 1));
}

/** Valeur d'allure de BO1 (`level.zombie_move_speed`) : 1 à la manche 1, puis 8 (n − 1). */
export function valeurAllure(n: number): number {
  return n <= 1 ? 1 : 8 * (n - 1);
}

/**
 * Allure d'un tigre qui apparaît (BO1 `set_run_speed`) : tirage entier dans [v, v + 35[ (v = valeur d'allure + décalage de difficulté),
 * ≤ 35 marche, ≤ 70 course, sinon sprint. `alea` ∈ [0, 1[ injecté. Un chef ne dépasse jamais la course.
 */
export function allureTiree(n: number, alea: number, difficulte: Difficulte = "plat", type: TypeZombie = 0): Allure {
  if (estLivraison(type)) return 2;
  const v = valeurAllure(n) + DIFFICULTES[difficulte].allure;
  const r = v + Math.floor(Math.min(0.999999, Math.max(0, alea)) * 35);
  const allure: Allure = r <= 35 ? 0 : r <= 70 ? 1 : 2;
  return type === 2 && allure === 2 ? 1 : allure;
}

/** Vitesse (m/s) d'une allure, ± `variationVitesse` selon `alea` ∈ [0, 1[. Un petit court à `vitessePetit`, un mini Truck roule à la sienne. */
export function vitesseAllure(allure: Allure, alea: number, type: TypeZombie = 0): number {
  const a = Math.min(1, Math.max(0, alea));
  const base = type === 3 ? ZOMBIES.vitessePetit : type === 4 ? ZOMBIES.miniTruck.vitesse : ZOMBIES.vitesses[allure];
  return base * (1 + ZOMBIES.variationVitesse * (2 * a - 1));
}

/** Dégâts d'une griffe selon le type et la difficulté (le petit mord : 22 en entrée, 30, 38 en goulaf ; le mini Truck ne griffe pas, il saute). */
export function degatsGriffe(type: TypeZombie = 0, difficulte: Difficulte = "plat"): number {
  if (type === 3) return Math.round(ZOMBIES.morsurePetit * facteurDifficulte(difficulte));
  if (type === 4) return 0;
  const d = DIFFICULTES[difficulte].griffe;
  return type === 2 ? d + (ZOMBIES.griffeChef - ZOMBIES.griffe) : d;
}

/** Recharge (s) entre deux griffes (morsures du petit plus rapprochées). */
export function rechargeGriffe(type: TypeZombie): number {
  return type === 3 ? ZOMBIES.morsureRechargeS : ZOMBIES.griffeRechargeS;
}

/** Armement (s) d'un coup : la morsure du petit part presque tout de suite, la griffe des tigres se voit venir (`griffeArmeS`). */
export function armementGriffe(type: TypeZombie): number {
  return type === 3 ? ZOMBIES.morsureArmeS : ZOMBIES.griffeArmeS;
}
/** Rotation (rad/s) pendant l'armement : le petit suit sa cible, le tigre se laisse contourner. */
export function rotationArmement(type: TypeZombie): number {
  return type === 3 ? ZOMBIES.morsureRotationMax : ZOMBIES.griffeRotationMax;
}
/** Rotation (rad/s) hors armement : le petit vire sec, le mini Truck vire mal (il fonce tout droit). */
export function rotationZombie(type: TypeZombie): number {
  return type === 3 ? ZOMBIES.rotationPetit : type === 4 ? ZOMBIES.miniTruck.rotation : ZOMBIES.rotationMax;
}
/** Distance de séparation (m) d'un type ; entre deux types, la moyenne. */
export function separationZombie(type: TypeZombie): number {
  return type === 3 ? ZOMBIES.separationPetitM : type === 4 ? ZOMBIES.miniTruck.separationM : ZOMBIES.separationM;
}

/** Échelle du modèle d'un tigre selon son type. */
export function echelleZombie(type: TypeZombie): number {
  return type === 2 ? ZOMBIES.echelleBrute : type === 3 ? ZOMBIES.echellePetit : type === 4 ? ZOMBIES.miniTruck.echelle : ZOMBIES.echelle;
}

/** Facteur de dégâts des ennemis du Truck selon la difficulté (entrée 0,75, plat 1, goulaf 1,25). */
export function facteurDifficulte(difficulte: Difficulte): number {
  return difficulte === "entree" ? 0.75 : difficulte === "goulaf" ? 1.25 : 1;
}

/** Tigres chefs de la manche `n` : floor((n − 6) / 4) à partir de la manche 10. */
export function nbChefs(n: number): number {
  return n < 10 ? 0 : Math.floor((n - 6) / 4);
}

/** Probabilité d'un tigre doré (porteur d'un bonus) dans la manche `n` : aucun à la 1, puis min(0,75 ; 0,35 + 0,05 n). */
export function probaDore(n: number): number {
  return n < 2 ? 0 : Math.min(0.75, 0.35 + 0.05 * n);
}

/**
 * Ordre d'apparition d'une manche normale : `total` tigres, dont les chefs (répartis dans la seconde moitié) et au plus un tigre doré (au
 * milieu, tiré avec `probaDore`). Le hasard est injecté.
 */
export function typesManche(n: number, j: number, alea: () => number): TypeZombie[] {
  const total = totalManche(n, j);
  const types: TypeZombie[] = new Array(total).fill(0);
  if (!total) return types;
  const chefs = Math.min(nbChefs(n), Math.floor(total / 2));
  for (let k = 0; k < chefs; k++) {
    const i = Math.floor(total / 2) + Math.floor(((k + alea()) / Math.max(1, chefs)) * (total - Math.floor(total / 2)));
    types[Math.min(total - 1, i)] = 2;
  }
  if (alea() < probaDore(n)) {
    let i = Math.floor(total * (0.35 + 0.3 * alea()));
    while (i < total - 1 && types[i] !== 0) i++;
    if (types[i] === 0) types[i] = 1;
  }
  return types;
}

// ---------------------------------------------------------------------------------------------
// Manches du Truck Muche (les chiens de BO1)
// ---------------------------------------------------------------------------------------------

/** Première manche du Truck : 5, 6 ou 7 (BO1 `randomintrange(5, 8)`). */
export function premiereMancheTruck(alea: number): number {
  return 5 + Math.min(2, Math.floor(Math.max(0, alea) * 3));
}
/** Manche du Truck suivante : 4 à 6 manches plus tard. */
export function mancheTruckSuivante(n: number, alea: number): number {
  return n + 4 + Math.min(2, Math.floor(Math.max(0, alea) * 3));
}
/**
 * Ennemis d'une manche du Truck (petits et mini Trucks) : BO1 lâche 6 chiens par joueur aux deux premières, 8 ensuite ; nos joueurs vont
 * 40 % plus vite que ceux de BO1, la livraison en lâche donc 8 par joueur puis 11, et au moins 10 en solo.
 */
export function totalTruck(numeroTruck: number, j: number): number {
  return Math.max(10, Math.max(1, Math.floor(j)) * (numeroTruck < 3 ? 8 : 11));
}
/** Ennemis du Truck vivants au plus (BO1 : 2 chiens par joueur) : 4 + 3 par joueur, sous le plafond de 24 (solo 7, 2 joueurs 10, 4 joueurs 16). */
export function plafondPetits(j: number): number {
  return Math.min(ZOMBIES.plafondVivants, 4 + 3 * Math.max(1, Math.floor(j)));
}
/** Part des mini Trucks parmi les ennemis d'une livraison (BO1 : la moitié des chiens sont des chiens de feu) : 25 %, 35 %, puis 50 %. */
export function partMiniTrucks(numeroTruck: number): number {
  return numeroTruck <= 1 ? 0.25 : numeroTruck === 2 ? 0.35 : 0.5;
}
/**
 * Ordre des ennemis d'une manche du Truck : `total` petits (3) dont `round(total × partMiniTrucks)` mini Trucks (4), répartis au hasard
 * (injecté), jamais aux deux premières places (la manche s'ouvre sur des petits).
 */
export function typesTruck(numeroTruck: number, total: number, alea: () => number): TypeZombie[] {
  const types: TypeZombie[] = new Array(Math.max(0, total)).fill(3);
  const libres: number[] = [];
  for (let i = Math.min(2, total); i < total; i++) libres.push(i);
  const minis = Math.min(libres.length, Math.round(total * partMiniTrucks(numeroTruck)));
  for (let k = 0; k < minis; k++) {
    const r = Math.min(libres.length - 1, Math.floor(alea() * libres.length));
    types[libres[r]] = 4;
    libres.splice(r, 1);
  }
  return types;
}
/** PV du Truck Muche lui-même (on peut le faire exploser). */
export function pvTruck(numeroTruck: number): number {
  return 2_500 * Math.max(1, numeroTruck);
}

// ---------------------------------------------------------------------------------------------
// Points (BO1 `zombie_score_*`)
// ---------------------------------------------------------------------------------------------

export interface OptionsGain { tete?: boolean; melee?: boolean; double?: boolean }

/** Gain d'un tir (une fois par tir) ou d'un coup de mêlée qui touche sans tuer : 10 $ (× 2 en double points). */
export function gainTouche(opts: OptionsGain = {}): number {
  return 10 * (opts.double ? 2 : 1);
}

/** Gain d'un kill : 50 + 10 au corps (60), + 50 à la tête (100), + 80 à la mêlée (130) ; × 2 en double points. */
export function gainKill(opts: OptionsGain = {}): number {
  const bonus = opts.melee ? 80 : opts.tete ? 50 : 10;
  return (50 + bonus) * (opts.double ? 2 : 1);
}

/** Plafond par joueur et par manche des planches reposées (BO1 `rebuild_barrier_cap_per_round`) : min(500, 50 n). */
export function plafondPlanches(n: number): number {
  return Math.min(500, 50 * Math.max(1, n));
}
/** Gain d'une planche reposée (avant plafond). */
export const GAIN_PLANCHE = 10;
/** Gains des bonus et du Truck : nuke, menuisier (à chaque joueur), Truck explosé (à chaque joueur), chef abattu (au tueur). */
export const GAIN_NUKE = 400;
export const GAIN_MENUISIER = 200;
export const GAIN_TRUCK = 500;
export const GAIN_CHEF = 250;

// ---------------------------------------------------------------------------------------------
// Bonus (power-ups)
// ---------------------------------------------------------------------------------------------

export type GenreBonus = "munitions" | "instakill" | "double" | "nuke" | "menuisier" | "soldes";
export const GENRES_BONUS: readonly GenreBonus[] = ["munitions", "instakill", "double", "nuke", "menuisier", "soldes"];
export const NOMS_BONUS: Readonly<Record<GenreBonus, string>> = {
  munitions: "Munitions max", instakill: "Insta-kill", double: "Double points", nuke: "Kaboum", menuisier: "Menuisier", soldes: "Happy hour",
};

/** Paquet de bonus mélangé (Fisher-Yates, hasard injecté) : chaque genre une fois, rebattu quand il est vide (BO1 `randomize_powerups`). */
export function paquetBonus(alea: () => number): GenreBonus[] {
  const p = [...GENRES_BONUS];
  for (let i = p.length - 1; i > 0; i--) {
    const k = Math.min(i, Math.floor(alea() * (i + 1)));
    [p[i], p[k]] = [p[k], p[i]];
  }
  return p;
}

/** Seuil de bonus initial (BO1) : j × 500 + 2 000. */
export function seuilBonusInitial(j: number): number {
  return Math.max(1, Math.floor(j)) * ZOMBIES.argentDepart + ZOMBIES.incrementBonus;
}
