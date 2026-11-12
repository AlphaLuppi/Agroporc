/**
 * Rocket Muche : physique de la voiture (module C, première moitié ; les contacts sont dans `contacts.ts`).
 *
 * L'Octane est un corps rigide (masse 180, boîte `VOITURE.hitbox` décalée de `VOITURE.decalageHitbox` ; l'ORIGINE de la voiture est
 * son centre de masse, comme dans Rocket League) qui roule sur quatre « roues » : pas de suspension, quatre points de contact
 * avec la SDF du stade (`Arene`). Sol, murs et plafond sont traités pareillement : la surface est ce que dit la SDF.
 *
 * La LOGIQUE, les formules et les constantes sont celles de RocketSim (src/Sim/Car/Car.cpp, src/Sim/btVehicleRL/btVehicleRL.cpp,
 * src/RLConst.h), transposées en mètres, Y vers le haut. Le solveur de Bullet (suspension à ressorts, contacts de la boîte contre le
 * maillage) n'est PAS repris : les roues qui s'enfoncent reçoivent une impulsion non élastique, la caisse un choc avec frottement.
 *
 * Ordre d'un pas, celui de RocketSim (Car::_PreTickUpdate, pas de Bullet, Car::_PostTickUpdate, Car::_FinishPhysicsTick) :
 *  1. contacts des roues (`rouesContact`, `normaleSurface`, `auSol` = trois roues au moins) et impulsions des pneus, calculées sur
 *     l'état du début du pas avec les réglages du pas PRÉCÉDENT (moteur, frein, braquage, adhérences) ;
 *  2. frein à main analogique, réglages des pneus pour le pas suivant, collage à la surface ;
 *  3. moins de trois roues : couple du dodge, contrôle aérien (aucune roue seulement), gaz en l'air ;
 *  4. saut (impulsion puis maintien), redressement sur le toit, double saut ou dodge, amortissement vertical du flip ;
 *  5. alignement sur la surface (avec du gaz), application des impulsions des pneus, boost ;
 *  6. forces et gravité, puis intégration de la position et de l'orientation avec des vitesses NON plafonnées ;
 *  7. plafond de vitesse angulaire (5,5 rad/s), contacts avec le décor (roues puis caisse), plafond de vitesse (23 m/s) ;
 *  8. supersonique et événements.
 *
 * Comme Bullet, les FORCES du pas (gravité, collage, maintien du saut, boost, couples de l'air) sont cumulées et n'entrent dans les
 * vitesses qu'à l'étape 6 ; les IMPULSIONS (saut, dodge, redressement, pneus) sont immédiates. C'est ce qui fait que l'amortissement
 * vertical du flip ne freine pas la gravité du pas, ou que l'amortissement de l'air lit la vitesse angulaire d'avant les couples.
 *
 * Les minuteurs (saut, flip, boost, supersonique, réapparition) sont cumulés en simple précision comme dans RocketSim (`Math.fround`) :
 * les seuils tombent ainsi sur les mêmes nombres de pas (24 pas de maintien du saut, 78 pas de couple de dodge, 12 pas de boost
 * minimal, 360 pas avant de réapparaître).
 *
 * Fidélité (spec § 13) : tout ce qui précède [RL] via RocketSim ; contact des roues par la distance de la SDF (et non par un rayon
 * lancé le long de -haut), absence de suspension, choc de la caisse par points d'échantillonnage [~].
 *
 * Pur et déterministe : aucune horloge, aucun hasard. Boucle chaude sans allocation (tampons de module) ; seuls le tableau
 * d'événements du pas et `integrerBase` (vec.ts) allouent.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§ 5)
 */
import {
  AIR,
  BOOST,
  CONDUITE,
  CONTACT_MONDE,
  ENTREES_NULLES,
  FLIP,
  GRAVITE,
  SAUT,
  VOITURE,
  interpolerTable,
  type Arene,
  type CentreHitbox,
  type CoinsHitbox,
  type CreerVoiture,
  type EntreesVoiture,
  type EtatVoiture,
  type EvenementVoiture,
  type PasVoiture,
  type ReplacerVoiture,
  type Vec3,
} from "./contrat";
import { baseDepuisCap, integrerBase, type Base } from "./vec";

// ============================================================================================================================
// Constantes dérivées
// ============================================================================================================================

/** Demi-dimensions de la hitbox, repère local `[avant, droite, haut]`. */
export const DEMI_HITBOX: Readonly<[number, number, number]> = [VOITURE.hitbox.longueur / 2, VOITURE.hitbox.largeur / 2, VOITURE.hitbox.hauteur / 2];
const [HX, HY, HZ] = DEMI_HITBOX;
const [DX, DY, DZ] = VOITURE.decalageHitbox;
const M = VOITURE.masse;
const L2 = VOITURE.hitbox.longueur ** 2, W2 = VOITURE.hitbox.largeur ** 2, H2 = VOITURE.hitbox.hauteur ** 2;
/** Moments d'inertie d'une boîte pleine de masse 180 autour de `avant` (roulis), `droite` (tangage), `haut` (lacet). */
export const INERTIE_VOITURE = { avant: (M / 12) * (W2 + H2), droite: (M / 12) * (L2 + H2), haut: (M / 12) * (L2 + W2) } as const;
const IA = INERTIE_VOITURE.avant, ID = INERTIE_VOITURE.droite, IH = INERTIE_VOITURE.haut;

/** Rayon de la sphère qui enferme la hitbox : sert à écarter vite les voitures et le décor lointain. */
export const RAYON_ENGLOBANT = Math.hypot(HX, HY, HZ);

/** Correction de position maximale par pas pour une roue / pour le corps (m). */
const CORRECTION_ROUE_M = 0.02;
const CORRECTION_CORPS_M = 0.1;
/** Restitution et frottement de la caisse contre le décor (RocketSim CARWORLD_COLLISION_RESTITUTION = 0,3, CARWORLD_COLLISION_FRICTION = 0,3). */
const RESTITUTION_CORPS = CONTACT_MONDE.restitution;
const FROTTEMENT_CORPS = CONTACT_MONDE.frottement;
/** Sous cette vitesse normale entrante, pas de rebond (Bullet m_restitutionVelocityThreshold = 0,2 unité Bullet par seconde = 0,1 m/s). */
const SEUIL_RESTITUTION_CORPS = CONTACT_MONDE.seuilRebond;
/** La caisse « touche » le décor dès qu'un de ses points en est à moins de 1 cm (Bullet : seuil de rupture d'un contact, 0,02 unité = 1 uu). */
const MARGE_CONTACT_CORPS_M = 0.01;
/** Au-dessus de cette vitesse normale entrante, un choc du corps est signalé (m/s). */
const SEUIL_CHOC = 3;
/** Vitesse normale d'impact minimale d'un atterrissage signalé (m/s) et durée minimale passée en l'air avant. */
const SEUIL_ATTERRISSAGE = 0.5;
const AIR_MIN_ATTERRISSAGE_S = 0.15;
/** Échelle des impulsions de frottement d'une roue (btVehicleRL::calcFrictionImpulses : frictionScale = masse / 3). */
const ECHELLE_PNEU = M / 3;

/** Simple précision : RocketSim cumule ses minuteurs en `float`, on reprend ses arrondis pour tomber sur les mêmes nombres de pas. */
const f32 = Math.fround;
/** Seuils des minuteurs, en simple précision comme les constantes de RLConst.h. */
const T_SAUT_MIN = f32(SAUT.maintienMinS);
const T_SAUT_MAX = f32(SAUT.maintienMaxS);
const T_SAUT_GARDE = f32(f32(SAUT.maintienMinS) + f32(SAUT.gardeRemiseS));
const T_FENETRE = f32(SAUT.fenetreDoubleSautS);
const T_FLIP = f32(FLIP.dureeRotationS);
const T_VERROU = f32(f32(FLIP.verrouTangageS) + f32(FLIP.verrouTangageExtraS));
const T_AMORT_DEBUT = f32(FLIP.amortissementDebutS);
const T_AMORT_FIN = f32(FLIP.amortissementFinS);
const T_BOOST_MIN = f32(BOOST.dureeMinS);

