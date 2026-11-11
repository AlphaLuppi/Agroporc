/**
 * Rocket Muche : CONTRAT PARTAGÉ entre tous les modules de `lib/rocket/` et `app/components/rocket/`.
 * Source de vérité entre les agents qui implémentent en parallèle : constantes physiques (SI), types d'état, entrées, événements et
 * SIGNATURES des fonctions que chaque module exporte. Rien ici ne dépend de three, du DOM ni de l'horloge : le fichier est importable par
 * les tests Node. Les signatures sont des types (`export type FonctionX = (…) => …`) : chaque module les implémente sous le nom indiqué dans
 * le commentaire « Implémenté par … ».
 *
 * Unités : mètres, secondes, radians. Les valeurs d'origine de Rocket League (unreal units, 1 uu = 1 cm) sont converties par `uu()` et la
 * valeur d'origine reste lisible à côté. Repère : Y vers le haut ; X = largeur du stade, Z = longueur ; l'équipe BLEUE défend le but
 * de Z = -60 m et attaque celui de Z = +60 m. Le terrain est symétrique en X : le passage du repère de Rocket League (x, y, z haut)
 * à celui-ci (x, z, y haut) ne change donc aucune position.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (prime sur tout commentaire d'un module en cas de divergence).
 */
import type * as THREE from "three";
import type { Base, Vec3 } from "./vec";
import type { SceneData } from "../agroparc3d/types";

export type { Base, Vec3, VecLocal } from "./vec";

/** unreal units → mètres (1 uu = 1 cm). */
export const uu = (x: number): number => x / 100;

// ============================================================================================================================
// 1. Temps et conventions
// ============================================================================================================================

/** Pas fixe de la physique : 120 Hz comme Rocket League. `pasMonde` avance TOUJOURS d'un pas (sauf tests). */
export const PAS_S = 1 / 120;
/** Au plus ce nombre de pas physiques par image affichée (au-delà : le temps est perdu, la partie ralentit plutôt que de s'emballer). */
export const PAS_MAX_PAR_IMAGE = 6;
/** Gravité (RL : -650 uu/s²). */
export const GRAVITE = uu(650);

export type Equipe = "bleue" | "orange";
export const EQUIPES: readonly Equipe[] = ["bleue", "orange"];
export const adversaire = (e: Equipe): Equipe => (e === "bleue" ? "orange" : "bleue");
/** Signe de Z du but que l'équipe DÉFEND : bleue -1 (Z = -60 m), orange +1. */
export const signeButDefendu = (e: Equipe): number => (e === "bleue" ? -1 : 1);

/** Nom des équipes (touche Agroparc : le Bistrot Trèfle contre le thème Tigre du site). */
export const NOMS_EQUIPES_DEFAUT: Readonly<Record<Equipe, string>> = { bleue: "Les Trèfles", orange: "Les Tigres" };

// ============================================================================================================================
// 2. Stade (Soccar standard, « DFH Stadium ») — dimensions EXACTES
// ============================================================================================================================

export const STADE = {
  /** demi-largeur : murs latéraux en X = ±40,96 m (RL : 4096 uu, terrain 8192 de large) */
  demiLargeur: uu(4096),
  /** demi-longueur jusqu'au fond de terrain (plan des buts) : Z = ±51,20 m (RL : 5120 uu, terrain 10240 de long hors buts) */
  demiLongueur: uu(5120),
  /** hauteur du plafond : 20,44 m (RL : 2044 uu) */
  hauteur: uu(2044),
  /** pan coupé des quatre coins : le coin est coupé de 11,52 m sur chaque mur (RL : 1152 uu), en plan (±40,96 ; ±39,68) → (±29,44 ; ±51,20) */
  panCoupe: uu(1152),
  /** rayon de raccord sol/murs (RL : ~256 uu) */
  rayonSol: uu(256),
  /** rayon de raccord murs/plafond (RL : ~256 uu) */
  rayonPlafond: uu(256),
  /** rayon des arêtes verticales (pan coupé ↔ murs) : arrondi pour que ni la balle ni les roues n'accrochent (RL : adouci, ~256 uu) */
  rayonCoin: uu(256),
} as const;

export const BUT = {
  /** largeur de l'ouverture : 17,86 m (RL : 1786 uu), soit Z demi-largeur 8,93 m */
  demiLargeur: uu(893),
  /** hauteur de l'ouverture : 6,42775 m (RL : 642,775 uu) */
  hauteur: uu(642.775),
  /** profondeur : de Z = ±51,20 à ±60,00 m (RL : 880 uu) */
  profondeur: uu(880),
  /** rayon des arêtes de l'encadrement (poteaux, barre) : la balle y rebondit sans accrocher (RL : poteaux fins ~ 20 uu, adoucis) */
  rayonArete: uu(15),
  /** la balle marque quand son CENTRE dépasse Z = ±(51,2425 + rayon de balle) (RL : 5124,25 uu + rayon, `SOCCAR_GOAL_SCORE_BASE_THRESHOLD_Y`) */
  seuilMarque: uu(5124.25),
  /** raccords des angles intérieurs de la cage (RL : cage à angles vifs, on adoucit à 0,25 m pour éviter les points durs de la SDF) */
  rayonInterieur: uu(25),
  /**
   * de part et d'autre de la cage, le raccord arrondi sol / mur du fond s'efface en biseau sur cette longueur (m) : au poteau le mur
   * tombe droit sur le sol, rien ne dépasse dans le terrain, et on entre ou sort de la cage en longeant le mur sans rien accrocher
   */
  longueurBiseau: 6,
  /** rayon de l'adoucissement des arêtes de ce biseau (m) */
  rayonBiseau: 0.5,
} as const;

/** Vrai pour la balle ET pour tout test « dans le but » : seuil du centre de balle selon son rayon. */
export const seuilMarqueBalle = (): number => BUT.seuilMarque + BALLE.rayon;

// ============================================================================================================================
// 3. Balle
// ============================================================================================================================

export const BALLE = {
  /** rayon de collision : 0,9125 m (RL : 91,25 uu ; le modèle visuel fait 92,75) */
  rayon: uu(91.25),
  rayonVisuel: uu(92.75),
  /** masse (RL : 30) ; la voiture pèse 180 */
  masse: 30,
  /** restitution contre le décor (RL : 0,6) ; seuil de vitesse normale sous lequel il n'y a plus de rebond (m/s) */
  restitution: 0.6,
  seuilRebond: 0.2,
  /** frottement de Coulomb contre le décor (RL : 0,35) */
  frottement: 0.35,
  /** amortissement de roulement (RL : 0,0285), appliqué à la vitesse angulaire de la balle quand elle roule sur une surface */
  frottementRoulement: 0.0285,
  /** amortissement linéaire (RL : 0,03) : `v ← v × (1 - 0,03)^dt` */
  amortissementLineaire: 0.03,
  /** amortissement angulaire (RL : ~0,03) : `w ← w × (1 - 0,03)^dt` */
  amortissementAngulaire: 0.03,
  /** vitesse maximale (RL : 6000 uu/s) et vitesse angulaire maximale (RL : 6 rad/s) */
  vitesseMax: uu(6000),
  vitesseAngMax: 6,
  /** moment d'inertie d'une sphère pleine : `0,4 × m × r²` (calculé à l'usage) */
  facteurInertie: 0.4,
  /** hauteur du centre à l'engagement (RL : 92,75 uu) */
  hauteurEngagement: uu(92.75),
} as const;

// ============================================================================================================================
// 4. Voiture (Octane, la seule carrosserie)
// ============================================================================================================================

