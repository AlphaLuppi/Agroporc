/**
 * Rocket Muche : physique de la voiture (module C, première moitié ; les contacts sont dans `contacts.ts`).
 *
 * L'Octane est un corps rigide (masse 180, boîte `VOITURE.hitbox` décalée de `VOITURE.decalageHitbox` ; l'ORIGINE de la voiture est
 * son centre de masse, comme dans Rocket League) qui roule sur quatre « roues » : pas de suspension, quatre points de contact
 * avec la SDF du stade (`Arene`). Sol, murs et plafond sont traités pareillement : la surface est ce que dit la SDF, la voiture est
 * collée à la surface qu'elle touche et conduit dans le plan tangent.
 *
 * Ordre d'un pas (spec § 5.2) :
 *  1. mesure des contacts des roues (`rouesContact`, `normaleSurface`, `auSol`) ;
 *  2. état de saut (remises à zéro à l'atterrissage, fenêtre du second saut), boost ;
 *  3. appui sur saut : saut, double saut, flip (dodge, stall) ou redressement sur le toit ;
 *  4. gravité, collage ; conduite (sol) ou contrôle aérien (air) ; maintien du saut ; boost ;
 *  5. intégration (vitesse plafonnée à 23 m/s, orientation) ;
 *  6. résolution des contacts : roues (impulsion non élastique SANS frottement : l'adhérence est le modèle de pneu) puis corps ;
 *  7. supersonique et événements.
 *
 * Fidélité (spec § 13) : gravité, courbes de gaz et de courbure, frein, saut, fenêtre de 1,25 s, couples de l'air control, boost,
 * supersonique, durée du flip [RL] ; modèle de pneu (adhérence latérale, dérapage), collage, redressement, échelles de vitesse du
 * flip [~]. Le frottement du CORPS contre le décor (voiture sur le toit) est ajouté au modèle de la spec (μ = 0,35) : sans lui une
 * voiture retournée glisserait indéfiniment.
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

/** Après un saut, le sol n'est pas considéré comme « atterri » pendant ce délai (les roues touchent encore deux ou trois pas). */
const GARDE_DECOLLAGE_S = 0.12;
/** Correction de position maximale par pas pour une roue / pour le corps (m). */
const CORRECTION_ROUE_M = 0.02;
const CORRECTION_CORPS_M = 0.1;
/** Restitution du corps contre le décor et frottement ajouté (voir en-tête). */
const RESTITUTION_CORPS = 0.2;
const FROTTEMENT_CORPS = 0.35;
/** Au-dessus de cette vitesse normale entrante, un choc du corps est signalé (m/s). */
const SEUIL_CHOC = 3;
/** Vitesse normale d'impact minimale d'un atterrissage signalé (m/s) et durée minimale passée en l'air avant. */
const SEUIL_ATTERRISSAGE = 0.5;
const AIR_MIN_ATTERRISSAGE_S = 0.15;
/** Raideur du lissage de la vitesse de lacet au sol (1/s). */
const RAIDEUR_LACET_SOL = 30;
/** Vitesse effective minimale dans le calcul du virage quand on accélère (m/s) : la voiture pivote doucement à l'arrêt. */
const VITESSE_VIRAGE_MIN = 1.5;
/** Redressement sur le toit : le toit doit être à moins de cette distance d'une surface (m) et le haut de la voiture sous ce seuil. */
const TOIT_PROCHE_M = 0.15;
const SEUIL_RETOURNEE = -0.3;

/** Entrées d'une voiture figée ou démolie (jamais modifiées). */
const ENTREES_FIGEES: Readonly<EntreesVoiture> = ENTREES_NULLES();

