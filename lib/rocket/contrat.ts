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
  /**
   * hauteur du plafond : 20,48 m (RocketSim ARENA_HEIGHT = 2048 uu : Arena.cpp pose le plan du plafond à z = 2048, comme il pose le sol
   * à 0 et les murs latéraux à ±4096 ; le wiki RLBot arrondit à 2044)
   */
  hauteur: uu(2048),
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
  /** demi-largeur de l'ouverture : 8,92755 m (RocketSim Arena.cpp APPROX_GOAL_HALF_WIDTH = 892,755 uu), soit 17,8551 m de large */
  demiLargeur: uu(892.755),
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
  /** rayon de collision : 0,9125 m (RocketSim BALL_COLLISION_RADIUS_SOCCAR = 91,25 uu ; le modèle visuel fait 92,75) */
  rayon: uu(91.25),
  rayonVisuel: uu(92.75),
  /** masse (RocketSim BALL_MASS_BT = CAR_MASS_BT / 6 = 30) ; la voiture pèse 180 */
  masse: 30,
  /** restitution contre le décor (RocketSim BALL_RESTITUTION = 0,6 ; Bullet garde le max de la balle et du décor, ARENA_COLLISION_BASE_RESTITUTION = 0,3) */
  restitution: 0.6,
  /**
   * sous cette vitesse normale d'approche (mesurée AVANT la gravité du pas), le contact ne rebondit plus : 0,1 m/s (Bullet
   * btContactSolverInfo::m_restitutionVelocityThreshold = 0,2 unité Bullet par seconde = 10 uu/s, restitutionCurve)
   */
  seuilRebond: uu(10),
  /** frottement de Coulomb contre le décor (RocketSim BALL_FRICTION = 0,35 ; Bullet garde le min de la balle et du décor, ARENA_COLLISION_BASE_FRICTION = 0,6) */
  frottement: 0.35,
  /**
   * le contact balle / décor existe dès que la surface de la balle est à moins de 1,905 cm de la matière (Bullet : seuil de rupture
   * d'un contact = gContactBreakingThreshold 0,02 × (rayon 1,825 + 0,08) unité Bullet = 1,905 uu, btCollisionShape::getBoundingSphere
   * modifié par RocketSim). C'est ce qui fait reposer la balle au-dessus de son rayon (BALL_REST_Z = 93,15 uu) ; même seuil pour le
   * contact voiture ↔ balle (le plus petit des deux corps, la voiture donnerait 2,03 uu)
   */
  margeContact: uu(1.905),
  /** amortissement linéaire (RocketSim BALL_DRAG = 0,03) : `v ← v × (1 - 0,03)^dt`, avant la gravité du pas (Bullet applyDamping) */
  amortissementLineaire: 0.03,
  /**
   * amortissement angulaire : NUL (RocketSim Arena.cpp `ball->_rigidBody.setDamping(ballDrag, 0)`). Aucun frottement de roulement non
   * plus (Arena.cpp `setRollingFriction(0)`, contact fusionné construit avec rollingFriction = 0) : le spin ne change que par le
   * frottement de Coulomb des contacts et par le plafond de 6 rad/s
   */
  amortissementAngulaire: 0,
  /** vitesse maximale (RocketSim BALL_MAX_SPEED = 6000 uu/s) et vitesse angulaire maximale (BALL_MAX_ANG_SPEED = 6 rad/s), appliquées une fois en fin de pas */
  vitesseMax: uu(6000),
  vitesseAngMax: 6,
  /** moment d'inertie d'une sphère pleine : `0,4 × m × r²` (calculé à l'usage) */
  facteurInertie: 0.4,
  /** hauteur du centre à l'engagement : 0,9315 m (RocketSim BALL_REST_Z = 93,15 uu : le rayon plus la marge de contact du décor) */
  hauteurEngagement: uu(93.15),
} as const;

// ============================================================================================================================
// 4. Voiture (Octane, la seule carrosserie)
// ============================================================================================================================

export const VOITURE = {
  /** RocketSim CAR_MASS_BT = 180 */
  masse: 180,
  /**
   * boîte de collision de l'Octane : 1,20507 × 0,866994 × 0,386591 m (RocketSim CarConfig.cpp HITBOX_SIZES[OCTANE] = 120,507 × 86,6994 ×
   * 38,6591 uu). Les valeurs « courantes » (118,01 × 84,20 × 36,16) sont celles que le jeu affiche, pas celles de la simulation : ce
   * sont ces dimensions-ci qui redonnent la matrice d'inertie mesurée en jeu (roulis 13,517, tangage 24,025, lacet 33,058 kg·m²)
   */
  hitbox: { longueur: uu(120.507), largeur: uu(86.6994), hauteur: uu(38.6591) },
  /** centre de la boîte par rapport à l'origine de la voiture, repère local [avant, droite, haut] (RocketSim HITBOX_OFFSETS[OCTANE] = 13,8757 ; 0 ; 20,755 uu) */
  decalageHitbox: [uu(13.8757), 0, uu(20.755)] as readonly [number, number, number],
  /** hauteur de l'origine au-dessus du sol, voiture posée (RocketSim CAR_SPAWN_REST_Z = 17 uu) */
  hauteurRepos: uu(17),
  /** hauteur de l'origine à la réapparition après une démolition : la voiture tombe de 19 cm (RocketSim CAR_RESPAWN_Z = 36 uu) */
  hauteurReapparition: uu(36),
  /**
   * roues, repère local [avant, droite, haut] (RocketSim CarConfig.cpp, Octane) : `attache` = point d'attache de la suspension
   * (FRONT_WHEELS_OFFSET = 51,25 ; 25,90 ; 20,755 uu, BACK_WHEELS_OFFSET = -33,75 ; 29,50 ; 20,755 uu), `local` = centre de la roue à
   * l'équilibre (25,255 / 22,755 uu sous l'attache), `rayon` (FRONT / BACK_WHEEL_RADS = 12,5 / 15 uu). `marge` : la roue « touche »
   * jusqu'à cette distance sous le bas du pneu, comme le rayon lancé par RocketSim (btVehicleRL::rayCast : repos + course + rayon -
   * SUSPENSION_SUBTRACTION, soit 26,755 + 12 + 12,5 - 2,5 = 48,755 uu sous l'attache à l'avant et 25,055 + 12 + 15 - 2,5 = 49,555 uu à
   * l'arrière : 11,0 et 11,8 uu sous le pneu). Ordre de RocketSim : avant droite, avant gauche, arrière droite, arrière gauche
   */
  roues: [
    { local: [uu(51.25), uu(25.9), uu(-4.5)] as readonly [number, number, number], attache: [uu(51.25), uu(25.9), uu(20.755)] as readonly [number, number, number], rayon: uu(12.5), marge: uu(11.0), avant: true },
    { local: [uu(51.25), uu(-25.9), uu(-4.5)] as readonly [number, number, number], attache: [uu(51.25), uu(-25.9), uu(20.755)] as readonly [number, number, number], rayon: uu(12.5), marge: uu(11.0), avant: true },
    { local: [uu(-33.75), uu(29.5), uu(-2)] as readonly [number, number, number], attache: [uu(-33.75), uu(29.5), uu(20.755)] as readonly [number, number, number], rayon: uu(15), marge: uu(11.8), avant: false },
    { local: [uu(-33.75), uu(-29.5), uu(-2)] as readonly [number, number, number], attache: [uu(-33.75), uu(-29.5), uu(20.755)] as readonly [number, number, number], rayon: uu(15), marge: uu(11.8), avant: false },
  ],
  /** nombre de roues en contact pour être « au sol » (RocketSim Car.cpp : isOnGround = numWheelsInContact >= 3) */
  rouesPourSol: 3,
  /** vitesse maximale (RocketSim CAR_MAX_SPEED = 2300 uu/s) ; vitesse angulaire maximale (CAR_MAX_ANG_SPEED = 5,5 rad/s) */
  vitesseMax: uu(2300),
  vitesseAngMax: 5.5,
  /**
   * supersonique : s'allume à 22,00 m/s (RocketSim SUPERSONIC_START_SPEED = 2200 uu/s). Pendant la première seconde passée supersonique
   * (SUPERSONIC_MAINTAIN_MAX_TIME = 1 s) il se maintient jusqu'à 21,00 m/s (SUPERSONIC_MAINTAIN_MIN_SPEED = 2100 uu/s) ; au-delà d'une
   * seconde il faut rester à 22 m/s
   */
  supersoniqueOn: uu(2200),
  supersoniqueOff: uu(2100),
  supersoniqueMaintienS: 1,
  /** boost au spawn (RocketSim BOOST_SPAWN_AMOUNT = 100 / 3) */
  boostInitial: 100 / 3,
} as const;