/** Entrées d'une voiture figée ou démolie (jamais modifiées). */
const ENTREES_FIGEES: Readonly<EntreesVoiture> = ENTREES_NULLES();

// ---- tampons de travail (aucune allocation dans la boucle chaude) ----
const T_C: Vec3 = [0, 0, 0];
const T_N: Vec3 = [0, 0, 0];
const T_F: Vec3 = [0, 0, 0];
const T_A: Vec3 = [0, 0, 0];
const T_B: Vec3 = [0, 0, 0];
const T_W: Vec3 = [0, 0, 0];
const T_X: Vec3 = [0, 0, 0];
const ARMS: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const NORMS: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const PENS: number[] = [0, 0, 0, 0];
const quatreVec = (): Vec3[] => [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
/** Forces du pas, cumulées en variations de vitesse (appliquées à l'étape 6, comme Bullet applique les forces au début de son pas). */
const DV: Vec3 = [0, 0, 0];
const DW: Vec3 = [0, 0, 0];
/** Roues, remplies par `mesurerRoues` : en contact ?, normale de la surface, bras de l'origine au point de contact. */
const R_CONTACT: boolean[] = [false, false, false, false];
/**
 * Roues qui touchent quelque chose à ce pas, le décor OU la balle (`EtatVoiture.rouesBalle`) : le `numWheelsInContact` de RocketSim,
 * qui décide de `auSol`, du contrôle aérien, de l'arrêt du flip, du moteur divisé par 4 (moins de trois roues) et de l'alignement sur
 * la surface (une à trois roues). Posé par `mesurerRoues`.
 */
let rouesTouchant = 0;
/**
 * Direction « vers le haut » des contacts de roue (RocketSim btVehicleRL::getUpwardsDirFromWheelContacts) : moyenne des normales de
 * TOUTES les roues en contact, celles du décor comme celles posées sur la balle ; le haut de la voiture si aucune ne touche ou si
 * leur somme est nulle. Sans roue sur la balle, c'est `normaleSurface`. Sert au collage et à l'alignement sur la surface. Posée par
 * `mesurerRoues`.
 */
const HAUT_CONTACTS: Vec3 = [0, 1, 0];
const R_N: Vec3[] = quatreVec();
const R_BRAS: Vec3[] = quatreVec();
/** Pneus, remplis par `calculerPneus` : essieu braqué, essieu et roulement dans le plan de contact, bras d'application, impulsions. */
const P_ESSIEU: Vec3[] = quatreVec();
const P_AXE: Vec3[] = quatreVec();
const P_ROUL: Vec3[] = quatreVec();
const P_BRAS: Vec3[] = quatreVec();
const P_JL: number[] = [0, 0, 0, 0];
const P_JF: number[] = [0, 0, 0, 0];

/** Points d'échantillonnage du corps (repère local à la hitbox, avant décalage) : 8 coins et 6 centres de face. */
const POINTS_CORPS: readonly (readonly [number, number, number])[] = (() => {
  const pts: [number, number, number][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * HX, sy * HY, sz * HZ]);
  for (const s of [-1, 1]) { pts.push([s * HX, 0, 0]); pts.push([0, s * HY, 0]); pts.push([0, 0, s * HZ]); }
  return pts;
})();

// ============================================================================================================================
// Petits outils sans allocation
// ============================================================================================================================

/** `out ← I⁻¹ · t` (t en repère monde, tenseur d'inertie diagonal dans le repère de la voiture). Rend `out`. */
export function inertieInverseDans(out: Vec3, b: Readonly<Base>, t: Readonly<Vec3>): Vec3 {
  const ta = (t[0] * b.avant[0] + t[1] * b.avant[1] + t[2] * b.avant[2]) / IA;
  const td = (t[0] * b.droite[0] + t[1] * b.droite[1] + t[2] * b.droite[2]) / ID;
  const th = (t[0] * b.haut[0] + t[1] * b.haut[1] + t[2] * b.haut[2]) / IH;
  out[0] = b.avant[0] * ta + b.droite[0] * td + b.haut[0] * th;
  out[1] = b.avant[1] * ta + b.droite[1] * td + b.haut[1] * th;
  out[2] = b.avant[2] * ta + b.droite[2] * td + b.haut[2] * th;
  return out;
}

/** `out ← a × b`. */
function croixDans(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

const dot3 = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norme3 = (a: Readonly<Vec3>): number => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const signe = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Masse effective d'un choc au bras `r` (depuis l'origine) dans la direction unitaire `n` : `1/m + n·((I⁻¹(r×n)) × r)`. */
export function inverseMasseEffective(b: Readonly<Base>, r: Readonly<Vec3>, n: Readonly<Vec3>): number {
  croixDans(T_X, r, n);
  inertieInverseDans(T_W, b, T_X);
  croixDans(T_X, T_W, r);
  return 1 / M + dot3(T_X, n);
}

/** Applique l'impulsion `j · dir` au point d'arm `r` de la voiture (vitesse linéaire et angulaire). */
export function appliquerImpulsion(v: EtatVoiture, r: Readonly<Vec3>, dir: Readonly<Vec3>, j: number): void {
  v.v[0] += (dir[0] * j) / M; v.v[1] += (dir[1] * j) / M; v.v[2] += (dir[2] * j) / M;
  croixDans(T_X, r, dir);
  inertieInverseDans(T_W, v.base, T_X);
  v.w[0] += T_W[0] * j; v.w[1] += T_W[1] * j; v.w[2] += T_W[2] * j;
}

/** Vitesse du point d'arm `r` (depuis l'origine) : `v + w × r`, écrite dans `out`. */
export function vitessePointDans(out: Vec3, v: Readonly<EtatVoiture>, r: Readonly<Vec3>): Vec3 {
  out[0] = v.v[0] + (v.w[1] * r[2] - v.w[2] * r[1]);
  out[1] = v.v[1] + (v.w[2] * r[0] - v.w[0] * r[2]);
  out[2] = v.v[2] + (v.w[0] * r[1] - v.w[1] * r[0]);
  return out;
}

// ============================================================================================================================
// Création et accesseurs
// ============================================================================================================================

const statsVides = () => ({ buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points: 0 });

/** Voiture posée à plat au point `p` (origine), cap donné, boost initial, vitesse nulle. */
export const creerVoiture: CreerVoiture = (params) => ({
  id: params.id,
  equipe: params.equipe,
  slot: params.slot,
  humain: params.humain,
  nom: params.nom,
  p: [params.p[0], params.p[1], params.p[2]],
  v: [0, 0, 0],
  w: [0, 0, 0],
  base: baseDepuisCap(params.cap),
  boost: VOITURE.boostInitial,
  rouesContact: 0,
  normaleSurface: null,
  auSol: false,
  saut: { aSaute: false, temps: 0, tenue: false, secondUtilise: false, tempsEnLAir: 0, depuisFinSaut: 0 },
  flip: { actif: false, temps: 0, dir: [0, 0], stall: false, verrouTangage: 0 },
  redressement: { actif: false, temps: 0, signe: 1 },
  contactMonde: { actif: false, normale: [0, 1, 0] },
  supersonique: false,
  supersoniqueDepuis: 0,
  boostActif: false,
  boostDepuis: 0,
  derapage: false,
  frein: 0,
  pneus: { angle: 0, moteur: 0, frein: 0, lat: [0, 0, 0, 0], long: [0, 0, 0, 0] },
  demolie: false,
  reapparitionDans: 0,
  figee: false,
  dernierContactBalleTick: -1e9,
  derniereImpulsionPsyonixTick: -1e9,
  bumpAutreId: -1,
  bumpDelaiTick: -1e9,
  rouesBalle: [false, false, false, false],
  normalesRouesBalle: quatreVec() as [Vec3, Vec3, Vec3, Vec3],
  vitesseEnAttente: [0, 0, 0],
  sautPrecedent: false,
  stats: statsVides(),
});