// ---- tampons de travail (aucune allocation dans la boucle chaude) ----
const T_C: Vec3 = [0, 0, 0];
const T_N: Vec3 = [0, 0, 0];
const T_F: Vec3 = [0, 0, 0];
const T_R: Vec3 = [0, 0, 0];
const T_A: Vec3 = [0, 0, 0];
const T_B: Vec3 = [0, 0, 0];
const T_W: Vec3 = [0, 0, 0];
const T_X: Vec3 = [0, 0, 0];
const ARMS: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const NORMS: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const PENS: number[] = [0, 0, 0, 0];

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
  saut: { aSaute: false, temps: 0, tenue: false, secondUtilise: false, tempsEnLAir: 0 },
  flip: { actif: false, temps: 0, dir: [0, 0], stall: false, verrouTangage: 0 },
  redressement: { actif: false, temps: 0 },
  supersonique: false,
  boostActif: false,
  boostDepuis: 0,
  derapage: false,
  demolie: false,
  reapparitionDans: 0,
  figee: false,
  dernierContactBalleTick: -1e9,
  dernierBumpTick: -1e9,
  sautPrecedent: false,
  stats: statsVides(),
});

/**
 * Repose une voiture au coup d'envoi / à la réapparition : position, cap, vitesse nulle, boost (33,33 par défaut), états de saut,
 * de flip, de boost remis à zéro, voiture ressuscitée. Ne touche ni `figee` ni les statistiques.
 */
export const replacerVoiture: ReplacerVoiture = (v, p, cap, boost = VOITURE.boostInitial) => {
  v.p[0] = p[0]; v.p[1] = p[1]; v.p[2] = p[2];
  v.v[0] = 0; v.v[1] = 0; v.v[2] = 0;
  v.w[0] = 0; v.w[1] = 0; v.w[2] = 0;
  const b = baseDepuisCap(cap);
  v.base.avant = b.avant; v.base.droite = b.droite; v.base.haut = b.haut;
  v.boost = boost;
  v.rouesContact = 0; v.normaleSurface = null; v.auSol = false;
  v.saut.aSaute = false; v.saut.temps = 0; v.saut.tenue = false; v.saut.secondUtilise = false; v.saut.tempsEnLAir = 0;
  v.flip.actif = false; v.flip.temps = 0; v.flip.dir[0] = 0; v.flip.dir[1] = 0; v.flip.stall = false; v.flip.verrouTangage = 0;
  v.redressement.actif = false; v.redressement.temps = 0;
  v.supersonique = false; v.boostActif = false; v.boostDepuis = 0; v.derapage = false;
  v.demolie = false; v.reapparitionDans = 0;
  v.sautPrecedent = false;
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

/** Compte les roues en contact (centre à moins de `margeContactRoue` de la surface), moyenne leurs normales, décide de `auSol`. */
function mesurerRoues(a: Arene, v: EtatVoiture): void {
  const { avant, droite, haut } = v.base;
  let nb = 0, sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < 4; i++) {
    const roue = VOITURE.roues[i];
    const lx = roue.local[0], ly = roue.local[1], lz = roue.local[2];
    T_C[0] = v.p[0] + avant[0] * lx + droite[0] * ly + haut[0] * lz;
    T_C[1] = v.p[1] + avant[1] * lx + droite[1] * ly + haut[1] * lz;
    T_C[2] = v.p[2] + avant[2] * lx + droite[2] * ly + haut[2] * lz;
    if (a.sd(T_C) - roue.rayon < VOITURE.margeContactRoue) {
      a.sdNormale(T_C, T_N);
      nb++; sx += T_N[0]; sy += T_N[1]; sz += T_N[2];
      if (nb === 1) { T_F[0] = T_N[0]; T_F[1] = T_N[1]; T_F[2] = T_N[2]; }
    }
  }
  v.rouesContact = nb;
  v.auSol = nb >= VOITURE.rouesPourSol;
  if (nb === 0) { v.normaleSurface = null; return; }
  let n = Math.hypot(sx, sy, sz);
  if (n < 1e-6) { sx = T_F[0]; sy = T_F[1]; sz = T_F[2]; n = 1; }
  const ns = v.normaleSurface ?? (v.normaleSurface = [0, 1, 0]);
  ns[0] = sx / n; ns[1] = sy / n; ns[2] = sz / n;
}