/**
 * Conduite : le modèle de pneu de RocketSim (btVehicleRL::calcFrictionImpulses + Car::_UpdateWheels), roue par roue. Chaque roue en
 * contact pousse le long de sa direction de roulement (moteur ou frein) et freine le glissement le long de son essieu ; les roues
 * avant sont braquées : le virage en découle, il n'est plus imposé.
 */
export const CONDUITE = {
  /**
   * accélération du gaz selon la vitesse avant (m/s → m/s²), les QUATRE roues au sol : 16 à l'arrêt, 1,6 à 14 m/s, 0 à 14,1 m/s
   * (RocketSim THROTTLE_TORQUE_AMOUNT = masse × 400 uu/s² PAR ROUE, DRIVE_SPEED_TORQUE_FACTOR_CURVE = 1 → 0,1 à 1400 → 0 à 1410 uu/s).
   * Chaque roue en contact en donne le quart ; avec moins de trois roues, le quart de cela encore (Car.cpp : driveSpeedScale /= 4)
   */
  courbeGaz: [[0, uu(1600)], [uu(1400), uu(160)], [uu(1410), 0]] as readonly (readonly [number, number])[],
  /** vitesse maximale sans boost (RocketSim : la courbe ci-dessus s'annule à 1410 uu/s) */
  vitesseGazMax: uu(1410),
  /** en dessous de cette valeur absolue, le gaz est ignoré (RocketSim THROTTLE_DEADZONE = 0,001) */
  zoneMorteGaz: 0.001,
  /** décélération du frein, les quatre roues au sol : 35 m/s² (RocketSim BRAKE_TORQUE_AMOUNT = masse × (14,25 + 1/3) : 875 uu/s² par roue) */
  frein: uu(3500),
  /** décélération « roue libre » (aucun gaz) : 15 % du frein, 5,25 m/s² (RocketSim COASTING_BRAKE_FACTOR = 0,15) */
  facteurRoueLibre: 0.15,
  rouleLibre: uu(525),
  /** sous cette vitesse avant, un gaz opposé inverse le sens sans freiner, et la roue libre devient un frein plein : arrêt franc (RocketSim STOPPING_FORWARD_VEL = 25 uu/s) */
  seuilArretFrein: uu(25),
  /** pente du frein d'une roue selon sa vitesse de roulement (1/s) : frein = clamp(v × 37,913, ± frein / 4) (RocketSim ROLLING_FRICTION_SCALE_MAGIC = 113,73963, divisé par 3 par l'échelle masse / 3) */
  penteFrein: 113.73963 / 3,
  /** angle de braquage des roues avant (rad) selon la vitesse avant (m/s) (RocketSim STEER_ANGLE_FROM_SPEED_CURVE : 0,53356 / 0,31930 / 0,18203 / 0,10570 / 0,08507 / 0,03454 à 0 / 500 / 1000 / 1500 / 1750 / 3000 uu/s) */
  angleBraquage: [[0, 0.53356], [uu(500), 0.3193], [uu(1000), 0.18203], [uu(1500), 0.1057], [uu(1750), 0.08507], [uu(3000), 0.03454]] as readonly (readonly [number, number])[],
  /** angle de braquage en plein frein à main (RocketSim POWERSLIDE_STEER_ANGLE_FROM_SPEED_CURVE : 0,39235 à 0, 0,12610 à 2500 uu/s) ; l'angle réel est mélangé selon `EtatVoiture.frein` */
  angleBraquageDerapage: [[0, 0.39235], [uu(2500), 0.1261]] as readonly (readonly [number, number])[],
  /** le frein à main est analogique : il monte à 5 /s tant que le bouton est tenu et retombe à 2 /s (RocketSim POWERSLIDE_RISE_RATE = 5, POWERSLIDE_FALL_RATE = 2) */
  freinMainMontee: 5,
  freinMainDescente: 2,
  /**
   * frottement latéral d'une roue : impulsion = -0,2 × vitesse le long de l'essieu × masse effective au contact (Bullet
   * resolveSingleBilateral, contactDamping = 0,2), multipliée par l'adhérence de la roue, par masse / 3 (btVehicleRL frictionScale) et par
   * le pas. À 120 Hz, une roue retire 10 % × adhérence de la vitesse latérale de son point de contact
   */
  amortissementLateral: 0.2,
  /** adhérence latérale selon le glissement, 0 = la roue roule droit, 1 = elle glisse de côté (RocketSim LAT_FRICTION_CURVE : 1 → 0,2) */
  adherenceGlissement: [[0, 1], [1, 0.2]] as readonly (readonly [number, number])[],
  /** le glissement n'est compté qu'au-dessus de cette vitesse latérale au point d'attache (RocketSim Car.cpp : baseFriction > 5 uu/s) */
  seuilGlissement: uu(5),
  /** en plein frein à main : adhérence latérale × 0,1 (RocketSim HANDBRAKE_LAT_FRICTION_FACTOR_CURVE = 0,1) */
  adherenceDerapage: 0.1,
  /** en plein frein à main : adhérence longitudinale (moteur et frein) × 0,5 sans glissement, × 0,9 en plein glissement (RocketSim HANDBRAKE_LONG_FRICTION_FACTOR_CURVE) */
  motriciteDerapage: [[0, 0.5], [1, 0.9]] as readonly (readonly [number, number])[],
  /**
   * sans gaz, les deux adhérences sont multipliées selon la composante verticale (signée) de la normale sous la roue : × 1 au sol, × 0,5
   * sur une pente à 45°, × 0,1 sur un mur ou au plafond : la voiture lâchée sur un mur glisse (RocketSim NON_STICKY_FRICTION_FACTOR_CURVE :
   * 0 → 0,1 ; 0,7075 → 0,5 ; 1 → 1)
   */
  adherenceSansGaz: [[0, 0.1], [0.7075, 0.5], [1, 1]] as readonly (readonly [number, number])[],
  /**
   * collage à la surface dès qu'une roue touche (RocketSim Car::_UpdateWheels, « sticky forces ») : accélération le long de -normale de
   * gravité × (0,5 + (1 - |normale verticale|) si l'on donne du gaz ou roule à plus de 0,25 m/s). 3,25 m/s² au sol, 9,75 m/s² sur un mur ;
   * au plafond 3,25 m/s² contre 6,5 de gravité : la voiture en TOMBE, comme dans Rocket League
   */
  collage: 0.5,
  /**
   * alignement sur la surface (RocketSim Car::_UpdateAutoRoll) : avec du gaz, quand 1 à 3 roues touchent ou que la caisse touche le
   * décor, accélération de 1 m/s² vers la surface (CAR_AUTOROLL_FORCE = 100 uu/s²) et accélération angulaire de 80 rad/s² ×
   * défaut d'alignement (CAR_AUTOROLL_TORQUE = 80)
   */
  autoRoll: { force: uu(100), couple: 80 },
  /**
   * redressement sur le toit (RocketSim Car::_UpdateAutoFlip) : appui sur saut quand la CAISSE touche une surface de type sol
   * (normale verticale > √½, CAR_AUTOFLIP_NORMZ_THRESH) et que le roulis dépasse 2,8 rad (CAR_AUTOFLIP_ROLL_THRESH). Impulsion de
   * 2 m/s le long de -haut (CAR_AUTOFLIP_IMPULSE = 200 uu/s), puis 50 rad/s² autour de l'avant (CAR_AUTOFLIP_TORQUE = 50) pendant
   * 0,4 s × |roulis| / π (CAR_AUTOFLIP_TIME = 0,4 s)
   */
  redressement: { impulsion: uu(200), couple: 50, dureeMaxS: 0.4, seuilRoulis: 2.8, seuilNormale: Math.SQRT1_2 },
  /**
   * [~] REPÈRES POUR LES BOTS seulement (la physique ne les lit plus : le virage découle du braquage des roues). Courbure du virage
   * (1/m) volant à fond selon la vitesse avant (m/s), mesurée en simulation sur le modèle de pneu ci-dessus en régime établi, et
   * rapport approché de la vitesse de lacet en dérapage
   */
  courbeCourbure: [[0, 0.69], [5, 0.396], [10, 0.231], [15, 0.135], [17.5, 0.11], [23, 0.084]] as readonly (readonly [number, number])[],
  facteurLacetDerapage: 1.6,
} as const;