/**
 * Repose une voiture au coup d'envoi / à la réapparition : position, cap, vitesse nulle, boost (33,33 par défaut), états de saut,
 * de flip, de boost, de frein à main, de pneus et de supersonique remis à zéro (RocketSim Car::Respawn repart d'un `CarState()` neuf),
 * voiture ressuscitée. Ne touche ni `figee` ni les statistiques.
 */
export const replacerVoiture: ReplacerVoiture = (v, p, cap, boost = VOITURE.boostInitial) => {
  v.p[0] = p[0]; v.p[1] = p[1]; v.p[2] = p[2];
  v.v[0] = 0; v.v[1] = 0; v.v[2] = 0;
  v.w[0] = 0; v.w[1] = 0; v.w[2] = 0;
  const b = baseDepuisCap(cap);
  v.base.avant = b.avant; v.base.droite = b.droite; v.base.haut = b.haut;
  v.boost = boost;
  v.rouesContact = 0; v.normaleSurface = null; v.auSol = false;
  v.saut.aSaute = false; v.saut.temps = 0; v.saut.tenue = false; v.saut.secondUtilise = false; v.saut.tempsEnLAir = 0; v.saut.depuisFinSaut = 0;
  v.flip.actif = false; v.flip.temps = 0; v.flip.dir[0] = 0; v.flip.dir[1] = 0; v.flip.stall = false; v.flip.verrouTangage = 0;
  v.redressement.actif = false; v.redressement.temps = 0; v.redressement.signe = 1;
  v.contactMonde.actif = false; v.contactMonde.normale[0] = 0; v.contactMonde.normale[1] = 1; v.contactMonde.normale[2] = 0;
  v.supersonique = false; v.supersoniqueDepuis = 0; v.boostActif = false; v.boostDepuis = 0; v.derapage = false; v.frein = 0;
  const pn = v.pneus;
  pn.angle = 0; pn.moteur = 0; pn.frein = 0;
  for (let i = 0; i < 4; i++) { pn.lat[i] = 0; pn.long[i] = 0; }
  v.demolie = false; v.reapparitionDans = 0;
  v.sautPrecedent = false;
  // délais et roues sur la balle : état neuf (RocketSim Car::Respawn repart d'un `CarState()` : carContact et ballHitInfo vides)
  v.derniereImpulsionPsyonixTick = -1e9; v.bumpAutreId = -1; v.bumpDelaiTick = -1e9;
  v.rouesBalle[0] = false; v.rouesBalle[1] = false; v.rouesBalle[2] = false; v.rouesBalle[3] = false;
  // vitesse d'un bump en attente : oubliée (RocketSim Car::SetState remet `_velocityImpulseCache` à zéro)
  v.vitesseEnAttente[0] = 0; v.vitesseEnAttente[1] = 0; v.vitesseEnAttente[2] = 0;
};

/** Centre de la hitbox en monde. */
export const centreHitbox: CentreHitbox = (v) => {
  const { avant, droite, haut } = v.base;
  return [
    v.p[0] + avant[0] * DX + droite[0] * DY + haut[0] * DZ,
    v.p[1] + avant[1] * DX + droite[1] * DY + haut[1] * DZ,
    v.p[2] + avant[2] * DX + droite[2] * DY + haut[2] * DZ,
  ];
};

/** Les 8 coins de la hitbox en monde. */
export const coinsHitbox: CoinsHitbox = (v) => {
  const c = centreHitbox(v);
  const { avant, droite, haut } = v.base;
  const coins: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const a = sx * HX, b = sy * HY, h = sz * HZ;
    coins.push([c[0] + avant[0] * a + droite[0] * b + haut[0] * h, c[1] + avant[1] * a + droite[1] * b + haut[1] * h, c[2] + avant[2] * a + droite[2] * b + haut[2] * h]);
  }
  return coins;
};

// ============================================================================================================================
// 1. Contacts des roues
// ============================================================================================================================

/**
 * Roues en contact (RocketSim btVehicleRL::rayCast) : une roue touche tant que le bas du pneu est à moins de sa `marge` de la surface
 * (portée du rayon de RocketSim : le pneu « tient » le sol jusqu'à 11 cm au-dessus, moteur et frottement y agissent déjà). Remplit les
 * tampons des roues (normale, bras du point de contact), compte les roues, moyenne leurs normales
 * (btVehicleRL::getUpwardsDirFromWheelContacts) et décide de `auSol`. Le rayon d'une roue de RocketSim touche aussi la BALLE : les
 * roues notées dans `v.rouesBalle` (par `contactVoitureBalle`, à la fin du pas précédent) comptent pour `auSol` (flip reset : saut au
 * sol, second saut et flip rendus, flip en cours arrêté, plus de contrôle aérien) et pour le compte de roues du moteur et de
 * l'alignement, et leur normale entre dans `HAUT_CONTACTS`, mais sans force de pneu, et le collage attend une roue sur le décor [~].
 * Une roue qui touche le décor ET la balle compte une fois, avec la normale du décor (le rayon de Bullet s'arrête au premier impact).
 */
function mesurerRoues(a: Arene, v: EtatVoiture): void {
  const { avant, droite, haut } = v.base;
  let nb = 0, total = 0, sx = 0, sy = 0, sz = 0;
  // somme des normales des roues posées sur la balle seulement, et leur nombre
  let nbBalle = 0, bx = 0, by = 0, bz = 0;
  for (let i = 0; i < 4; i++) {
    const roue = VOITURE.roues[i];
    const lx = roue.local[0], ly = roue.local[1], lz = roue.local[2];
    T_C[0] = v.p[0] + avant[0] * lx + droite[0] * ly + haut[0] * lz;
    T_C[1] = v.p[1] + avant[1] * lx + droite[1] * ly + haut[1] * lz;
    T_C[2] = v.p[2] + avant[2] * lx + droite[2] * ly + haut[2] * lz;
    const contact = a.sd(T_C) - roue.rayon < roue.marge;
    R_CONTACT[i] = contact;
    // une roue dont le rayon touche la balle compte aussi (flip reset), sans force de pneu
    if (contact || v.rouesBalle[i]) total++;
    if (!contact) {
      if (v.rouesBalle[i]) { const nbl = v.normalesRouesBalle[i]; bx += nbl[0]; by += nbl[1]; bz += nbl[2]; nbBalle++; }
      continue;
    }
    const n = R_N[i], r = R_BRAS[i];
    const d = a.sdNormale(T_C, n);
    // point de contact : le point de la surface le plus proche du centre de la roue
    r[0] = T_C[0] - n[0] * d - v.p[0]; r[1] = T_C[1] - n[1] * d - v.p[1]; r[2] = T_C[2] - n[2] * d - v.p[2];
    nb++; sx += n[0]; sy += n[1]; sz += n[2];
    if (nb === 1) { T_F[0] = n[0]; T_F[1] = n[1]; T_F[2] = n[2]; }
  }
  v.rouesContact = nb;
  rouesTouchant = total;
  v.auSol = total >= VOITURE.rouesPourSol;
  if (nbBalle > 0) {
    // des roues sur la balle : moyenne de toutes les normales de contact, le haut de la voiture si leur somme est nulle
    const hx = sx + bx, hy = sy + by, hz = sz + bz, nh = Math.hypot(hx, hy, hz);
    if (nh < 1e-6) { HAUT_CONTACTS[0] = haut[0]; HAUT_CONTACTS[1] = haut[1]; HAUT_CONTACTS[2] = haut[2]; }
    else { HAUT_CONTACTS[0] = hx / nh; HAUT_CONTACTS[1] = hy / nh; HAUT_CONTACTS[2] = hz / nh; }
  }
  if (nb === 0) {
    v.normaleSurface = null;
    if (nbBalle === 0) { HAUT_CONTACTS[0] = haut[0]; HAUT_CONTACTS[1] = haut[1]; HAUT_CONTACTS[2] = haut[2]; }
    return;
  }
  let n = Math.hypot(sx, sy, sz);
  if (n < 1e-6) { sx = T_F[0]; sy = T_F[1]; sz = T_F[2]; n = 1; }
  const ns = v.normaleSurface ?? (v.normaleSurface = [0, 1, 0]);
  ns[0] = sx / n; ns[1] = sy / n; ns[2] = sz / n;
  if (nbBalle === 0) { HAUT_CONTACTS[0] = ns[0]; HAUT_CONTACTS[1] = ns[1]; HAUT_CONTACTS[2] = ns[2]; }
}

