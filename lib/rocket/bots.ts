/**
 * Rocket Muche : les bots. Un `Cerveau` par bot, à trois niveaux (Débutant, Pro, All-Star) réglés par `PROFILS_BOT`.
 *
 * AUCUNE triche : même physique, mêmes `EntreesVoiture` que l'humain, aucune téléportation ; le cerveau ne lit que l'état du monde
 * (positions, vitesses, boost, plots actifs) et la prévision de la balle SEULE (`predireBalle`). Pur et déterministe : le hasard vient du
 * `Rng` semé par `graine`, le temps de l'argument `dt`.
 *
 * Architecture (deux étages) :
 *  1. la DÉCISION, `frequenceDecisionHz` fois par seconde : rôle (rotation), point d'interception sur la trajectoire prévue de la
 *     balle, point de position, plot à ramasser, démolition. Le résultat est une `Consigne`, appliquée avec le retard `reactionS` et
 *     bruitée (`bruitVisee`) : c'est ici que se joue la différence de niveau ;
 *  2. l'EXÉCUTION, à chaque pas physique : contrôleur de conduite au sol (angle → volant, dérapage, marche arrière, frein quand la
 *     cible est à l'intérieur du cercle de virage), contrôleur d'attitude en l'air (PD sur les trois axes, mêmes couples que `AIR`),
 *     séquences de saut / flip de frappe / flip de vitesse / aérien, déblocage.
 *
 * Ce qui sépare les niveaux, au-delà des chiffres de `PROFILS_BOT` (réglé sur la physique de RocketSim, 2026-11-12) :
 *  - le Débutant (`rotation` faux) n'a aucun sens du placement : il fonce sur la balle d'où il est et la frappe dans le sens où il
 *    arrive, bon ou mauvais ; son erreur de visée dure (bruit corrélé) ; il ne flippe pas, donc plafonne à 14 m/s sans boost ;
 *  - Pro et All-Star se placent derrière la balle sur la ligne de frappe (`viser`), contournent quand ils sont du mauvais côté,
 *    frappent de côté ou se replient près de leur cage (`planFrappe`, `repli`), barrent la route d'une balle qui entre, passent sur
 *    les plots de leur route, flippent pour frapper (tir à plat, 25 à 32 m/s) et pour gagner de la vitesse (`flipDeVitesse`).
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§ 7).
 */
import {
  BALLE, BOOST, BUT, CONDUITE, ENTREES_NULLES, PAS_S, PLOT, PLOTS, PROFILS_BOT, STADE, VOITURE, creerRng, interpolerTable, signeButDefendu, tirer, tirerGauss,
} from "./contrat";
import type { Cerveau, CreerCerveau, EchantillonBalle, EntreesVoiture, EtatBalle, EtatVoiture, MondeRocket, NiveauBot, ProfilBot, Rng, Vec3 } from "./contrat";
import { clamp, croix, distance, dot, mondeVersLocal, norme, normaliser, signe } from "./vec";
import { predireBalle } from "./balle";

// ============================================================================================================================
// Réglages des cerveaux (valeurs de ressenti, jamais de règle de jeu)
// ============================================================================================================================

const BOTS = {
  /** hauteur maximale (centre de la balle) qu'un bot atteint en roulant, sans sauter (m) */
  hauteurSol: 1.45,
  /** hauteur maximale d'une frappe en saut (jump + flip, sans boost) (m) */
  hauteurSaut: 3.0,
  /** hauteur minimale d'un aérien (m) : en dessous, saut simple */
  hauteurAerienMin: 3.0,
  /** boost minimal pour tenter un aérien */
  boostAerienMin: 28,
  /** durée minimale / maximale avant la frappe pour tenter un aérien (s) */
  aerienTMin: 0.85,
  aerienTMax: 3.2,
  /** poussée maximale demandée au boost pour qu'un aérien soit jugé faisable (m/s²) */
  poussee: BOOST.acceleration * 0.92,
  /** profondeur de la prévision partagée entre bots d'un même monde et durée de réutilisation (pas) */
  reutilisationPrevision: 6,
  /** distance du point de défense devant la ligne de but (m) */
  profondeurDefense: 11,
  /** gains PD de l'attitude en l'air (tangage / lacet / roulis) : `[kp, kd]`, voir `AIR` pour les couples */
  gainsTangage: [1.0, 0.46] as const,
  gainsLacet: [1.1, 0.56] as const,
  gainsRoulis: [0.3, 0.147] as const,
  /** immobilité au sol avant déblocage (s) et durée de la manœuvre */
  immobileMaxS: 1.6,
  deblocageS: 1.1,
  /**
   * flip précoce du coup d'envoi (All-Star) : vitesse avant à partir de laquelle il part (m/s) et distance minimale à la balle (m).
   * Désactivé (`activeFlipEnvoi`) depuis que le flip suit RocketSim : +5 m/s seulement vers l'avant, la voiture « flotte » et reste
   * retournée près d'une seconde, ce qui fait perdre plus de temps que le gain de vitesse (coup d'envoi touché à 4,2–4,7 s au lieu de 2,8 s).
   */
  activeFlipEnvoi: false,
  vitesseFlipEnvoi: 11,
  distanceFlipEnvoi: 14,
  /** durée de la tentative de démolition avant de reprendre le jeu (s) */
  demoMaxS: 1.2,
  /** démolition : vitesse avant et boost exigés si l'on n'est pas déjà supersonique, distance maximale de la cible (m), alignement minimal (cosinus) */
  demoVitesseMin: 18,
  demoBoostMin: 20,
  demoDistanceMax: 20,
  demoCos: 0.93,
  /** écart maximal (rad) entre la direction réelle de la frappe et la direction idéale pour frapper sans contourner ; la route droite
   *  vers la balle se courbe vers l'idéal de `courbureApproche` rad par mètre restant */
  ecartFrappeDirecte: 1.0,
  courbureApproche: 0.05,
  /** à moins de cette distance de sa ligne de but (m), on ne contourne plus la balle : frappe de côté si elle est sûre, sinon repli */
  distancePresse: 26,
  /** point d'approche (voir `viser`) : avance sur la ligne de frappe (m, et en secondes de route à sa vitesse), recul derrière la balle
   *  par mètre d'écart latéral et son plafond (m), recul maximal (m) ; recul derrière la balle pendant une poursuite sans frappe prévue (m) */
  avanceLigne: 4,
  avanceLigneS: 0.55,
  avanceLigneProche: 0.45,
  /** écart latéral à la ligne de frappe (m) sous lequel on fonce à travers la balle (`traversee` m au-delà) ; au-dessus, on reste au
   *  moins `reculContact` m derrière elle (le contact a lieu quand le centre de la voiture est à ≈ 1,9 m du centre de la balle) */
  ecartLigneMax: 1.2,
  traversee: 3,
  reculContact: 2.2,
  reculLateral: 0.8,
  reculLateralMax: 9,
  reculMax: 12,
  reculPoursuite: 3,
  /** au-delà de cette distance de la ligne médiane, dans son camp, une frappe qui recentre la balle devant sa cage est dangereuse (m) */
  zoneRecentrage: 22,
  /** « chez soi » : contact à moins de cette distance de la ligne médiane côté adverse (m), ou balle qui file vers sa cage à plus de `vitesseMenace` (m/s) */
  margeChezSoi: 10,
  vitesseMenace: 8,
  /** une frappe de côté vers sa ligne de but est sûre si elle la croise à plus de cette distance du poteau (m) */
  margeCadre: 4,
  /** barrage sous la menace : avance minimale sur la balle au point choisi (s) et vitesse d'arrivée (m/s) */
  avanceBarrageS: 0.15,
  vitesseBarrage: 5,
  /** distance du point de repli devant sa ligne de but (m) */
  profondeurRepli: 3.5,
  /** plots sur la route : boost au-dessus duquel on ne se détourne plus, détour toléré (m) pour un petit plot / pour un gros à réserve vide,
   *  cosinus minimal entre l'avant de la voiture et le plot, délai minimal avant une frappe prévue (s) */
  boostPlein: 88,
  detourPetitPlot: 1.6,
  detourGrosPlot: 14,
  cosPlotDevant: 0.8,
  plotAvantFrappeS: 2.6,
  /** flip de vitesse (voir `flipDeVitesse`) : plage de vitesse avant (m/s), boost au-dessus duquel on préfère booster, durée jusqu'au
   *  retour au sol (s), marge de distance (m), alignement minimal sur la cible (cosinus) */
  flipVitesseMin: 10.5,
  flipVitesseMax: 20.5,
  flipVitesseBoostMax: 25,
  flipVitesseDureeS: 1.3,
  flipVitesseMargeM: 8,
  flipVitesseCos: 0.992,
  /** on ne vise aucun contact plus de `margeAdversaireS` s après le moment où un adversaire peut toucher la balle */
  margeAdversaireS: 0.4,
  /** vitesse avant minimale pour un flip de frappe sur une balle basse (m/s) */
  flipFrappeVitesseMin: 9,
  /** mémoire de l'erreur de visée (s) : temps de corrélation du bruit `ProfilBot.bruitVisee` */
  memoireBiaisS: 0.7,
  /** cercle de virage (voir `conduire`) : vitesse au-dessus de laquelle on le teste, vitesse au-dessus de laquelle on freine (sinon
   *  roue libre), part du rayon en deçà de laquelle la cible est tenue pour inatteignable */
  vitesseMinCercle: 4.5,
  vitesseFreinCercle: 7.5,
  margeCercle: 0.92,
  /** au-dessus de cette vitesse avant le boost ne sert presque plus (plafond 23 m/s) : on l'économise (m/s) */
  vitesseSansBoost: 21.5,
} as const;