export const VOITURE = {
  masse: 180,
  /** boîte de collision : 1,1801 × 0,8420 × 0,3616 m (RL : 118,01 × 84,20 × 36,16 uu) */
  hitbox: { longueur: uu(118.01), largeur: uu(84.2), hauteur: uu(36.16) },
  /** centre de la boîte par rapport à l'origine de la voiture, repère local [avant, droite, haut] : (0,1388 ; 0 ; 0,2075) (RL : 13,88, 0, 20,75 uu) */
  decalageHitbox: [uu(13.88), 0, uu(20.75)] as readonly [number, number, number],
  /** hauteur de l'origine au-dessus du sol, voiture posée (RL : ~17 uu) */
  hauteurRepos: uu(17),
  /** roues : centre (repère local [avant, droite, haut]) et rayon. Empattement 0,85 m (RL Octane : avant +51,25 uu, arrière -33,75 uu) */
  roues: [
    { local: [uu(51.25), uu(25.9), uu(-4.5)] as readonly [number, number, number], rayon: uu(12.5), avant: true },
    { local: [uu(51.25), uu(-25.9), uu(-4.5)] as readonly [number, number, number], rayon: uu(12.5), avant: true },
    { local: [uu(-33.75), uu(29.5), uu(-2)] as readonly [number, number, number], rayon: uu(15), avant: false },
    { local: [uu(-33.75), uu(-29.5), uu(-2)] as readonly [number, number, number], rayon: uu(15), avant: false },
  ],
  /** une roue « touche » quand son centre est à moins de rayon + cette marge de la surface (course de suspension) */
  margeContactRoue: uu(5),
  /** nombre de roues en contact pour être « au sol » (RL : 3) */
  rouesPourSol: 3,
  /** vitesse maximale (RL : 2300 uu/s) ; vitesse angulaire maximale (RL : 5,5 rad/s) */
  vitesseMax: uu(2300),
  vitesseAngMax: 5.5,
  /** supersonique : s'allume à 22,00 m/s, s'éteint sous 21,00 m/s (RL : 2200 / 2100 uu/s) */
  supersoniqueOn: uu(2200),
  supersoniqueOff: uu(2100),
  /** boost au spawn (RL : 33,33 %) */
  boostInitial: 100 / 3,
} as const;

/** Conduite au sol (et sur les murs / le plafond : tout se passe dans le plan tangent de la surface). */
export const CONDUITE = {
  /** accélération de la gaz en fonction de la vitesse avant (m/s → m/s²) : 16 à l'arrêt, 1,6 à 14 m/s, 0 à 14,1 m/s (RL : 1600 → 160 à 1400 → 0 à 1410) */
  courbeGaz: [[0, uu(1600)], [uu(1400), uu(160)], [uu(1410), 0]] as readonly (readonly [number, number])[],
  /** vitesse maximale sans boost (RL : 1410 uu/s) */
  vitesseGazMax: uu(1410),
  /** décélération au frein (gaz opposé à la vitesse) : RL 3500 uu/s² */
  frein: uu(3500),
  /** décélération « roue libre » (aucun gaz) : RL 525 uu/s² */
  rouleLibre: uu(525),
  /** en dessous de cette vitesse, un gaz opposé inverse le sens sans freiner (m/s) */
  seuilArretFrein: uu(25),
  /** courbure du virage (1/m) selon la vitesse avant (m/s) : vitesse angulaire = courbure × vitesse × volant. RL : 0,0069 / 0,00398 / 0,00235 / 0,001375 / 0,001145 / 0,0009 par uu à 0 / 500 / 1000 / 1500 / 1750 / 2300 uu/s */
  courbeCourbure: [[0, 0.69], [5, 0.398], [10, 0.235], [15, 0.1375], [17.5, 0.1145], [23, 0.09]] as readonly (readonly [number, number])[],
  /** multiplicateur de la vitesse de lacet en dérapage (frein à main) */
  facteurLacetDerapage: 1.6,
  /** raideur d'adhérence latérale (1/s) : la vitesse latérale décroît de `1 - exp(-k·dt)` par pas ; 0,1 × en dérapage */
  adherenceLaterale: 20,
  facteurAdherenceDerapage: 0.1,
  /** perte de vitesse avant en dérapage (1/s), relative à la vitesse avant */
  freinageDerapage: 0.25,
  /** force de maintien contre la surface : accélération le long de -normale (RL : « sticky forces », gravité entière sur les murs) */
  collageSol: GRAVITE * 0.5,
  collageMur: GRAVITE,
  /** un élan latéral plus fort que cela décolle quand même de la surface (m/s) */
  decollageNormal: uu(300),
  /** la voiture s'aligne sur la surface sous elle : vitesse angulaire max de cet alignement (rad/s) et raideur (1/s) quand 1 à 2 roues touchent */
  autoAlignementRoulis: 4,
  /** redressement automatique sur le toit (bouton de saut quand la voiture est sur le dos au sol) : impulsion, couple et durée (RL : ~200 uu/s, couple 50, 0,4 s) */
  redressement: { impulsion: uu(200), vitesseAng: 4, dureeS: 0.4 },
} as const;

export const SAUT = {
  /** impulsion initiale le long du haut de la voiture : 2,91667 m/s (RL : 291,667 uu/s) */
  impulsion: uu(291.667),
  /** accélération tant que le bouton reste appuyé : 14,5833 m/s² (RL : 1458,333 uu/s²), au plus 0,2 s (RL : 0,2 s) */
  maintien: uu(1458.333),
  maintienMaxS: 0.2,
  /** la poussée dure au moins 0,025 s même sur un appui bref, à 62 % pendant ce temps (RocketSim JUMP_MIN_TIME, JUMP_PRE_MIN_ACCEL_SCALE) */
  maintienMinS: 0.025,
  echelleAvantMin: 0.62,
  /** fenêtre pour le second saut / dodge, comptée depuis la FIN du premier saut (RL : 1,25 s, `DOUBLEJUMP_MAX_DELAY`) ; sans premier saut, pas de limite */
  fenetreDoubleSautS: 1.25,
  /** double saut sans direction : même impulsion verticale que le premier, sans maintien */
  impulsionDoubleSaut: uu(291.667),
} as const;

/** Dodge (flip) : impulsion horizontale, rotation, amortissement vertical. */
export const FLIP = {
  /** impulsion de base : 5 m/s (RL : 500 uu/s), multipliée selon la vitesse avant (voir spec §4.5) */
  impulsionBase: uu(500),
  /**
   * multiplicateur MAX à vitesse maximale (impulsion × (1 + (S - 1) × |v_avant| / 23)), valeurs de RocketSim
   * (RLConst.h) : vers l'avant 1,0 (FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE, soit +5 m/s quelle que soit la vitesse), sur le côté 1,9,
   * vers l'arrière 2,5 puis × 16/15 (FLIP_BACKWARD_IMPULSE_SCALE_X). « Arrière » se juge par rapport au sens de la marche (voir `flipEstArriere`).
   */
  echelleAvant: 1.0,
  echelleCote: 1.9,
  echelleArriere: 2.5,
  facteurArriere: 16 / 15,
  /** sous cette vitesse avant (m/s), « arrière » = manche tiré (RL : 100 uu/s) */
  seuilSensMarche: uu(100),
  /**
   * durée du couple de dodge (RL : 0,65 s). La vitesse angulaire de consigne autour de l'axe du flip est plafonnée comme tout le
   * reste à `VOITURE.vitesseAngMax` (5,5 rad/s) : le couple de RL (224 / 260 rad/s²) atteint le plafond en quelques ms. La voiture
   * ne fait donc PAS un tour exact : ≈ 205° à 0,65 s, puis la vitesse résiduelle s'amortit (≈ 314° au total).
   */
  dureeRotationS: 0.65,
  vitesseAng: 5.5,
  /** accélération angulaire du dodge (rad/s²) : roulis × composante latérale, tangage × composante avant (RocketSim FLIP_TORQUE_X / _Y) */
  coupleRoulis: 260,
  coupleTangage: 224,
  /** verrouillage du tangage : tant que le temps écoulé depuis le début du flip est inférieur à 0,65 s + 0,3 s (RL : FLIP_TORQUE_TIME + FLIP_PITCHLOCK_EXTRA_TIME) */
  verrouTangageS: 0.65,
  verrouTangageExtraS: 0.3,
  /** amortissement vertical : ×0,65 par 1/120 s (RL : FLIP_Z_DAMP_120 = 0,35) dès 0,15 s, tant que la voiture descend ou avant 0,21 s, jusqu'à la fin du flip (0,65 s) */
  amortissementVertical: 0.35,
  amortissementDebutS: 0.15,
  amortissementFinS: 0.21,
  /** seuil de |lacet| + |tangage| + |roulis| au-dessus duquel l'appui sur saut est un flip et non un double saut (RL : 0,5) */
  zoneMorte: 0.5,
  /** stall : direction du dodge (-tangage, lacet + roulis) quasi nulle (RL : 0,1) */
  zoneMorteStall: 0.1,
} as const;

/** Contrôle en l'air : accélération angulaire (rad/s²) = COUPLE × entrée + AMORT × ω × (1 - |entrée|), dans le repère de la voiture. */
export const AIR = {
  /** Convention de signe de ce projet : entrée +1 = nez vers le haut (tangage), tourner à droite (lacet), pencher à droite (roulis). */
  coupleTangage: 12.146,
  coupleLacet: 8.92,
  coupleRoulis: 36.08,
  /** amortissement (RL : -2,798 / -1,886 / -4,472) ; valeurs positives ici, le signe est dans la formule */
  amortTangage: 2.798,
  amortLacet: 1.886,
  amortRoulis: 4.472,
  /** poussée dans l'air avec gaz : accélération avant/arrière du gaz, boost ou non (RL : 66,667 uu/s²) */
  gazAerien: uu(66.667),
} as const;