// ============================================================================================================================
// 2. Boost
// ============================================================================================================================

/** Met à jour l'état du boost (durée minimale d'un appui) ; rend vrai si le boost BRÛLE ce pas. */
function majBoost(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, evs: EvenementVoiture[]): boolean {
  const veut = e.boost && v.boost > 0;
  if (v.boostActif) {
    v.boostDepuis += dt;
    if (v.boost <= 0 || (!veut && v.boostDepuis >= BOOST.dureeMinS)) {
      v.boostActif = false;
      evs.push({ t: "boost", idVoiture: v.id, actif: false });
    }
  } else if (veut) {
    v.boostActif = true;
    v.boostDepuis = 0;
    evs.push({ t: "boost", idVoiture: v.id, actif: true });
  }
  return v.boostActif && v.boost > 0;
}

// ============================================================================================================================
// 3. Saut, double saut, flip, redressement
// ============================================================================================================================

/** Entrées de lacet et de roulis EFFECTIVES en l'air (spec § 5.5) : `derapage` bascule le volant en roulis. */
const lacetEffectif = (e: Readonly<EntreesVoiture>): number => (e.derapage ? 0 : e.lacet !== 0 ? e.lacet : e.direction);
const roulisEffectif = (e: Readonly<EntreesVoiture>): number => (e.derapage ? clamp(e.roulis + e.direction, -1, 1) : e.roulis);

/** Vrai si le toit de la voiture retournée est proche d'une surface (elle est « sur le dos »). */
function toitProcheDeSurface(a: Arene, v: Readonly<EtatVoiture>): boolean {
  const { avant, droite, haut } = v.base;
  T_C[0] = v.p[0] + avant[0] * DX + droite[0] * DY + haut[0] * (DZ + HZ);
  T_C[1] = v.p[1] + avant[1] * DX + droite[1] * DY + haut[1] * (DZ + HZ);
  T_C[2] = v.p[2] + avant[2] * DX + droite[2] * DY + haut[2] * (DZ + HZ);
  return a.sd(T_C) < TOIT_PROCHE_M;
}