/** Compteurs de diagnostic (tests, réglage) : jamais lus par le jeu. Remis à zéro par `reinitialiserStatsBots`. */
export const statsBots: { aeriensChoisis: number; decollages: number; flipsFrappe: number; saut: number; demolitionsVisees: number; deblocages: number; sequences: Record<string, number> } = { sequences: {}, aeriensChoisis: 0, decollages: 0, flipsFrappe: 0, saut: 0, demolitionsVisees: 0, deblocages: 0 };
export const reinitialiserStatsBots = (): void => { statsBots.sequences = {}; statsBots.aeriensChoisis = statsBots.decollages = statsBots.flipsFrappe = statsBots.saut = statsBots.demolitionsVisees = statsBots.deblocages = 0; };

type Role = "attaque" | "soutien" | "couverture" | "gardien";

/** Ce que le bot veut faire jusqu'à la prochaine décision. */
interface Consigne {
  /** point à rejoindre (monde) ; pour une frappe : le point d'approche, pas la balle */
  cible: Vec3;
  /** vitesse avant souhaitée à l'arrivée (m/s) ; Infinity = à fond */
  vitesse: number;
  /** le boost est autorisé (tirage du niveau, rôle) */
  boost: boolean;
  /** dérapage autorisé pour tourner serré */
  derapage: boolean;
  /** point à regarder une fois arrivé (position d'attente) */
  regarder: Vec3 | null;
  /** frappe prévue sur la balle (temps absolu de jeu, position du contact, type) */
  frappe: { tAbs: number; p: Vec3; type: "sol" | "saut" } | null;
  /** plan aérien */
  aerien: { tAbs: number; p: Vec3 } | null;
  /** normale de la surface d'atterrissage prévue, pour se remettre sur les roues */
  atterrissage: Vec3;
  role: Role;
  /** le coup d'envoi est à moi */
  coupEnvoi: boolean;
  /** biais de visée (rad) de cette décision */
  biais: number;
  /** direction de dérapage / flip souhaitée vers la balle (gauche négatif) */
  lateralBalle: number;
  /** repli vers sa cage (aucune frappe sûre) : à fond, boost sans condition de distance */
  repli: boolean;
  /** frappe de côté (telle qu'on arrive), choisie faute de pouvoir contourner la balle à temps */
  cote: boolean;
}

const consigneNeutre = (): Consigne => ({
  cible: [0, 0, 0], vitesse: Infinity, boost: false, derapage: false, regarder: null, frappe: null, aerien: null,
  atterrissage: [0, 1, 0], role: "attaque", coupEnvoi: false, biais: 0, lateralBalle: 0, repli: false, cote: false,
});

// ============================================================================================================================
// Prévision de la balle partagée entre les bots d'un même monde
// ============================================================================================================================

interface Prevision {
  tick: number;
  horizon: number;
  echantillons: EchantillonBalle[];
}
const previsions = new WeakMap<EtatBalle, Prevision>();
const PAS_PREVISION_S = 1 / 15;

/** Échantillons de la trajectoire de la balle avec `t` compté depuis maintenant (copie de la prévision partagée, décalée si elle est un peu ancienne). */
function trajectoire(m: Readonly<MondeRocket>, horizonS: number): EchantillonBalle[] {
  const b = m.balle;
  const c = previsions.get(b);
  if (c && c.horizon >= horizonS && m.tick - c.tick >= 0 && m.tick - c.tick <= BOTS.reutilisationPrevision) {
    const dec = (m.tick - c.tick) * PAS_S;
    const e0 = c.echantillons[0], e1 = c.echantillons[1];
    // La balle a-t-elle dévié (frappe, rebond imprévu) depuis le calcul ? Alors on recalcule.
    const k = e1 ? clamp(dec / (e1.t - e0.t), 0, 1) : 0;
    const px = e0.p[0] + (e1 ? (e1.p[0] - e0.p[0]) * k : 0), py = e0.p[1] + (e1 ? (e1.p[1] - e0.p[1]) * k : 0), pz = e0.p[2] + (e1 ? (e1.p[2] - e0.p[2]) * k : 0);
    if (Math.hypot(px - b.p[0], py - b.p[1], pz - b.p[2]) < 0.8) {
      const sortie: EchantillonBalle[] = [];
      for (const e of c.echantillons) if (e.t - dec >= -1e-9) sortie.push({ t: Math.max(0, e.t - dec), p: e.p, v: e.v });
      return sortie;
    }
  }
  const horizon = Math.max(horizonS, 1.5);
  const echantillons = predireBalle(m.arene, b, horizon, PAS_PREVISION_S);
  previsions.set(b, { tick: m.tick, horizon, echantillons });
  return echantillons;
}

// ============================================================================================================================
// Outils de géométrie et de cinématique
// ============================================================================================================================

const demiX = STADE.demiLargeur;
const demiZ = STADE.demiLongueur;

/** Ramène un point visé dans le terrain (marge des murs et des pans coupés) ; le fond des cages reste accessible. */
function dansLeTerrain(p: Vec3, marge = 2.5): Vec3 {
  const enCage = Math.abs(p[0]) < BUT.demiLargeur - 1.5;
  const zMax = enCage ? demiZ + BUT.profondeur - 2 : demiZ - marge;
  let x = clamp(p[0], -(demiX - marge), demiX - marge), z = clamp(p[2], -zMax, zMax);
  const lim = STADE.demiLargeur + STADE.demiLongueur - STADE.panCoupe - marge * 1.5;
  if (!enCage && Math.abs(x) + Math.abs(z) > lim) {
    const k = lim / (Math.abs(x) + Math.abs(z));
    x *= k; z *= k;
  }
  return [x, 0, z];
}

/** Plus grande vitesse avant (m/s) dont la courbure de virage (`CONDUITE.courbeCourbure`, décroissante) atteint `k` (1/m). */
function vitessePourCourbure(k: number): number {
  const t = CONDUITE.courbeCourbure;
  if (k >= t[0][1]) return 2;
  if (k <= t[t.length - 1][1]) return t[t.length - 1][0];
  for (let i = 1; i < t.length; i++) {
    if (k >= t[i][1]) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      return x0 + ((k - y0) / (y1 - y0)) * (x1 - x0);
    }
  }
  return t[t.length - 1][0];
}

/**
 * Vitesse de la voiture au contact (m/s) pour un tir au sol SANS flip sur la cage à `dist` mètres. Mesuré sur la physique (contact
 * et impulsion de Psyonix de RocketSim) : une balle au repos part à ≈ 1,35 × la vitesse de la voiture avec ≈ 16° d'élévation (une
 * balle qui roule déjà : 5 à 10°) ; à pleine vitesse, un tir de 30 à 40 m passe au-dessus de la barre (centre de balle à 6,3 m), à
 * 18 m/s il passe dessous (5,1 m). On vise ≈ 2,5 m à la ligne : v² = g·d² / (2·cos²θ·(d·tanθ − 2,5)). Le flip de frappe, lui, tire à
 * plat (0 à 6°) : les bots qui flippent ne ralentissent pas (voir `viser`).
 */
function vitesseDeTir(dist: number): number {
  const hauteurPleineVitesse = dist * TAN_LOB - (6.5 * dist * dist) / (2 * (FACTEUR_TIR * 23) ** 2 * COS2_LOB);
  if (hauteurPleineVitesse <= 3.4) return Infinity;
  const montee = dist * TAN_LOB - 2.5;
  const vBalle = Math.sqrt((6.5 * dist * dist) / (2 * COS2_LOB * montee));
  return clamp(vBalle / FACTEUR_TIR, 10, 23);
}
const TAN_LOB = 0.29;
const COS2_LOB = 1 / (1 + TAN_LOB * TAN_LOB);
const FACTEUR_TIR = 1.35;

/** Temps pour parcourir `dist` mètres depuis la vitesse `v0` (gaz seul ou avec boost), sans le temps de rotation. */
function tempsParcours(dist: number, v0: number, boost: number): number {
  const avecBoost = boost > 8;
  const vmax = avecBoost ? 23 : 14.1;
  const acc = avecBoost ? 12 : 6.5;
  const v = clamp(v0, 0, vmax);
  const dAcc = (vmax * vmax - v * v) / (2 * acc);
  if (dist <= dAcc) return (-v + Math.sqrt(v * v + 2 * acc * dist)) / acc;
  return (vmax - v) / acc + (dist - dAcc) / vmax;
}

/** Centre de la hitbox sans allocation superflue. */
function centre(v: Readonly<EtatVoiture>): Vec3 {
  const d = VOITURE.decalageHitbox, b = v.base;
  return [
    v.p[0] + b.avant[0] * d[0] + b.droite[0] * d[1] + b.haut[0] * d[2],
    v.p[1] + b.avant[1] * d[0] + b.droite[1] * d[1] + b.haut[1] * d[2],
    v.p[2] + b.avant[2] * d[0] + b.droite[2] * d[1] + b.haut[2] * d[2],
  ];
}

/** Temps estimé pour qu'une voiture arrive en `cible` (rotation comprise). */
function etaVers(v: Readonly<EtatVoiture>, cible: Readonly<Vec3>): number {
  const c = centre(v);
  const dx = cible[0] - c[0], dz = cible[2] - c[2];
  const dist = Math.hypot(dx, dz);
  const vf = dot(v.v, v.base.avant);
  const cap = Math.atan2(v.base.avant[0], v.base.avant[2]);
  let da = Math.atan2(dx, dz) - cap;
  da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
  return tempsParcours(dist, Math.max(0, vf), v.boost) + da * (vf > 10 ? 0.22 : 0.3) + (v.demolie ? 99 : 0);
}