export const SAUT = {
  /** impulsion initiale le long du haut de la voiture : 2,91667 m/s (RocketSim JUMP_IMMEDIATE_FORCE = 875 / 3 uu/s) */
  impulsion: uu(875 / 3),
  /** accélération tant que le bouton reste appuyé : 14,5833 m/s² (RocketSim JUMP_ACCEL = 4375 / 3 uu/s²), au plus 0,2 s (JUMP_MAX_TIME) : 24 pas à 120 Hz */
  maintien: uu(4375 / 3),
  maintienMaxS: 0.2,
  /** la poussée dure au moins 0,025 s même sur un appui bref, à 62 % pendant ce temps (RocketSim JUMP_MIN_TIME, JUMP_PRE_MIN_ACCEL_SCALE) */
  maintienMinS: 0.025,
  echelleAvantMin: 0.62,
  /**
   * au sol, l'état de saut n'est remis à zéro qu'une fois le saut vieux de `maintienMinS + gardeRemiseS` = 0,05 s : les roues touchent
   * encore pendant les premiers pas du décollage (RocketSim JUMP_RESET_TIME_PAD = 1 / 40 s)
   */
  gardeRemiseS: 1 / 40,
  /** fenêtre pour le second saut / dodge, comptée depuis la FIN du premier saut (RL : 1,25 s, `DOUBLEJUMP_MAX_DELAY`) ; sans premier saut, pas de limite */
  fenetreDoubleSautS: 1.25,
  /** double saut sans direction : même impulsion que le premier le long du haut de la voiture, sans maintien (RocketSim JUMP_IMMEDIATE_FORCE) */
  impulsionDoubleSaut: uu(875 / 3),
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
   * durée du couple de dodge (RocketSim FLIP_TORQUE_TIME = 0,65 s : 78 pas, du pas qui suit l'appui au 78ᵉ). La vitesse angulaire est
   * plafonnée à `VOITURE.vitesseAngMax` (5,5 rad/s) APRÈS l'intégration de l'orientation, comme dans RocketSim (Car::_FinishPhysicsTick
   * passe après le pas de Bullet) : chaque pas tourne donc à 5,5 + 224 / 120 = 7,37 rad/s en tangage (5,5 + 260 / 120 = 7,67 en roulis)
   * avant de revenir à 5,5. Un flip avant sans entrée fait ≈ 268° à 0,65 s, ≈ 329° à 0,95 s, ≈ 351° à 1,2 s.
   */
  dureeRotationS: 0.65,
  vitesseAng: 5.5,
  /** accélération angulaire du dodge (rad/s²) : roulis × composante latérale, tangage × composante avant (RocketSim FLIP_TORQUE_X / _Y) */
  coupleRoulis: 260,
  coupleTangage: 224,
  /** verrouillage du tangage : tant que le temps écoulé depuis le début du flip est inférieur à 0,65 s + 0,3 s (RL : FLIP_TORQUE_TIME + FLIP_PITCHLOCK_EXTRA_TIME) */
  verrouTangageS: 0.65,
  verrouTangageExtraS: 0.3,
  /**
   * amortissement vertical : ×0,65 par 1/120 s (RocketSim FLIP_Z_DAMP_120 = 0,35) dès 0,15 s (FLIP_Z_DAMP_START), tant que la voiture
   * descend ou avant 0,21 s (FLIP_Z_DAMP_END), jusqu'à la fin du flip (0,65 s). Il s'applique AVANT la gravité et les poussées du pas
   * (la gravité du pas n'est pas amortie : la voiture descend à ≈ 0,155 m/s pendant le flip)
   */
  amortissementVertical: 0.35,
  amortissementDebutS: 0.15,
  amortissementFinS: 0.21,
  /** seuil de |lacet| + |tangage| + |roulis| au-dessus duquel l'appui sur saut est un flip et non un double saut (RL : 0,5) */
  zoneMorte: 0.5,
  /** stall : direction du dodge (-tangage, lacet + roulis) quasi nulle (RL : 0,1) */
  zoneMorteStall: 0.1,
} as const;

/**
 * Échelle des couples de Rocket League (RocketSim CAR_TORQUE_SCALE = 2π / 65536 × 1000 = 0,0958738) : un couple de RocketSim × cette
 * échelle est une accélération angulaire en rad/s² (Car.cpp multiplie le couple par l'inertie, qui s'annule donc).
 */
const ECHELLE_COUPLE = ((2 * Math.PI) / 65536) * 1000;

/**
 * Contrôle en l'air (RocketSim Car::_UpdateAirTorque), dans le repère de la voiture : accélération angulaire (rad/s²) =
 * COUPLE × entrée - AMORT × ω × (1 - |entrée|) pour le tangage et le lacet, COUPLE × entrée - AMORT × ω pour le ROULIS (son
 * amortissement n'est jamais levé par l'entrée). Seulement quand AUCUNE roue ne touche.
 */
export const AIR = {
  /**
   * Convention de signe de ce projet : entrée +1 = nez vers le haut (tangage), tourner à droite (lacet), pencher à droite (roulis).
   * RocketSim CAR_AIR_CONTROL_TORQUE = (130, 95, 400) pour (tangage, lacet, roulis) : 12,4636 / 9,1080 / 38,3495 rad/s²
   */
  coupleTangage: 130 * ECHELLE_COUPLE,
  coupleLacet: 95 * ECHELLE_COUPLE,
  coupleRoulis: 400 * ECHELLE_COUPLE,
  /** amortissement (1/s) : RocketSim CAR_AIR_CONTROL_DAMPING = (30, 20, 50), soit 2,8762 / 1,9175 / 4,7937 ; valeurs positives ici, le signe est dans la formule */
  amortTangage: 30 * ECHELLE_COUPLE,
  amortLacet: 20 * ECHELLE_COUPLE,
  amortRoulis: 50 * ECHELLE_COUPLE,
  /** poussée dans l'air avec gaz : accélération avant/arrière du gaz, boost ou non (RocketSim THROTTLE_AIR_ACCEL = 200 / 3 uu/s²) */
  gazAerien: uu(200 / 3),
} as const;

export const BOOST = {
  /** accélération du boost le long de l'avant RÉEL de la voiture : 9,91667 m/s² au sol, trois roues au moins (RocketSim BOOST_ACCEL_GROUND = 2975 / 3 uu/s²) */
  acceleration: uu(2975 / 3),
  /** en l'air : 10,5833 m/s² (RocketSim BOOST_ACCEL_AIR = 3175/3 uu/s²) */
  accelerationAir: uu(3175 / 3),
  /** consommation : 33,33 / s (RL : 100 en 3 s) */
  consommation: 100 / 3,
  /** un appui consomme au moins ce temps (RocketSim BOOST_MIN_TIME = 0,1 s : 12 pas à 120 Hz, soit 3,33 de boost) */
  dureeMinS: 0.1,
  max: 100,
} as const;

/**
 * Plots de boost (RocketSim BoostPad::_CheckCollide) : l'ORIGINE de la voiture doit être dans le cylindre de rayon 144 uu (petit,
 * CYL_RAD_SMALL) ou 208 uu (gros, CYL_RAD_BIG) autour du plot, à moins de 95 uu en hauteur de son centre (CYL_HEIGHT), posé à 70 / 73 uu.
 * `valeur` : BOOST_AMOUNT_SMALL = 12, BOOST_AMOUNT_BIG = 100 ; `rechargeS` : COOLDOWN_SMALL = 4 s, COOLDOWN_BIG = 10 s.
 *
 * Verrou : la voiture qui touchait déjà le plot au pas précédent (`EtatPlot.verrou`) n'est plus jugée sur le cylindre mais sur une
 * boîte, contre la boîte englobante (alignée sur les axes) de sa hitbox : demi-côté 120 uu (petit, BOX_RAD_SMALL) ou 160 uu (gros,
 * BOX_RAD_BIG), de la hauteur du plot à 64 uu au-dessus (BOX_HEIGHT), soit de 0,70 à 1,34 m (petit) et de 0,73 à 1,37 m (gros).
 */
export const PLOT = {
  petit: { valeur: 12, rechargeS: 4, rayon: uu(144), demiHauteur: uu(95), hauteurCentre: uu(70), demiCoteBoite: uu(120), hauteurBoite: uu(64) },
  gros: { valeur: 100, rechargeS: 10, rayon: uu(208), demiHauteur: uu(95), hauteurCentre: uu(73), demiCoteBoite: uu(160), hauteurBoite: uu(64) },
  /** au-dessus de cette hauteur l'origine de la voiture ne teste aucun plot : 3,45 m (RocketSim BoostPadGrid EXTENT_Z = CYL_HEIGHT + 250 = 345 uu) */
  hauteurMaxOrigine: uu(95 + 250),
} as const;

/** Contact voiture ↔ balle : choc physique + impulsion « Psyonix ». */
export const CONTACT_BALLE = {
  /** restitution du choc physique voiture ↔ balle : NULLE (RocketSim CARBALL_COLLISION_RESTITUTION = 0). La vitesse de sortie vient du choc inélastique plus l'impulsion de Psyonix. */
  restitution: 0,
  /** frottement de Coulomb du choc voiture ↔ balle (RocketSim CARBALL_COLLISION_FRICTION = 2) : plafonné par l'adhérence totale, il donne le spin et le dribble */
  frottement: 2,
  /**
   * l'impulsion supplémentaire de Psyonix (RocketSim Ball::_OnHit) : direction = vecteur ORIGINE de la voiture → centre de la balle
   * avec la composante verticale × 0,35 (BALL_CAR_EXTRA_IMPULSE_Z_SCALE) et la composante avant ramenée à × 0,65
   * (BALL_CAR_EXTRA_IMPULSE_FORWARD_SCALE) ; intensité = vitesse relative (plafond 46 m/s, BALL_CAR_EXTRA_IMPULSE_MAXDELTAVEL_UU = 4600) × courbe
   */
  echelleVerticale: 0.35,
  echelleAvant: 0.65,
  vitesseRelativeMax: uu(4600),
  /** courbe de l'impulsion (RocketSim BALL_CAR_EXTRA_IMPULSE_FACTOR_CURVE) : (vitesse relative → facteur) = (0 → 0,65), (500 → 0,65), (2300 → 0,55), (4600 → 0,30) uu/s */
  courbeImpulsion: [[0, 0.65], [uu(500), 0.65], [uu(2300), 0.55], [uu(4600), 0.3]] as readonly (readonly [number, number])[],
  /**
   * après une impulsion supplémentaire, la même voiture saute ce nombre de pas avant la suivante (RocketSim Ball.cpp:262 :
   * `tickCount > tickCountWhenExtraImpulseApplied + 1`) : en contact continu l'impulsion repart un pas sur deux
   */
  delaiImpulsionPas: 1,
  /**
   * arêtes et coins de la hitbox arrondis de 2 cm face à la balle (Bullet CONVEX_DISTANCE_MARGIN = 0,04 unité = 2 uu : la boîte est
   * rétrécie de sa marge puis regonflée d'autant par le détecteur GJK, les faces ne bougent pas)
   */
  arrondiHitbox: uu(2),
} as const;

/** Voiture ↔ voiture : chocs, bump et démolition. */
export const CONTACT_VOITURES = {
  /** restitution et frottement du choc (RocketSim CARCAR_COLLISION_RESTITUTION = 0,1, CARCAR_COLLISION_FRICTION = 0,09 ; Arena.cpp les impose à chaque point de contact) */
  restitution: 0.1,
  frottement: 0.09,
  /**
   * bump (RocketSim Arena::_BtCallback_OnCarCarCollision), en m/s selon la vitesse de l'attaquant vers la victime (RL : uu/s) :
   * poussée le long de la direction de la vitesse de l'attaquant, au sol 0 → 5/6, 1400 → 1100, 2200 → 1530 uu/s
   * (BUMP_VEL_AMOUNT_GROUND_CURVE), en l'air 0 → 5/6, 1400 → 1390, 2200 → 1945 (BUMP_VEL_AMOUNT_AIR_CURVE), plus une poussée
   * verticale (le long du haut de la victime au sol, +Y en l'air) 0 → 2/6, 1400 → 278, 2200 → 417 (BUMP_UPWARD_VEL_AMOUNT_CURVE).
   * Seul le pare-chocs avant bumpe (même condition que la démolition)
   */
  bumpSol: [[0, uu(5 / 6)], [uu(1400), uu(1100)], [uu(2200), uu(1530)]] as readonly (readonly [number, number])[],
  bumpAir: [[0, uu(5 / 6)], [uu(1400), uu(1390)], [uu(2200), uu(1945)]] as readonly (readonly [number, number])[],
  bumpHaut: [[0, uu(2 / 6)], [uu(1400), uu(278)], [uu(2200), uu(417)]] as readonly (readonly [number, number])[],
  /**
   * délai du bump (RocketSim BUMP_COOLDOWN_TIME = 0,25 s) : il appartient à l'ATTAQUANT et ne vaut que contre la MÊME victime
   * (CarContact::otherCarID / cooldownTimer) ; armé aussi par une démolition. 30 pas à 120 Hz : le bump suivant passe au pas t + 30
   */
  bumpDelaiS: 0.25,
  /** démolition : l'attaquant est supersonique, la victime est d'une AUTRE équipe, mêmes gardes que le bump (approche, pare-chocs avant, délai) */
  demoReapparitionS: 3,
  /** l'avant de l'attaquant : le point de contact doit être au moins à cette distance DEVANT son origine (RocketSim BUMP_MIN_FORWARD_DIST = 64,5 uu) */
  demoAvantMinM: uu(64.5),
  /** démolition entre coéquipiers (RocketSim MutatorConfig::enableTeamDemos = false) : équipe amie, simple bump */
  tirAmi: false,
} as const;

/**
 * Contact de la caisse d'une voiture avec le décor (RocketSim Arena::_BtCallback_OnCarWorldCollision impose CARWORLD_COLLISION_FRICTION
 * = 0,3 et CARWORLD_COLLISION_RESTITUTION = 0,3) ; pas de rebond sous 0,1 m/s de vitesse normale (Bullet
 * m_restitutionVelocityThreshold = 0,2 unité Bullet par seconde = 10 uu/s). Les roues ne sont pas des corps de collision.
 */
export const CONTACT_MONDE = {
  frottement: 0.3,
  restitution: 0.3,
  seuilRebond: uu(10),
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
  /**
   * buteur : la voiture de l'équipe qui marque dont la dernière touche est la plus récente, à condition qu'elle date de 4 s au plus
   * (RocketSim GameEventTrackerConfig.goalMaxTouchTime = 4 s), même si un adversaire a dévié la balle ensuite
   */
  fenetreButeurS: 4,
  /**
   * passe décisive : un AUTRE coéquipier dont la dernière touche est la plus récente, à 2 s au plus AVANT la touche du buteur ou du
   * tireur (RocketSim GameEventTrackerConfig.passMaxTouchTime = 2 s)
   */
  fenetrePasseS: 2,
  /**
   * Tirs cadrés et arrêts (RocketSim GameEventTracker, valeurs par défaut de GameEventTrackerConfig ; son auteur précise que ce sont
   * ses réglages et non ceux du jeu). La balle est « tirée » quand elle va au moins à `vitesseMin` et que sa trajectoire prolongée
   * (gravité comprise) entre dans une cage en moins de `horizonS`, `delaiToucheS` après la dernière touche d'une voiture de l'équipe
   * qui attaque cette cage ; un arrêt est compté quand une balle « tirée » n'entre plus et qu'une voiture de l'équipe qui défend
   * vient de la toucher au même pas.
   */
  suivi: {
    /** vitesse minimale de la balle : 17,5 m/s, soit 63 km/h (shotMinSpeed = 1750 uu/s) */
    vitesseMin: uu(1750),
    /** la touche du tireur doit dater d'au moins 0,3 s (shotTouchMinDelay = 0,3 s : 36 pas à 120 Hz) */
    delaiToucheS: 0.3,
    /** délai minimal entre deux tirs comptés (shotEventCooldown = 1 s) */
    delaiTirS: 1,
    /** la balle doit atteindre la ligne en 2 s au plus (shotMinScoreTime = 2 s) */
    horizonS: 2,
    /** marge du cadre, en rayons de balle (Arena::IsBallProbablyGoingIn : scoreMargin = ballRadius × 0,1 ; predScoreExtraMargin = 0) */
    margeCadreRayons: 0.1,
  },
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

/** Un emplacement de réapparition après une démolition (équipe BLEUE ; orange : z → -z et cap + π, x inchangé, comme RocketSim Car::Respawn). */
export interface PosReapparition {
  x: number;
  z: number;
  /** cap (rad), même convention que `PosCoupDEnvoi` : 0 = vers le but adverse */
  cap: number;
}
/**
 * Les 4 emplacements de réapparition de Rocket League (RocketSim CAR_RESPAWN_LOCATIONS_SOCCAR : (-2304, -4608), (-2688, -4608),
 * (2304, -4608), (2688, -4608) uu, lacet π/2 = face au but adverse), tirés au hasard (Car::Respawn), voiture lâchée de
 * `VOITURE.hauteurReapparition`.
 */
export const REAPPARITIONS: readonly PosReapparition[] = [
  { x: uu(-2304), z: uu(-4608), cap: 0 },
  { x: uu(-2688), z: uu(-4608), cap: 0 },
  { x: uu(2304), z: uu(-4608), cap: 0 },
  { x: uu(2688), z: uu(-4608), cap: 0 },
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
  /** dernier toucheur (couleur de la balle, bots ; buteur, passe, tirs et arrêts se lisent sur `EtatVoiture.dernierContactBalleTick`) */
  dernierToucheur: { idVoiture: number; equipe: Equipe; temps: number } | null;
  /** toucheur précédent d'une AUTRE voiture */
  avantDernierToucheur: { idVoiture: number; equipe: Equipe; temps: number } | null;
  /**
   * vitesse en attente (RocketSim Ball::_velocityImpulseCache) : les impulsions supplémentaires de Psyonix des voitures qui touchent
   * la balle à ce pas s'y CUMULENT au lieu de modifier `v` (aucune voiture ne lit l'impulsion d'une autre) ; `match.ts` l'ajoute à `v`
   * une seule fois, après tous les contacts du pas et juste avant les plafonds (`appliquerVitesseEnAttente`, l'équivalent de
   * Ball::_FinishPhysicsTick). Nulle entre deux pas
   */
  vitesseEnAttente: Vec3;
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
  /** temps passé sans aucune roue à portée de la surface depuis le dernier appui d'une roue (s) */
  tempsEnLAir: number;
  /** temps écoulé depuis la fin du premier saut (bouton relâché ou 0,2 s de maintien) : fenêtre de 1,25 s du second saut (RL) */
  depuisFinSaut: number;
}

export interface EtatFlip {
  /** le couple du dodge est en cours (0,65 s) ; remis à faux dès que trois roues touchent */
  actif: boolean;
  /** s depuis le début du flip (continue de courir après le couple, jusqu'à la fin du verrou de tangage) */
  temps: number;
  /** direction de dodge normalisée dans le repère de la voiture au moment du flip : [avant, droite] */
  dir: [number, number];
  /** vrai si le dodge est un « stall » (pas d'impulsion, rotation de roulis seule) */
  stall: boolean;
  /** s restantes pendant lesquelles le manche de tangage est ignoré (0,95 s depuis le début du flip ; 0 hors flip et au sol) */
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
  /** vitesse (m/s), plafonnée à 23 m/s en fin de pas */
  v: Vec3;
  /**
   * vitesse angulaire monde (rad/s), plafonnée à 5,5 rad/s après chaque intégration de l'orientation ; un contact du pas (roues qui
   * suivent un raccord, choc de la caisse) peut la laisser au-dessus jusqu'à l'intégration suivante, comme le pas de Bullet dans RocketSim
   */
  w: Vec3;
  base: Base;
  /** 0..100 */
  boost: number;
  /** roues en contact avec une surface du DÉCOR (0..4) et normale moyenne de ces contacts (null si aucune) */
  rouesContact: number;
  normaleSurface: Vec3 | null;
  /**
   * trois roues au moins (`VOITURE.rouesPourSol`) touchent le décor OU la balle (`rouesBalle`) : peut sauter, n'a pas de contrôle
   * aérien ; les forces de pneu et le collage agissent dès UNE roue au contact du décor. Le même compte (décor ET balle, le
   * numWheelsInContact de RocketSim) décide du moteur divisé par 4 (moins de trois roues) et de l'alignement sur la surface (1 à 3 roues)
   */
  auSol: boolean;
  saut: EtatSaut;
  flip: EtatFlip;
  /**
   * redressement automatique en cours (sur le toit) : `temps` = s RESTANTES du couple (0,4 s × |roulis| / π au départ), `signe` = sens
   * du couple autour de l'avant (+1 si le roulis était positif)
   */
  redressement: { actif: boolean; temps: number; signe: number };
  /**
   * la CAISSE (hitbox) a touché le décor au pas précédent, et normale de ce contact (RocketSim CarState::worldContact) : sert au
   * redressement sur le toit et à l'alignement sur la surface ; remis à faux à chaque pas puis rempli par les contacts du pas
   */
  contactMonde: { actif: boolean; normale: Vec3 };
  supersonique: boolean;
  /** s passées supersonique d'affilée (0 sinon) : le maintien entre 21 et 22 m/s ne vaut que pendant la première seconde */
  supersoniqueDepuis: number;
  /** le boost brûle ce pas ; `boostDepuis` = durée de l'appui en cours (s), pour la durée minimale */
  boostActif: boolean;
  boostDepuis: number;
  /** frein à main efficace : `frein > 0` et au moins une roue en contact (traces de pneus, sons) */
  derapage: boolean;
  /** frein à main ANALOGIQUE, 0..1 : monte à 5 /s bouton tenu, retombe à 2 /s, au sol comme en l'air (RocketSim handbrakeVal) */
  frein: number;
  /**
   * réglages des pneus calculés au pas PRÉCÉDENT et appliqués à ce pas (RocketSim calcule les impulsions de frottement avant de lire
   * les commandes du pas) : `angle` de braquage des roues avant (rad, + = à droite), `moteur` = accélération d'une roue le long de son
   * roulement (m/s², signée), `frein` = décélération maximale d'une roue (m/s²), adhérences latérale `lat` et longitudinale `long`
   * de chacune des quatre roues
   */
  pneus: { angle: number; moteur: number; frein: number; lat: [number, number, number, number]; long: [number, number, number, number] };
  /** détruite : invisible, intangible, entrées ignorées ; revient dans `reapparitionDans` secondes */
  demolie: boolean;
  reapparitionDans: number;
  /** immobilisée (décompte du coup d'envoi) : les entrées sont ignorées */
  figee: boolean;
  /**
   * pas (tick) du dernier contact avec la balle (RocketSim BallHitInfo::tickCountWhenHit) : mis à jour à CHAQUE contact, il ne sert pas
   * au délai de l'impulsion. `match.ts` y lit le buteur, le passeur, le tireur et l'auteur d'un arrêt (RocketSim GameEventTracker) et
   * l'oublie à chaque coup d'envoi
   */
  dernierContactBalleTick: number;
  /**
   * pas (tick) de la dernière impulsion supplémentaire de Psyonix donnée à la balle par cette voiture (RocketSim
   * BallHitInfo::tickCountWhenExtraImpulseApplied) : écrit seulement quand l'impulsion part, la suivante attend `CONTACT_BALLE.delaiImpulsionPas`
   */
  derniereImpulsionPsyonixTick: number;
  /**
   * délai du bump, propre à l'ATTAQUANT (RocketSim CarContact) : id de la dernière voiture bumpée ou démolie par celle-ci (-1 : aucune)
   * et pas (tick) de ce choc. Pendant 0,25 s elle ne peut pas bumper de nouveau CETTE voiture ; les autres, si, et sa victime peut
   * la bumper aussitôt
   */
  bumpAutreId: number;
  bumpDelaiTick: number;
  /**
   * roues dont le rayon de suspension touche la BALLE, mesurées par `contactVoitureBalle` en fin de pas (ordre de `VOITURE.roues`) :
   * au pas suivant elles comptent avec les roues au contact du décor pour `auSol` (RocketSim : le rayon d'une roue touche tout corps
   * sauf son châssis). Trois roues posées sur la balle = « au sol » : c'est le flip reset
   */
  rouesBalle: [boolean, boolean, boolean, boolean];
  /**
   * normale (unitaire, de la balle vers la roue) du point où le rayon de suspension de chaque roue de `rouesBalle` touche la balle ;
   * sans objet pour une roue qui ne la touche pas. Elles entrent avec les normales des roues au contact du décor dans la direction
   * « vers le haut » des contacts (RocketSim btVehicleRL::getUpwardsDirFromWheelContacts : collage, alignement sur la surface)
   */
  normalesRouesBalle: [Vec3, Vec3, Vec3, Vec3];
  /**
   * vitesse en attente (RocketSim Car::_velocityImpulseCache) : la vitesse d'un BUMP reçu à ce pas s'y cumule au lieu de modifier
   * `v` (une voiture bumpée n'entre pas plus vite dans ses autres contacts du même pas) ; `match.ts` l'ajoute à `v` après toutes les
   * paires de voitures, puis plafonne la vitesse UNE fois (`appliquerVitesseEnAttente`, l'équivalent de Car::_FinishPhysicsTick).
   * Nulle entre deux pas
   */
  vitesseEnAttente: Vec3;
  /** état du bouton de saut au pas précédent (front montant) */
  sautPrecedent: boolean;
  stats: StatsVoiture;
}

export interface EtatPlot {
  id: number;
  actif: boolean;
  /** s avant réactivation si inactif */
  recharge: number;
  /**
   * id de la voiture qui touchait le plot au pas précédent, -1 sinon (RocketSim BoostPadState.prevLockedCarID) : cette voiture est
   * jugée sur la boîte du plot (`PLOT.*.demiCoteBoite`, `hauteurBoite`) au lieu du cylindre
   */
  verrou: number;
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
  /** réactions rapides : direction de la croix tenue à cet instant (le menu agit sur le front montant, dans `jeu.ts`) */
  chat: ChatEntrees;
  /**
   * (clavier et souris seulement, rempli par la source d'entrées) directions dont une touche a été ENFONCÉE (événement, hors répétition automatique)
   * depuis l'échantillon précédent, même relâchée depuis : un second appui sur la même touche dans l'intervalle de deux images (rendu lent) ne se perd
   * pas dans l'état « tenu ». Absent = déduire le front de `chat` (manette, tests).
   */
  chatAppuis?: ChatEntrees;
  /** les mêmes appuis, dans l'ORDRE où ils ont eu lieu et autant de fois (un ensemble de directions perd l'ordre quand le rendu est lent) */
  chatSuite?: readonly DirectionChat[];
}
/** Les quatre directions de la croix des réactions rapides (haut = Infos, gauche = Compliments, droite = Réactions, bas = Excuses). */
export type DirectionChat = "haut" | "gauche" | "droite" | "bas";
export type ChatEntrees = Record<DirectionChat, boolean>;
export const CHAT_NUL = (): ChatEntrees => ({ haut: false, gauche: false, droite: false, bas: false });

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
  /** Échap reste toujours liée à la pause (cf. `normaliserReglages`) : seul le second emplacement est libre. */
  pause: readonly string[];
  /** bouton (ou touche) tenu qui fait de la souris un levier de regard libre ; `Souris1` (molette cliquée) par défaut */
  regardLibre: readonly string[];
  /** réactions rapides, comme la croix de Rocket League : un appui ouvre la catégorie, un second choisit le message (1 2 3 4 par défaut) */
  chatHaut: readonly string[];
  chatGauche: readonly string[];
  chatDroite: readonly string[];
  chatBas: readonly string[];
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
  regardLibre: ["Souris1"],
  chatHaut: ["Digit1"],
  chatGauche: ["Digit2"],
  chatDroite: ["Digit3"],
  chatBas: ["Digit4"],
};

/**
 * Une entrée de manette, au mapping « standard » de la Gamepad API : `B<n>` = bouton n (analogique pour les gâchettes : `B7` = RT),
 * `A<n>+` / `A<n>-` = DEMI-axe n poussé vers le sens positif / négatif (`A0-` = stick gauche vers la gauche, `A1-` = stick gauche vers le haut).
 * Un bouton sur un axe vaut 0/1 ; une action à deux états sur un demi-axe se déclenche au-delà de `SEUIL_ENTREE_MANETTE`.
 */
export type EntreeManette = string;
/** Seuil (sur l'axe brut) au-delà duquel un demi-axe compte comme « pressé » pour une action à deux états, et pour la capture. */
export const SEUIL_ENTREE_MANETTE = 0.5;

/**
 * Les actions rebindables de la manette : deux entrées au plus par action. Défauts = disposition de Rocket League. Les deux demi-axes d'un
 * même stick gardent la zone morte radiale et la courbe (`stickAvecZoneMorte`) quelle que soit leur affectation. `tangageHaut` / `tangageBas`
 * ne servent qu'en l'air (nez en haut / en bas) ; `regard*` pilotent le regard libre de la caméra.
 */
export interface LiaisonsManette {
  accelerer: readonly EntreeManette[];
  reculer: readonly EntreeManette[];
  gauche: readonly EntreeManette[];
  droite: readonly EntreeManette[];
  tangageHaut: readonly EntreeManette[];
  tangageBas: readonly EntreeManette[];
  saut: readonly EntreeManette[];
  boost: readonly EntreeManette[];
  derapage: readonly EntreeManette[];
  rouleGauche: readonly EntreeManette[];
  rouleDroite: readonly EntreeManette[];
  balleCam: readonly EntreeManette[];
  arriere: readonly EntreeManette[];
  klaxon: readonly EntreeManette[];
  /** Start (`B9`) reste toujours liée à la pause, comme Échap au clavier : seul le second emplacement est libre. */
  pause: readonly EntreeManette[];
  regardGauche: readonly EntreeManette[];
  regardDroite: readonly EntreeManette[];
  regardHaut: readonly EntreeManette[];
  regardBas: readonly EntreeManette[];
  /** réactions rapides : la croix directionnelle (B12 à B15) par défaut ; le klaxon est passé sur L3 (B10) pour la libérer */
  chatHaut: readonly EntreeManette[];
  chatGauche: readonly EntreeManette[];
  chatDroite: readonly EntreeManette[];
  chatBas: readonly EntreeManette[];
}
export const LIAISONS_MANETTE_DEFAUT: LiaisonsManette = {
  accelerer: ["B7"],
  reculer: ["B6"],
  gauche: ["A0-"],
  droite: ["A0+"],
  tangageHaut: ["A1+"],
  tangageBas: ["A1-"],
  saut: ["B0"],
  boost: ["B1"],
  derapage: ["B2"],
  rouleGauche: ["B4"],
  rouleDroite: ["B5"],
  balleCam: ["B3"],
  arriere: ["B11"],
  klaxon: ["B10"],
  pause: ["B9"],
  regardGauche: ["A2-"],
  regardDroite: ["A2+"],
  regardHaut: ["A3-"],
  regardBas: ["A3+"],
  chatHaut: ["B12"],
  chatGauche: ["B14"],
  chatDroite: ["B15"],
  chatBas: ["B13"],
};

export interface ReglagesRocket {
  camera: ParamsCamera;
  touches: LiaisonsTouches;
  /** boutons et sticks de la manette */
  liaisonsManette: LiaisonsManette;
  /** ball cam active au lancement et après chaque but */
  balleCamParDefaut: boolean;
  /** volume général 0..1 */
  volume: number;
  /** zone morte des sticks (0..0.4) et inversion du tangage de la manette */
  zoneMorteManette: number;
  inverserTangageManette: boolean;
  /** vibrations de la manette */
  vibrations: boolean;
  /** afficher les réactions rapides des ADVERSAIRES (bulle, fil, son) ; celles de l'équipe et les miennes restent toujours visibles */
  reactionsAdversaires: boolean;
}
export const REGLAGES_DEFAUT = (): ReglagesRocket => ({
  camera: { ...CAMERA_DEFAUT },
  touches: { ...LIAISONS_DEFAUT },
  liaisonsManette: { ...LIAISONS_MANETTE_DEFAUT },
  balleCamParDefaut: true,
  volume: 0.7,
  zoneMorteManette: 0.12,
  inverserTangageManette: false,
  vibrations: true,
  reactionsAdversaires: true,
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
  /** réactions rapides (menu de la croix, messages reçus) ; absent = rien à afficher */
  chat?: HudChat;
}

/** Message de réaction rapide reçu (fil du HUD). `nom` : l'émetteur ; `equipeSeule` : « (équipe) » devant le nom. */
export interface LigneChat {
  id: number;
  nom: string;
  texte: string;
  equipe: Equipe;
  equipeSeule: boolean;
  /** c'est moi qui ai parlé */
  moi: boolean;
}
/** Menu ouvert d'une catégorie : ses quatre messages, chacun sur sa direction. */
export interface MenuChatHud {
  categorie: string;
  titre: string;
  choix: { direction: DirectionChat; id: string; texte: string; equipeSeule: boolean }[];
}
export interface HudChat {
  menu: MenuChatHud | null;
  lignes: LigneChat[];
  /** chat bloqué (trop de messages d'affilée) : secondes restantes, arrondies au-dessus ; 0 sinon */
  bloqueS: number;
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
 * Avance la balle de `dt` (PAS_S en jeu) contre le décor, dans l'ordre de RocketSim : traînée, contact détecté sur la position du
 * DÉBUT du pas (à 1,905 cm près), gravité, réponse en vitesse seulement (restitution 0,6, frottement, spin ; aucune correction de
 * position), intégration, plafonds de vitesse. Une balle dont la vitesse et le spin sont exactement nuls ne bouge pas (elle « dort »
 * comme à l'engagement, jusqu'à ce qu'une voiture la touche). Un `dt` plus long que PAS_S est découpé en pas de PAS_S au plus. Rend
 * le plus fort impact du pas, ou null. Implémenté par `balle.ts` (`pasBalle`).
 */
export type PasBalle = (a: Arene, b: EtatBalle, dt: number) => ImpactBalle | null;
/**
 * Plafonds de la balle : 60 m/s et 6 rad/s (RocketSim Ball::_FinishPhysicsTick). `pasBalle` l'applique à la fin de son pas ; `match.ts`
 * le rappelle UNE fois après les contacts des voitures (choc, frottement) et l'ajout de la vitesse en attente (impulsions de Psyonix,
 * `appliquerVitesseEnAttente`), comme RocketSim en fin de tick. Implémenté par `balle.ts` (`bornerBalle`).
 */
export type BornerBalle = (b: EtatBalle) => void;
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
/** Position et vitesse de la balle AVANT les contacts du pas (RocketSim : l'état lu dans les rappels de contact, avant le solveur). */
export interface BalleAvantContacts {
  p: Readonly<Vec3>;
  v: Readonly<Vec3>;
}
/**
 * Contact voiture ↔ balle (hitbox orientée contre sphère), dès que la balle est à moins de `BALLE.margeContact` de la boîte : séparation
 * si elle y pénètre, impulsion physique (restitution 0, frottement 2, masses 180 / 30, couple sur la voiture) si elles se rapprochent,
 * PUIS, dans tous les cas, impulsion supplémentaire de Psyonix (`CONTACT_BALLE`) si la précédente de cette voiture date de plus d'un
 * pas. Cette impulsion ne modifie PAS `b.v` : elle se cumule dans `b.vitesseEnAttente`, que l'appelant ajoute en fin de pas
 * (`appliquerVitesseEnAttente`). Elle est calculée sur l'état de la balle d'avant les contacts du pas, `balleAvant` (défaut : son état à
 * l'appel, juste pour une seule voiture) : quand plusieurs voitures touchent la balle au même pas, `match.ts` fige cet état avant la
 * première, et l'impulsion de chacune ne dépend ni des autres ni de l'ordre des voitures. Met à jour `dernierContactBalleTick`,
 * `derniereImpulsionPsyonixTick`, `rouesBalle` et `normalesRouesBalle` ; ne plafonne PAS la vitesse de la balle (`bornerBalle`, par
 * `match.ts`) et ne touche pas `balle.dernierToucheur`. Rend null s'il n'y a pas de contact.
 * Implémenté par `contacts.ts` (`contactVoitureBalle`).
 */
export type ContactVoitureBalle = (
  v: EtatVoiture, b: EtatBalle, tick: number, dt: number, balleAvant?: Readonly<BalleAvantContacts>,
) => ContactBalle | null;
export interface ContactVoitures {
  /** l'attaquant démolit la victime (conditions de `CONTACT_VOITURES`) : le match marque la victime, ce module ne touche PAS `demolie` */
  demolition: { auteur: number; victime: number } | null;
  /** un bump (choc avec impulsion supplémentaire) a eu lieu */
  bump: { vitesse: number } | null;
}
/**
 * Contact voiture ↔ voiture (SAT de deux boîtes orientées) : séparation, impulsion (restitution 0,1, frottement 0,09), puis, pour
 * chaque sens (`a` attaque `b`, puis `b` attaque `a`), bump ou détection de la démolition, avec le délai de l'attaquant contre cette
 * victime. La vitesse d'un bump ne modifie PAS la vitesse de la victime : elle se cumule dans sa `vitesseEnAttente`, que l'appelant
 * ajoute après toutes les paires du pas (`appliquerVitesseEnAttente`, puis `plafonnerVitesse`). Les conditions et la direction du
 * bump se lisent sur les vitesses d'avant les contacts du pas, `vAvantA` et `vAvantB` (défaut : les vitesses à l'appel, justes pour
 * une seule paire) : `match.ts` les fige avant le premier contact, une voiture déjà heurtée dans une autre paire du même pas n'y
 * entre pas avec la vitesse de ce choc. Rend null sans contact. Implémenté par `contacts.ts` (`contactVoitureVoiture`).
 */
export type ContactEntreVoitures = (
  a: EtatVoiture, b: EtatVoiture, tick: number, vAvantA?: Readonly<Vec3>, vAvantB?: Readonly<Vec3>,
) => ContactVoitures | null;
/**
 * Fin de pas d'une balle ou d'une voiture (RocketSim Ball / Car::_FinishPhysicsTick, première partie) : ajoute `vitesseEnAttente` à
 * `v` et la remet à zéro. Les plafonds viennent ensuite (`bornerBalle`, `plafonnerVitesse`). Implémenté par `contacts.ts`.
 */
export type AppliquerVitesseEnAttente = (c: { v: Vec3; vitesseEnAttente: Vec3 }) => void;

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
  /** petit « bloop » à la réception d'une réaction rapide (`moi` : c'est la mienne, plus discrète) */
  reaction(moi: boolean): void;
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
  /** `Gamepad.buttons` (RT = 7, LT = 6, A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, Start = 9, R3 = 11) ; les entrées `B<n>` des liaisons y renvoient */
  boutons: readonly { pressed: boolean; value: number }[];
}
/** Clavier/souris → entrées (pure). Implémenté par `entrees.ts` (`entreesDepuisClavier`). */
export type EntreesDepuisClavier = (i: InstantaneClavier, l: Readonly<LiaisonsTouches>) => EntreesJoueur;
/**
 * Manette → entrées (pure, zone morte radiale, courbe quadratique sur les sticks). `liaisons` : celles du joueur (défaut : disposition de
 * Rocket League). Implémenté par `entrees.ts` (`entreesDepuisManette`).
 */
export type EntreesDepuisManette = (
  m: InstantaneManette,
  r: Pick<ReglagesRocket, "zoneMorteManette" | "inverserTangageManette">,
  liaisons?: Readonly<LiaisonsManette>,
) => EntreesJoueur;
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