export const BOOST = {
  /** accélération du boost le long de l'avant : 9,91667 m/s² au sol (RL : 991,667 uu/s²) */
  acceleration: uu(991.667),
  /** en l'air : 10,5833 m/s² (RocketSim BOOST_ACCEL_AIR = 3175/3 uu/s²) */
  accelerationAir: uu(3175 / 3),
  /** consommation : 33,33 / s (RL : 100 en 3 s) */
  consommation: 100 / 3,
  /** un appui consomme au moins ce temps (RL : 0,1 s) */
  dureeMinS: 0.1,
  max: 100,
} as const;

/** Plots de boost. */
export const PLOT = {
  petit: { valeur: 12, rechargeS: 4, rayon: uu(144), hauteur: uu(165), hauteurCentre: uu(70) },
  gros: { valeur: 100, rechargeS: 10, rayon: uu(208), hauteur: uu(168), hauteurCentre: uu(73) },
} as const;

/** Contact voiture ↔ balle : choc physique + impulsion « Psyonix ». */
export const CONTACT_BALLE = {
  /** restitution du choc physique voiture ↔ balle : NULLE (RocketSim CARBALL_COLLISION_RESTITUTION = 0). La vitesse de sortie vient du choc inélastique plus l'impulsion de Psyonix. */
  restitution: 0,
  /** frottement de Coulomb du choc voiture ↔ balle (RocketSim CARBALL_COLLISION_FRICTION = 2) : plafonné par l'adhérence totale, il donne le spin et le dribble */
  frottement: 2,
  /** l'impulsion supplémentaire de Psyonix : direction = vecteur voiture → balle avec la composante verticale × 0,35 et la composante avant ramenée à × 0,65 ; intensité = vitesse relative (plafond 46 m/s) × courbe */
  echelleVerticale: 0.35,
  echelleAvant: 0.65,
  vitesseRelativeMax: uu(4600),
  /** courbe de l'impulsion : (vitesse relative m/s → facteur) = (0 → 0,65), (5 → 0,65), (23 → 0,55), (46 → 0,30) (RL : 0 / 500 / 2300 / 4600 uu/s) */
  courbeImpulsion: [[0, 0.65], [uu(500), 0.65], [uu(2300), 0.55], [uu(4600), 0.3]] as readonly (readonly [number, number])[],
  /** l'impulsion supplémentaire n'est pas réappliquée pendant ce délai après la précédente pour la même voiture (anti-dribble infini) */
  delaiImpulsionS: 0.1,
} as const;

/** Voiture ↔ voiture : chocs, bump et démolition. */
export const CONTACT_VOITURES = {
  restitution: 0.1,
  frottement: 0.3,
  /**
   * bump (RocketSim Arena::_BtCallback_OnCarCarCollision), en m/s selon la vitesse de l'attaquant vers la victime (RL : uu/s) :
   * poussée le long de la direction de la vitesse de l'attaquant, au sol 0 → 0, 14 → 11, 22 → 15,3 (RL 1400 → 1100, 2200 → 1530),
   * en l'air 0 → 0, 14 → 13,9, 22 → 19,45 (RL 1400 → 1390, 2200 → 1945), plus une poussée verticale (le long du haut de la victime
   * au sol, +Y en l'air) 0 → 0, 14 → 2,78, 22 → 4,17 (RL 1400 → 278, 2200 → 417). Seul le pare-chocs avant bumpe (même condition
   * que la démolition) ; délai entre deux bumps du même couple
   */
  bumpSol: [[0, 0], [uu(1400), uu(1100)], [uu(2200), uu(1530)]] as readonly (readonly [number, number])[],
  bumpAir: [[0, 0], [uu(1400), uu(1390)], [uu(2200), uu(1945)]] as readonly (readonly [number, number])[],
  bumpHaut: [[0, 0], [uu(1400), uu(278)], [uu(2200), uu(417)]] as readonly (readonly [number, number])[],
  bumpDelaiS: 0.25,
  /** démolition : l'attaquant est supersonique, la victime est d'une AUTRE équipe, le point de contact est dans l'angle avant de l'attaquant */
  demoReapparitionS: 3,
  /** l'avant de l'attaquant : le point de contact doit être au moins à cette distance DEVANT son centre (RL : 64,5 uu) */
  demoAvantMinM: uu(64.5),
  /** après une démolition d'un adversaire, l'auteur ne retouche pas les mêmes ; équipe amie : simple bump */
  tirAmi: false,
} as const;

// ============================================================================================================================
// 5. Match
// ============================================================================================================================

export const MATCH = {
  dureeDefautS: 300,
  dureesPermisesS: [180, 300, 420, 600] as readonly number[],
  /** compte à rebours du coup d'envoi (3, 2, 1, GO) : voitures bloquées, balle posée au centre */
  decompteS: 3,
  /**
   * célébration d'un but : balle libre au ralenti (×0,5) pendant ce temps de jeu (2,5 s réelles) avant la remise en place ; le jeu
   * (`jeu.ts`) rejoue ensuite le but de derrière le buteur avant le coup d'envoi (`rejeu-but.ts`)
   */
  celebrationS: 1.25,
  ralentiCelebration: 0.5,
  /** une voiture démolie réapparaît après ce délai */
  reapparitionS: CONTACT_VOITURES.demoReapparitionS,
  /** après la fin du chronomètre à 0 la partie attend que la balle touche le sol (RL) ; et au plus cette durée de grâce (s) */
  graceBalleEnAirS: 12,
  /** prolongation : mort subite, sans limite de temps */
  prolongation: true,
  /** barème de points (RL) */
  points: { but: 100, passeDecisive: 50, arret: 50, tir: 20, demolition: 10, touche: 2 },
  /** passe décisive : le dernier coéquipier du buteur à avoir touché la balle, moins de 5 s avant le but */
  fenetrePasseS: 5,
  /** arrêt : la voiture touche une balle qui se dirigeait vers son but (cadrée, à moins de 12 m de la ligne) */
  distanceArretM: 12,
} as const;

export type PhaseMatch = "decompte" | "enJeu" | "but" | "fini";

export type Format = "1v1" | "2v2" | "3v3";
export const FORMATS: readonly Format[] = ["1v1", "2v2", "3v3"];
export const joueursParEquipe = (f: Format): number => (f === "1v1" ? 1 : f === "2v2" ? 2 : 3);

export type NiveauBot = "debutant" | "pro" | "allstar";
export const NIVEAUX_BOT: readonly NiveauBot[] = ["debutant", "pro", "allstar"];
export const LIBELLES_NIVEAU: Readonly<Record<NiveauBot, string>> = { debutant: "Débutant", pro: "Pro", allstar: "All-Star" };

/** Profil d'un niveau de bot (toutes les valeurs sont des réglages, pas des règles : les bots n'ont AUCUN avantage physique). */
export interface ProfilBot {
  /** latence entre une décision et son effet sur les entrées (s) */
  reactionS: number;
  /** bruit gaussien ajouté à la direction visée (rad, écart type) */
  bruitVisee: number;
  /** part du temps où le bot utilise le boost quand c'est utile (0..1) */
  usageBoost: number;
  /** a le droit de viser des balles en l'air (jump + boost + air control) et jusqu'à quelle hauteur de balle (m) */
  aeriens: boolean;
  hauteurAerienMax: number;
  /** utilise le flip (dodge) pour frapper, le speedflip au coup d'envoi, le demi-flip */
  flips: boolean;
  /** horizon de prédiction de la trajectoire de balle (s) */
  predictionS: number;
  /** respecte la rotation (3e homme, soutien) et ne chasse pas la balle à plusieurs */
  rotation: boolean;
  /** envie de ramasser des plots quand rien ne presse (0..1) */
  appetitPlots: number;
  /** tente de démolir un adversaire sur sa route */
  demolit: boolean;
  /** décisions par seconde (le reste du temps les entrées précédentes sont maintenues) */
  frequenceDecisionHz: number;
}
export const PROFILS_BOT: Readonly<Record<NiveauBot, ProfilBot>> = {
  debutant: { reactionS: 0.35, bruitVisee: 0.2, usageBoost: 0.45, aeriens: false, hauteurAerienMax: 0, flips: false, predictionS: 0.6, rotation: false, appetitPlots: 0.25, demolit: false, frequenceDecisionHz: 10 },
  pro: { reactionS: 0.14, bruitVisee: 0.07, usageBoost: 0.8, aeriens: true, hauteurAerienMax: 9, flips: true, predictionS: 1.5, rotation: true, appetitPlots: 0.7, demolit: false, frequenceDecisionHz: 20 },
  allstar: { reactionS: 0.04, bruitVisee: 0.02, usageBoost: 1, aeriens: true, hauteurAerienMax: 18, flips: true, predictionS: 3, rotation: true, appetitPlots: 1, demolit: true, frequenceDecisionHz: 30 },
};