/** Rotation (vecteur axe × angle, monde) qui amène la base `b` sur la base d'avant `avantD` et de haut `hautD`. */
function erreurRotation(b: Readonly<EtatVoiture["base"]>, avantD: Readonly<Vec3>, hautD: Readonly<Vec3>): Vec3 {
  const droiteD = croix(avantD, hautD);
  const w1 = croix(b.avant, avantD), w2 = croix(b.droite, droiteD), w3 = croix(b.haut, hautD);
  const wx = w1[0] + w2[0] + w3[0], wy = w1[1] + w2[1] + w3[1], wz = w1[2] + w2[2] + w3[2];
  const trace = dot(b.avant, avantD) + dot(b.droite, droiteD) + dot(b.haut, hautD);
  const cos = clamp((trace - 1) / 2, -1, 1);
  const s = Math.hypot(wx, wy, wz) / 2;
  if (s < 1e-6) return cos > 0 ? [0, 0, 0] : [b.avant[0] * Math.PI, b.avant[1] * Math.PI, b.avant[2] * Math.PI];
  const ang = Math.atan2(s, cos), k = ang / (2 * s);
  return [wx * k, wy * k, wz * k];
}

/** Orientation voulue : l'avant vise `dir`, le haut le plus proche de `hautPrefere` (les roues vers le bas par défaut). */
function orientation(dir: Readonly<Vec3>, hautPrefere: Readonly<Vec3>, repliHaut: Readonly<Vec3>): { avant: Vec3; haut: Vec3 } {
  const avant = normaliser(dir, [0, 0, 1]);
  const d = dot(hautPrefere, avant);
  let haut: Vec3 = [hautPrefere[0] - avant[0] * d, hautPrefere[1] - avant[1] * d, hautPrefere[2] - avant[2] * d];
  if (norme(haut) < 0.2) {
    const d2 = dot(repliHaut, avant);
    haut = [repliHaut[0] - avant[0] * d2, repliHaut[1] - avant[1] * d2, repliHaut[2] - avant[2] * d2];
  }
  return { avant, haut: normaliser(haut, [0, 1, 0]) };
}

/** Contrôle d'attitude PD : entrées de tangage, lacet et roulis qui amènent la voiture vers l'orientation voulue. */
function attitude(v: Readonly<EtatVoiture>, avantD: Readonly<Vec3>, hautD: Readonly<Vec3>, e: EntreesVoiture, verrouTangage: boolean): void {
  const err = erreurRotation(v.base, avantD, hautD);
  const ea = dot(err, v.base.avant), ed = dot(err, v.base.droite), eh = dot(err, v.base.haut);
  const wa = dot(v.w, v.base.avant), wd = dot(v.w, v.base.droite), wh = dot(v.w, v.base.haut);
  const [kpP, kdP] = BOTS.gainsTangage, [kpY, kdY] = BOTS.gainsLacet, [kpR, kdR] = BOTS.gainsRoulis;
  e.tangage = verrouTangage ? 0 : clamp(kpP * ed - kdP * wd, -1, 1);
  e.roulis = clamp(kpR * ea - kdR * wa, -1, 1);
  e.lacet = clamp(-(kpY * eh - kdY * wh), -1, 1);
  e.direction = 0;
  e.derapage = false;
}

// ============================================================================================================================
// Séquences (sauts, flips, speed flip) : segments datés qui écrasent certaines entrées
// ============================================================================================================================

interface Segment {
  de: number;
  a: number;
  saut?: boolean;
  tangage?: number;
  direction?: number;
  roulis?: number;
  lacet?: number;
  boost?: boolean;
  derapage?: boolean;
  /** garde le contrôle d'attitude pour les axes non écrasés */
  attitude?: boolean;
}
interface Sequence {
  nom: "flip" | "saut" | "vitesse" | "decollage" | "deblocage";
  t: number;
  fin: number;
  segments: Segment[];
}

const seq = (nom: Sequence["nom"], segments: Segment[]): Sequence => (statsBots.sequences[nom] = (statsBots.sequences[nom] ?? 0) + 1, { nom, t: 0, fin: segments.reduce((m, s) => Math.max(m, s.a), 0), segments });

/** Saut puis flip vers l'avant (diagonal si `lat` ≠ 0), pour frapper la balle au sol ou en l'air basse. */
function sequenceFlip(lat: number, avecSaut: boolean, attente: number): Sequence {
  const d = clamp(lat, -1, 1);
  const t0 = avecSaut ? 0.1 : 0;
  const segs: Segment[] = [];
  if (avecSaut) segs.push({ de: 0, a: 0.1, saut: true, boost: true }, { de: 0.1, a: 0.1 + attente, saut: false, boost: true });
  const f0 = t0 + attente;
  segs.push({ de: f0, a: f0 + 0.05, saut: true, tangage: -1, direction: d, boost: true });
  segs.push({ de: f0 + 0.05, a: f0 + 0.7, saut: false, tangage: 0, boost: true, attitude: true });
  return seq("flip", segs);
}

/**
 * Flip de VITESSE : petit saut puis flip avant, sans boost. Mesuré sur la physique : de 14,1 m/s (plafond du gaz seul) on ressort à
 * ≈ 19 m/s, de 17 à ≈ 22, et la vitesse acquise se garde gaz tenu ; la voiture retouche le sol 1,3 s après l'appui (elle « flotte »
 * pendant le couple du dodge). C'est la façon de dépasser 14 m/s sans boost, comme dans Rocket League.
 */
function sequenceFlipVitesse(): Sequence {
  return seq("vitesse", [
    { de: 0, a: 0.1, saut: true },
    { de: 0.1, a: 0.15, saut: false },
    { de: 0.15, a: 0.2, saut: true, tangage: -1, direction: 0, roulis: 0 },
    { de: 0.2, a: 0.85, saut: false, tangage: 0, attitude: true },
  ]);
}

/** Saut tenu 0,2 s (hauteur maximale) puis flip vers la balle : frappe de balles entre 1,5 et 3 m. */
function sequenceSaut(lat: number, attenteFlip: number): Sequence {
  const d = clamp(lat, -1, 1);
  return seq("saut", [
    { de: 0, a: SAUT_TENU, saut: true, boost: true },
    { de: SAUT_TENU, a: SAUT_TENU + attenteFlip, saut: false, boost: true, attitude: true },
    { de: SAUT_TENU + attenteFlip, a: SAUT_TENU + attenteFlip + 0.05, saut: true, tangage: -1, direction: d, boost: true },
    { de: SAUT_TENU + attenteFlip + 0.05, a: SAUT_TENU + attenteFlip + 0.7, saut: false, tangage: 0, boost: true, attitude: true },
  ]);
}
const SAUT_TENU = 0.2;

/**
 * Speed flip du coup d'envoi (All-Star) : saut, flip en diagonale vers la balle dès que la voiture est en l'air, annulation partielle
 * du tangage, boost tout du long. `lat` : −1 gauche, +1 droite (côté de la balle).
 */
function sequenceSpeedFlip(lat: number): Sequence {
  const d = lat >= 0 ? 1 : -1;
  return seq("vitesse", [
    { de: 0, a: 0.07, saut: true, boost: true },
    { de: 0.07, a: 0.11, saut: false, boost: true },
    { de: 0.11, a: 0.16, saut: true, tangage: -1, direction: d, boost: true },
    { de: 0.16, a: 0.9, saut: false, tangage: 0, direction: 0, boost: true, attitude: true },
  ]);
}

/** Décollage d'un aérien : saut tenu 0,22 s (hauteur maximale), le contrôle d'attitude et le boost prennent le relais en l'air. */
function sequenceDecollage(): Sequence {
  return seq("decollage", [
    { de: 0, a: 0.22, saut: true },
    { de: 0.22, a: 0.3, saut: false },
  ]);
}

/** Manœuvre de déblocage : marche arrière braquée, puis saut si le bot est resté coincé. */
function sequenceDeblocage(cote: number): Sequence {
  return seq("deblocage", [
    { de: 0, a: BOTS.deblocageS, saut: false, direction: cote },
    { de: BOTS.deblocageS * 0.5, a: BOTS.deblocageS * 0.5 + 0.12, saut: true, direction: cote },
  ]);
}

// ============================================================================================================================
// Le cerveau
// ============================================================================================================================

interface Contexte {
  m: Readonly<MondeRocket>;
  moi: Readonly<EtatVoiture>;
  centre: Vec3;
  /** signe du but défendu / attaqué */
  sg: number;
  att: number;
  balle: Readonly<EtatBalle>;
  amis: EtatVoiture[];
  adversaires: EtatVoiture[];
}

class CerveauBot implements Cerveau {
  private readonly profil: ProfilBot;
  private readonly rng: Rng;
  /** certains Débutants ne vont jamais chercher de plot (appétit) : tirage unique */
  private readonly gourmand: boolean;
  private horloge = 0;
  private prochaineDecision = 0;
  private file: { applique: number; c: Consigne }[] = [];
  private c: Consigne = consigneNeutre();
  private sequence: Sequence | null = null;
  private immobileS = 0;
  private cooldownSaut = 0;
  private redressementT = 0;
  private coupEnvoiFait = false;
  private readonly speedFlip: boolean;
  private demoJusqua = -1;
  private demoCible = -1;
  private boostOk = true;
  private sortie: EntreesVoiture = ENTREES_NULLES();
  private roleLisse: Role = "attaque";
  private biais = 0;

  constructor(niveau: NiveauBot, graine: number) {
    this.profil = PROFILS_BOT[niveau];
    this.speedFlip = niveau === "allstar";
    this.rng = creerRng(graine);
    this.gourmand = tirer(this.rng) < this.profil.appetitPlots;
  }