// ============================================================================================================================
// 2. Pneus (RocketSim btVehicleRL::calcFrictionImpulses / applyFrictionImpulses, Car::_UpdateWheels)
// ============================================================================================================================

/**
 * Impulsions de frottement des roues en contact, calculées TOUTES sur l'état du début du pas, avec les réglages du pas précédent
 * (`v.pneus`). Pour chaque roue : l'essieu (la droite de la voiture, tournée de l'angle de braquage autour du haut pour les roues
 * avant) est projeté dans le plan de contact ; le roulement est `normale × essieu`.
 *  - latéral : -0,2 × vitesse du point de contact le long de l'essieu × masse effective (Bullet resolveSingleBilateral), × adhérence
 *    latérale × masse / 3 × dt ;
 *  - roulement : le moteur s'il pousse, sinon le frein (pente 37,913 /s, plafonné), × adhérence longitudinale × masse × dt.
 * Elles seront appliquées au point de contact ramené dans le plan du centre de masse perpendiculaire au haut de la voiture : les pneus
 * ne donnent ni roulis ni tangage (btVehicleRL::applyFrictionImpulses).
 */
function calculerPneus(v: EtatVoiture, dt: number): void {
  const { avant, droite, haut } = v.base;
  const pn = v.pneus;
  const c = Math.cos(pn.angle), s = Math.sin(pn.angle);
  for (let i = 0; i < 4; i++) {
    P_JL[i] = 0; P_JF[i] = 0;
    if (!R_CONTACT[i]) continue;
    const ess = P_ESSIEU[i];
    if (VOITURE.roues[i].avant) {
      // volant à droite (angle > 0) : le roulement de la roue tourne vers la droite, son essieu vers l'arrière
      ess[0] = droite[0] * c - avant[0] * s; ess[1] = droite[1] * c - avant[1] * s; ess[2] = droite[2] * c - avant[2] * s;
    } else {
      ess[0] = droite[0]; ess[1] = droite[1]; ess[2] = droite[2];
    }
    const n = R_N[i], r = R_BRAS[i], axe = P_AXE[i], roul = P_ROUL[i], rp = P_BRAS[i];
    const proj = dot3(ess, n);
    axe[0] = ess[0] - n[0] * proj; axe[1] = ess[1] - n[1] * proj; axe[2] = ess[2] - n[2] * proj;
    const na = norme3(axe);
    if (na < 1e-6) continue; // essieu perpendiculaire à la surface (roue sur la tranche) : aucune force de pneu
    axe[0] /= na; axe[1] /= na; axe[2] /= na;
    croixDans(roul, n, axe);
    vitessePointDans(T_A, v, r);
    const vl = dot3(T_A, axe), vf = dot3(T_A, roul);
    P_JL[i] = ((-CONDUITE.amortissementLateral * vl) / inverseMasseEffective(v.base, r, axe)) * pn.lat[i] * ECHELLE_PNEU * dt;
    let af = 0;
    if (pn.moteur !== 0) af = pn.moteur;
    else if (pn.frein > 0) af = -clamp(vf * CONDUITE.penteFrein, -pn.frein, pn.frein);
    P_JF[i] = M * af * pn.long[i] * dt;
    const h = dot3(r, haut);
    rp[0] = r[0] - haut[0] * h; rp[1] = r[1] - haut[1] * h; rp[2] = r[2] - haut[2] * h;
  }
}

/** Applique les impulsions calculées par `calculerPneus`. */
function appliquerPneus(v: EtatVoiture): void {
  for (let i = 0; i < 4; i++) {
    if (P_JL[i] !== 0) appliquerImpulsion(v, P_BRAS[i], P_AXE[i], P_JL[i]);
    if (P_JF[i] !== 0) appliquerImpulsion(v, P_BRAS[i], P_ROUL[i], P_JF[i]);
  }
}

/**
 * Réglages des pneus pour le pas SUIVANT (RocketSim Car::_UpdateWheels), d'après les commandes de ce pas :
 *  - moteur et frein : gaz opposé à la marche = frein PLEIN et moteur coupé ; sans gaz, roue libre (15 % du frein), frein plein sous
 *    0,25 m/s ; frein à main tenu = ni frein ni roue libre, le gaz brut va au moteur ; moteur divisé par 4 avec moins de trois roues
 *    en contact, celles posées sur la balle comprises (`rouesTouchant`, le numWheelsInContact de RocketSim) ;
 *  - braquage selon la vitesse, mélangé avec celui du frein à main selon sa valeur analogique ;
 *  - adhérences de chaque roue en contact selon son glissement, le frein à main et, sans gaz, la pente de la surface.
 * `gazReel` : le gaz, forcé à 1 par un appui sur le boost avec de la réserve (RocketSim realThrottle).
 */
function majPneus(v: EtatVoiture, e: Readonly<EntreesVoiture>, vAvant: number, gazReel: number): void {
  const pn = v.pneus;
  const av = Math.abs(vAvant);
  let moteur = gazReel, frein = 0;
  if (!e.derapage) {
    if (Math.abs(gazReel) >= CONDUITE.zoneMorteGaz) {
      if (av > CONDUITE.seuilArretFrein && signe(gazReel) !== signe(vAvant)) { frein = 1; moteur = 0; }
    } else {
      moteur = 0;
      frein = av < CONDUITE.seuilArretFrein ? 1 : CONDUITE.facteurRoueLibre;
    }
  }
  let parRoue = interpolerTable(CONDUITE.courbeGaz, av) / 4;
  if (rouesTouchant < VOITURE.rouesPourSol) parRoue /= 4;
  pn.moteur = moteur * parRoue;
  pn.frein = (frein * CONDUITE.frein) / 4;

  let angle = interpolerTable(CONDUITE.angleBraquage, av);
  if (v.frein > 0) angle += (interpolerTable(CONDUITE.angleBraquageDerapage, av) - angle) * v.frein;
  pn.angle = angle * e.direction;

  const { avant, droite, haut } = v.base;
  for (let i = 0; i < 4; i++) {
    if (!R_CONTACT[i]) continue;
    // vitesse du point d'attache de la roue, glissement = part latérale de cette vitesse
    const at = VOITURE.roues[i].attache;
    T_A[0] = avant[0] * at[0] + droite[0] * at[1] + haut[0] * at[2];
    T_A[1] = avant[1] * at[0] + droite[1] * at[1] + haut[1] * at[2];
    T_A[2] = avant[2] * at[0] + droite[2] * at[1] + haut[2] * at[2];
    vitessePointDans(T_B, v, T_A);
    const ess = P_ESSIEU[i], n = R_N[i];
    croixDans(T_C, n, ess);
    const lat = Math.abs(dot3(T_B, ess));
    const glissement = lat > CONDUITE.seuilGlissement ? lat / (Math.abs(dot3(T_B, T_C)) + lat) : 0;
    let adhLat = interpolerTable(CONDUITE.adherenceGlissement, glissement), adhLong = 1;
    if (v.frein > 0) {
      adhLat *= (CONDUITE.adherenceDerapage - 1) * v.frein + 1;
      adhLong *= (interpolerTable(CONDUITE.motriciteDerapage, glissement) - 1) * v.frein + 1;
    }
    if (gazReel === 0) {
      const k = interpolerTable(CONDUITE.adherenceSansGaz, n[1]);
      adhLat *= k; adhLong *= k;
    }
    pn.lat[i] = adhLat; pn.long[i] = adhLong;
  }
}