// ============================================================================================================================
// 6. Données du stade : plots et coups d'envoi (positions de Rocket League, repère local [x, z])
// ============================================================================================================================

export interface DefPlot {
  /** index stable 0..33 (ordre ci-dessous : Z croissant puis X croissant) */
  id: number;
  /** position au sol (x, z) en m ; la hauteur du centre est `PLOT.*.hauteurCentre` */
  x: number;
  z: number;
  gros: boolean;
}
/** Les 34 plots officiels (RL : (x, y) en uu / 100) : 6 gros (100, recharge 10 s) et 28 petits (12, recharge 4 s). */
const BRUT_PLOTS: readonly (readonly [number, number, boolean])[] = [
  [-3072, -4096, true], [3072, -4096, true],
  [0, -4240, false], [-1792, -4184, false], [1792, -4184, false],
  [-940, -3308, false], [940, -3308, false],
  [0, -2816, false],
  [-3584, -2484, false], [3584, -2484, false],
  [-1788, -2300, false], [1788, -2300, false],
  [-2048, -1036, false], [2048, -1036, false], [0, -1024, false],
  [-3584, 0, true], [3584, 0, true],
  [-1024, 0, false], [1024, 0, false],
  [-2048, 1036, false], [2048, 1036, false], [0, 1024, false],
  [-1788, 2300, false], [1788, 2300, false],
  [-3584, 2484, false], [3584, 2484, false],
  [0, 2816, false],
  [-940, 3308, false], [940, 3308, false],
  [-3072, 4096, true], [3072, 4096, true],
  [-1792, 4184, false], [1792, 4184, false],
  [0, 4240, false],
];
export const PLOTS: readonly DefPlot[] = BRUT_PLOTS.map(([x, z, gros], id) => ({ id, x: uu(x), z: uu(z), gros }));

/** Un emplacement de coup d'envoi (équipe BLEUE ; l'orange est le même point tourné de 180° autour de Y : x → -x, z → -z, cap + π). */
export interface PosCoupDEnvoi {
  nom: "diagonaleG" | "diagonaleD" | "decaleG" | "decaleD" | "arriere";
  x: number;
  z: number;
  /** cap (rad) : avant = (sin cap, 0, cos cap) ; 0 = vers le but adverse */
  cap: number;
}
/** Les 5 positions de RL (x, y en uu, lacet RL 0,25π / 0,75π / 0,5π) ; ordre d'attribution : diagonales d'abord, puis arrière, puis décalés. */
export const COUPS_D_ENVOI: readonly PosCoupDEnvoi[] = [
  { nom: "diagonaleG", x: uu(-2048), z: uu(-2560), cap: Math.PI / 4 },
  { nom: "diagonaleD", x: uu(2048), z: uu(-2560), cap: -Math.PI / 4 },
  { nom: "arriere", x: 0, z: uu(-4608), cap: 0 },
  { nom: "decaleG", x: uu(-256), z: uu(-3840), cap: 0 },
  { nom: "decaleD", x: uu(256), z: uu(-3840), cap: 0 },
];

// ============================================================================================================================
// 7. Le stade posé sur Agroparc
// ============================================================================================================================

/**
 * Emplacement du stade dans le repère de `scene.json` (mètres, X est, Z sud) : le grand parking sud et la prairie qui le prolonge.
 * Mesuré sur `scene.json` : l'empreinte de 120 × 82 m (buts compris) avec 3 m de marge ne touche aucun bâtiment, aucun plan d'eau
 * et aucun arbre ; ≈ 1 900 m² d'allées de parking passent dessous (le sol du stade, posé à `hauteurSol`, les recouvre).
 */
export const SITE = {
  /** centre du terrain (point d'engagement) dans la scène */
  centre: [-58, 332] as readonly [number, number],
  /** rotation du stade autour de Y (rad) : le repère local +Z (vers le but orange) pointe vers (sin cap, cos cap) = (0,866 ; 0,5) en (x, z) de la scène */
  cap: Math.PI / 3,
  /** le sol du stade est posé 5 cm au-dessus du sol d'Agroparc (évite le combat de profondeur avec chaussée et places) */
  hauteurSol: 0.05,
  /** rayon de la zone dégagée de tout mobilier : demi-diagonale du terrain + gradins (m) */
  margeGradins: 14,
} as const;

/** Repère local du stade → repère de la scène Agroparc (rotation de `SITE.cap` autour de Y, puis translation). */
export function localVersScene(x: number, z: number): [number, number] {
  const c = Math.cos(SITE.cap), s = Math.sin(SITE.cap);
  return [SITE.centre[0] + x * c + z * s, SITE.centre[1] - x * s + z * c];
}
/** Inverse de `localVersScene`. */
export function sceneVersLocal(xs: number, zs: number): [number, number] {
  const c = Math.cos(SITE.cap), s = Math.sin(SITE.cap);
  const dx = xs - SITE.centre[0], dz = zs - SITE.centre[1];
  return [dx * c - dz * s, dx * s + dz * c];
}
/**
 * Boîtes (repère de la scène) où rien du décor secondaire d'Agroparc n'est posé : le rectangle tourné du stade (82 m × 120 m) plus
 * `margeGradins`, découpé en 12 bandes le long de l'axe long (une seule boîte alignée sur les axes couvrirait 183 × 169 m).
 * À passer à `construireDecor(…, { exclure })`.
 */
export function boitesExclusionSite(): { x0: number; z0: number; x1: number; z1: number }[] {
  const demiL = STADE.demiLargeur + SITE.margeGradins, demiZ = BUT.profondeur + STADE.demiLongueur + SITE.margeGradins;
  const n = 12, pas = (2 * demiZ) / n, boites: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (let i = 0; i < n; i++) {
    const z0 = -demiZ + i * pas, z1 = z0 + pas;
    const coins = ([[-demiL, z0], [demiL, z0], [demiL, z1], [-demiL, z1]] as const).map(([x, z]) => localVersScene(x, z));
    boites.push({ x0: Math.min(...coins.map((c) => c[0])), z0: Math.min(...coins.map((c) => c[1])), x1: Math.max(...coins.map((c) => c[0])), z1: Math.max(...coins.map((c) => c[1])) });
  }
  return boites;
}

// ============================================================================================================================
// 8. Aléa déterministe et tables
// ============================================================================================================================