  decider(m: Readonly<MondeRocket>, moi: Readonly<EtatVoiture>, dt: number): EntreesVoiture {
    this.horloge += dt;
    const e = this.sortie;
    Object.assign(e, ENTREES_NULLES());
    if (moi.demolie) { this.sequence = null; this.file.length = 0; this.coupEnvoiFait = false; return e; }
    if (moi.figee) this.coupEnvoiFait = false;

    // ---- Décision (à la fréquence du niveau), appliquée après le retard de réaction.
    if (this.horloge >= this.prochaineDecision) {
      this.prochaineDecision = this.horloge + 1 / this.profil.frequenceDecisionHz;
      const c = this.decision(m, moi);
      this.file.push({ applique: this.horloge + (moi.figee ? 0 : this.profil.reactionS), c });
    }
    while (this.file.length > 0 && this.file[0].applique <= this.horloge) this.c = (this.file.shift() as { c: Consigne }).c;
    if (moi.figee) return e;

    this.cooldownSaut = Math.max(0, this.cooldownSaut - dt);
    const ctx = this.contexte(m, moi);
    this.executer(ctx, e, dt);
    return e;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Contexte
  // ------------------------------------------------------------------------------------------------------------------------

  private contexte(m: Readonly<MondeRocket>, moi: Readonly<EtatVoiture>): Contexte {
    const sg = signeButDefendu(moi.equipe);
    const amis: EtatVoiture[] = [], adversaires: EtatVoiture[] = [];
    for (const v of m.voitures) {
      if (v.id === moi.id) continue;
      (v.equipe === moi.equipe ? amis : adversaires).push(v);
    }
    return { m, moi, centre: centre(moi), sg, att: -sg, balle: m.balle, amis, adversaires };
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // DÉCISION
  // ------------------------------------------------------------------------------------------------------------------------

  private decision(m: Readonly<MondeRocket>, moi: Readonly<EtatVoiture>): Consigne {
    const ctx = this.contexte(m, moi);
    const p = this.profil;
    const c = consigneNeutre();
    // erreur de visée CORRÉLÉE dans le temps (AR(1), mémoire `memoireBiaisS`) : un joueur se trompe de quelques degrés pendant une
    // demi-seconde, il ne tremble pas à la fréquence de ses décisions (un bruit blanc se moyenne et ne coûte rien) ; écart type inchangé
    const rho = Math.exp(-1 / (p.frequenceDecisionHz * BOTS.memoireBiaisS));
    this.biais = this.biais * rho + tirerGauss(this.rng) * p.bruitVisee * Math.sqrt(1 - rho * rho);
    c.biais = this.biais;
    this.boostOk = tirer(this.rng) < p.usageBoost;
    c.boost = this.boostOk;
    c.derapage = p.flips;

    const b = ctx.balle;
    const pred = trajectoire(m, p.predictionS);
    const urgence = this.urgenceBut(ctx, pred);
    const role = this.choisirRole(ctx, urgence);
    this.roleLisse = role;
    c.role = role;
    c.lateralBalle = signe(dot([b.p[0] - ctx.centre[0], 0, b.p[2] - ctx.centre[2]], moi.base.droite));

    // Coup d'envoi : balle immobile au centre, personne ne l'a touchée.
    const auCentre = Math.hypot(b.p[0], b.p[2]) < 0.8 && Math.hypot(b.v[0], b.v[1], b.v[2]) < 0.6 && b.dernierToucheur === null;
    if (auCentre && role === "attaque") {
      c.coupEnvoi = true;
      c.cible = [b.p[0], 0, b.p[2]];
      // boost à fond pour qui sait jouer un coup d'envoi ; le Débutant booste comme d'habitude, par à-coups
      if (p.flips) c.boost = true;
      c.frappe = { tAbs: m.temps + 3, p: [b.p[0], b.p[1], b.p[2]], type: "sol" };
      c.atterrissage = [0, 1, 0];
      return c;
    }

    c.atterrissage = this.normaleAtterrissage(ctx);

    // Démolition (All-Star), sauf si la défense du but presse.
    const demo = this.chercherDemolition(ctx, urgence, role);
    if (demo) { c.cible = demo; c.vitesse = Infinity; c.boost = true; c.derapage = false; return c; }

    // Besoin de boost sans urgence : le plot le plus utile de son demi-terrain.
    if (role !== "attaque" || (moi.boost < 18 && this.etaBalleMin(ctx) > 3)) {
      const seuil = p.appetitPlots >= 0.7 ? 60 : 35;
      if (this.gourmand && moi.boost < seuil && !urgence) {
        const plot = this.meilleurPlot(ctx, role !== "attaque");
        if (plot) { c.cible = plot; c.boost = true; return c; }
      }
    }

    if (role === "attaque" || role === "gardien") {
      this.viser(ctx, pred, c, urgence);
    } else {
      this.positionner(ctx, pred, c, role);
    }
    // Un plot à peine hors de la route : on passe dessus (sauf frappe imminente ou cage menacée).
    if (this.gourmand && !urgence && moi.boost < BOTS.boostPlein && moi.auSol) {
      const tFrappe = c.frappe ? c.frappe.tAbs - m.temps : c.aerien ? c.aerien.tAbs - m.temps : Infinity;
      if (tFrappe > BOTS.plotAvantFrappeS) {
        const plot = this.plotSurLaRoute(ctx, c.cible);
        if (plot) { c.cible = plot; c.regarder = null; }
      }
    }
    return c;
  }

  /**
   * Plot actif (ou qui le sera à l'arrivée) presque sur la route vers `cible` : le détour toléré est de `detourPetitPlot` pour un
   * petit plot et grandit avec le manque de boost pour un gros. Le plot doit être devant la voiture (pas de demi-tour pour 12 de boost).
   */
  private plotSurLaRoute(ctx: Contexte, cible: Readonly<Vec3>): Vec3 | null {
    const moi = ctx.moi, m = ctx.m;
    const cx = moi.p[0], cz = moi.p[2];
    const L = Math.hypot(cible[0] - cx, cible[2] - cz);
    if (L < 5) return null;
    const av = moi.base.avant;
    const manque = (BOOST.max - moi.boost) / BOOST.max;
    let meilleur: Vec3 | null = null, score = 0;
    for (let k = 0; k < PLOTS.length; k++) {
      const d = PLOTS[k];
      const px = d.x - cx, pz = d.z - cz;
      const dp = Math.hypot(px, pz);
      if (dp < 1 || dp > L + 1) continue;
      const etat = m.plots[k];
      if (!etat.actif && etat.recharge > dp / 20) continue;
      if ((px * av[0] + pz * av[2]) / dp < BOTS.cosPlotDevant) continue;
      const detour = dp + Math.hypot(cible[0] - d.x, cible[2] - d.z) - L;
      if (detour > (d.gros ? BOTS.detourGrosPlot * manque : BOTS.detourPetitPlot)) continue;
      const sc = (d.gros ? PLOT.gros.valeur : PLOT.petit.valeur) / (detour + 1);
      if (sc > score) { score = sc; meilleur = [d.x, 0, d.z]; }
    }
    return meilleur;
  }

  /** La balle va-t-elle franchir ma ligne de but dans les 2,2 s ? Rend le temps et le point de passage, ou null. */
  private urgenceBut(ctx: Contexte, pred: EchantillonBalle[]): { t: number; p: Vec3 } | null {
    const limite = demiZ - BALLE.rayon * 0.5;
    for (const e of pred) {
      if (e.t > 2.2) break;
      if (e.p[2] * ctx.sg >= limite && Math.abs(e.p[0]) < BUT.demiLargeur + 1 && e.p[1] < BUT.hauteur + 1.5) return { t: e.t, p: e.p };
    }
    return null;
  }

  private etaBalleMin(ctx: Contexte): number {
    const b = ctx.balle;
    let mini = etaVers(ctx.moi, [b.p[0] + b.v[0] * 0.5, 0, b.p[2] + b.v[2] * 0.5]);
    for (const a of ctx.amis) mini = Math.min(mini, etaVers(a, [b.p[0] + b.v[0] * 0.5, 0, b.p[2] + b.v[2] * 0.5]));
    return mini;
  }

  /** Rotation d'équipe : le plus proche attaque, le deuxième soutient (3v3) ou couvre (2v2), le dernier couvre la cage. */
  private choisirRole(ctx: Contexte, urgence: { t: number; p: Vec3 } | null): Role {
    if (!this.profil.rotation || ctx.amis.length === 0) return "attaque";
    const b = ctx.balle;
    const but: Vec3 = [b.p[0] + b.v[0] * 0.5, 0, b.p[2] + b.v[2] * 0.5];
    const eta = (v: EtatVoiture): number => {
      let e = etaVers(v, but);
      const dt = b.dernierToucheur;
      // « rotation arrière » : celui qui vient de frapper cède sa place.
      if (dt && dt.idVoiture === v.id && ctx.m.temps - dt.temps < 1.3) e += 1.6;
      return e + v.id * 1e-4;
    };
    const mon = eta(ctx.moi);
    let rang = 0;
    for (const a of ctx.amis) if (!a.demolie && eta(a) < mon) rang++;
    const equipe = ctx.amis.length + 1;
    if (rang === 0) return "attaque";
    if (urgence && rang === 1) return "gardien";
    if (equipe === 2) return "couverture";
    return rang === 1 ? "soutien" : "couverture";
  }

  /** Normale de la surface où la voiture atterrirait en chute balistique (pour se remettre sur les roues). */
  private normaleAtterrissage(ctx: Contexte): Vec3 {
    const v = ctx.moi;
    const a = ctx.m.arene;
    const g = 6.5;
    for (let t = 0.1; t <= 4; t += 0.1) {
      const p: Vec3 = [v.p[0] + v.v[0] * t, v.p[1] + v.v[1] * t - 0.5 * g * t * t, v.p[2] + v.v[2] * t];
      if (a.sd(p) < 1.2) return a.normale(p);
    }
    return [0, 1, 0];
  }

  /** Plot actif le plus rentable (valeur / détour) ; `demiTerrain` le limite à sa moitié de terrain. */
  private meilleurPlot(ctx: Contexte, demiTerrain: boolean): Vec3 | null {
    const m = ctx.m, c = ctx.centre;
    let meilleur: Vec3 | null = null, score = -1;
    for (let k = 0; k < PLOTS.length; k++) {
      const d = PLOTS[k];
      if (demiTerrain && d.z * ctx.sg < -6) continue;
      const etat = m.plots[k];
      const dist = Math.hypot(d.x - c[0], d.z - c[2]);
      if (!etat.actif && etat.recharge > dist / 15 + 0.2) continue;
      const cfg = d.gros ? PLOT.gros : PLOT.petit;
      const s = cfg.valeur / (dist + 8);
      if (s > score) { score = s; meilleur = [d.x, 0, d.z]; }
    }
    return meilleur;
  }

  /** All-Star : un adversaire sur la route, assez proche pour être percuté en supersonique. */
  private chercherDemolition(ctx: Contexte, urgence: unknown, role: Role): Vec3 | null {
    if (!this.profil.demolit || urgence || role === "gardien") return null;
    const moi = ctx.moi;
    const vf = dot(moi.v, moi.base.avant);
    if (this.horloge < this.demoJusqua && this.demoCible >= 0) {
      const cible = ctx.m.voitures[this.demoCible];
      if (cible && !cible.demolie) return [cible.p[0] + cible.v[0] * 0.25, 0, cible.p[2] + cible.v[2] * 0.25];
    }
    if (role === "attaque" && distance(ctx.balle.p, ctx.centre) < 18) return null;
    // Une démolition exige d'être supersonique à l'impact (règle de RocketSim) : on ne la tente que lancé, ou presque avec du boost,
    // sur un adversaire droit devant, et jamais quand la balle est dans son propre camp (on y laisserait sa cage ouverte).
    if (!moi.supersonique && !(vf >= BOTS.demoVitesseMin && moi.boost >= BOTS.demoBoostMin)) return null;
    if (ctx.balle.p[2] * ctx.sg > 0) return null;
    let meilleur: EtatVoiture | null = null, dMeilleur: number = BOTS.demoDistanceMax;
    for (const a of ctx.adversaires) {
      if (a.demolie) continue;
      const dx = a.p[0] - ctx.centre[0], dz = a.p[2] - ctx.centre[2];
      const d = Math.hypot(dx, dz);
      if (d > dMeilleur || d < 3) continue;
      const cos = (dx * moi.base.avant[0] + dz * moi.base.avant[2]) / (d * Math.max(1e-6, Math.hypot(moi.base.avant[0], moi.base.avant[2])));
      if (cos < BOTS.demoCos) continue;
      meilleur = a; dMeilleur = d;
    }
    if (!meilleur) return null;
    statsBots.demolitionsVisees++;
    this.demoCible = meilleur.id;
    this.demoJusqua = this.horloge + BOTS.demoMaxS;
    return [meilleur.p[0] + meilleur.v[0] * 0.25, 0, meilleur.p[2] + meilleur.v[2] * 0.25];
  }

  /**
   * Plan de frappe pour un contact en `cp` dans `t` secondes. Direction IDÉALE `u` : tir vers la cage adverse, dégagement vers le côté
   * dans le tiers défensif ou sous la menace. Direction RÉELLE `h` : la voiture arrive le long de la droite voiture → balle, qu'elle ne
   * peut courber vers `u` qu'en proportion de la distance qui reste (`courbureApproche`). Si `h` s'écarte trop de `u` (voiture du
   * mauvais côté de la balle) :
   *  - un bot sans sens du placement (`rotation` faux, le Débutant) garde `u` et fonce sur la balle (voir `viser`) ;
   *  - en attaque, ou chez soi mais loin de sa cage (plus de `distancePresse`), on garde `u` : `viser` contourne la balle ;
   *  - près de sa cage, on frappe DE CÔTÉ, telle qu'on arrive, pourvu que ce coup ne soit pas dangereux (`frappeDangereuse`) ;
   *    sinon `null` : aucune frappe sûre d'ici, il faut repasser entre la balle et sa cage (`repli`).
   * Contourner une balle qu'un adversaire pousse à 10 m/s ne finit jamais : on roulait à côté d'elle jusque dans sa propre cage.
   */
  private planFrappe(ctx: Contexte, cp: Readonly<Vec3>, urgence: unknown): { u: Vec3; aim: Vec3; defensif: boolean; cote: boolean } | null {
    const sg = ctx.sg;
    const defensif = cp[2] * sg > 16 || urgence !== null;
    const aim: Vec3 = defensif
      ? [(cp[0] >= 0 ? 1 : -1) * 28, 0, cp[2] + ctx.att * 38]
      : [clamp(-cp[0] * 0.25, -3.5, 3.5), 2, ctx.att * (demiZ + 2)];
    const u = normaliser([aim[0] - cp[0], 0, aim[2] - cp[2]], [0, 0, ctx.att]);
    const direct = { u, aim, defensif, cote: false };
    if (!this.profil.rotation) return direct;
    const dx = cp[0] - ctx.centre[0], dz = cp[2] - ctx.centre[2];
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return direct;
    let hx = dx / d, hz = dz / d;
    // direction réelle : la route droite, courbée vers `u` autant que la distance le permet
    const cos = clamp(hx * u[0] + hz * u[2], -1, 1);
    const ecart = Math.acos(cos);
    const courbe = Math.min(ecart, d * BOTS.courbureApproche);
    if (ecart - courbe <= BOTS.ecartFrappeDirecte) return direct;
    const chezMoi = defensif || cp[2] * sg > -BOTS.margeChezSoi || ctx.balle.v[2] * sg > BOTS.vitesseMenace;
    if (!chezMoi) return direct;
    // loin de sa cage on a le temps de repasser derrière la balle : on contourne
    if (cp[2] * sg <= demiZ - BOTS.distancePresse) return direct;
    // sûre telle qu'on arrive (route droite) ET une fois courbée : la courbe n'est qu'une estimation
    if (this.frappeDangereuse(ctx, cp, hx, hz)) return null;
    if (courbe > 0) {
      // tourne (hx, hz) de `courbe` vers u, du bon côté
      const sens = hx * u[2] - hz * u[0] >= 0 ? 1 : -1;
      const c = Math.cos(courbe), sn = Math.sin(courbe) * sens;
      const rx = hx * c - hz * sn, rz = hx * sn + hz * c;
      hx = rx; hz = rz;
      if (this.frappeDangereuse(ctx, cp, hx, hz)) return null;
    }
    return { u: [hx, 0, hz], aim, defensif, cote: true };
  }

  /**
   * Une frappe en `cp` le long de (hx, hz) est-elle dangereuse pour sa propre cage ? Oui si elle croise la ligne de but dans le cadre
   * (marge `margeCadre`), ou si, dans le tiers défensif, elle recentre la balle devant la cage.
   */
  private frappeDangereuse(ctx: Contexte, cp: Readonly<Vec3>, hx: number, hz: number): boolean {
    const sg = ctx.sg;
    if (hz * sg > 0.15 && Math.abs(cp[0] + hx * ((sg * demiZ - cp[2]) / hz)) < BUT.demiLargeur + BOTS.margeCadre) return true;
    return cp[2] * sg > BOTS.zoneRecentrage && Math.abs(cp[0]) > BUT.demiLargeur * 0.6 && hx * Math.sign(cp[0]) < -0.55 && hz * sg > -0.5;
  }

  /** Attaque / dégagement / défense directe : interception sur la trajectoire prévue de la balle. */
  private viser(ctx: Contexte, pred: EchantillonBalle[], c: Consigne, urgence: { t: number; p: Vec3 } | null): void {
    const p = this.profil;
    const moi = ctx.moi, b = ctx.balle;
    let choix: { e: EchantillonBalle; type: "sol" | "saut" | "aerien"; plan: NonNullable<ReturnType<CerveauBot["planFrappe"]>> } | null = null;
    let sansFrappeSure = false;
    let barrage: EchantillonBalle | null = null;
    // Au-delà du moment où un adversaire peut toucher la balle, la prévision (balle seule) ne vaut plus rien : on n'y vise aucun contact.
    const tAdv = this.tempsAdversaire(ctx, pred);
    for (const e of pred) {
      if (e.t < 0.05) continue;
      // la balle est entrée dans une cage : plus rien à frapper au-delà
      if (Math.abs(e.p[2]) > demiZ + BALLE.rayon) break;
      if (e.t > tAdv + BOTS.margeAdversaireS) break;
      const hauteur = e.p[1];
      const horiz: Vec3 = [e.p[0], 0, e.p[2]];
      const marge = e.t - (etaVers(moi, horiz) + 0.05);
      // sous la menace : premier point de la trajectoire où l'on peut être AVANT la balle, pour lui barrer la route de sa caisse
      if (urgence && p.rotation && !barrage && hauteur <= BOTS.hauteurSaut && marge >= BOTS.avanceBarrageS) barrage = e;
      let type: "sol" | "saut" | "aerien" | null = null;
      if (hauteur <= BOTS.hauteurSol) type = "sol";
      else if (p.flips && hauteur <= BOTS.hauteurSaut) type = "saut";
      else if (p.aeriens && hauteur > BOTS.hauteurAerienMin && hauteur <= p.hauteurAerienMax) type = "aerien";
      if (!type) continue;
      if (type === "aerien") {
        if (moi.boost < BOTS.boostAerienMin || e.t < BOTS.aerienTMin || e.t > BOTS.aerienTMax) continue;
        if (!this.aerienFaisable(ctx, e)) continue;
        // un aérien doit aussi être à portée horizontale avant le saut
        if (marge < -0.6) continue;
      } else if (marge < 0) continue;
      const plan = this.planFrappe(ctx, e.p, urgence);
      if (!plan) { sansFrappeSure = true; continue; }
      choix = { e, type, plan };
      break;
    }

    if (!choix) {
      // Rien d'atteignable : on se place sur la trajectoire (sous la menace), on repasse derrière la balle, ou on la poursuit.
      if (urgence && barrage) {
        // aucune frappe sûre avant la ligne : on se met en travers de la trajectoire, à l'arrêt ou presque
        c.cible = dansLeTerrain([barrage.p[0], 0, barrage.p[2]], 0.5);
        c.vitesse = BOTS.vitesseBarrage;
        c.boost = true;
        c.repli = true;
      } else if (urgence) {
        c.cible = dansLeTerrain([urgence.p[0], 0, ctx.sg * (demiZ - 4)], 1);
        c.regarder = [urgence.p[0], 0, urgence.p[2]];
        c.vitesse = 9;
      } else if (sansFrappeSure) {
        this.repli(ctx, pred, c);
      } else {
        const plan = this.planFrappe(ctx, b.p, urgence);
        if (!plan) { this.repli(ctx, pred, c); return; }
        // poursuite : vers la balle telle qu'elle sera quand l'adversaire la touchera (ou à mi-horizon)
        const tPoursuite = Math.min(tAdv, p.predictionS * 0.5);
        let e: { p: Readonly<Vec3> } = pred[pred.length - 1] ?? { p: b.p };
        for (const x of pred) if (x.t >= tPoursuite) { e = x; break; }
        // (le Débutant vise la balle elle-même ; les autres se placent 3 m derrière elle, côté frappe)
        const rec = p.rotation ? BOTS.reculPoursuite : 0;
        c.cible = dansLeTerrain([e.p[0] - plan.u[0] * rec, 0, e.p[2] - plan.u[2] * rec], 1);
      }
      return;
    }

    const { e, type, plan } = choix;
    const { u, aim, defensif } = plan;
    const cp: Vec3 = [e.p[0], e.p[1], e.p[2]];
    const dist = Math.hypot(e.p[0] - ctx.centre[0], e.p[2] - ctx.centre[2]);
    // Point d'approche. Le Débutant (sans sens du placement) fonce sur la balle d'où il est : il la frappe dans le sens où il arrive,
    // bon ou mauvais. Les autres se placent derrière elle par rapport à la direction de frappe.
    const s = dot([ctx.centre[0] - e.p[0], 0, ctx.centre[2] - e.p[2]], u);
    let recul = BALLE.rayon + 0.25;
    if (p.rotation && !plan.cote) {
      // Suivi de la LIGNE de frappe (droite par la balle, le long de u) : on vise le point de la ligne situé `avance` mètres en avant
      // de sa propre projection. L'avance grandit avec la vitesse (à 20 m/s, un point à 4 m fait zigzaguer) et se resserre près de la
      // balle. Une fois sur la ligne (écart latéral < `ecartLigneMax`), le point visé TRAVERSE la balle : le contact a lieu 1,9 m avant
      // le centre de la balle, il ne faut plus tourner à ce moment-là (0,5 m d'écart au contact dévie la frappe de 16°). Sinon on reste
      // derrière la balle, d'autant plus loin que la voiture est de côté.
      const lat = Math.abs((ctx.centre[0] - e.p[0]) * u[2] - (ctx.centre[2] - e.p[2]) * u[0]);
      const avance = Math.max(BOTS.avanceLigne, Math.min(dot(moi.v, moi.base.avant) * BOTS.avanceLigneS, -s * BOTS.avanceLigneProche));
      const reculCote = lat > BOTS.ecartLigneMax ? Math.min(lat * BOTS.reculLateral, BOTS.reculLateralMax) + BOTS.reculContact : -BOTS.traversee;
      recul = clamp(Math.max(-s - avance, reculCote), -BOTS.traversee, BOTS.reculMax);
    }
    let cible: Vec3 = [e.p[0] - u[0] * recul, 0, e.p[2] - u[2] * recul];
    // Voiture du mauvais côté de la balle : on contourne par le côté pour ne pas la pousser vers notre cage.
    if (p.rotation && !plan.cote && s > -1.2 && dist < 22) {
      const perp: Vec3 = [-u[2], 0, u[0]];
      const cote = dot([ctx.centre[0] - e.p[0], 0, ctx.centre[2] - e.p[2]], perp) >= 0 ? 1 : -1;
      cible = [e.p[0] - u[0] * 7 + perp[0] * cote * 5, 0, e.p[2] - u[2] * 7 + perp[2] * cote * 5];
    }
    c.cible = dansLeTerrain(cible, 1);
    c.vitesse = Infinity;
    c.cote = plan.cote;

    // un tir au sol sans flip part en cloche : on ralentit pour rester sous la barre (le flip de frappe tire à plat)
    if (!defensif && type === "sol" && !p.flips) c.vitesse = vitesseDeTir(Math.hypot(aim[0] - cp[0], aim[2] - cp[2]));
    if (type === "aerien") {
      statsBots.aeriensChoisis++;
      c.aerien = { tAbs: ctx.m.temps + e.t, p: [e.p[0] - u[0] * 0.6, e.p[1], e.p[2] - u[2] * 0.6] };
      c.cible = dansLeTerrain([e.p[0], 0, e.p[2]], 1);
    } else {
      c.frappe = { tAbs: ctx.m.temps + e.t, p: [e.p[0], e.p[1], e.p[2]], type };
    }
  }

  /**
   * Repli : aucune frappe sûre d'où l'on est (la balle est entre la voiture et sa propre cage). On fonce se replacer devant sa cage,
   * du côté de la balle ; une fois entre la balle et la cage, `viser` retrouve une frappe.
   */
  private repli(ctx: Contexte, pred: EchantillonBalle[], c: Consigne): void {
    const e = pred[Math.min(pred.length - 1, 22)] ?? { p: ctx.balle.p };
    c.cible = dansLeTerrain([clamp(e.p[0] * 0.6, -(BUT.demiLargeur - 1.5), BUT.demiLargeur - 1.5), 0, ctx.sg * (demiZ - BOTS.profondeurRepli)], 1);
    c.vitesse = Infinity;
    c.boost = true;
    c.repli = true;
  }

  /** Premier instant de la prévision où un adversaire peut être sur la balle (au sol ou en sautant) ; Infinity s'il n'y en a pas. */
  private tempsAdversaire(ctx: Contexte, pred: EchantillonBalle[]): number {
    for (const e of pred) {
      if (e.p[1] > BOTS.hauteurSaut) continue;
      for (const a of ctx.adversaires) if (!a.demolie && etaVers(a, e.p) <= e.t) return e.t;
    }
    return Infinity;
  }

  /** Cet instant de la trajectoire prévue est-il atteignable par un aérien (poussée du boost suffisante) ? */
  private aerienFaisable(ctx: Contexte, e: EchantillonBalle): boolean {
    const moi = ctx.moi;
    const T = e.t - 0.25;
    if (T < 0.5) return false;
    // le saut ajoute environ 4 m/s vers le haut et 0,5 m de hauteur dès le décollage
    const dx = e.p[0] - moi.p[0], dy = e.p[1] - (moi.p[1] + 0.5), dz = e.p[2] - moi.p[2];
    const ax = (2 * (dx - moi.v[0] * T)) / (T * T);
    const ay = (2 * (dy - (moi.v[1] + 4) * T)) / (T * T) + 6.5;
    const az = (2 * (dz - moi.v[2] * T)) / (T * T);
    const besoin = Math.hypot(ax, ay, az);
    if (besoin > BOTS.poussee) return false;
    // assez de boost pour tenir la poussée pendant T
    return moi.boost >= Math.min(100, (besoin / BOOST.acceleration) * BOOST.consommation * T * 0.9 + 5);
  }

  /** Positionnement d'un coéquipier qui n'attaque pas : soutien en retrait de la balle, couverture de la cage. */
  private positionner(ctx: Contexte, pred: EchantillonBalle[], c: Consigne, role: Role): void {
    const b = ctx.balle;
    const e1 = pred[Math.min(pred.length - 1, 15)] ?? { p: b.p };
    const bp = e1.p;
    c.regarder = [b.p[0], 0, b.p[2]];
    const patrouille = Math.sin(this.horloge * 0.6 + ctx.moi.id) * 3.5;
    if (role === "soutien") {
      const x = clamp(-Math.sign(bp[0] || 1) * 11 + patrouille * 0.3, -demiX + 6, demiX - 6);
      const z = clamp(bp[2] - ctx.att * 24, -(demiZ - 8), demiZ - 8);
      // pas plus avancé que la balle ni trop profond dans son camp
      const zz = ctx.sg > 0 ? Math.min(z, demiZ - 14) : Math.max(z, -(demiZ - 14));
      c.cible = dansLeTerrain([x, 0, zz], 2);
      c.vitesse = 8;
    } else {
      const proche = bp[2] * ctx.sg > 24;
      const profondeur = proche ? 5.5 : BOTS.profondeurDefense;
      c.cible = dansLeTerrain([clamp(bp[0] * 0.45, -8, 8) + patrouille * 0.4, 0, ctx.sg * (demiZ - profondeur)], 2);
      c.vitesse = 8;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // EXÉCUTION
  // ------------------------------------------------------------------------------------------------------------------------

  private executer(ctx: Contexte, e: EntreesVoiture, dt: number): void {
    const { moi, m } = ctx;
    const c = this.c;
    const surLeToit = moi.base.haut[1] < -0.35 && moi.p[1] < 1.6 && moi.rouesContact === 0;

    // Immobilité au sol (hors coup d'envoi) : déblocage.
    const vit = norme(moi.v);
    if (m.phase === "enJeu" && moi.auSol && vit < 1.0 && !this.sequence) this.immobileS += dt; else this.immobileS = 0;
    if (this.immobileS > BOTS.immobileMaxS) {
      statsBots.deblocages++;
      this.sequence = sequenceDeblocage(tirer(this.rng) < 0.5 ? -1 : 1);
      this.immobileS = 0;
    }

    // Retournement forcé sur le toit : impulsions de saut espacées.
    if (surLeToit) {
      this.redressementT += dt;
      e.saut = this.redressementT % 0.7 < 0.14;
      e.accel = 0;
      return;
    }
    this.redressementT = 0;

    // Séquence en cours : elle écrase les entrées de base.
    if (this.sequence) {
      this.base(ctx, c, e);
      if (this.appliquerSequence(ctx, e, dt)) return;
    } else {
      this.base(ctx, c, e);
    }

    // Déclencheurs de séquences (au sol seulement).
    if (!this.sequence && moi.auSol && this.cooldownSaut <= 0) this.declencher(ctx);
  }

  /** Entrées de base (sans séquence) : conduite au sol ou contrôle d'attitude en l'air. */
  private base(ctx: Contexte, c: Consigne, e: EntreesVoiture): void {
    const { moi } = ctx;
    if (moi.auSol) {
      this.conduire(ctx, c, e);
      return;
    }
    // En l'air : plan aérien, sinon retour sur les roues, face au sens de la vitesse (ou vers la balle).
    if (c.aerien && moi.saut.aSaute && ctx.m.temps < c.aerien.tAbs + 0.3 && !moi.flip.actif) {
      this.aerien(ctx, e);
      return;
    }
    this.recuperer(ctx, c, e);
  }

  /** Remise sur les roues : le haut vers la surface d'atterrissage prévue, l'avant dans le sens du déplacement. */
  private recuperer(ctx: Contexte, c: Consigne, e: EntreesVoiture): void {
    const { moi } = ctx;
    const vh: Vec3 = [moi.v[0], 0, moi.v[2]];
    const dir = norme(vh) > 3 ? vh : [moi.base.avant[0], 0, moi.base.avant[2]] as Vec3;
    const o = orientation(dir, c.atterrissage, [0, 1, 0]);
    attitude(moi, o.avant, o.haut, e, moi.flip.verrouTangage > 0);
    // pendant un flip la rotation est pilotée par la physique : on ne contrarie que le roulis et le lacet
    e.accel = 0;
  }

  /** Conduite au sol : vers `c.cible`, angle → volant, marche arrière proche, dérapage, boost. */
  private conduire(ctx: Contexte, c: Consigne, e: EntreesVoiture): void {
    const { moi } = ctx;
    const v = moi.base;
    const cible = c.cible;
    let dx = cible[0] - ctx.centre[0], dz = cible[2] - ctx.centre[2];
    // le biais de visée tourne le vecteur visé autour de la verticale
    if (c.biais !== 0) {
      const cs = Math.cos(c.biais), sn = Math.sin(c.biais);
      const rx = dx * cs - dz * sn, rz = dx * sn + dz * cs;
      dx = rx; dz = rz;
    }
    const d3: Vec3 = [dx, cible[1] - ctx.centre[1], dz];
    // plan de la surface sous la voiture (sol, mur, plafond)
    const dn = dot(d3, v.haut);
    const dp: Vec3 = [d3[0] - v.haut[0] * dn, d3[1] - v.haut[1] * dn, d3[2] - v.haut[2] * dn];
    const df = dot(dp, v.avant), dl = dot(dp, v.droite);
    const dist = Math.hypot(df, dl);
    const vf = dot(moi.v, v.avant);
    let ang = Math.atan2(dl, df);

    // Position d'attente atteinte : on s'oriente vers la balle en rampant.
    if (c.regarder && dist < 3.5 && c.role !== "attaque") {
      const rx = c.regarder[0] - ctx.centre[0], rz = c.regarder[2] - ctx.centre[2];
      const a = Math.atan2(dot([rx, 0, rz], v.droite), dot([rx, 0, rz], v.avant));
      e.direction = clamp(a * 2, -1, 1);
      // la voiture ne s'arrête jamais complètement : elle rôde à ≈ 3 m/s autour de sa position, face à la balle
      e.accel = vf > 3.5 ? -0.3 : vf > 2.5 ? 0.1 : 0.5;
      return;
    }

    // Marche arrière : cible juste derrière, voiture lente.
    if (Math.abs(ang) > 2.35 && dist < 14 && vf < 4) {
      const aArr = Math.atan2(dl, -df);
      e.accel = -1;
      e.direction = clamp(-aArr * 2.2, -1, 1);
      return;
    }

    e.direction = clamp(ang * 2.4, -1, 1);
    e.derapage = c.derapage && Math.abs(ang) > 1.15 && vf > 8 && dist > 6;
    // Cible À L'INTÉRIEUR du cercle de virage (volant à fond, à cette vitesse) : elle est inatteignable sans ralentir, la voiture
    // tournerait autour indéfiniment. On freine (et on dérape si le niveau le permet) jusqu'à ce que le cercle se resserre.
    if (vf > BOTS.vitesseMinCercle && Math.abs(ang) > 0.35) {
      const r = 1 / interpolerTable(CONDUITE.courbeCourbure, vf);
      if (Math.hypot(df, Math.abs(dl) - r) < r * BOTS.margeCercle) {
        e.direction = signe(dl) || 1;
        e.accel = vf > BOTS.vitesseFreinCercle ? -1 : 0;
        e.derapage = c.derapage && vf > 6 && Math.abs(ang) > 0.9;
        return;
      }
    }
    // vitesse voulue à l'arrivée
    e.accel = 1;
    let vMax = Infinity;
    if (c.vitesse !== Infinity) {
      // freinage constant de 20 m/s² (le frein de la voiture fait 35) : v² = vArrivée² + 2·a·distance
      vMax = Math.sqrt(c.vitesse * c.vitesse + 40 * Math.max(0, dist - 1));
      if (vf > vMax + 1.2) e.accel = -1;
      else if (vf > vMax - 0.3) e.accel = 0;
    }
    // Vitesse maximale pour que le rayon de virage (table de courbure de `CONDUITE`) permette de rejoindre la cible : sinon le bot la dépasse
    // et tourne autour. Le dérapage resserre le virage de 1,6. Inactif tout près de la cible (l'angle y est instable) et pour une frappe.
    if (dist > 5 && vf > 3) {
      const sinus = Math.max(Math.sin(Math.min(Math.abs(ang), Math.PI / 2)), 0.06);
      const kNecessaire = (2 * sinus) / dist / (e.derapage ? CONDUITE.facteurLacetDerapage : 1);
      const vTour = vitessePourCourbure(kNecessaire);
      if (vf > vTour + 1.5) e.accel = vf > vTour + 6 ? -1 : 0;
    }
    // Boost : aligné, pas à fond de vitesse, cible lointaine (ou balle de coup d'envoi).
    if (c.boost && moi.boost > 0 && Math.abs(ang) < 0.26 && vf < Math.min(BOTS.vitesseSansBoost, vMax - 0.5) && (dist > 14 || c.coupEnvoi || c.frappe || c.repli)) e.boost = true;
  }

  /** Applique la séquence active sur `e`. Rend vrai si elle a tout décidé pour ce pas. */
  private appliquerSequence(ctx: Contexte, e: EntreesVoiture, dt: number): boolean {
    const s = this.sequence as Sequence;
    s.t += dt;
    if (s.t > s.fin) { this.sequence = null; this.cooldownSaut = 0.25; return false; }
    // une séquence de saut s'interrompt si la voiture est démolie (gérée plus haut) ; un flip fini au sol se termine tôt
    let attitudeVoulue = false;
    for (const g of s.segments) {
      if (s.t < g.de || s.t >= g.a) continue;
      if (g.saut !== undefined) e.saut = g.saut;
      if (g.tangage !== undefined) e.tangage = g.tangage;
      if (g.direction !== undefined) { e.direction = g.direction; e.lacet = 0; }
      if (g.roulis !== undefined) e.roulis = g.roulis;
      if (g.lacet !== undefined) e.lacet = g.lacet;
      if (g.boost !== undefined) e.boost = g.boost && ctx.moi.boost > 0;
      if (g.derapage !== undefined) e.derapage = g.derapage;
      if (g.attitude) attitudeVoulue = true;
    }
    if (s.nom === "deblocage") { e.accel = s.t < BOTS.deblocageS ? -1 : 1; return true; }
    e.accel = 1;
    if (s.nom === "decollage" && !ctx.moi.auSol) {
      const saut = e.saut;
      this.aerien(ctx, e);
      e.saut = saut || e.saut;
      return true;
    }
    if (attitudeVoulue && !ctx.moi.auSol) {
      const o = orientation(ctx.moi.v.length ? [ctx.moi.v[0], 0, ctx.moi.v[2]] : ctx.moi.base.avant, this.c.atterrissage, [0, 1, 0]);
      attitude(ctx.moi, o.avant, o.haut, e, ctx.moi.flip.verrouTangage > 0);
    }
    return true;
  }

  /** Déclenche saut / flip / speed flip quand la frappe prévue arrive. */
  private declencher(ctx: Contexte): void {
    const { moi, m } = ctx;
    const c = this.c;
    // Flip précoce du coup d'envoi (All-Star) : dès que le gaz ne fait plus accélérer, un flip avant ajoute +5 m/s (désactivé, voir `BOTS.activeFlipEnvoi`).
    if (BOTS.activeFlipEnvoi && c.coupEnvoi && this.speedFlip && !this.coupEnvoiFait) {
      const vf0 = dot(moi.v, moi.base.avant);
      const d0 = Math.hypot(ctx.balle.p[0] - ctx.centre[0], ctx.balle.p[2] - ctx.centre[2]);
      if (vf0 >= BOTS.vitesseFlipEnvoi && d0 > BOTS.distanceFlipEnvoi) {
        this.coupEnvoiFait = true;
        this.sequence = sequenceFlip(c.lateralBalle * 0.3, true, 0.05);
        return;
      }
    }
    const pc = ctx.centre;
    if (this.flipDeVitesse(ctx)) { this.sequence = sequenceFlipVitesse(); return; }
    // Aérien : on décolle quand le temps de vol restant suffit à rejoindre le point de contact.
    if (c.aerien) {
      const tr = c.aerien.tAbs - m.temps;
      const dH = Math.hypot(c.aerien.p[0] - pc[0], c.aerien.p[2] - pc[2]);
      const vf = dot(moi.v, moi.base.avant);
      const tVol = 0.55 + c.aerien.p[1] * 0.16;
      if (tr <= tVol + 0.25 && tr >= 0.45 && dH <= Math.max(vf, 2) * tr + 4 && dot([c.aerien.p[0] - pc[0], 0, c.aerien.p[2] - pc[2]], moi.base.avant) > 0) {
        statsBots.decollages++;
        this.sequence = sequenceDecollage();
      }
      return;
    }
    const f = c.frappe;
    if (!f || !this.profil.flips) return;
    const vh: Vec3 = [moi.v[0], 0, moi.v[2]];
    const tr0 = f.tAbs - m.temps;
    if (tr0 < -0.1) return;
    const dist0 = Math.hypot(f.p[0] - pc[0], f.p[2] - pc[2]);
    // coup d'envoi : la balle est fixe, le temps de contact vient de la géométrie
    const tr = c.coupEnvoi ? Math.max(0, dist0 - 1.7) / Math.max(dot(moi.v, moi.base.avant), 4) : tr0;
    // position horizontale prévue de la voiture à l'instant du contact
    const px = pc[0] + vh[0] * Math.max(tr, 0), pz = pc[2] + vh[2] * Math.max(tr, 0);
    const reste = Math.hypot(f.p[0] - px, f.p[2] - pz);
    const dist = Math.hypot(f.p[0] - pc[0], f.p[2] - pc[2]);
    const vf = dot(moi.v, moi.base.avant);
    const lat = clamp(dot([f.p[0] - pc[0], 0, f.p[2] - pc[2]], moi.base.droite) / Math.max(dist, 1) * 1.5, -0.8, 0.8);
    // aligné : la balle est devant
    const devant = dot([f.p[0] - pc[0], 0, f.p[2] - pc[2]], moi.base.avant) / Math.max(dist, 1e-6);
    if (devant < 0.75) return;
    // jamais de flip (frappe forte) dans une direction dangereuse pour sa propre cage
    if (this.profil.rotation && dist > 1e-3 && this.frappeDangereuse(ctx, f.p, (f.p[0] - pc[0]) / dist, (f.p[2] - pc[2]) / dist)) return;
    if (f.type === "saut") {
      // saut tenu puis flip : le contact survient environ 0,45 s après l'appui
      if (tr <= 0.55 && tr >= 0.2 && reste < 3.2 && vf > 4) { statsBots.saut++; this.sequence = sequenceSaut(lat, Math.max(0.08, tr - SAUT_TENU - 0.18)); }
    } else if (f.type === "sol") {
      // flip de frappe sur une balle basse : le flip touche environ 0,22 s après l'appui
      if (vf > BOTS.flipFrappeVitesseMin && tr <= 0.3 && tr >= 0.1 && reste < 2.8 && dist < 9) { statsBots.flipsFrappe++; this.sequence = sequenceFlip(lat, true, 0.05); }
    }
  }

  /**
   * Faut-il un flip de vitesse ? Seulement à plat, les quatre roues au sol, en ligne droite vers une cible lointaine à rejoindre à
   * fond, entre `flipVitesseMin` et `flipVitesseMax` m/s, sans frappe ni aérien avant la fin du flip, et quand le boost ne fait pas déjà
   * mieux (réserve faible ou boost refusé à cette décision).
   */
  private flipDeVitesse(ctx: Contexte): boolean {
    const { moi, m } = ctx;
    const c = this.c;
    if (!this.profil.flips || c.vitesse !== Infinity || c.coupEnvoi || c.cote) return false;
    if (moi.rouesContact < 4 || moi.base.haut[1] < 0.97) return false;
    const vf = dot(moi.v, moi.base.avant);
    if (vf < BOTS.flipVitesseMin || vf > BOTS.flipVitesseMax) return false;
    if (c.boost && moi.boost > BOTS.flipVitesseBoostMax && vf < BOTS.vitesseSansBoost - 1) return false;
    const dx = c.cible[0] - ctx.centre[0], dz = c.cible[2] - ctx.centre[2];
    const dist = Math.hypot(dx, dz);
    // la voiture parcourt ≈ (vf + 4) × 1,3 m avant de retoucher le sol. La cible compte telle quelle, même si ce n'est qu'un plot
    // pris sur la route : flipper plus souvent (en visant au-delà du plot) a été mesuré, cela ne rapporte rien
    if (dist < (vf + 4) * BOTS.flipVitesseDureeS + BOTS.flipVitesseMargeM) return false;
    if ((dx * moi.base.avant[0] + dz * moi.base.avant[2]) / dist < BOTS.flipVitesseCos) return false;
    if (Math.abs(moi.w[1]) > 0.25) return false;
    const tPlan = c.frappe ? c.frappe.tAbs - m.temps : c.aerien ? c.aerien.tAbs - m.temps : Infinity;
    if (tPlan < BOTS.flipVitesseDureeS + 0.5) return false;
    // pas de flip droit dans un mur : la retombée doit rester dans le terrain
    const ax = ctx.centre[0] + moi.base.avant[0] * (vf + 4) * BOTS.flipVitesseDureeS, az = ctx.centre[2] + moi.base.avant[2] * (vf + 4) * BOTS.flipVitesseDureeS;
    if (Math.abs(ax) > demiX - 6 || Math.abs(az) > demiZ - 6 || Math.abs(ax) + Math.abs(az) > demiX + demiZ - STADE.panCoupe - 8) return false;
    return true;
  }

  /** Aérien : saut puis poussée du boost vers le point de contact, flip final. Appelé à chaque pas tant que `c.aerien` est actif. */
  private aerien(ctx: Contexte, e: EntreesVoiture): void {
    const { moi, m } = ctx;
    const plan = this.c.aerien;
    if (!plan) return;
    const T = plan.tAbs - m.temps;
    if (moi.auSol) {
      // au sol : le saut est lancé par `declencherAerien` ; ici on suit la cible en roulant
      return;
    }
    if (T < -0.4) return;
    const Tc = Math.max(T, 0.12);
    const dx = plan.p[0] - moi.p[0], dy = plan.p[1] - moi.p[1], dz = plan.p[2] - moi.p[2];
    const ax = (2 * (dx - moi.v[0] * Tc)) / (Tc * Tc);
    const ay = (2 * (dy - moi.v[1] * Tc)) / (Tc * Tc) + 6.5;
    const az = (2 * (dz - moi.v[2] * Tc)) / (Tc * Tc);
    const besoin = Math.hypot(ax, ay, az);
    const dir: Vec3 = [ax, ay, az];
    // pendant le saut tenu, pas de contrôle : la voiture reste droite
    const o = orientation(dir, [0, 1, 0], moi.base.haut);
    attitude(moi, o.avant, o.haut, e, moi.flip.verrouTangage > 0);
    const alignement = dot(moi.base.avant, o.avant);
    // poussée utile le long de l'avant
    const utile = dot([ax, ay, az], moi.base.avant);
    if (moi.boost > 0 && alignement > 0.93 && utile > BOOST.acceleration * 0.35 && T > 0.05) e.boost = true;
    else if (alignement > 0.97 && besoin > 1.5 && moi.boost > 0) e.boost = true;
    // flip final vers la balle quand elle est à portée et que le second saut est disponible
    const dBalle = distance(centre(moi), ctx.balle.p);
    if (dBalle < 3.4 && !moi.saut.secondUtilise && moi.saut.tempsEnLAir < 1.2 && T < 0.3) {
      const loc = mondeVersLocal(moi.base, [ctx.balle.p[0] - moi.p[0], ctx.balle.p[1] - moi.p[1], ctx.balle.p[2] - moi.p[2]]);
      const n = Math.max(Math.hypot(loc[0], loc[1]), 1e-6);
      e.saut = true;
      e.tangage = clamp(-loc[0] / n, -1, 1);
      e.direction = clamp(loc[1] / n, -1, 1);
      e.lacet = 0;
    }
  }
}

/** Un cerveau par bot, semé par `graine` (bruit de visée, hésitations). */
export const creerCerveau: CreerCerveau = (niveau, graine) => new CerveauBot(niveau, graine);

// ============================================================================================================================
// Décollage des aériens (au sol)
// ============================================================================================================================

/** Utilisé par les tests : constantes de réglage lisibles sans les exporter une à une. */
export const REGLAGES_BOTS = BOTS;
export type { Role };