// ============================================================================================================================
// 3. Couples en l'air (RocketSim Car::_UpdateAirTorque)
// ============================================================================================================================

/** Entrées de lacet et de roulis EFFECTIVES en l'air (spec § 5.5) : `derapage` bascule le volant en roulis. */
const lacetEffectif = (e: Readonly<EntreesVoiture>): number => (e.derapage ? 0 : e.lacet !== 0 ? e.lacet : e.direction);
const roulisEffectif = (e: Readonly<EntreesVoiture>): number => (e.derapage ? clamp(e.roulis + e.direction, -1, 1) : e.roulis);

/**
 * Moins de trois roues au sol : couple du dodge, contrôle aérien, gaz en l'air. Tout est cumulé dans `DW` / `DV` (forces du pas).
 *  - couple du dodge : roulis 260 rad/s² × composante latérale, tangage 224 rad/s² × composante avant, tant que le flip a moins de
 *    0,65 s. Le « flip cancel » (manche à l'opposé du flip) n'éteint QUE la part de tangage : un flip en diagonale annulé garde son
 *    tonneau, c'est le speed flip. Le couple ne commence qu'au pas qui SUIT l'appui (le flip démarre après cette fonction) ;
 *  - contrôle aérien : seulement si `sansRoue` (aucune roue en contact), hors redressement, et pas pendant un dodge non annulé.
 *    L'amortissement lit la vitesse angulaire du début du pas ; celui du roulis n'est jamais levé par l'entrée ;
 *  - le gaz pousse un peu le long de l'avant (RocketSim THROTTLE_AIR_ACCEL).
 */
function couplesEnLAir(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, sansRoue: boolean): void {
  const { avant, droite, haut } = v.base;
  const f = v.flip;
  if (f.actif) f.actif = f.temps < T_FLIP;
  let controle: boolean;
  if (f.actif) {
    const dirA = f.dir[0], dirD = f.dir[1];
    if (dirA !== 0 || dirD !== 0) {
      controle = false;
      let echelle = 1;
      if (dirA !== 0 && e.tangage !== 0 && signe(e.tangage) === signe(dirA)) {
        echelle = 1 - Math.min(Math.abs(e.tangage), 1);
        controle = true;
      }
      const ar = dirD * FLIP.coupleRoulis * dt, at = -dirA * FLIP.coupleTangage * echelle * dt;
      DW[0] += avant[0] * ar + droite[0] * at; DW[1] += avant[1] * ar + droite[1] * at; DW[2] += avant[2] * ar + droite[2] * at;
    } else {
      controle = true; // stall : ni impulsion ni couple, la voiture reste pilotable
    }
  } else {
    controle = true;
  }
  if (controle && sansRoue && !v.redressement.actif) {
    const lacet = lacetEffectif(e), roulis = roulisEffectif(e);
    // le tangage est verrouillé pendant le flip et 0,3 s après (l'amortissement de tangage est alors entier)
    const tang = f.actif || f.verrouTangage > 0 ? 0 : e.tangage;
    const wa = dot3(v.w, avant), wd = dot3(v.w, droite), wh = dot3(v.w, haut);
    const aa = AIR.coupleRoulis * roulis - AIR.amortRoulis * wa;
    const ad = AIR.coupleTangage * tang - AIR.amortTangage * wd * (1 - Math.abs(tang));
    const ah = -AIR.coupleLacet * lacet - AIR.amortLacet * wh * (1 - Math.abs(lacet));
    DW[0] += (avant[0] * aa + droite[0] * ad + haut[0] * ah) * dt;
    DW[1] += (avant[1] * aa + droite[1] * ad + haut[1] * ah) * dt;
    DW[2] += (avant[2] * aa + droite[2] * ad + haut[2] * ah) * dt;
  }
  if (e.accel !== 0) {
    const acc = AIR.gazAerien * e.accel * dt;
    DV[0] += avant[0] * acc; DV[1] += avant[1] * acc; DV[2] += avant[2] * acc;
  }
}

// ============================================================================================================================
// 4. Saut, redressement, double saut, flip (RocketSim Car::_UpdateJump, _UpdateAutoFlip, _UpdateDoubleJumpOrFlip)
// ============================================================================================================================

/**
 * Premier saut. Il ne part qu'AU SOL (trois roues au moins) : impulsion immédiate le long du haut de la voiture, puis maintien tant que
 * le bouton reste tenu (0,2 s au plus, 0,025 s au moins à 62 %). Le maintien ne dépend que du temps et du bouton, jamais du sol ; au
 * sol, l'état de saut n'est remis à zéro qu'une fois le maintien fini et le saut vieux de 0,05 s (les roues touchent encore au décollage).
 */
function majSaut(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, dt32: number, front: boolean, evs: EvenementVoiture[]): void {
  const s = v.saut;
  const { haut } = v.base;
  if (v.auSol && !s.tenue && !(s.aSaute && s.temps < T_SAUT_GARDE)) { s.aSaute = false; s.temps = 0; }
  if (s.tenue) {
    if (!(s.temps < T_SAUT_MIN || (e.saut && s.temps < T_SAUT_MAX))) s.tenue = false;
  } else if (v.auSol && front) {
    s.tenue = true; s.temps = 0;
    v.v[0] += haut[0] * SAUT.impulsion; v.v[1] += haut[1] * SAUT.impulsion; v.v[2] += haut[2] * SAUT.impulsion;
    evs.push({ t: "saut", idVoiture: v.id });
  }
  if (s.tenue) {
    s.aSaute = true;
    const k = SAUT.maintien * dt * (s.temps < T_SAUT_MIN ? SAUT.echelleAvantMin : 1);
    DV[0] += haut[0] * k; DV[1] += haut[1] * k; DV[2] += haut[2] * k;
  }
  if (s.aSaute) s.temps = f32(s.temps + dt32);
}

/** Angle de roulis de la voiture (rad, convention de RocketSim `Angle::FromRotMat`) : 0 à plat, ±π sur le toit. */
export function angleRoulis(b: Readonly<Base>): number {
  return -Math.atan2(b.droite[1], b.haut[1]);
}

/**
 * Redressement sur le toit (auto-flip). Déclencheur : appui sur saut alors que la CAISSE a touché une surface de type sol au pas
 * précédent et que le roulis dépasse 2,8 rad. Impulsion de 2 m/s le long de -haut (vers la surface), puis 50 rad/s² ajoutés autour de
 * l'avant pendant 0,4 s × |roulis| / π. Pendant ce temps : ni contrôle aérien ni dodge. Le plafond de 5,5 rad/s vaut comme partout.
 */
function majRedressement(v: EtatVoiture, dt: number, dt32: number, front: boolean): void {
  const r = v.redressement, cfg = CONDUITE.redressement;
  const { avant, haut } = v.base;
  if (front && v.contactMonde.actif && v.contactMonde.normale[1] > cfg.seuilNormale) {
    const roulis = angleRoulis(v.base);
    if (Math.abs(roulis) > cfg.seuilRoulis) {
      r.temps = f32(cfg.dureeMaxS * (Math.abs(roulis) / Math.PI));
      r.signe = roulis > 0 ? 1 : -1;
      r.actif = true;
      v.v[0] -= haut[0] * cfg.impulsion; v.v[1] -= haut[1] * cfg.impulsion; v.v[2] -= haut[2] * cfg.impulsion;
    }
  }
  if (r.actif) {
    if (r.temps <= 0) {
      r.actif = false; r.temps = 0;
    } else {
      // RocketSim ajoute `avant × 50 × signe × dt` dans son repère ; le nôtre en est le miroir, d'où le signe moins : le côté bas remonte
      const k = -cfg.couple * r.signe * dt;
      v.w[0] += avant[0] * k; v.w[1] += avant[1] * k; v.w[2] += avant[2] * k;
      r.temps = f32(r.temps - dt32);
    }
  }
}