/** Générateur déterministe sérialisable (mulberry32) : l'état est un entier 32 bits, copiable dans un instantané. */
export interface Rng { s: number }
export const creerRng = (graine: number): Rng => ({ s: graine >>> 0 });
/** Prochain tirage dans [0, 1). Le SEUL moyen d'obtenir du hasard dans `lib/rocket/` (jamais `Math.random`). */
export function tirer(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Tirage gaussien centré réduit (Box-Muller), consomme deux tirages. */
export function tirerGauss(r: Rng): number {
  const u = Math.max(tirer(r), 1e-12), v = tirer(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Interpolation linéaire dans une table triée `[x, y]`, bornée aux extrémités. */
export function interpolerTable(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// ============================================================================================================================
// 9. États
// ============================================================================================================================

export interface EtatBalle {
  /** centre */
  p: Vec3;
  v: Vec3;
  /** vitesse angulaire (monde, rad/s) */
  w: Vec3;
  /** dernier toucheur (pour les passes décisives, les arrêts et les stats) */
  dernierToucheur: { idVoiture: number; equipe: Equipe; temps: number } | null;
  /** toucheur précédent d'une AUTRE voiture (passes) */
  avantDernierToucheur: { idVoiture: number; equipe: Equipe; temps: number } | null;
}

export interface EtatSaut {
  /** le premier saut a eu lieu depuis le dernier contact au sol */
  aSaute: boolean;
  /** temps depuis l'impulsion du premier saut (s), 0 tant qu'il n'a pas eu lieu */
  temps: number;
  /** la phase de maintien (≤ 0,2 s, bouton tenu) est en cours */
  tenue: boolean;
  /** le second saut ou le flip a été dépensé */
  secondUtilise: boolean;
  /** temps passé sans contact depuis le décollage (s) */
  tempsEnLAir: number;
  /** temps écoulé depuis la fin du premier saut (bouton relâché ou 0,2 s de maintien) : fenêtre de 1,25 s du second saut (RL) */
  depuisFinSaut: number;
}

export interface EtatFlip {
  actif: boolean;
  /** s depuis le début du flip */
  temps: number;
  /** direction de dodge normalisée dans le repère de la voiture au moment du flip : [avant, droite] */
  dir: [number, number];
  /** vrai si le dodge est un « stall » (pas d'impulsion, rotation de roulis seule) */
  stall: boolean;
  /** s restantes pendant lesquelles le manche de tangage est ignoré */
  verrouTangage: number;
}

export interface StatsVoiture {
  buts: number;
  passes: number;
  arrets: number;
  tirs: number;
  demolitions: number;
  /** nombre de fois où la voiture a été démolie */
  demolie: number;
  touches: number;
  points: number;
}

export interface EtatVoiture {
  id: number;
  equipe: Equipe;
  /** 0..n-1 dans l'équipe (détermine la place de coup d'envoi) */
  slot: number;
  humain: boolean;
  nom: string;
  /** origine de la voiture (≠ centre de la hitbox, cf. `VOITURE.decalageHitbox`) */
  p: Vec3;
  v: Vec3;
  /** vitesse angulaire monde (rad/s) */
  w: Vec3;
  base: Base;
  /** 0..100 */
  boost: number;
  /** roues en contact avec une surface (0..4) et normale moyenne de ces contacts (null si aucune) */
  rouesContact: number;
  normaleSurface: Vec3 | null;
  /** `rouesContact >= VOITURE.rouesPourSol` : peut conduire, sauter, recevoir le collage */
  auSol: boolean;
  saut: EtatSaut;
  flip: EtatFlip;
  /** redressement automatique en cours (sur le toit) */
  redressement: { actif: boolean; temps: number };
  supersonique: boolean;
  /** le boost brûle ce pas ; `boostDepuis` = durée de l'appui en cours (s), pour la durée minimale */
  boostActif: boolean;
  boostDepuis: number;
  /** frein à main tenu et efficace au sol */
  derapage: boolean;
  /** détruite : invisible, intangible, entrées ignorées ; revient dans `reapparitionDans` secondes */
  demolie: boolean;
  reapparitionDans: number;
  /** immobilisée (décompte du coup d'envoi) : les entrées sont ignorées */
  figee: boolean;
  /** pas (tick) du dernier contact avec la balle / du dernier bump, pour les délais */
  dernierContactBalleTick: number;
  dernierBumpTick: number;
  /** état du bouton de saut au pas précédent (front montant) */
  sautPrecedent: boolean;
  stats: StatsVoiture;
}

export interface EtatPlot {
  id: number;
  actif: boolean;
  /** s avant réactivation si inactif */
  recharge: number;
}

export interface ConfigMatch {
  format: Format;
  /** équipe du joueur humain (un seul humain : le slot 0 de cette équipe) */
  equipeJoueur: Equipe;
  niveauAllies: NiveauBot;
  niveauAdversaires: NiveauBot;
  dureeS: number;
  /** graine du générateur déterministe de la partie (positions de coup d'envoi, bruit des bots) */
  graine: number;
  nomsEquipes: Record<Equipe, string>;
  nomJoueur: string;
}

/** Copie de la position/orientation du pas précédent, pour l'interpolation de l'affichage entre deux pas physiques. */
export interface InstantanePrecedent {
  voitures: { p: Vec3; base: Base }[];
  balle: { p: Vec3 };
}

export interface MondeRocket {
  config: ConfigMatch;
  arene: Arene;
  /** numéro du pas courant */
  tick: number;
  /** temps de jeu écoulé depuis le début de la partie, y compris décompte et célébrations (s) */
  temps: number;
  phase: PhaseMatch;
  /** s écoulées dans la phase courante (le décompte vaut `MATCH.decompteS - tempsPhase` restant) */
  tempsPhase: number;
  /** temps de jeu restant (s) ; en prolongation vaut 0 et `prolongation` est vrai */
  tempsRestant: number;
  prolongation: boolean;
  /** le chrono est à 0 mais la balle est en l'air : la fin attend qu'elle touche le sol */
  attenteSolBalle: boolean;
  score: Record<Equipe, number>;
  /** équipe qui vient de marquer pendant la phase « but » */
  dernierBut: { equipe: Equipe; idMarqueur: number | null; idPasse: number | null; vitesseKmh: number } | null;
  /** ordre : équipe bleue (slots 0..n-1) puis orange ; `id` = index dans ce tableau */
  voitures: EtatVoiture[];
  /** id de la voiture du joueur humain (slot 0 de `config.equipeJoueur`) */
  idHumain: number;
  balle: EtatBalle;
  plots: EtatPlot[];
  rng: Rng;
  precedent: InstantanePrecedent;
  /** vainqueur à la fin (null = pas fini) */
  vainqueur: Equipe | null;
}

// ============================================================================================================================
// 10. Entrées
// ============================================================================================================================

/**
 * Entrées d'UNE voiture à UN pas, analogiques dans [-1, 1] (le clavier donne -1, 0 ou 1). Convention de signe : tangage +1 = nez vers
 * le haut, lacet et direction +1 = vers la droite, roulis +1 = pencher à droite. `entrees.ts` remplit les deux mappings (sol/air).
 */
export interface EntreesVoiture {
  /** gaz (+1) / marche arrière ou frein (-1) */
  accel: number;
  /** volant au sol ; en l'air, lacet si `derapage` est faux, roulis si `derapage` est vrai (air roll libre, comme RL) */
  direction: number;
  tangage: number;
  /** lacet en l'air (écrase `direction` en l'air quand non nul) */
  lacet: number;
  /** roulis en l'air (touches Q/E, LB/RB) ; additionné à `direction` quand `derapage` est vrai en l'air */
  roulis: number;
  /** saut : maintenu (la voiture détecte le front montant) */
  saut: boolean;
  boost: boolean;
  /** frein à main au sol (powerslide) / air roll libre en l'air */
  derapage: boolean;
}
export const ENTREES_NULLES = (): EntreesVoiture => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });

/** Entrées du joueur humain en plus de la voiture : caméra, pause, klaxon. */
export interface EntreesJoueur {
  voiture: EntreesVoiture;
  /** bouton « ball cam » tenu à cet instant (la bascule se fait sur le front montant, dans `jeu.ts`) */
  basculerBalleCam: boolean;
  /** regard libre (stick droit / souris bouton droit), [-1, 1] horizontal, vertical */
  regard: [number, number];
  /** vue arrière tenue */
  arriere: boolean;
  klaxon: boolean;
  pause: boolean;
}

// ============================================================================================================================
// 11. Événements du match (pas par pas)
// ============================================================================================================================

export type EvenementMatch =
  | { t: "decompte"; n: 3 | 2 | 1 }
  | { t: "coupDEnvoi" }
  | { t: "toucheBalle"; idVoiture: number; force: number }
  | { t: "balleDecor"; vitesse: number; point: Vec3 }
  | { t: "but"; equipe: Equipe; idMarqueur: number | null; idPasse: number | null; vitesseKmh: number }
  | { t: "demolition"; victime: number; auteur: number; p: Vec3 }
  | { t: "reapparition"; idVoiture: number }
  | { t: "bump"; idVoiture: number; autre: number; vitesse: number }
  | { t: "plot"; idVoiture: number; idPlot: number; gros: boolean; gain: number }
  | { t: "plotRecharge"; idPlot: number }
  | { t: "saut"; idVoiture: number }
  | { t: "doubleSaut"; idVoiture: number }
  | { t: "flip"; idVoiture: number; dir: [number, number]; stall: boolean }
  | { t: "atterrissage"; idVoiture: number; vitesse: number }
  | { t: "choc"; idVoiture: number; vitesse: number }
  | { t: "boost"; idVoiture: number; actif: boolean }
  | { t: "supersonique"; idVoiture: number; actif: boolean }
  | { t: "arret"; idVoiture: number }
  | { t: "klaxon"; idVoiture: number }
  | { t: "prolongation" }
  | { t: "chronoZero" }
  | { t: "fin"; vainqueur: Equipe | null };
export type TypeEvenement = EvenementMatch["t"];
/** Événements qu'émet `pasVoiture` (le reste vient de `contacts.ts`, `balle.ts` et `match.ts`). */
export type EvenementVoiture = Extract<EvenementMatch, { t: "saut" | "doubleSaut" | "flip" | "atterrissage" | "choc" | "boost" | "supersonique" }>;

// ============================================================================================================================
// 12. Caméra et réglages
// ============================================================================================================================

/** Réglages de caméra par défaut de Rocket League (FOV horizontal 110°, distance 270 uu, hauteur 100 uu, angle -4°, rigidité 0,45). */
export interface ParamsCamera {
  /** champ HORIZONTAL en degrés (60..110) */
  fov: number;
  /** distance derrière la voiture (m) : 1,0..4,0 (RL 100..400 uu) */
  distance: number;
  /** hauteur (m) : 0,4..2,0 (RL 40..200 uu) */
  hauteur: number;
  /** inclinaison (degrés) : -15..0 */
  angle: number;
  /** rigidité : 0 (très souple) .. 1 (collée) */
  rigidite: number;
  /** vitesse du regard libre (1..10) et de la transition ball cam ↔ car cam (1..2) */
  vitesseRegard: number;
  vitesseTransition: number;
}
export const CAMERA_DEFAUT: ParamsCamera = { fov: 110, distance: uu(270), hauteur: uu(100), angle: -4, rigidite: 0.45, vitesseRegard: 4.6, vitesseTransition: 1.2 };

export interface PoseCamera {
  /** repère LOCAL du stade ; le rendu y attache la caméra three (cf. `RenduRocket.racine`) */
  position: Vec3;
  cible: Vec3;
  haut: Vec3;
  /** champ VERTICAL (degrés) pour `PerspectiveCamera` ; `fovVertical = 2·atan(tan(fov_h / 2) / aspect)` */
  fovVertical: number;
}

export interface EntreesCamera {
  balleCam: boolean;
  regard: readonly [number, number];
  arriere: boolean;
}

export interface EtatCamera {
  /** direction de visée lissée (unitaire) */
  dir: Vec3;
  /** haut lissé */
  haut: Vec3;
  /** 0 = car cam, 1 = ball cam (lissé par `vitesseTransition`) */
  melange: number;
  /** angle de regard libre lissé (rad) : [lacet, tangage] */
  regard: [number, number];
  /** secousse (mètres) en cours, décroissante ; ignorée si `mouvementReduit` */
  secousse: number;
  position: Vec3;
}

/** Les actions rebindables (clavier / souris). Valeurs = `KeyboardEvent.code` (positions physiques : WASD = ZQSD sur AZERTY) ou `Souris0`/`Souris1`/`Souris2`. */
export interface LiaisonsTouches {
  accelerer: readonly string[];
  reculer: readonly string[];
  gauche: readonly string[];
  droite: readonly string[];
  saut: readonly string[];
  boost: readonly string[];
  derapage: readonly string[];
  rouleGauche: readonly string[];
  rouleDroite: readonly string[];
  balleCam: readonly string[];
  arriere: readonly string[];
  klaxon: readonly string[];
  pause: readonly string[];
}
export const LIAISONS_DEFAUT: LiaisonsTouches = {
  accelerer: ["KeyW", "ArrowUp"],
  reculer: ["KeyS", "ArrowDown"],
  gauche: ["KeyA", "ArrowLeft"],
  droite: ["KeyD", "ArrowRight"],
  saut: ["Space"],
  boost: ["ShiftLeft", "Souris0"],
  derapage: ["KeyC", "ControlLeft"],
  rouleGauche: ["KeyQ"],
  rouleDroite: ["KeyE"],
  balleCam: ["KeyY", "Souris2"],
  arriere: ["KeyV"],
  klaxon: ["KeyH"],
  pause: ["Escape"],
};

export interface ReglagesRocket {
  camera: ParamsCamera;
  touches: LiaisonsTouches;
  /** ball cam active au lancement et après chaque but */
  balleCamParDefaut: boolean;
  /** volume général 0..1 */
  volume: number;
  /** zone morte des sticks (0..0.4) et inversion du tangage de la manette */
  zoneMorteManette: number;
  inverserTangageManette: boolean;
  /** vibrations de la manette */
  vibrations: boolean;
}
export const REGLAGES_DEFAUT = (): ReglagesRocket => ({
  camera: { ...CAMERA_DEFAUT },
  touches: { ...LIAISONS_DEFAUT },
  balleCamParDefaut: true,
  volume: 0.7,
  zoneMorteManette: 0.12,
  inverserTangageManette: false,
  vibrations: true,
});

export const DEFAUT_CONFIG = (): ConfigMatch => ({
  format: "2v2", equipeJoueur: "bleue", niveauAllies: "pro", niveauAdversaires: "pro", dureeS: MATCH.dureeDefautS, graine: 1,
  nomsEquipes: { ...NOMS_EQUIPES_DEFAUT }, nomJoueur: "Agent",
});

// ============================================================================================================================
// 13. HUD et fin de match (jeu.ts → React)
// ============================================================================================================================

export interface LigneFil {
  id: number;
  texte: string;
  equipe: Equipe | null;
}
export interface BanniereHud {
  id: number;
  /** « BUT ! », « DÉMOLITION », « 3 », « GO ! », « PROLONGATION », « PLUS QUE 30 SECONDES » */
  texte: string;
  sousTexte?: string;
  equipe?: Equipe | null;
  /** durée d'affichage en s (le HUD la retire seul) */
  dureeS: number;
}
export interface LigneClassement {
  id: number;
  nom: string;
  equipe: Equipe;
  humain: boolean;
  stats: StatsVoiture;
}
export interface ResultatMatch {
  vainqueur: Equipe | null;
  score: Record<Equipe, number>;
  prolongation: boolean;
  /** équipe du joueur humain */
  equipeJoueur: Equipe;
  classement: LigneClassement[];
  /** meilleur joueur (points) */
  mvp: number | null;
}

export interface HudRocket {
  phase: PhaseMatch;
  score: Record<Equipe, number>;
  nomsEquipes: Record<Equipe, string>;
  /** temps restant (s, arrondi à la seconde supérieure pour l'affichage), prolongation = vrai */
  tempsRestant: number;
  prolongation: boolean;
  /** valeur du décompte affichée (3, 2, 1) ou null */
  decompte: number | null;
  /** boost du joueur 0..100 et vitesse en km/h (RL : uu/s × 0,036) */
  boost: number;
  vitesseKmh: number;
  supersonique: boolean;
  demolie: boolean;
  reapparitionDans: number;
  equipeJoueur: Equipe;
  balleCam: boolean;
  /** rejeu d'un but en cours (vu de derrière `buteur`) ; absent ou null hors rejeu */
  rejeu?: { buteur: string; equipe: Equipe } | null;
  banniere: BanniereHud | null;
  fil: LigneFil[];
  enPause: boolean;
  manette: boolean;
  /** vrai quand un message d'aide des touches doit s'afficher (les 8 premières secondes de la partie) */
  aide: boolean;
  /** pointage des joueurs maintenu (Tab) */
  classement: LigneClassement[];
  resultat: ResultatMatch | null;
}

// ============================================================================================================================
// 14. SIGNATURES DES MODULES
// ============================================================================================================================

// ---- A. arene.ts ---------------------------------------------------------------------------------------------------------

/**
 * Le stade : un champ de distance signée CONTINU et lisse (raccords arrondis), à la fois pour la balle (qui rebondit) et pour la
 * voiture (qui roule sur le sol, les murs et le plafond). `sd > 0` = espace libre, `sd < 0` = dans la matière ; le gradient
 * est la normale vers l'espace libre. Aucune allocation dans `sd` / `sdNormale`.
 */
export interface Arene {
  /** distance signée (m) au plus proche obstacle ; exacte (1-Lipschitz) à moins d'1 m des surfaces, un minorant sûr plus loin */
  sd(p: Readonly<Vec3>): number;
  /** normale unitaire (gradient de `sd`, différences centrées à 1 cm) */
  normale(p: Readonly<Vec3>): Vec3;
  /** écrit la normale dans `n` et rend `sd(p)` (variante sans allocation, 4 évaluations de `sd` au plus) */
  sdNormale(p: Readonly<Vec3>, n: Vec3): number;
  /** équipe qui MARQUE si le centre d'une balle de rayon `rayon` est en `p` (au-delà de la ligne de but, dans la cage) ; null sinon */
  butMarque(p: Readonly<Vec3>, rayon: number): Equipe | null;
  /** équipe dont `p` est dans la cage (boîte de la cage, pour bots et arrêts), null hors cage */
  dansCage(p: Readonly<Vec3>): Equipe | null;
  /** premier impact d'un rayon (sphere tracing) : distance, ou null au-delà de `max` */
  lancerRayon(o: Readonly<Vec3>, d: Readonly<Vec3>, max: number): number | null;
  /** point de la surface le plus proche et sa normale (projette `p` le long du gradient, 4 itérations) */
  surfaceProche(p: Readonly<Vec3>): { point: Vec3; normale: Vec3; distance: number };
}
/** Implémenté par `arene.ts`. Pure, déterministe, sans état global (peut être appelée plusieurs fois). */
export type CreerArene = () => Arene;

// ---- B. balle.ts ---------------------------------------------------------------------------------------------------------

export interface ImpactBalle {
  /** vitesse normale à l'impact (m/s, > 0) */
  vitesse: number;
  point: Vec3;
  normale: Vec3;
}
/** Implémenté par `balle.ts`. Balle au centre, au repos. */
export type CreerBalle = (p?: Readonly<Vec3>) => EtatBalle;
/**
 * Avance la balle de `dt` (≤ PAS_S) contre le décor : gravité, amortissements, collision SDF (position, restitution 0,6, frottement,
 * spin), plafonds de vitesse. Découpe en sous-pas si nécessaire (jamais de tunnel). Rend le plus fort impact du pas, ou null.
 * Implémenté par `balle.ts` (`pasBalle`).
 */
export type PasBalle = (a: Arene, b: EtatBalle, dt: number) => ImpactBalle | null;
export interface EchantillonBalle {
  /** temps depuis maintenant (s) */
  t: number;
  p: Vec3;
  v: Vec3;
}
/**
 * Prévision de la trajectoire de la balle SEULE (pas de voiture) pour les bots, sans modifier `b` : échantillons tous les `pasS`
 * (30 Hz par défaut) sur `dureeS`, intégrés en interne à PAS_S. Implémenté par `balle.ts` (`predireBalle`).
 */
export type PredireBalle = (a: Arene, b: Readonly<EtatBalle>, dureeS: number, pasS?: number) => EchantillonBalle[];

// ---- C. voiture.ts + contacts.ts ----------------------------------------------------------------------------------------

export interface ParamsCreationVoiture {
  id: number;
  equipe: Equipe;
  slot: number;
  humain: boolean;
  nom: string;
  p: Vec3;
  cap: number;
}
/** Voiture posée à plat au point `p` (origine), cap donné, boost initial, vitesse nulle. Implémenté par `voiture.ts` (`creerVoiture`). */
export type CreerVoiture = (p: ParamsCreationVoiture) => EtatVoiture;
/** Repose une voiture au coup d'envoi / à la réapparition : position, cap, vitesse nulle, boost 33,33 ou donné, états de saut remis. Implémenté par `voiture.ts` (`replacerVoiture`). */
export type ReplacerVoiture = (v: EtatVoiture, p: Readonly<Vec3>, cap: number, boost?: number) => void;
/**
 * Un pas de la voiture (conduite au sol/murs/plafond, saut, double saut/flip, contrôle aérien, boost, dérapage, contact des roues et du
 * corps avec le décor, redressement). N'agit ni sur la balle ni sur les autres voitures. `tick` sert aux délais. Rend les événements du
 * pas (`EvenementVoiture`). Une voiture `demolie` ou `figee` ignore les entrées (mais la physique de la figée continue : gravité, collage).
 * Implémenté par `voiture.ts` (`pasVoiture`).
 */
export type PasVoiture = (a: Arene, v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, tick: number) => EvenementVoiture[];
/** Centre de la hitbox en monde (`p` + base × décalage). Implémenté par `voiture.ts` (`centreHitbox`). */
export type CentreHitbox = (v: Readonly<EtatVoiture>) => Vec3;
/** Les 8 coins de la hitbox en monde. Implémenté par `voiture.ts` (`coinsHitbox`). */
export type CoinsHitbox = (v: Readonly<EtatVoiture>) => Vec3[];

export interface ContactBalle {
  /** vitesse relative balle/voiture avant le choc (m/s) */
  force: number;
  point: Vec3;
}
/**
 * Contact voiture ↔ balle (hitbox orientée contre sphère) : séparation, impulsion physique (restitution 0,6, masses 180 / 30,
 * couple sur la voiture) PUIS impulsion supplémentaire de Psyonix (`CONTACT_BALLE`) si le délai est écoulé ; met à jour
 * `dernierContactBalleTick` ; ne touche pas `balle.dernierToucheur` (c'est `match.ts`). Rend null s'il n'y a pas de contact.
 * Implémenté par `contacts.ts` (`contactVoitureBalle`).
 */
export type ContactVoitureBalle = (v: EtatVoiture, b: EtatBalle, tick: number, dt: number) => ContactBalle | null;
export interface ContactVoitures {
  /** l'attaquant démolit la victime (conditions de `CONTACT_VOITURES`) : le match marque la victime, ce module ne touche PAS `demolie` */
  demolition: { auteur: number; victime: number } | null;
  /** un bump (choc avec impulsion supplémentaire) a eu lieu */
  bump: { vitesse: number } | null;
}
/**
 * Contact voiture ↔ voiture (SAT de deux boîtes orientées) : séparation, impulsion (restitution 0,1, frottement), bump, détection de
 * la démolition. Rend null sans contact. Implémenté par `contacts.ts` (`contactVoitureVoiture`).
 */
export type ContactEntreVoitures = (a: EtatVoiture, b: EtatVoiture, tick: number) => ContactVoitures | null;

// ---- D. match.ts + bots.ts -----------------------------------------------------------------------------------------------

/**
 * Crée le monde : voitures (humain = slot 0 de `equipeJoueur`, tous les autres sont des bots), balle au centre, plots pleins, score
 * 0-0, phase « decompte ». `arene` vient de `creerArene()` si absent. Implémenté par `match.ts` (`creerMonde`).
 */
export type CreerMonde = (config: ConfigMatch, arene?: Arene) => MondeRocket;
/**
 * Un pas du match : entrées → voitures (`pasVoiture`) → balle (`pasBalle`) → contacts (voiture-balle, voiture-voiture, démolitions)
 * → plots → règles (but, chrono, prolongation, fin) → phases (décompte, célébration, remise en jeu). `entrees[i]` correspond à
 * `monde.voitures[i]`. `dt` vaut `PAS_S` (tests : moins). Remplit d'abord `monde.precedent`. Rend les événements du pas, dans l'ordre.
 * Implémenté par `match.ts` (`pasMonde`).
 */
export type PasMonde = (m: MondeRocket, entrees: readonly Readonly<EntreesVoiture>[], dt?: number) => EvenementMatch[];
/** Fin de partie anticipée / résultat courant (classement trié par points décroissants). Implémenté par `match.ts` (`resultatMatch`). */
export type ResultatCourant = (m: Readonly<MondeRocket>) => ResultatMatch;
/** Repose voitures, balle et plots pour un coup d'envoi (décompte). Implémenté par `match.ts` (`preparerCoupDEnvoi`). */
export type PreparerCoupDEnvoi = (m: MondeRocket) => void;

/** Un cerveau de bot : lit le monde, rend les entrées de SA voiture. Aucune triche (même physique, mêmes entrées que l'humain, pas de téléportation). */
export interface Cerveau {
  decider(m: Readonly<MondeRocket>, moi: Readonly<EtatVoiture>, dt: number): EntreesVoiture;
}
/** Un cerveau par bot, semé par `graine` (bruit de visée, hésitations). Implémenté par `bots.ts` (`creerCerveau`). */
export type CreerCerveau = (niveau: NiveauBot, graine: number) => Cerveau;

// ---- E. rendu.ts + sons.ts -----------------------------------------------------------------------------------------------

export interface OptionsRendu {
  qualite: "haute" | "basse";
  mouvementReduit: boolean;
  nomsEquipes: Record<Equipe, string>;
}
export interface RenduRocket {
  /**
   * Racine à ajouter à la scène three : porte la transformation du site (position `SITE.centre`, rotation `SITE.cap`, hauteur
   * `SITE.hauteurSol`). Tout son contenu est dans le repère LOCAL du stade ; la caméra du jeu en est un enfant.
   */
  readonly racine: THREE.Group;
  /** place voitures, balle, plots, effets d'après `monde` interpolé entre `monde.precedent` et l'état courant par `alpha` ∈ [0,1] ; `dtImage` anime les effets (s) */
  synchroniser(m: Readonly<MondeRocket>, alpha: number, dtImage: number): void;
  /** réagit à un événement (traînée, explosion, étincelles, flash de plot…) */
  evenement(e: Readonly<EvenementMatch>, m: Readonly<MondeRocket>): void;
  /** taille du canvas changée (résolution des lignes épaisses, le cas échéant) */
  redimensionner(largeur: number, hauteur: number): void;
  dispose(): void;
}
/** Implémenté par `rendu.ts` (`creerRenduRocket`). Les données de la scène Agroparc ne servent pas ici : le décor autour est construit par `jeu.ts`. */
export type CreerRenduRocket = (m: Readonly<MondeRocket>, opts: OptionsRendu) => RenduRocket;

export interface SonsRocket {
  /** crée/relance le contexte audio (à appeler dans un geste utilisateur : clic sur « Lancer ») */
  activer(): void;
  evenement(e: Readonly<EvenementMatch>, idMoi: number): void;
  /** chaque image : moteur (hauteur selon la vitesse et le boost) de la voiture du joueur et des plus proches, avec spatialisation simple */
  maj(m: Readonly<MondeRocket>, idMoi: number, dtImage: number): void;
  volume(v: number): void;
  suspendre(actif: boolean): void;
  dispose(): void;
}
/** Implémenté par `sons.ts` (`creerSonsRocket`). WebAudio uniquement, aucun fichier audio. */
export type CreerSonsRocket = () => SonsRocket;

// ---- F. jeu.ts + camera.ts + entrees.ts + reglages.ts -------------------------------------------------------------------

/**
 * Caméra de Rocket League : car cam / ball cam, rigidité, regard libre, vue arrière, secousse, anticollision avec le stade (la caméra ne
 * sort jamais de l'arène : on la rapproche de la voiture le long du rayon jusqu'à `sd > 0,4 m`). Pure. Implémenté par `camera.ts` (`creerEtatCamera`, `majCamera`).
 */
export type CreerEtatCamera = (moi: Readonly<EtatVoiture>, balle: Readonly<EtatBalle>, balleCam: boolean) => EtatCamera;
export type MajCamera = (e: EtatCamera, p: Readonly<ParamsCamera>, entree: EntreesCamera, moi: Readonly<EtatVoiture>, balle: Readonly<EtatBalle>, arene: Arene, dt: number, aspect: number, mouvementReduit: boolean) => PoseCamera;

export interface InstantaneClavier {
  /** `KeyboardEvent.code` des touches enfoncées */
  touches: ReadonlySet<string>;
  /** boutons de la souris enfoncés (0 gauche, 1 milieu, 2 droit) → codes `Souris0..2` ajoutés à `touches` par la source */
  deplacementSouris: readonly [number, number];
}
export interface InstantaneManette {
  /** `Gamepad.axes` (mapping « standard » : 0/1 stick gauche, 2/3 stick droit) */
  axes: readonly number[];
  /** `Gamepad.buttons` (RT = 7, LT = 6, A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, Start = 9, R3 = 11) */
  boutons: readonly { pressed: boolean; value: number }[];
}
/** Clavier/souris → entrées (pure). Implémenté par `entrees.ts` (`entreesDepuisClavier`). */
export type EntreesDepuisClavier = (i: InstantaneClavier, l: Readonly<LiaisonsTouches>) => EntreesJoueur;
/** Manette → entrées (pure, zone morte radiale, courbe quadratique sur les sticks). Implémenté par `entrees.ts` (`entreesDepuisManette`). */
export type EntreesDepuisManette = (m: InstantaneManette, r: Pick<ReglagesRocket, "zoneMorteManette" | "inverserTangageManette">) => EntreesJoueur;
/** Combine deux sources (la plus forte l'emporte pour chaque axe, OU logique pour les boutons). Implémenté par `entrees.ts` (`fusionnerEntrees`). */
export type FusionnerEntrees = (a: EntreesJoueur, b: EntreesJoueur) => EntreesJoueur;
export interface SourceEntrees {
  /** lit l'état courant (clavier + souris + première manette connectée) */
  echantillonner(): EntreesJoueur;
  manetteConnectee(): boolean;
  /** réinitialise les touches (perte de focus) */
  relacher(): void;
  /** vibre sur la manette (no-op sans manette ou sans actionneur) */
  vibrer(intensite: number, dureeMs: number): void;
  dispose(): void;
}
/** Branche les écouteurs sur `cible` (window) ; les liaisons sont lues à chaque échantillon. Implémenté par `entrees.ts` (`creerSourceEntrees`). */
export type CreerSourceEntrees = (cible: Window, liaisons: () => Readonly<LiaisonsTouches>, reglages: () => Readonly<ReglagesRocket>) => SourceEntrees;

/** Lecture / écriture / normalisation des réglages (`localStorage` `pdj-rocket-reglages`, jamais d'exception). Pure sauf le stockage injecté. Implémenté par `reglages.ts`. */
export interface StockageMinimal {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export type NormaliserReglages = (brut: unknown) => ReglagesRocket;
export type LireReglages = (s: StockageMinimal | null) => ReglagesRocket;
export type EcrireReglages = (r: Readonly<ReglagesRocket>, s: StockageMinimal | null) => void;

export interface OptionsJeuRocket {
  config: ConfigMatch;
  reglages: ReglagesRocket;
  /** état du HUD : au plus 20 Hz, plus les changements d'événement */
  hud(h: HudRocket): void;
  /** le joueur quitte (menu pause ou écran de fin) */
  sortir(): void;
  /** échec de démarrage (WebGL, contexte perdu) */
  erreur(texte: string): void;
}
export interface JeuRocketHandle {
  /** libère renderer, contexte WebGL, écouteurs, audio, boucle */
  dispose(): void;
  pause(actif: boolean): void;
  estEnPause(): boolean;
  /** relance une partie avec la même config (nouvelle graine) */
  recommencer(): void;
  reglages(r: ReglagesRocket): void;
  basculerBalleCam(): void;
  /** demande les stats complètes (Tab) */
  afficherClassement(actif: boolean): void;
}
/**
 * Boucle du jeu : renderer three + décor d'Agroparc autour du stade (`construireDecor` avec `exclure: boitesExclusionSite()`), `RenduRocket`,
 * sons, entrées, caméra, accumulateur de pas fixes (PAS_S, au plus PAS_MAX_PAR_IMAGE par image), bots, HUD, pause (Échap, perte de
 * focus), fin de partie. Aucun import synchrone depuis `Agroparc3D.tsx` : montée par `import("@/lib/rocket/jeu")`.
 * Implémenté par `jeu.ts` (`creerJeuRocket`).
 */
export type CreerJeuRocket = (canvas: HTMLCanvasElement, scene: SceneData, opts: OptionsJeuRocket) => JeuRocketHandle;

// ---- G. UI et intégration ------------------------------------------------------------------------------------------------

/** Normalise une config lue du stockage (`pdj-rocket-config`) ou d'un formulaire : valeurs hors liste ramenées au défaut. Pure. Implémenté par `lib/rocket/lobby.ts` (`normaliserConfig`). */
export type NormaliserConfig = (brut: unknown) => ConfigMatch;
/** Libellé court d'une config pour le bouton « Lancer » et l'infobulle (« 2v2 · Pro · 5 min »). Implémenté par `lib/rocket/lobby.ts` (`libelleConfig`). */
export type LibelleConfig = (c: Readonly<ConfigMatch>) => string;

/**
 * Crochet de développement (hors production) posé par `jeu.ts` sur `window.__rocket` : `etat()` (monde sérialisable), `monde()`,
 * `avancer(n)` (n pas sans rendu), `geler(b)`, `entrees(i, e | null)` (surcharge les entrées de la voiture i), `teleporter(i, p, cap?)`,
 * `balle(p, v?)`, `evenements()` (journal des 200 derniers), `hud()`, `pause(b)`.
 */
export interface CrochetRocket {
  etat(): unknown;
  monde(): MondeRocket;
  avancer(pas: number): EvenementMatch[];
  geler(actif: boolean): void;
  entrees(i: number, e: EntreesVoiture | null): void;
  teleporter(i: number, p: Vec3, cap?: number): void;
  balle(p: Vec3, v?: Vec3): void;
  evenements(): EvenementMatch[];
  hud(): HudRocket | null;
  pause(actif: boolean): void;
}
declare global {
  interface Window {
    __rocket?: CrochetRocket;
  }
}