/** Début d'un flip (dodge) ou d'un stall : direction, impulsion horizontale, verrou de tangage. */
function demarrerFlip(v: EtatVoiture, e: Readonly<EntreesVoiture>, evs: EvenementVoiture[]): void {
  const lacet = lacetEffectif(e), roulis = roulisEffectif(e);
  // règle de RL (RocketSim / RLUtilities) : direction du dodge = (-tangage, lacet + roulis) ; stall quand elle est quasi nulle
  // alors que la somme des entrées dépasse le seuil du flip (lacet et roulis opposés, tangage nul)
  let dirA = -e.tangage, dirD = lacet + roulis;
  const stall = Math.abs(dirA) < FLIP.zoneMorteStall && Math.abs(dirD) < FLIP.zoneMorteStall;
  if (stall) {
    dirA = 0; dirD = signe(roulis) || -signe(lacet) || 1;
  } else {
    const n = Math.hypot(dirA, dirD) || 1;
    dirA /= n; dirD /= n;
  }
  const f = v.flip;
  f.actif = true; f.temps = 0; f.dir[0] = dirA; f.dir[1] = dirD; f.stall = stall;
  f.verrouTangage = FLIP.verrouTangageS + FLIP.verrouTangageExtraS;
  if (!stall) {
    const { avant, droite } = v.base;
    // directions horizontales de la voiture (repères de l'impulsion de RL)
    let ax = avant[0], az = avant[2], na = Math.hypot(ax, az);
    if (na < 1e-3) { ax = 0; az = 1; na = 1; }
    ax /= na; az /= na;
    let dx = droite[0], dz = droite[2], nd = Math.hypot(dx, dz);
    if (nd < 1e-3) { dx = -1; dz = 0; nd = 1; }
    dx /= nd; dz /= nd;
    const vAvant = v.v[0] * ax + v.v[2] * az;
    const r = Math.min(Math.abs(vAvant) / VOITURE.vitesseMax, 1);
    const arriere = flipEstArriere(dirA, vAvant);
    const sA = arriere ? FLIP.echelleArriere : FLIP.echelleAvant;
    const kA = dirA * (1 + (sA - 1) * r) * FLIP.impulsionBase * (arriere ? FLIP.facteurArriere : 1);
    const kD = dirD * (1 + (FLIP.echelleCote - 1) * r) * FLIP.impulsionBase;
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

/** Traite le front montant du bouton de saut. */
function gererAppuiSaut(a: Arene, v: EtatVoiture, e: Readonly<EntreesVoiture>, evs: EvenementVoiture[]): void {
  const s = v.saut;
  const { haut } = v.base;
  // sur le toit : le saut redresse
  if (v.rouesContact === 0 && haut[1] < SEUIL_RETOURNEE && !v.redressement.actif && toitProcheDeSurface(a, v)) {
    v.redressement.actif = true; v.redressement.temps = 0;
    v.v[1] += CONDUITE.redressement.impulsion;
    s.aSaute = true; s.tenue = false;
    return;
  }
  if (v.rouesContact >= 1) {
    // premier saut (les pas qui suivent le décollage ou un posé sur deux roues après un saut ne comptent pas)
    if (s.aSaute) return;
    v.v[0] += haut[0] * SAUT.impulsion; v.v[1] += haut[1] * SAUT.impulsion; v.v[2] += haut[2] * SAUT.impulsion;
    s.aSaute = true; s.temps = 0; s.tenue = true;
    evs.push({ t: "saut", idVoiture: v.id });
    return;
  }
  // en l'air : second saut ou flip dans la fenêtre de 1,25 s
  if (s.secondUtilise || s.tempsEnLAir > SAUT.fenetreDoubleSautS) return;
  s.secondUtilise = true; s.tenue = false;
  if (Math.abs(e.tangage) + Math.abs(lacetEffectif(e)) + Math.abs(roulisEffectif(e)) >= FLIP.zoneMorte) {
    demarrerFlip(v, e, evs);
  } else {
    v.v[0] += haut[0] * SAUT.impulsionDoubleSaut; v.v[1] += haut[1] * SAUT.impulsionDoubleSaut; v.v[2] += haut[2] * SAUT.impulsionDoubleSaut;
    evs.push({ t: "doubleSaut", idVoiture: v.id });
  }
}

// ============================================================================================================================
// 4a. Conduite (sol, murs, plafond)
// ============================================================================================================================

/** Conduite dans le plan tangent de la surface sous les roues : gaz, frein, roue libre, virage, adhérence latérale, dérapage. */
function conduire(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, brule: boolean): void {
  const n = v.normaleSurface as Vec3;
  const { avant, droite } = v.base;
  // f : avant projeté sur le plan tangent
  const dn = dot3(avant, n);
  T_F[0] = avant[0] - n[0] * dn; T_F[1] = avant[1] - n[1] * dn; T_F[2] = avant[2] - n[2] * dn;
  let nf = norme3(T_F);
  if (nf < 0.05) { croixDans(T_F, n, droite); nf = norme3(T_F) || 1; }
  T_F[0] /= nf; T_F[1] /= nf; T_F[2] /= nf;
  croixDans(T_R, T_F, n); // droite tangente
  const vf = dot3(v.v, T_F), vl = dot3(v.v, T_R), avf = Math.abs(vf);

  const derape = e.derapage;
  v.derapage = derape;
  const accelEff = brule ? 1 : e.accel;
  const aAcc = Math.abs(accelEff);
  const gaz = aAcc > 0.01;

  // --- longitudinal
  let dvf: number;
  if (gaz) {
    const s = signe(accelEff);
    if (avf < CONDUITE.seuilArretFrein || signe(vf) === s) dvf = s * aAcc * interpolerTable(CONDUITE.courbeGaz, avf) * dt;
    else dvf = s * Math.min(CONDUITE.frein * aAcc * dt, avf);
  } else {
    dvf = -signe(vf) * Math.min(CONDUITE.rouleLibre * dt, avf);
  }
  // --- adhérence latérale et dérapage
  const k = CONDUITE.adherenceLaterale * (derape ? CONDUITE.facteurAdherenceDerapage : 1);
  const dvl = -vl * (1 - Math.exp(-k * dt));
  if (derape) dvf -= vf * (1 - Math.exp(-CONDUITE.freinageDerapage * dt));
  v.v[0] += T_F[0] * dvf + T_R[0] * dvl;
  v.v[1] += T_F[1] * dvf + T_R[1] * dvl;
  v.v[2] += T_F[2] * dvf + T_R[2] * dvl;

  // --- virage : vitesse de lacet autour de la normale (rotation positive = vers la gauche, donc le volant à droite est négatif)
  let vEff = avf, sens = signe(vf);
  if (gaz && avf < VITESSE_VIRAGE_MIN) { vEff = VITESSE_VIRAGE_MIN; sens = signe(accelEff); }
  const cible = -interpolerTable(CONDUITE.courbeCourbure, vEff) * vEff * sens * e.direction * (derape ? CONDUITE.facteurLacetDerapage : 1);
  const wn = dot3(v.w, n);
  const kk = (cible - wn) * (1 - Math.exp(-RAIDEUR_LACET_SOL * dt));
  v.w[0] += n[0] * kk; v.w[1] += n[1] * kk; v.w[2] += n[2] * kk;

  // --- boost le long de f
  if (brule) {
    v.v[0] += T_F[0] * BOOST.acceleration * dt; v.v[1] += T_F[1] * BOOST.acceleration * dt; v.v[2] += T_F[2] * BOOST.acceleration * dt;
  }
}

// ============================================================================================================================
// 4b. Contrôle aérien, flip, redressement
// ============================================================================================================================

/**
 * Contrôle en l'air : couples + amortissements de Rocket League dans le repère de la voiture, rotation du flip, rotation du
 * redressement, plafond de 5,5 rad/s. Rend vrai si la rotation du flip se termine à ce pas (l'axe est alors mis à zéro APRÈS
 * l'intégration de l'orientation : voir `pasVoiture`).
 */
function controleAerien(v: EtatVoiture, e: Readonly<EntreesVoiture>, dt: number, brule: boolean): boolean {
  const { avant, droite, haut } = v.base;
  const lacet = lacetEffectif(e), roulis = roulisEffectif(e);
  const tang = v.flip.verrouTangage > 0 ? 0 : e.tangage;
  const wa = dot3(v.w, avant), wd = dot3(v.w, droite), wh = dot3(v.w, haut);
  const aa = AIR.coupleRoulis * roulis - AIR.amortRoulis * wa * (1 - Math.abs(roulis));
  const ad = AIR.coupleTangage * tang - AIR.amortTangage * wd * (1 - Math.abs(tang));
  const ah = -AIR.coupleLacet * lacet - AIR.amortLacet * wh * (1 - Math.abs(lacet));
  v.w[0] += (avant[0] * aa + droite[0] * ad + haut[0] * ah) * dt;
  v.w[1] += (avant[1] * aa + droite[1] * ad + haut[1] * ah) * dt;
  v.w[2] += (avant[2] * aa + droite[2] * ad + haut[2] * ah) * dt;

  let finFlip = false;
  const f = v.flip;
  if (v.redressement.actif) {
    // redressement : l'axe (roulis ou tangage) qui ramène `haut` vers +Y
    const gR = droite[1], gP = -avant[1]; // composante Y de (avant × haut) et (droite × haut)
    let ax: Vec3 = avant, sg: number;
    if (Math.abs(gR) >= Math.abs(gP)) {
      sg = Math.abs(gR) > 0.05 ? signe(gR) : signe(roulis) || 1;
    } else {
      ax = droite; sg = signe(gP);
    }
    const w = CONDUITE.redressement.vitesseAng * sg;
    v.w[0] = ax[0] * w; v.w[1] = ax[1] * w; v.w[2] = ax[2] * w;
    v.redressement.temps += dt;
    if (v.redressement.temps >= CONDUITE.redressement.dureeS) v.redressement.actif = false;
  } else if (f.actif) {
    // flip : rotation de consigne autour de l'axe (invariant du repère de la voiture), annulable en tirant à l'opposé
    const dirA = f.dir[0], dirD = f.dir[1];
    T_A[0] = avant[0] * dirD - droite[0] * dirA; T_A[1] = avant[1] * dirD - droite[1] * dirA; T_A[2] = avant[2] * dirD - droite[2] * dirA;
    let cible = FLIP.vitesseAng;
    if (f.temps >= FLIP.annulationMinS && dirA !== 0) cible *= 1 - Math.max(0, e.tangage * signe(dirA));
    // fin du couple de dodge : la vitesse résiduelle n'est ni remise à zéro ni forcée, l'amortissement de l'air la consomme ensuite
    if (f.temps + dt >= FLIP.dureeRotationS) finFlip = true;
    const wax = dot3(v.w, T_A);
    T_B[0] = v.w[0] - T_A[0] * wax; T_B[1] = v.w[1] - T_A[1] * wax; T_B[2] = v.w[2] - T_A[2] * wax;
    const np = norme3(T_B);
    const k = np > VOITURE.vitesseAngMax ? VOITURE.vitesseAngMax / np : 1;
    v.w[0] = T_B[0] * k + T_A[0] * cible; v.w[1] = T_B[1] * k + T_A[1] * cible; v.w[2] = T_B[2] * k + T_A[2] * cible;
    f.temps += dt;
    if (finFlip) f.actif = false;
  } else {
    const nw = norme3(v.w);
    if (nw > VOITURE.vitesseAngMax) { const k = VOITURE.vitesseAngMax / nw; v.w[0] *= k; v.w[1] *= k; v.w[2] *= k; }
  }

  // poussée aérienne et boost le long de l'avant
  // (le gaz seul pousse aussi un peu en l'air, boost ou non ; RocketSim THROTTLE_AIR_ACCEL)
  const acc = ((brule ? BOOST.accelerationAir : 0) + AIR.gazAerien * e.accel) * dt;
  if (acc !== 0) { v.v[0] += avant[0] * acc; v.v[1] += avant[1] * acc; v.v[2] += avant[2] * acc; }
  return finFlip;
}

/** Avec 1 ou 2 roues seulement en contact, l'orientation glisse vers la surface sous elles (atterrissage sur les roues). */
function aligner(v: EtatVoiture): void {
  const n = v.normaleSurface;
  if (!n || v.flip.actif || v.redressement.actif) return;
  if (v.saut.aSaute && v.saut.temps < 0.25) return;
  const haut = v.base.haut;
  croixDans(T_A, haut, n);
  const s = norme3(T_A);
  if (s < 1e-4) return;
  const angle = Math.atan2(s, dot3(haut, n));
  const rate = Math.min(CONDUITE.autoAlignementRoulis, 6 * angle);
  const ux = T_A[0] / s, uy = T_A[1] / s, uz = T_A[2] / s;
  const wu = v.w[0] * ux + v.w[1] * uy + v.w[2] * uz;
  if (wu < rate) {
    const d = (rate - wu) * 0.5;
    v.w[0] += ux * d; v.w[1] += uy * d; v.w[2] += uz * d;
  }
}

// ============================================================================================================================
// 6. Résolution des contacts avec le décor
// ============================================================================================================================

/**
 * Contacts des roues : impulsion non élastique (e = 0) au point de chaque roue qui s'enfonce, avec la masse et l'inertie du
 * solide, puis correction de position. AUCUN frottement ici. Rend la plus forte vitesse normale entrante (m/s, ≥ 0).
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
 * Contact du CORPS avec le décor (coins et centres de face de la hitbox) : impulsion (restitution 0,2) avec un frottement ajouté,
 * correction de position (≤ 10 cm). Rend la plus forte vitesse normale entrante.
 */
function resoudreCorps(a: Arene, v: EtatVoiture): number {
  const { avant, droite, haut } = v.base;
  const cx0 = v.p[0] + avant[0] * DX + droite[0] * DY + haut[0] * DZ;
  const cy0 = v.p[1] + avant[1] * DX + droite[1] * DY + haut[1] * DZ;
  const cz0 = v.p[2] + avant[2] * DX + droite[2] * DY + haut[2] * DZ;
  T_C[0] = cx0; T_C[1] = cy0; T_C[2] = cz0;
  if (a.sd(T_C) > RAYON_ENGLOBANT) return 0;
  let maxVn = 0, corrX = 0, corrY = 0, corrZ = 0, nb = 0;
  for (let i = 0; i < POINTS_CORPS.length; i++) {
    const o = POINTS_CORPS[i];
    T_C[0] = cx0 + avant[0] * o[0] + droite[0] * o[1] + haut[0] * o[2];
    T_C[1] = cy0 + avant[1] * o[0] + droite[1] * o[1] + haut[1] * o[2];
    T_C[2] = cz0 + avant[2] * o[0] + droite[2] * o[1] + haut[2] * o[2];
    const s = a.sdNormale(T_C, T_N);
    if (s >= 0) continue;
    const r = ARMS[0];
    r[0] = T_C[0] - v.p[0]; r[1] = T_C[1] - v.p[1]; r[2] = T_C[2] - v.p[2];
    vitessePointDans(T_A, v, r);
    const vn = dot3(T_A, T_N);
    if (vn < 0) {
      const entrant = -vn;
      if (entrant > maxVn) maxVn = entrant;
      const j = (-(1 + (entrant > 1 ? RESTITUTION_CORPS : 0)) * vn) / inverseMasseEffective(v.base, r, T_N);
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
 * Un pas de la voiture. Une voiture `demolie` ne fait que décompter `reapparitionDans` (c'est `match.ts` qui la replace à zéro) ;
 * une voiture `figee` ignore les entrées mais garde sa physique (gravité, collage, contacts).
 */
export const pasVoiture: PasVoiture = (a, v, e0, dt, _tick) => {
  const evs: EvenementVoiture[] = [];
  if (v.demolie) {
    v.reapparitionDans = Math.max(0, v.reapparitionDans - dt);
    v.boostActif = false; v.derapage = false; v.sautPrecedent = false;
    return evs;
  }
  const e = v.figee ? ENTREES_FIGEES : e0;
  const s = v.saut;

  // --- 1. contacts, remises à zéro de l'état de saut
  mesurerRoues(a, v);
  const etaitEnLAir = s.tempsEnLAir > AIR_MIN_ATTERRISSAGE_S;
  if (v.auSol && !(s.aSaute && s.temps < GARDE_DECOLLAGE_S)) {
    s.aSaute = false; s.temps = 0; s.tenue = false; s.secondUtilise = false; s.tempsEnLAir = 0;
    v.flip.actif = false; v.flip.temps = 0; v.flip.verrouTangage = 0;
    v.redressement.actif = false; v.redressement.temps = 0;
  } else if (v.rouesContact === 0) {
    s.tempsEnLAir += dt;
  }
  if (s.aSaute) s.temps += dt;
  if (v.flip.verrouTangage > 0) v.flip.verrouTangage = Math.max(0, v.flip.verrouTangage - dt);

  // --- 2. boost, saut
  const brule = majBoost(v, e, dt, evs);
  const front = e.saut && !v.sautPrecedent;
  v.sautPrecedent = e.saut;
  if (front) gererAppuiSaut(a, v, e, evs);

  // --- 3. gravité, collage, conduite ou contrôle aérien
  v.v[1] -= GRAVITE * dt;
  let finFlip = false;
  if (v.auSol) {
    const n = v.normaleSurface as Vec3;
    if (dot3(v.v, n) < CONDUITE.decollageNormal) {
      // au plafond la gravité annule exactement le collage de mur : on ajoute une demi-gravité pour que les roues restent plaquées
      const c = (n[1] > 0.7 ? CONDUITE.collageSol : n[1] < -0.7 ? CONDUITE.collageMur + CONDUITE.collageSol : CONDUITE.collageMur) * dt;
      v.v[0] -= n[0] * c; v.v[1] -= n[1] * c; v.v[2] -= n[2] * c;
    }
    conduire(v, e, dt, brule);
  } else {
    v.derapage = false;
    if (v.rouesContact > 0) aligner(v);
    finFlip = controleAerien(v, e, dt, brule);
  }

  // amortissement vertical du flip (« écrase » la vitesse verticale)
  // (RocketSim : dès 0,15 s, tant que la voiture descend ou avant 0,21 s, pendant tout le couple de dodge : elle « flotte »)
  if (v.flip.actif || finFlip) {
    const t = v.flip.temps;
    if (t >= FLIP.amortissementDebutS && (v.v[1] < 0 || t < FLIP.amortissementFinS)) v.v[1] *= Math.max(0, 1 - FLIP.amortissementVertical * dt * 120);
  }

  // maintien du saut
  if (s.tenue) {
    if (e.saut && s.temps < SAUT.maintienMaxS) {
      const { haut } = v.base;
      const k = SAUT.maintien * dt;
      v.v[0] += haut[0] * k; v.v[1] += haut[1] * k; v.v[2] += haut[2] * k;
    } else s.tenue = false;
  }

  // consommation du boost
  if (brule) v.boost = Math.max(0, v.boost - BOOST.consommation * dt);

  // --- 4. intégration
  const nv = norme3(v.v);
  if (nv > VOITURE.vitesseMax) { const k = VOITURE.vitesseMax / nv; v.v[0] *= k; v.v[1] *= k; v.v[2] *= k; }
  v.p[0] += v.v[0] * dt; v.p[1] += v.v[1] * dt; v.p[2] += v.v[2] * dt;
  integrerBase(v.base, v.w, dt);

  // --- 5. contacts avec le décor
  const impactRoues = resoudreRoues(a, v);
  if (impactRoues > SEUIL_ATTERRISSAGE && etaitEnLAir) {
    evs.push({ t: "atterrissage", idVoiture: v.id, vitesse: impactRoues });
    s.tempsEnLAir = 0.1;
  }
  const impactCorps = resoudreCorps(a, v);
  if (impactCorps > SEUIL_CHOC) evs.push({ t: "choc", idVoiture: v.id, vitesse: impactCorps });
  // un choc ne peut pas lancer la voiture en rotation au-delà du plafond de l'air (au sol elle suit les raccords : 8 à 9 rad/s)
  if (!v.auSol && !v.redressement.actif) {
    const nw = norme3(v.w);
    if (nw > VOITURE.vitesseAngMax) { const k = VOITURE.vitesseAngMax / nw; v.w[0] *= k; v.w[1] *= k; v.w[2] *= k; }
  }

  // --- 6. supersonique
  const vit = norme3(v.v);
  if (!v.supersonique && vit >= VOITURE.supersoniqueOn) {
    v.supersonique = true;
    evs.push({ t: "supersonique", idVoiture: v.id, actif: true });
  } else if (v.supersonique && vit < VOITURE.supersoniqueOff) {
    v.supersonique = false;
    evs.push({ t: "supersonique", idVoiture: v.id, actif: false });
  }
  // boost vide : s'éteint
  if (v.boostActif && v.boost <= 0) {
    v.boostActif = false;
    evs.push({ t: "boost", idVoiture: v.id, actif: false });
  }
  return evs;
};