/** Début d'un flip (dodge) ou d'un stall : direction, impulsion horizontale, verrou de tangage. `vAvant` : vitesse le long de l'avant (3D) au début du pas. */
function demarrerFlip(v: EtatVoiture, e: Readonly<EntreesVoiture>, vAvant: number, evs: EvenementVoiture[]): void {
  const lacet = lacetEffectif(e), roulis = roulisEffectif(e);
  // règle de RL (RocketSim / RLUtilities) : direction du dodge = (-tangage, lacet + roulis) ; stall quand elle est quasi nulle
  // alors que la somme des entrées dépasse le seuil du flip (lacet et roulis opposés, tangage nul)
  let dirA = -e.tangage, dirD = lacet + roulis;
  const stall = Math.abs(dirA) < FLIP.zoneMorteStall && Math.abs(dirD) < FLIP.zoneMorteStall;
  if (stall) {
    // stall (RocketSim) : direction nulle, donc ni impulsion ni couple ; il reste le verrou de tangage et le contrôle aérien
    dirA = 0; dirD = 0;
  } else {
    const n = Math.hypot(dirA, dirD) || 1;
    dirA /= n; dirD /= n;
  }
  const f = v.flip;
  f.actif = true; f.temps = 0; f.dir[0] = dirA; f.dir[1] = dirD; f.stall = stall;
  f.verrouTangage = T_VERROU;
  if (!stall) {
    const { avant } = v.base;
    // RocketSim : l'avant projeté à l'horizontale, et sa PERPENDICULAIRE (jamais la droite de la voiture : penchée ou sur le flanc,
    // la poussée latérale reste horizontale et perpendiculaire au cap). À cap 0, avant = (0, 1) et droite = (-1, 0) en (x, z).
    let ax = avant[0], az = avant[2];
    const na = Math.hypot(ax, az);
    if (na < 1e-6) { ax = 0; az = 0; } else { ax /= na; az /= na; } // nez à la verticale : pas de direction horizontale, pas d'impulsion
    const dx = -az, dz = ax;
    const r = Math.min(Math.abs(vAvant) / VOITURE.vitesseMax, 1);
    const arriere = flipEstArriere(dirA, vAvant);
    const sA = arriere ? FLIP.echelleArriere : FLIP.echelleAvant;
    // RocketSim : une composante normalisée sous 0,1 ne pousse pas (la rotation, elle, garde la direction exacte)
    const iA = Math.abs(dirA) < FLIP.zoneMorteStall ? 0 : dirA, iD = Math.abs(dirD) < FLIP.zoneMorteStall ? 0 : dirD;
    const kA = iA * (1 + (sA - 1) * r) * FLIP.impulsionBase * (arriere ? FLIP.facteurArriere : 1);
    const kD = iD * (1 + (FLIP.echelleCote - 1) * r) * FLIP.impulsionBase;
    v.v[0] += ax * kA + dx * kD;
    v.v[2] += az * kA + dz * kD;
  }
  evs.push({ t: "flip", idVoiture: v.id, dir: [dirA, dirD], stall });
}

/**
 * Un dodge est « arrière » (échelle 2,5 × 16/15) quand il s'oppose au sens de la marche : à l'arrêt (|v| < 1 m/s), manche tiré ;
 * sinon, dodge vers l'avant en marche arrière ou vers l'arrière en marche avant (RocketSim).
 */
export function flipEstArriere(dirA: number, vitesseAvant: number): boolean {
  if (Math.abs(vitesseAvant) < FLIP.seuilSensMarche) return dirA < 0;
  return (dirA >= 0) !== (vitesseAvant >= 0);
}

/**
 * Second saut et flip. Au sol (trois roues) : tout est rendu, sans garde. Sinon (0, 1 ou 2 roues), la fenêtre de 1,25 s court depuis la
 * FIN du premier saut (bouton relâché ou 0,2 s de maintien) : une voiture qui a quitté le sol SANS sauter (bord d'un mur, bump, flip
 * reset) garde son saut aussi longtemps qu'elle reste en l'air. Un appui dans la fenêtre est un dodge (entrées ≥ 0,5) ou un double
 * saut ; rien pendant le redressement. Puis le temps du flip avance et l'amortissement vertical s'applique, AVANT les forces du pas.
 */
function majSecondSaut(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, dt32: number, front: boolean, vAvant: number, evs: EvenementVoiture[]): void {
  const s = v.saut, f = v.flip;
  if (v.auSol) {
    s.secondUtilise = false; s.depuisFinSaut = 0;
    f.temps = 0; f.verrouTangage = 0;
  } else {
    s.depuisFinSaut = s.aSaute && !s.tenue ? f32(s.depuisFinSaut + dt32) : 0;
    if (front && s.depuisFinSaut < T_FENETRE && !s.secondUtilise && !v.redressement.actif) {
      s.secondUtilise = true;
      if (Math.abs(e.tangage) + Math.abs(lacetEffectif(e)) + Math.abs(roulisEffectif(e)) >= FLIP.zoneMorte) {
        demarrerFlip(v, e, vAvant, evs);
      } else {
        const { haut } = v.base;
        v.v[0] += haut[0] * SAUT.impulsionDoubleSaut; v.v[1] += haut[1] * SAUT.impulsionDoubleSaut; v.v[2] += haut[2] * SAUT.impulsionDoubleSaut;
        evs.push({ t: "doubleSaut", idVoiture: v.id });
      }
    }
  }
  if (f.actif) {
    f.temps = f32(f.temps + dt32);
    // amortissement vertical du flip : la voiture « flotte » pendant tout le couple de dodge (RocketSim : dès 0,15 s, tant qu'elle
    // descend ou avant 0,21 s). La vitesse lue est celle d'AVANT la gravité du pas, qui n'est donc pas amortie
    if (f.temps <= T_FLIP && f.temps >= T_AMORT_DEBUT && (v.v[1] < 0 || f.temps < T_AMORT_FIN)) v.v[1] *= Math.pow(1 - FLIP.amortissementVertical, dt * 120);
  } else if (f.verrouTangage > 0) {
    // le temps continue de courir après le couple, pour le verrou de tangage
    f.temps = f32(f.temps + dt32);
  }
  if (f.actif || f.verrouTangage > 0) f.verrouTangage = f.temps < T_VERROU ? T_VERROU - f.temps : 0;
}

// ============================================================================================================================
// 5. Alignement sur la surface, boost
// ============================================================================================================================

/**
 * Alignement sur la surface (RocketSim Car::_UpdateAutoRoll) : `n` est la normale moyenne des roues en contact (décor et balle,
 * `HAUT_CONTACTS`), à défaut celle du contact de la caisse. Accélération de 1 m/s² vers la surface et accélération angulaire de 80 rad/s² autour de l'avant (si la voiture
 * penche de côté) et de la droite (si elle pique ou se cabre), chacune pondérée par son défaut d'alignement. Force du pas (`DV`, `DW`).
 */
function autoRoll(v: EtatVoiture, n: Readonly<Vec3>, dt: number): void {
  const { avant, droite } = v.base;
  // droite et avant « idéaux » sur la surface (égaux à ceux de la voiture quand elle est alignée)
  croixDans(T_A, avant, n);
  croixDans(T_B, n, T_A);
  const kR = 1 - clamp(dot3(droite, T_A), 0, 1), kF = 1 - clamp(dot3(avant, T_B), 0, 1);
  // signes de RocketSim inversés : notre repère est le miroir du sien (les vecteurs de rotation changent de signe)
  const cA = (dot3(droite, n) >= 0 ? 1 : -1) * kR * CONDUITE.autoRoll.couple * dt;
  const cD = (dot3(avant, n) >= 0 ? -1 : 1) * kF * CONDUITE.autoRoll.couple * dt;
  DW[0] += avant[0] * cA + droite[0] * cD; DW[1] += avant[1] * cA + droite[1] * cD; DW[2] += avant[2] * cA + droite[2] * cD;
  const k = CONDUITE.autoRoll.force * dt;
  DV[0] -= n[0] * k; DV[1] -= n[1] * k; DV[2] -= n[2] * k;
}

/**
 * Boost (RocketSim Car::_UpdateBoost) : un appui brûle au moins 0,1 s (12 pas) ; la poussée suit l'avant RÉEL de la voiture (posée de
 * travers sur la surface, elle pousse aussi vers la surface ou l'en éloigne), 9,92 m/s² au sol (trois roues), 10,58 m/s² sinon.
 */
function majBoost(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, dt32: number, evs: EvenementVoiture[]): void {
  const etait = v.boostActif;
  if (v.boost > 0) {
    if (v.boostActif) v.boostActif = e.boost || v.boostDepuis < T_BOOST_MIN;
    else if (e.boost) v.boostActif = true;
  } else {
    v.boostActif = false;
  }
  v.boostDepuis = v.boostActif ? f32(v.boostDepuis + dt32) : 0;
  if (v.boostActif) {
    v.boost = Math.max(0, v.boost - BOOST.consommation * dt);
    const { avant } = v.base;
    const acc = (v.auSol ? BOOST.acceleration : BOOST.accelerationAir) * dt;
    DV[0] += avant[0] * acc; DV[1] += avant[1] * acc; DV[2] += avant[2] * acc;
  }
  if (v.boostActif !== etait) evs.push({ t: "boost", idVoiture: v.id, actif: v.boostActif });
}

// ============================================================================================================================
// 6. Résolution des contacts avec le décor
// ============================================================================================================================

/** Nombre de roues qui APPUIENT sur la surface (pneu enfoncé) au dernier `resoudreRoues`. */
let rouesEnAppui = 0;

/**
 * Contacts des roues : impulsion non élastique (e = 0) au point de chaque roue qui s'enfonce, avec la masse et l'inertie du
 * solide, puis correction de position. AUCUN frottement ici (c'est le modèle de pneu). Tient lieu de la suspension de RocketSim
 * (ressorts et amortisseurs de btVehicleRL::updateSuspension, non repris : l'architecture est sans suspension). Rend la plus forte
 * vitesse normale entrante (m/s, ≥ 0).
 */
function resoudreRoues(a: Arene, v: EtatVoiture): number {
  const { avant, droite, haut } = v.base;
  let cnt = 0;
  for (let i = 0; i < 4; i++) {
    const roue = VOITURE.roues[i];
    const lx = roue.local[0], ly = roue.local[1], lz = roue.local[2];
    T_C[0] = v.p[0] + avant[0] * lx + droite[0] * ly + haut[0] * lz;
    T_C[1] = v.p[1] + avant[1] * lx + droite[1] * ly + haut[1] * lz;
    T_C[2] = v.p[2] + avant[2] * lx + droite[2] * ly + haut[2] * lz;
    const s = a.sd(T_C) - roue.rayon;
    if (s >= 0) continue;
    a.sdNormale(T_C, NORMS[cnt]);
    const n = NORMS[cnt], r = ARMS[cnt];
    // point de la roue qui touche la surface
    r[0] = T_C[0] - n[0] * roue.rayon - v.p[0]; r[1] = T_C[1] - n[1] * roue.rayon - v.p[1]; r[2] = T_C[2] - n[2] * roue.rayon - v.p[2];
    PENS[cnt] = -s;
    cnt++;
  }
  rouesEnAppui = cnt;
  if (cnt === 0) return 0;
  let maxVn = 0;
  for (let it = 0; it < 3; it++) {
    for (let k = 0; k < cnt; k++) {
      const n = NORMS[k], r = ARMS[k];
      vitessePointDans(T_A, v, r);
      const vn = dot3(T_A, n);
      if (vn < 0) {
        if (-vn > maxVn) maxVn = -vn;
        appliquerImpulsion(v, r, n, -vn / inverseMasseEffective(v.base, r, n));
      }
    }
  }
  // correction de position : moyenne des corrections de chaque roue qui s'enfonce
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < cnt; k++) {
    const c = Math.min(PENS[k], CORRECTION_ROUE_M);
    cx += NORMS[k][0] * c; cy += NORMS[k][1] * c; cz += NORMS[k][2] * c;
  }
  v.p[0] += cx / cnt; v.p[1] += cy / cnt; v.p[2] += cz / cnt;
  return maxVn;
}

/**
 * Contact du CORPS avec le décor (coins et centres de face de la hitbox) : impulsion (restitution 0,3 au-dessus de 0,1 m/s) avec
 * frottement de Coulomb (0,3), correction de position (≤ 10 cm). Note dans `v.contactMonde` si la caisse touche (à 1 cm près) et la
 * normale de son point le plus enfoncé : le pas SUIVANT s'en sert (redressement, alignement). Rend la plus forte vitesse normale entrante.
 */
function resoudreCorps(a: Arene, v: EtatVoiture): number {
  const { avant, droite, haut } = v.base;
  const cx0 = v.p[0] + avant[0] * DX + droite[0] * DY + haut[0] * DZ;
  const cy0 = v.p[1] + avant[1] * DX + droite[1] * DY + haut[1] * DZ;
  const cz0 = v.p[2] + avant[2] * DX + droite[2] * DY + haut[2] * DZ;
  T_C[0] = cx0; T_C[1] = cy0; T_C[2] = cz0;
  if (a.sd(T_C) > RAYON_ENGLOBANT + MARGE_CONTACT_CORPS_M) return 0;
  const cm = v.contactMonde;
  let maxVn = 0, corrX = 0, corrY = 0, corrZ = 0, nb = 0, plusProche = MARGE_CONTACT_CORPS_M;
  for (let i = 0; i < POINTS_CORPS.length; i++) {
    const o = POINTS_CORPS[i];
    T_C[0] = cx0 + avant[0] * o[0] + droite[0] * o[1] + haut[0] * o[2];
    T_C[1] = cy0 + avant[1] * o[0] + droite[1] * o[1] + haut[1] * o[2];
    T_C[2] = cz0 + avant[2] * o[0] + droite[2] * o[1] + haut[2] * o[2];
    const s = a.sdNormale(T_C, T_N);
    if (s < plusProche) {
      plusProche = s;
      cm.actif = true; cm.normale[0] = T_N[0]; cm.normale[1] = T_N[1]; cm.normale[2] = T_N[2];
    }
    if (s >= 0) continue;
    const r = ARMS[0];
    r[0] = T_C[0] - v.p[0]; r[1] = T_C[1] - v.p[1]; r[2] = T_C[2] - v.p[2];
    vitessePointDans(T_A, v, r);
    const vn = dot3(T_A, T_N);
    if (vn < 0) {
      const entrant = -vn;
      if (entrant > maxVn) maxVn = entrant;
      const j = (-(1 + (entrant > SEUIL_RESTITUTION_CORPS ? RESTITUTION_CORPS : 0)) * vn) / inverseMasseEffective(v.base, r, T_N);
      appliquerImpulsion(v, r, T_N, j);
      // frottement de Coulomb sur la vitesse tangentielle restante
      vitessePointDans(T_A, v, r);
      const vn2 = dot3(T_A, T_N);
      T_B[0] = T_A[0] - T_N[0] * vn2; T_B[1] = T_A[1] - T_N[1] * vn2; T_B[2] = T_A[2] - T_N[2] * vn2;
      const vt = norme3(T_B);
      if (vt > 1e-6) {
        T_B[0] /= vt; T_B[1] /= vt; T_B[2] /= vt;
        const jt = Math.min(FROTTEMENT_CORPS * j, vt / inverseMasseEffective(v.base, r, T_B));
        appliquerImpulsion(v, r, T_B, -jt);
      }
    }
    const c = Math.min(-s, CORRECTION_CORPS_M);
    corrX += T_N[0] * c; corrY += T_N[1] * c; corrZ += T_N[2] * c; nb++;
  }
  if (nb > 0) { v.p[0] += corrX / nb; v.p[1] += corrY / nb; v.p[2] += corrZ / nb; }
  return maxVn;
}

// ============================================================================================================================
// Le pas
// ============================================================================================================================

/**
 * Plafond de vitesse de la voiture (RocketSim Car::_FinishPhysicsTick, CAR_MAX_SPEED = 2300 uu/s), au sol comme en l'air. `pasVoiture`
 * l'applique en fin de pas ; `match.ts` le rappelle UNE fois par voiture heurtée, après toutes les paires de voitures du pas et l'ajout
 * de la vitesse en attente des bumps (RocketSim ajoute `_velocityImpulseCache` juste avant le plafond).
 */
export function plafonnerVitesse(v: EtatVoiture): void {
  const nv = norme3(v.v);
  if (nv > VOITURE.vitesseMax) { const k = VOITURE.vitesseMax / nv; v.v[0] *= k; v.v[1] *= k; v.v[2] *= k; }
}

/**
 * Un pas de la voiture. Une voiture `demolie` ne fait que décompter `reapparitionDans` (c'est `match.ts` qui la replace à zéro) ;
 * une voiture `figee` ignore les entrées mais garde sa physique (gravité, collage, contacts).
 */
export const pasVoiture: PasVoiture = (a, v, e0, dt, _tick) => {
  const evs: EvenementVoiture[] = [];
  const dt32 = f32(dt);
  if (v.demolie) {
    // RocketSim Car::_PreTickUpdate : décompte en simple précision, il tombe exactement à 0 au 360ᵉ pas de 1/120 s
    v.reapparitionDans = Math.max(f32(v.reapparitionDans - dt32), 0);
    v.boostActif = false; v.derapage = false; v.sautPrecedent = false;
    return evs;
  }
  const e = v.figee ? ENTREES_FIGEES : e0;
  const s = v.saut;
  const { avant } = v.base;
  DV[0] = 0; DV[1] = 0; DV[2] = 0; DW[0] = 0; DW[1] = 0; DW[2] = 0;

  // --- 1. contacts des roues, impulsions des pneus (réglages du pas précédent), mesures du début du pas
  mesurerRoues(a, v);
  calculerPneus(v, dt);
  // temps passé sans aucune roue à portée de la surface (événement d'atterrissage, bots) ; remis à zéro quand une roue appuie
  const etaitEnLAir = s.tempsEnLAir > AIR_MIN_ATTERRISSAGE_S;
  if (v.rouesContact === 0) s.tempsEnLAir += dt;
  const vAvant = dot3(v.v, avant);
  const front = e.saut && !v.sautPrecedent;
  v.sautPrecedent = e.saut;

  // --- 2. frein à main analogique (au sol comme en l'air), pneus du pas suivant, collage
  v.frein = clamp(v.frein + (e.derapage ? CONDUITE.freinMainMontee : -CONDUITE.freinMainDescente) * dt, 0, 1);
  v.derapage = v.frein > 0 && v.rouesContact > 0;
  // gaz réel : un appui sur le boost avec de la réserve vaut plein gaz (l'ENTRÉE, pas la traîne de 0,1 s du boost)
  const gazReel = e.boost && v.boost > 0 ? 1 : e.accel;
  majPneus(v, e, vAvant, gazReel);
  if (v.rouesContact > 0) {
    // collage (RocketSim « sticky forces ») dès qu'une roue touche le DÉCOR (m_isInContactWithWorld) : demi-gravité vers la surface,
    // plus (1 - |n vertical|) × gravité si l'on donne du gaz ou roule ; aucune condition sur la vitesse normale. La direction est celle
    // de tous les contacts de roue (getUpwardsDirFromWheelContacts) : `normaleSurface`, sauf si une autre roue est posée sur la balle
    const n = HAUT_CONTACTS;
    const colle = gazReel !== 0 || Math.abs(vAvant) > CONDUITE.seuilArretFrein;
    const k = (CONDUITE.collage + (colle ? 1 - Math.abs(n[1]) : 0)) * GRAVITE * dt;
    DV[0] -= n[0] * k; DV[1] -= n[1] * k; DV[2] -= n[2] * k;
  }

  // --- 3. moins de trois roues : couple du dodge, contrôle aérien (aucune roue), gaz en l'air ; sinon le flip s'arrête
  // (roues au contact du décor OU de la balle : RocketSim numWheelsInContact)
  if (rouesTouchant < VOITURE.rouesPourSol) couplesEnLAir(v, e, dt, rouesTouchant === 0);
  else v.flip.actif = false;

  // --- 4. saut, redressement, second saut ou flip
  majSaut(v, e, dt, dt32, front, evs);
  majRedressement(v, dt, dt32, front);
  majSecondSaut(v, e, dt, dt32, front, vAvant, evs);

  // --- 5. alignement sur la surface (avec du gaz : 1 à 3 roues en contact, décor ou balle, ou la caisse a touché), pneus, boost
  if (e.accel !== 0 && ((rouesTouchant > 0 && rouesTouchant < 4) || v.contactMonde.actif)) {
    autoRoll(v, rouesTouchant > 0 ? HAUT_CONTACTS : v.contactMonde.normale, dt);
  }
  v.contactMonde.actif = false;
  appliquerPneus(v);
  majBoost(v, e, dt, dt32, evs);

  // --- 6. forces du pas et gravité, puis intégration avec des vitesses NON plafonnées (RocketSim plafonne après le pas de Bullet)
  v.v[0] += DV[0]; v.v[1] += DV[1] - GRAVITE * dt; v.v[2] += DV[2];
  v.w[0] += DW[0]; v.w[1] += DW[1]; v.w[2] += DW[2];
  v.p[0] += v.v[0] * dt; v.p[1] += v.v[1] * dt; v.p[2] += v.v[2] * dt;
  integrerBase(v.base, v.w, dt);

  // --- 7. plafond de vitesse angulaire, contacts avec le décor, plafond de vitesse
  // RocketSim : contacts → intégration → plafond. Ici les contacts sont résolus APRÈS l'intégration : le plafond de 5,5 rad/s se place
  // donc entre les deux pour garder le même cycle. En l'air c'est exactement RocketSim (couples → intégration → plafond) ; au contact,
  // la rotation donnée par les roues ou la caisse sert à l'intégration suivante avant d'être plafonnée, comme dans Bullet (c'est ce qui
  // laisse la voiture suivre les raccords de 2,56 m à pleine vitesse : il y faut 9 rad/s).
  const nw = norme3(v.w);
  if (nw > VOITURE.vitesseAngMax) { const k = VOITURE.vitesseAngMax / nw; v.w[0] *= k; v.w[1] *= k; v.w[2] *= k; }
  const impactRoues = resoudreRoues(a, v);
  if (impactRoues > SEUIL_ATTERRISSAGE && etaitEnLAir) evs.push({ t: "atterrissage", idVoiture: v.id, vitesse: impactRoues });
  if (rouesEnAppui > 0) s.tempsEnLAir = 0;
  const impactCorps = resoudreCorps(a, v);
  if (impactCorps > SEUIL_CHOC) evs.push({ t: "choc", idVoiture: v.id, vitesse: impactCorps });
  plafonnerVitesse(v);

  // --- 8. supersonique (RocketSim Car::_PostTickUpdate) : le maintien à 21 m/s ne vaut que pendant la première seconde passée supersonique
  const vit = norme3(v.v);
  const sup = v.supersonique && v.supersoniqueDepuis < VOITURE.supersoniqueMaintienS ? vit >= VOITURE.supersoniqueOff : vit >= VOITURE.supersoniqueOn;
  v.supersoniqueDepuis = sup ? f32(v.supersoniqueDepuis + dt32) : 0;
  if (sup !== v.supersonique) {
    v.supersonique = sup;
    evs.push({ t: "supersonique", idVoiture: v.id, actif: sup });
  }
  return evs;
};
