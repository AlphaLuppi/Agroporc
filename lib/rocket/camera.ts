/**
 * Rocket Muche : caméra de Rocket League (PURE : aucun three, aucune horloge, le temps vient des arguments).
 *
 * Refonte 2026-11 (façon RL, cf. CLAUDE.md « Rocket Muche ») : la caméra est un REPÈRE (avant `dir`, haut `haut`) lissé comme UNE seule
 * rotation (quaternion), et sa position est la formule de RL : `pivot = voiture + haut·hauteur`, `caméra = pivot − avant·distance`,
 * la visée penchée de `angle` (c'est le tangage de la caméra, comme le `Pitch` de RL) : au sol la voiture est à ≈ 16° sous le centre de
 * l'image, dans le tiers bas, avec le terrain devant.
 *
 * - **Car cam au sol** (sol, murs, plafond) : le repère cible est celui de la voiture (avant, haut), quasi rigide (lissé à 20/s
 *   seulement pour filtrer les chocs) : sur un mur la caméra se tient derrière la voiture LE LONG du mur, son haut est la normale.
 * - **Car cam en l'air** : le haut revient à celui du monde, l'avant suit le CAP du nez (son projeté horizontal), jamais son tangage ;
 *   nez à la verticale (décollage d'un mur, aérien), la vitesse horizontale puis le dernier cap valable prennent le relais.
 *   **Pendant un flip** (dodge, pas le stall) le repère est GELÉ à celui du départ du flip : la caméra suit la POSITION de la voiture
 *   mais pas le salto, puis se raccroche (fondu de `RACCROCHAGE_FLIP_S`, rotation bornée à `VITESSE_RACCROCHAGE` tant que la borne mord,
 *   half flip compris). Le gel se déduit de `moi.flip` et `moi.auSol`, déjà sérialisés : rien de plus en ligne.
 * - **Ball cam** : la caméra se place sur la ligne balle → voiture, derrière la voiture, et regarde la balle ; horizon toujours droit
 *   (haut du monde, même sur un mur : comme RL), suivi rigide du cap à vitesse bornée quand la balle passe au-dessus du toit, visée qui
 *   monte pour une balle haute (`elevationViseeBalle`).
 * - **Rigidité** (stiffness de RL) : elle règle l'ÉTIREMENT de la distance avec la vitesse, pas la rotation : à 0 la caméra recule de
 *   `ETIREMENT_MAX_M` à pleine vitesse, à 1 elle reste à `distance`.
 * - **Murs et anticollision** : RL ne fait aucune collision de caméra, elle passe en partie derrière les murs (devenus transparents,
 *   « Transparent Goalposts »). Ici les murs et le plafond sont additifs, translucides : la caméra peut passer jusqu'à
 *   `DEPASSEMENT_MUR_MAX_M` derrière eux (sous le retrait des gradins). Le sol et son raccord (jusqu'à `HAUT_RACCORD_OPAQUE`) sont
 *   OPAQUES : la caméra reste à `MARGE_CAMERA_M` devant, et ne les regarde jamais par-derrière. Une position interdite est PROJETÉE le
 *   long du gradient du champ de distance (la caméra glisse sur la paroi), jamais rapprochée de la voiture ; si la projection la ramène
 *   à moins de `DISTANCE_MIN_M` du centre de la caisse, le bras se relève. La caméra n'entre donc jamais dans la voiture.
 * - **Regard libre** : ±90° de lacet, ±45° de tangage autour de la voiture ; **vue arrière** : demi-tour (ball cam suspendue).
 * - **Secousse** décroissante, ignorée en mouvement réduit ; **célébration** d'un but : orbite lente (`majCameraBut`).
 *
 * Le repère est celui du stade (local). Le champ est HORIZONTAL (110° par défaut) et converti en vertical selon l'aspect.
 * Les états de lissage supplémentaires sont gardés à part de `EtatCamera` (contrat figé) dans une `WeakMap`.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 8.3
 */
import {
  BUT,
  CAMERA_DEFAUT,
  STADE,
  VOITURE,
  type Arene,
  type EntreesCamera,
  type EtatBalle,
  type EtatCamera,
  type EtatVoiture,
  type MajCamera,
  type ParamsCamera,
  type PoseCamera,
  type CreerEtatCamera,
} from "./contrat";
import {
  HAUT_MONDE,
  ajouter,
  clamp,
  croix,
  distance,
  dot,
  melanger,
  mult,
  normaliser,
  soustraire,
  tournerVec,
  type Vec3,
} from "./vec";

const D2R = Math.PI / 180;

/** Distance minimale entre la caméra et une surface OPAQUE du stade (sol et raccord de sol) (m). */
export const MARGE_CAMERA_M = 0.4;
/** Marge sous le plafond (m) : la caméra ne monte jamais au-delà de `STADE.hauteur − MARGE_PLAFOND_M`. */
export const MARGE_PLAFOND_M = 0.5;
/** Jamais plus bas que cela (m) : le sol est opaque. */
export const HAUTEUR_MIN_M = 0.35;
/** Profondeur autorisée derrière une paroi translucide (murs, plafond, filets) : sous le retrait des gradins (1,2 m). */
export const DEPASSEMENT_MUR_MAX_M = 1.0;
/** Hauteur au-dessus de laquelle les parois sont translucides : le sol et son raccord (rayon 2,56 m) sont dessinés opaques. */
export const HAUT_RACCORD_OPAQUE = STADE.rayonSol + 0.15;
/** Fondu (m) entre parois opaques et translucides : la marge exigée varie continûment, la caméra ne saute pas. */
const FONDU_TRANSLUCIDE_M = 0.6;
/** Distance minimale (m) entre la caméra et le CENTRE de la caisse : la caméra n'est jamais dans la voiture (demi-diagonale ≈ 0,76 m). */
export const DISTANCE_MIN_M = 1.3;
/** Pivot de l'anticollision au-dessus de l'origine, le long du haut de la voiture (m) : au-dessus du toit (0,40 m), hors de la caisse. */
export const PIVOT_TOIT_M = 0.55;
/** Étirement de la distance (m) à rigidité 0 et à pleine vitesse (RL : plus de 100 uu à stiffness 0), vitesse de référence (m/s). */
export const ETIREMENT_MAX_M = 1.0;
const VITESSE_ETIREMENT_MAX = 23;
const SUIVI_ETIREMENT = 3;
/** Vitesses de suivi (1/s) du repère : car cam au sol (quasi rigide), en l'air, ball cam établie, bascule d'un mode à l'autre. */
export const SUIVI_ROT_SOL = 20;
export const SUIVI_ROT_AIR = 6;
const SUIVI_BALLE = 32;
const SUIVI_BASCULE = 9;
/** Retour de l'anticollision (1/s) : la caméra se réécarte doucement une fois la paroi passée. */
const SUIVI_DEGAGEMENT = 4;
/** suivi du haut du pivot (1/s) */
const SUIVI_PIVOT = 12;
/** entrée dans le décalage imposé par une paroi (1/s) : rapide, mais sans saut */
const SUIVI_ENTREE = 14;
/** règle dure devant une paroi opaque (m) : la marge de 0,4 m peut être entamée pendant l'entrée lissée, la paroi jamais traversée */
const SEUIL_DUR_OPAQUE_M = 0.08;
/** Ball cam : la visée monte (ou descend) jusque-là pour garder la balle à l'écran. */
const ELEVATION_BALLE_MAX = 78 * D2R;
/** Ball cam : marges angulaires gardées entre la voiture et le bas de l'image, entre la balle et le haut de l'image. */
const MARGE_VOITURE = 7 * D2R;
const MARGE_BALLE = 11 * D2R;
/** Car cam : la voiture reste dans l'image, à au moins cet angle du bord, même quand la paroi a déplacé la caméra. */
const MARGE_VOITURE_CAR = 4 * D2R;
/** Ball cam : la caméra ne descend pas plus bas que cela derrière la voiture (m au-dessus du sol). */
const GARDE_SOL_M = 0.5;
/** Vitesse de rotation maximale (rad/s) du cap de la ball cam quand la balle est à la verticale de la voiture, et dans tous les cas. */
const VITESSE_CAP_PROCHE = 4;
const VITESSE_CAP_MAX = 10;
/** Élévation de la ligne qui place la caméra derrière la voiture : pas sous le sol, pas au zénith. */
const ELEVATION_POSITION_MIN = -60 * D2R;
const ELEVATION_POSITION_MAX = 20 * D2R;
/** Élévation maximale de la visée par rapport au haut de la caméra (jamais à la verticale : `lookAt` dégénérerait). */
const ELEVATION_VISEE_MAX = 80 * D2R;
/** Car cam : le point visé est à cette distance devant la voiture (m), le long de la visée idéale. */
const AVANCE_VISEE_M = 3;
/** Raccrochage après un flip : durée du fondu du gel vers le repère de la voiture (s) et vitesse de rotation maximale (rad/s). */
export const RACCROCHAGE_FLIP_S = 0.45;
export const VITESSE_RACCROCHAGE = 4;

const normaliser2 = (x: number, z: number): [number, number] => { const n = Math.hypot(x, z); return n > 1e-9 ? [x / n, z / n] : [0, 1]; };

/** `fovVertical = 2·atan(tan(fov_h / 2) / aspect)` (degrés → degrés). */
export function fovVerticalDepuisHorizontal(fovHorizontal: number, aspect: number): number {
  const a = aspect > 0.01 ? aspect : 1;
  return (2 * Math.atan(Math.tan((fovHorizontal * D2R) / 2) / a)) / D2R;
}

const lisse = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lisseEntre = (a: number, b: number, x: number): number => lisse((x - a) / (b - a));

// ============================================================================================================================
// Quaternions (repère de la caméra : avant = +Z local, haut = +Y local)
// ============================================================================================================================

type Quat = [number, number, number, number];

/** Quaternion du repère (avant `f`, haut `u`) : `u` est réorthonormalisé contre `f` (repli si parallèles). */
function quatDepuisRepere(fBrut: Readonly<Vec3>, uBrut: Readonly<Vec3>, repliHaut: Readonly<Vec3> = HAUT_MONDE): Quat {
  const f = normaliser(fBrut, [0, 0, 1]);
  let u: Vec3 = soustraire(uBrut, mult(f, dot(f, uBrut)));
  if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = soustraire(repliHaut, mult(f, dot(f, repliHaut)));
  if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = Math.abs(f[1]) < 0.9 ? soustraire(HAUT_MONDE, mult(f, f[1])) : [1, 0, 0];
  u = normaliser(u);
  const r = croix(u, f);
  // matrice de colonnes (r, u, f)
  const m00 = r[0], m01 = u[0], m02 = f[0], m10 = r[1], m11 = u[1], m12 = f[1], m20 = r[2], m21 = u[2], m22 = f[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return normaliserQ(q);
}
function normaliserQ(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/** Rotation du vecteur `v` par `q`. */
function tournerQ(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const avantQ = (q: Readonly<Quat>): Vec3 => normaliser(tournerQ(q, [0, 0, 1]), [0, 0, 1]);
const hautQ = (q: Readonly<Quat>): Vec3 => normaliser(tournerQ(q, [0, 1, 0]), HAUT_MONDE);
/** Angle (rad) de la rotation qui mène de `a` à `b`. */
function angleQ(a: Readonly<Quat>, b: Readonly<Quat>): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}
/** Interpolation sphérique, par le plus court chemin. */
function slerp(a: Readonly<Quat>, bBrut: Readonly<Quat>, t: number): Quat {
  if (t <= 0) return [a[0], a[1], a[2], a[3]];
  let d = a[0] * bBrut[0] + a[1] * bBrut[1] + a[2] * bBrut[2] + a[3] * bBrut[3];
  const b: Quat = d < 0 ? [-bBrut[0], -bBrut[1], -bBrut[2], -bBrut[3]] : [bBrut[0], bBrut[1], bBrut[2], bBrut[3]];
  if (t >= 1) return b;
  d = Math.abs(d);
  if (d > 0.9995) return normaliserQ([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return normaliserQ([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb]);
}

// ============================================================================================================================
// États annexes (hors contrat)
// ============================================================================================================================

interface Annexes {
  /** repère lissé de la caméra (avant = `e.dir`, haut = `e.haut`) */
  q: Quat | null;
  /** décalage lissé imposé par les parois (position rendue − position idéale) ; null = première image */
  decalage: Vec3 | null;
  /** étirement de la distance (rigidité), lissé (m) */
  etirement: number;
  /** phase de la secousse (rad), avancée par le temps */
  phase: number;
  /** dernière pose rendue par `majCamera` : point de départ du fondu vers la célébration */
  dernierePose: PoseCamera | null;
  /** entrée en célébration : pose de départ du fondu, azimut de départ de l'orbite, temps écoulé depuis l'entrée */
  but: { depart: PoseCamera; azimut: number; t: number; orbite: Vec3 | null } | null;
  /** cap horizontal [x, z] (unitaire) et élévation (rad) de la droite voiture → balle suivis par la ball cam (null avant la première image) */
  capBalle: [number, number] | null;
  elBalle: number;
  /** dernier cap horizontal valable de la voiture (repli de la car cam en l'air, nez à la verticale) */
  capAir: [number, number] | null;
  /** repère de la car cam gelé au départ d'un flip (null hors flip et une fois le raccrochage fini) */
  gel: Quat | null;
  /** poids du gel : 1 pendant le flip, retombe à 0 pendant le raccrochage */
  poidsGel: number;
  /** raccrochage en cours : la rotation est bornée, y compris APRÈS la fin du fondu tant que la borne mord (half flip) */
  raccrochage: boolean;
  /** haut du pivot de la caméra (au-dessus du toit), lissé ; null = première image */
  hautPivot: Vec3 | null;
}
const annexes = new WeakMap<EtatCamera, Annexes>();
function annexesDe(e: EtatCamera): Annexes {
  let a = annexes.get(e);
  if (!a) {
    a = { q: null, decalage: null, etirement: 0, phase: 0, dernierePose: null, but: null, capBalle: null, elBalle: 0, capAir: null, gel: null, poidsGel: 0, raccrochage: false, hautPivot: null };
    annexes.set(e, a);
  }
  return a;
}

// ============================================================================================================================
// Repères voulus
// ============================================================================================================================

/**
 * La voiture est en plein flip (dodge) : en l'air, flip qui tourne (pas un stall, qui ne fait que rouler sur l'axe de l'avant) et verrou de
 * tangage non écoulé (0,95 s depuis le début : couple de 0,65 s puis rotation résiduelle). Remis à faux par `majSecondSaut` dès que
 * trois roues touchent (`verrouTangage` = 0 au sol) : atterrissage, flip cancel sur le sol, balle sous les roues.
 */
export function flipEnCours(moi: Readonly<EtatVoiture>): boolean {
  return !moi.auSol && !moi.flip.stall && moi.flip.verrouTangage > 0;
}

/**
 * Cap horizontal de la car cam en l'air : celui du nez tant qu'il n'est pas à la verticale, sinon la vitesse horizontale (décollage
 * d'un mur), sinon le dernier cap valable. Passage continu de l'un à l'autre.
 */
function capEnLAir(moi: Readonly<EtatVoiture>, a: Annexes, repli: Readonly<Vec3>): Vec3 {
  const ax = moi.base.avant[0], az = moi.base.avant[2];
  const n = Math.hypot(ax, az);
  const w = lisseEntre(0.15, 0.45, n);
  const vh = Math.hypot(moi.v[0], moi.v[2]);
  let fx: number, fz: number;
  if (vh > 2) { fx = moi.v[0] / vh; fz = moi.v[2] / vh; }
  else if (a.capAir) { [fx, fz] = a.capAir; }
  else { [fx, fz] = normaliser2(repli[0], repli[2]); }
  const nx = n > 1e-9 ? ax / n : 0, nz = n > 1e-9 ? az / n : 0;
  const [cx, cz] = normaliser2(nx * w + fx * (1 - w), nz * w + fz * (1 - w));
  if (w > 0.5) a.capAir = [cx, cz];
  return [cx, 0, cz];
}

/** Repère voulu de la car cam : celui de la voiture si elle roule (sol, mur, plafond), cap du nez et haut du monde en l'air. */
function repereCar(moi: Readonly<EtatVoiture>, a: Annexes, repli: Readonly<Vec3>): Quat {
  if (moi.auSol) {
    a.capAir = moi.base.avant[1] * moi.base.avant[1] < 0.9 ? normaliser2(moi.base.avant[0], moi.base.avant[2]) : a.capAir;
    return quatDepuisRepere(moi.base.avant, moi.base.haut);
  }
  return quatDepuisRepere(capEnLAir(moi, a, repli), HAUT_MONDE);
}

/** Élévation (rad) de `d` au-dessus du plan perpendiculaire à `h`. */
const elevation = (d: Readonly<Vec3>, h: Readonly<Vec3>): number => Math.asin(clamp(dot(d, h), -1, 1));

/** Direction d'élévation `el` (rad) au-dessus du plan ⟂ `u`, de cap `f` (⟂ `u`). */
const dirElevee = (f: Readonly<Vec3>, u: Readonly<Vec3>, el: number): Vec3 => {
  const c = Math.cos(el), s = Math.sin(el);
  return [f[0] * c + u[0] * s, f[1] * c + u[1] * s, f[2] * c + u[2] * s];
};

/** Tourne `d` vers `cible` d'une fraction de l'angle qui les sépare (jamais de passage par zéro, même s'ils sont opposés). */
function tournerVers(d: Readonly<Vec3>, cible: Readonly<Vec3>, fraction: number, axeRepli: Readonly<Vec3>): Vec3 {
  const c = clamp(dot(d, cible), -1, 1);
  const angle = Math.acos(c);
  if (angle < 1e-5 || fraction >= 1) return [cible[0], cible[1], cible[2]];
  const axe = normaliser(croix(d, cible), axeRepli);
  return normaliser(tournerVec(d, axe, angle * fraction), cible);
}

/**
 * Élévation de la visée en ball cam (PURE, testée) : on regarde la balle (`elBalle`, plus l'angle de caméra qui s'efface quand la
 * balle monte) tant que la voiture reste à l'écran ; sinon on baisse la visée juste assez pour garder la voiture en bas de l'image,
 * sans jamais laisser la balle sortir par le haut : la balle passe avant la voiture.
 */
export function elevationViseeBalle(elBalle: number, elVoiture: number, demiChampV: number, angle: number): number {
  const e0 = elBalle + angle * (1 - lisseEntre(10 * D2R, 40 * D2R, Math.abs(elBalle)));
  const limiteVoiture = elVoiture + demiChampV - MARGE_VOITURE;
  const e = e0 <= limiteVoiture ? e0 : Math.max(limiteVoiture, elBalle - (demiChampV - MARGE_BALLE));
  return clamp(e, -ELEVATION_BALLE_MAX, ELEVATION_BALLE_MAX);
}

// ============================================================================================================================
// Parois : opaques (sol, raccord) ou translucides (murs, plafond, filets)
// ============================================================================================================================

/** Centre de la caisse (hitbox) en monde. */
function centreCaisse(moi: Readonly<EtatVoiture>): Vec3 {
  const [da, , dh] = VOITURE.decalageHitbox;
  return [moi.p[0] + moi.base.avant[0] * da + moi.base.haut[0] * dh, moi.p[1] + moi.base.avant[1] * da + moi.base.haut[1] * dh, moi.p[2] + moi.base.avant[2] * da + moi.base.haut[2] * dh];
}

/** Translucidité (0 opaque → 1 translucide) d'une paroi selon la hauteur de son point : continue, pour que la caméra ne saute pas. */
const translucidite = (y: number): number => lisseEntre(HAUT_RACCORD_OPAQUE, HAUT_RACCORD_OPAQUE + FONDU_TRANSLUCIDE_M, y);
/** Distance signée exigée (m) pour une translucidité `w` : 0,4 m devant une paroi opaque, jusqu'à 1 m derrière une paroi translucide. */
const seuilDe = (w: number): number => MARGE_CAMERA_M - (MARGE_CAMERA_M + DEPASSEMENT_MUR_MAX_M) * w;

/** Translucidité de la paroi la plus proche de `c`. */
function translucidePres(arene: Arene, c: Readonly<Vec3>, n: Vec3): number {
  const d = arene.sdNormale(c, n);
  return translucidite(c[1] - n[1] * d);
}

/**
 * Translucidité de la paroi que traverse le segment `de → a` (1 s'il n'en traverse aucune) : une caméra derrière un mur doit voir la
 * voiture À TRAVERS une paroi translucide, jamais à travers le sol ou son raccord.
 */
function translucideTraversee(arene: Arene, de: Readonly<Vec3>, a: Readonly<Vec3>): number {
  const N = 16;
  const p: Vec3 = [0, 0, 0];
  const sdEn = (t: number): number => { p[0] = de[0] + (a[0] - de[0]) * t; p[1] = de[1] + (a[1] - de[1]) * t; p[2] = de[2] + (a[2] - de[2]) * t; return arene.sd(p); };
  let prec = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    if (sdEn(t) >= 0) { prec = t; continue; }
    let lo = prec, hi = t;
    for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (sdEn(mid) >= 0) lo = mid; else hi = mid; }
    sdEn((lo + hi) / 2);
    return translucidite(p[1]);
  }
  return 1;
}

/** Projette `c` le long du gradient du champ de distance jusqu'à `sd ≥ seuil` (la caméra GLISSE sur la paroi), puis borne la hauteur. */
function projeter(arene: Arene, c: Vec3, seuil: number, n: Vec3): Vec3 {
  for (let i = 0; i < 8; i++) {
    const d = arene.sdNormale(c, n);
    if (d >= seuil - 1e-4) break;
    const k = seuil - d;
    c[0] += n[0] * k; c[1] += n[1] * k; c[2] += n[2] * k;
  }
  c[1] = clamp(c[1], HAUTEUR_MIN_M, STADE.hauteur - MARGE_PLAFOND_M);
  return c;
}

/** Position permise (même règle que `placerDansStade`, tolérance `tol`). */
function permise(arene: Arene, c: Readonly<Vec3>, seuil: number, centre: Readonly<Vec3>, tol: number): boolean {
  return arene.sd(c) >= seuil - tol && distance(c, centre) >= DISTANCE_MIN_M - tol && c[1] >= HAUTEUR_MIN_M - tol && c[1] <= STADE.hauteur - MARGE_PLAFOND_M + tol;
}

/**
 * Place la caméra idéale `ideal` dans le stade (PURE) : rien à faire si elle est déjà permise ; sinon projection sur la paroi (derrière
 * une paroi translucide jusqu'à 1 m si la voiture reste visible à travers elle), puis, si la caméra est revenue trop près de la caisse,
 * le bras (pivot → caméra) se relève vers `hautBras` jusqu'à retrouver sa distance. Rend la position et la marge exigée.
 */
function placerDansStade(arene: Arene, ideal: Readonly<Vec3>, pivot: Readonly<Vec3>, centre: Readonly<Vec3>, hautBras: Readonly<Vec3>): { c: Vec3; seuil: number } {
  const n: Vec3 = [0, 0, 0];
  let w = Math.min(translucidePres(arene, ideal, n), translucideTraversee(arene, pivot, ideal));
  let seuil = seuilDe(w);
  let c = projeter(arene, [ideal[0], ideal[1], ideal[2]], seuil, n);
  if (arene.sd(c) < 0) {
    // derrière une paroi : la paroi traversée par la ligne de vue doit être translucide elle aussi
    const w2 = Math.min(w, translucidePres(arene, c, n), translucideTraversee(arene, pivot, c));
    if (w2 < w - 1e-3) { w = w2; seuil = seuilDe(w); c = projeter(arene, [ideal[0], ideal[1], ideal[2]], seuil, n); }
  }
  if (arene.sd(ideal) < 0 && arene.sd(c) >= 0) {
    // projetée depuis l'intérieur d'un obstacle mince (poteau, paroi de cage, pan coupé), la caméra peut ressortir de L'AUTRE côté,
    // que la voiture ne voit pas, et changer de côté d'une image à l'autre : on la ramène alors le long du bras, devant le premier
    // obstacle, comme un bras de caméra qui bute
    const versC = soustraire(c, pivot);
    const lc = Math.hypot(versC[0], versC[1], versC[2]);
    if (lc > 1e-6) {
      const impactC = arene.lancerRayon(pivot, mult(versC, 1 / lc), lc);
      if (impactC !== null && impactC < lc - 0.05) {
        const versI = soustraire(ideal, pivot);
        const li = Math.max(Math.hypot(versI[0], versI[1], versI[2]), 1e-6);
        const dirI = mult(versI, 1 / li);
        const impactI = arene.lancerRayon(pivot, dirI, li) ?? li;
        c = projeter(arene, ajouter(pivot, mult(dirI, Math.max(impactI - MARGE_CAMERA_M, 0))), seuil, n);
      }
    }
  }
  if (distance(c, centre) >= DISTANCE_MIN_M) return { c, seuil };
  // trop près de la caisse : le bras se relève
  const bras = soustraire(ideal, pivot);
  const longueur = Math.max(Math.hypot(bras[0], bras[1], bras[2]), DISTANCE_MIN_M);
  const dir0 = normaliser(bras, hautBras);
  for (const s of [0.2, 0.4, 0.6, 0.8, 1]) {
    const d = normaliser(melanger(dir0, hautBras, s), hautBras);
    const essai = projeter(arene, ajouter(pivot, mult(d, longueur)), MARGE_CAMERA_M, n);
    if (distance(essai, centre) >= DISTANCE_MIN_M) return { c: essai, seuil: MARGE_CAMERA_M };
    c = essai;
  }
  return { c: projeter(arene, ajouter(pivot, mult(hautBras, DISTANCE_MIN_M)), MARGE_CAMERA_M, n), seuil: MARGE_CAMERA_M };
}

/** Position de la caméra derrière `moi` : `p − dirPos·distance + haut·hauteur`, sous le plafond. */
function positionIdeale(moi: Readonly<EtatVoiture>, dirPos: Readonly<Vec3>, haut: Readonly<Vec3>, distanceM: number, hauteurM: number): Vec3 {
  const pos: Vec3 = [
    moi.p[0] - dirPos[0] * distanceM + haut[0] * hauteurM,
    moi.p[1] - dirPos[1] * distanceM + haut[1] * hauteurM,
    moi.p[2] - dirPos[2] * distanceM + haut[2] * hauteurM,
  ];
  pos[1] = Math.min(pos[1], STADE.hauteur - MARGE_PLAFOND_M);
  return pos;
}

// ============================================================================================================================
// API
// ============================================================================================================================

/** Repère de la ball cam : cap horizontal vers la balle, haut du monde. */
const repereBalle = (cap: readonly [number, number]): Quat => quatDepuisRepere([cap[0], 0, cap[1]], HAUT_MONDE);

/** État initial : caméra déjà à sa place (pas de balayage au premier affichage). Aucune anticollision ici : `majCamera` s'en charge. */
export const creerEtatCamera: CreerEtatCamera = (moi, balle, balleCam) => {
  const e: EtatCamera = { dir: [0, 0, 1], haut: [0, 1, 0], melange: balleCam ? 1 : 0, regard: [0, 0], secousse: 0, position: [0, 0, 0] };
  const a = annexesDe(e);
  const enFlip = flipEnCours(moi);
  // en plein flip l'avant ne dit plus où la voiture « va » : on ne garde que son cap, à plat (comme en l'air), et on gèle ce repère
  const qCar = repereCar(moi, a, moi.base.avant);
  const versBalle = soustraire(balle.p, moi.p);
  const dh = Math.hypot(versBalle[0], versBalle[2]);
  const fCar = avantQ(qCar);
  a.capBalle = dh > 1e-3 ? [versBalle[0] / dh, versBalle[2] / dh] : normaliser2(fCar[0], fCar[2]);
  a.elBalle = Math.atan2(versBalle[1], Math.max(dh, 1e-6));
  a.q = balleCam ? repereBalle(a.capBalle) : qCar;
  if (enFlip) { a.gel = qCar; a.poidsGel = 1; }
  e.dir = avantQ(a.q);
  e.haut = hautQ(a.q);
  e.position = positionIdeale(moi, e.dir, e.haut, CAMERA_DEFAUT.distance, CAMERA_DEFAUT.hauteur);
  return e;
};

/** Ajoute une secousse (m) : la plus forte en cours l'emporte. Sans effet en mouvement réduit (`majCamera` la remet à zéro). */
export function ajouterSecousse(e: EtatCamera, metres: number): void {
  if (metres > e.secousse) e.secousse = Math.min(metres, 0.35);
}

/** Décalage de secousse déterministe (sinusoïdes incommensurables sur la phase), pas de hasard. */
function decalageSecousse(a: Annexes, amplitude: number): Vec3 {
  if (amplitude < 1e-4) return [0, 0, 0];
  const f = a.phase;
  return [Math.sin(f * 1.73) * amplitude, Math.sin(f * 2.31 + 1.1) * amplitude, Math.sin(f * 1.17 + 2.3) * amplitude];
}

/**
 * Une image de caméra. `dt` est le temps réel de l'image (s) ; `moi` et `balle` sont les états à afficher (le jeu passe l'état
 * INTERPOLÉ entre deux pas physiques, sinon la caméra tremble par rapport à la voiture dessinée).
 */
export const majCamera: MajCamera = (e, p, entree: EntreesCamera, moi, balle, arene, dtBrut, aspect, mouvementReduit) => {
  const a = annexesDe(e);
  a.but = null;
  const dt = clamp(Number.isFinite(dtBrut) ? dtBrut : 0, 0, 0.1);
  const rig = clamp(p.rigidite, 0, 1);
  const fovV = fovVerticalDepuisHorizontal(p.fov, aspect);
  const demiV = (fovV * D2R) / 2;
  if (!a.q) a.q = quatDepuisRepere(e.dir, e.haut);

  // 1. car cam ↔ ball cam
  const balleVoulue = entree.balleCam && !entree.arriere;
  const vitesse = clamp(p.vitesseTransition, 0.5, 4) * 2.5;
  e.melange = clamp(e.melange + clamp((balleVoulue ? 1 : 0) - e.melange, -vitesse * dt, vitesse * dt), 0, 1);
  const m = lisse(e.melange);

  // 2. repère voulu de la car cam (voiture au sol, cap du nez en l'air), gelé pendant un flip puis raccroché en douceur
  const qVoiture = repereCar(moi, a, avantQ(a.q));
  if (flipEnCours(moi)) {
    if (!a.gel || a.poidsGel < 1) a.gel = [a.q[0], a.q[1], a.q[2], a.q[3]];
    a.poidsGel = 1;
    a.raccrochage = false;
  } else if (a.gel) {
    a.poidsGel -= dt / RACCROCHAGE_FLIP_S;
    if (a.poidsGel <= 0) { a.gel = null; a.poidsGel = 0; }
    a.raccrochage = true;
  }
  const qCar = !a.gel ? qVoiture : a.poidsGel >= 1 ? a.gel : slerp(a.gel, qVoiture, 1 - lisse(a.poidsGel));

  // 3. ball cam : cap (horizontal) et élévation de la droite voiture → balle, suivis séparément ; quand la balle passe au-dessus du
  //    toit, le cap se retourne d'un coup, la caméra fait le tour de la voiture à vitesse bornée au lieu de sauter de l'autre côté
  const versBalle = soustraire(balle.p, moi.p);
  const dBalle = Math.hypot(versBalle[0], versBalle[1], versBalle[2]);
  const dHorizontale = Math.hypot(versBalle[0], versBalle[2]);
  const elBalleBrute = Math.atan2(versBalle[1], Math.max(dHorizontale, 1e-6));
  if (!a.capBalle) {
    const f = avantQ(qCar);
    a.capBalle = dHorizontale > 1e-3 ? [versBalle[0] / dHorizontale, versBalle[2] / dHorizontale] : normaliser2(f[0], f[2]);
    a.elBalle = elBalleBrute;
  } else {
    if (dHorizontale > 1e-3) {
      const cx = versBalle[0] / dHorizontale, cz = versBalle[2] / dHorizontale;
      const ecart = Math.atan2(a.capBalle[1] * cx - a.capBalle[0] * cz, a.capBalle[0] * cx + a.capBalle[1] * cz);
      const proche = lisseEntre(0.5, 4, dHorizontale);
      const pas = Math.min(Math.abs(ecart) * (1 - Math.exp(-dt * SUIVI_BALLE)), (VITESSE_CAP_PROCHE + (VITESSE_CAP_MAX - VITESSE_CAP_PROCHE) * proche) * dt);
      const r = ecart >= 0 ? pas : -pas, c = Math.cos(r), sn = Math.sin(r);
      a.capBalle = normaliser2(a.capBalle[0] * c + a.capBalle[1] * sn, a.capBalle[1] * c - a.capBalle[0] * sn);
    }
    a.elBalle += (elBalleBrute - a.elBalle) * (1 - Math.exp(-dt * SUIVI_BALLE));
  }
  const qBalle = repereBalle(a.capBalle);

  // 4. UNE rotation lissée vers le repère voulu (mélange des deux modes) ; ball cam établie : rigide
  const arrive = balleVoulue ? m : 1 - m;
  if (balleVoulue && arrive > 0.999) { a.q = qBalle; a.raccrochage = false; }
  else {
    const qCible = slerp(qCar, qBalle, m);
    const kMode = balleVoulue ? SUIVI_BALLE : moi.auSol && !a.gel ? SUIVI_ROT_SOL : SUIVI_ROT_AIR;
    const k = SUIVI_BASCULE + (kMode - SUIVI_BASCULE) * arrive;
    let fraction = 1 - Math.exp(-dt * k);
    // raccrochage d'un flip : jamais plus vite que `VITESSE_RACCROCHAGE`, quel que soit l'écart (atterrissage nez en l'air, correction
    // du réseau, half flip) ; la borne reste après le fondu tant qu'elle mord, et se lève d'elle-même quand le suivi devient plus lent
    if (a.raccrochage) {
      const angle = angleQ(a.q, qCible);
      const borne = angle > 1e-5 ? (VITESSE_RACCROCHAGE * dt) / angle : 1;
      if (borne < fraction) fraction = borne;
      else if (!a.gel) a.raccrochage = false;
    }
    a.q = slerp(a.q, qCible, fraction);
  }
  const f = avantQ(a.q);
  const u = hautQ(a.q);
  e.dir = f;
  e.haut = u;

  // 5. regard libre (angles lissés) ; la vue arrière est un demi-tour
  const lacetVoulu = entree.arriere ? Math.PI : clamp(entree.regard[0], -1, 1) * (Math.PI / 2);
  const tangageVoulu = clamp(entree.regard[1], -1, 1) * (Math.PI / 4);
  const ar = 1 - Math.exp(-dt * clamp(p.vitesseRegard, 1, 10) * 1.6);
  e.regard[0] += (lacetVoulu - e.regard[0]) * ar;
  e.regard[1] += (tangageVoulu - e.regard[1]) * ar;
  // tourner à droite = rotation NÉGATIVE autour du haut (convention du contrat)
  const fR = Math.abs(e.regard[0]) > 1e-6 ? tournerVec(f, u, -e.regard[0]) : f;

  // 6. rigidité = étirement de la distance avec la vitesse (stiffness de RL)
  const vAvant = Math.max(0, dot(moi.v, f));
  const etirCible = (1 - rig) * ETIREMENT_MAX_M * clamp(vAvant / VITESSE_ETIREMENT_MAX, 0, 1);
  a.etirement += (etirCible - a.etirement) * (1 - Math.exp(-dt * SUIVI_ETIREMENT));
  const dEff = p.distance + a.etirement;

  // 7. position idéale : RL, `p − avant·distance + haut·hauteur` ; en ball cam la ligne de placement suit l'élévation de la balle
  //    (balle haute : la caméra descend derrière la voiture jusqu'à 0,5 m du sol ; balle basse : elle monte)
  const elSol = Math.asin(clamp((moi.p[1] + p.hauteur - GARDE_SOL_M) / Math.max(dEff, 0.5), Math.sin(5 * D2R), Math.sin(ELEVATION_BALLE_MAX)));
  const elPosMax = ELEVATION_POSITION_MAX + (elSol - ELEVATION_POSITION_MAX) * m;
  const elPos = clamp(m * clamp(a.elBalle, ELEVATION_POSITION_MIN, elSol) + e.regard[1], ELEVATION_POSITION_MIN, elPosMax);
  const ideal = positionIdeale(moi, dirElevee(fR, u, elPos), u, dEff, p.hauteur);

  // 8. parois : la caméra glisse sur le sol, passe derrière un mur translucide, ne rentre jamais dans la voiture
  // haut du pivot lissé : le contact des roues avec un mur clignote (auSol vrai / faux d'une image à l'autre en montant un poteau ou la
  // paroi de la cage), le pivot sautait de 0,5 m et la caméra changeait de côté de l'obstacle
  const hautVoulu = moi.auSol ? moi.base.haut : HAUT_MONDE;
  a.hautPivot = a.hautPivot ? tournerVers(a.hautPivot, hautVoulu, 1 - Math.exp(-dt * SUIVI_PIVOT), croix(hautVoulu, f)) : [hautVoulu[0], hautVoulu[1], hautVoulu[2]];
  const hautVoiture = a.hautPivot;
  const pivot = ajouter(moi.p, mult(hautVoiture, PIVOT_TOIT_M));
  pivot[1] = Math.min(pivot[1], STADE.hauteur - 0.05);
  const centre = centreCaisse(moi);
  const place = placerDansStade(arene, ideal, pivot, centre, hautVoiture);
  const voulu = soustraire(place.c, ideal);
  if (!a.decalage) a.decalage = voulu;
  else {
    // sortie en douceur ; entrée rapide mais lissée elle aussi (un poteau, un pan coupé ou la cage déplaçaient la caméra de plusieurs
    // mètres en une image) : le décalage n'est pris d'un coup que dans la mesure où il le faut pour tenir les règles DURES (jamais
    // dans la voiture, jamais dans une paroi opaque, jamais plus d'1 m derrière une paroi translucide) ; la marge de 0,4 m devant une
    // paroi, elle, peut être entamée le temps de quelques images
    const lisseDec = melanger(a.decalage, voulu, 1 - Math.exp(-dt * SUIVI_DEGAGEMENT));
    if (permise(arene, ajouter(ideal, lisseDec), place.seuil, centre, 0.02)) a.decalage = lisseDec;
    else {
      // entrée rapide, puis les règles dures tenues en POUSSANT la caméra depuis là où elle est (projection peu profonde, éloignement
      // radial de la caisse) : jamais un mélange en ligne droite vers la place voulue, qui traverse le poteau ou la paroi d'en face
      const c = ajouter(ideal, melanger(a.decalage, voulu, 1 - Math.exp(-dt * SUIVI_ENTREE)));
      const seuilDur = Math.min(place.seuil, SEUIL_DUR_OPAQUE_M);
      const nTmp: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3 && !permise(arene, c, seuilDur, centre, 0.02); k++) {
        if (arene.sd(c) < seuilDur) projeter(arene, c, seuilDur, nTmp);
        const dc = distance(c, centre);
        if (dc < DISTANCE_MIN_M) {
          const dir = dc > 1e-6 ? mult(soustraire(c, centre), 1 / dc) : hautVoiture;
          c[0] = centre[0] + dir[0] * DISTANCE_MIN_M; c[1] = centre[1] + dir[1] * DISTANCE_MIN_M; c[2] = centre[2] + dir[2] * DISTANCE_MIN_M;
        }
        c[1] = clamp(c[1], HAUTEUR_MIN_M, STADE.hauteur - MARGE_PLAFOND_M);
      }
      a.decalage = permise(arene, c, seuilDur, centre, 0.03) ? soustraire(c, ideal) : voulu;
    }
  }
  const pos = ajouter(ideal, a.decalage);
  pos[1] = clamp(pos[1], HAUTEUR_MIN_M, STADE.hauteur - MARGE_PLAFOND_M);

  // 9. visée. Car cam : tangage = `angle` (+ regard), vers un point devant la voiture le long de la visée idéale (si la paroi a déplacé
  //    la caméra, elle continue de viser ce point) ; ball cam : la balle, la voiture gardée à l'écran tant que possible
  const vueCar = dirElevee(fR, u, p.angle * D2R + e.regard[1]);
  const cibleCar = ajouter(ideal, mult(vueCar, Math.max(dot(soustraire(moi.p, ideal), vueCar), 0) + AVANCE_VISEE_M));
  const cibleBalle = ajouter(moi.p, mult(dirElevee(fR, u, a.elBalle + e.regard[1]), Math.max(dBalle, 3)));
  const cible = melanger(cibleCar, cibleBalle, m);
  const brut = normaliser(soustraire(cible, pos), fR);
  const sH = dot(brut, u);
  const hor = normaliser([brut[0] - u[0] * sH, brut[1] - u[1] * sH, brut[2] - u[2] * sH], fR);
  const elCar = elevation(normaliser(soustraire(cibleCar, pos), fR), u);
  const elVoiture = elevation(normaliser(soustraire(moi.p, pos), fR), u);
  const elB = elevationViseeBalle(elevation(normaliser(soustraire(cibleBalle, pos), fR), u), elVoiture, demiV, p.angle * D2R);
  const el = clamp(elCar + (elB - elCar) * m, -ELEVATION_VISEE_MAX, ELEVATION_VISEE_MAX);
  let regard = dirElevee(hor, u, el);
  // la voiture ne sort pas de l'image (caméra poussée par une paroi, champ étroit, ball cam au pied d'un mur) : la visée tourne vers
  // elle juste assez ; en ball cam, jamais au point de faire sortir la balle (la balle passe avant la voiture)
  {
    const versVoiture = normaliser(soustraire(centre, pos), regard);
    const alpha = Math.acos(clamp(dot(regard, versVoiture), -1, 1));
    const limite = demiV - MARGE_VOITURE_CAR;
    if (alpha > limite && alpha > 1e-6) {
      const axe = croix(u, regard);
      const versBalleCam = normaliser(soustraire(balle.p, pos), regard);
      const ecartBalle = (r: Readonly<Vec3>): number => Math.acos(clamp(dot(r, versBalleCam), -1, 1));
      const limiteBalle = Math.max(ecartBalle(regard), Math.PI + (demiV - MARGE_BALLE - Math.PI) * m);
      let t = (alpha - limite) / alpha;
      if (ecartBalle(tournerVers(regard, versVoiture, t, axe)) > limiteBalle) {
        let lo = 0, hi = t;
        for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (ecartBalle(tournerVers(regard, versVoiture, mid, axe)) > limiteBalle) hi = mid; else lo = mid; }
        t = lo;
      }
      regard = tournerVers(regard, versVoiture, t, axe);
      const elR = elevation(regard, u);
      if (Math.abs(elR) > ELEVATION_VISEE_MAX) {
        const h2 = normaliser(soustraire(regard, mult(u, dot(regard, u))), hor);
        regard = dirElevee(h2, u, clamp(elR, -ELEVATION_VISEE_MAX, ELEVATION_VISEE_MAX));
      }
    }
  }

  // la balle passe avant la voiture, même quand une paroi a poussé la caméra : en ball cam, si elle est sortie du cadre (vertical, le
  // plus étroit), la visée tourne vers elle juste assez pour la ramener, au prix de la voiture s'il le faut
  if (m > 1e-3) {
    const versBalleCam = normaliser(soustraire(balle.p, pos), regard);
    const ecart = Math.acos(clamp(dot(regard, versBalleCam), -1, 1));
    const limite = Math.PI + (demiV - MARGE_BALLE - Math.PI) * m;
    if (ecart > limite && ecart > 1e-6) regard = tournerVers(regard, versBalleCam, (ecart - limite) / ecart, croix(u, regard));
  }

  // 10. secousse (jamais en mouvement réduit) : elle déplace la caméra ET son point visé, l'image tremble sans tourner
  if (mouvementReduit) e.secousse = 0;
  else {
    a.phase += dt * 55;
    const s = decalageSecousse(a, e.secousse);
    pos[0] += s[0]; pos[1] += s[1]; pos[2] += s[2];
    e.secousse *= Math.exp(-dt * 9);
    if (e.secousse < 1e-4) e.secousse = 0;
  }

  e.position = pos;
  const pose: PoseCamera = {
    position: pos,
    cible: ajouter(pos, mult(regard, Math.max(p.distance * 3, 6))),
    haut: [u[0], u[1], u[2]],
    fovVertical: fovV,
  };
  a.dernierePose = pose;
  return pose;
};

// ============================================================================================================================
// Célébration d'un but
// ============================================================================================================================

/** Rayon, hauteur et vitesse (rad/s) de l'orbite de la célébration. */
/** Recul de l'orbite devant la première paroi (m) et lissage de son point (1/s). */
const DEGAGEMENT_ORBITE_M = 0.6;
const SUIVI_ORBITE_BUT = 5;
/** vitesse maximale du point de l'orbite (m/s) : jamais de saut, même quand le point dégagé change d'un coup */
const VITESSE_ORBITE_BUT_MAX = 15;
/**
 * Point du segment `de → a` le plus loin de `de` encore dégagé (arrêté `DEGAGEMENT_ORBITE_M` avant la première paroi), `de` étant dans
 * le stade. Sert à l'orbite de la célébration : la caméra (et le centre qu'elle suit, de la balle vers le marqueur) ne passe jamais
 * derrière une paroi.
 */
function pointLibre(arene: Arene, de: Readonly<Vec3>, a: Readonly<Vec3>): Vec3 {
  const d = soustraire(a, de);
  const longueur = Math.hypot(d[0], d[1], d[2]);
  if (longueur < 1e-6) return [a[0], a[1], a[2]];
  const dir = mult(d, 1 / longueur);
  const impact = arene.lancerRayon(de, dir, longueur);
  return impact === null ? [a[0], a[1], a[2]] : ajouter(de, mult(dir, Math.max(impact - DEGAGEMENT_ORBITE_M, 0)));
}

/**
 * Centre suivi par l'orbite, de la balle (`k` = 0) au marqueur (`k` = 1). Balle au fond d'une cage : le centre sort d'abord par la bouche
 * du but (point juste devant la ligne, dans l'ouverture), puis rejoint le marqueur ; en ligne droite, il traversait la paroi de la cage.
 */
function versMarqueur(balle: Readonly<Vec3>, marqueur: Readonly<Vec3>, k: number): Vec3 {
  if (Math.abs(balle[2]) <= STADE.demiLongueur) return melanger(balle, marqueur, k);
  const bouche: Vec3 = [
    clamp(balle[0], -(BUT.demiLargeur - 1.5), BUT.demiLargeur - 1.5),
    clamp(balle[1], 1, BUT.hauteur - 1.5),
    Math.sign(balle[2]) * (STADE.demiLongueur - 0.5),
  ];
  return k < 0.5 ? melanger(balle, bouche, k * 2) : melanger(bouche, marqueur, k * 2 - 1);
}

export const ORBITE_BUT = {
  rayon: 13, hauteur: 3.4, vitesse: 0.45, fonduS: 0.5, versMarqueurDebutS: 0.9, versMarqueurFinS: 1.9,
  /** balle à moins de `approcheCageM` de la ligne de but (ou dedans) : l'orbite devient un balancement de ±`balancementRad` devant la cage */
  approcheCageM: 4, balancementRad: 0.75,
  /** centre du balancement ramené à ±`centreCageXM` en X : le rayon balle → caméra passe par la bouche du but, loin des poteaux */
  centreCageXM: 3,
} as const;

/**
 * Caméra de la phase « but » (et de la fin de partie) : fondu depuis la dernière pose de jeu vers une orbite lente autour de la balle,
 * qui glisse vers le marqueur au bout de ~2 s. `tempsPhase` est le temps écoulé dans la phase (s). En mouvement réduit, point de vue
 * fixe (pas de rotation, pas de secousse). L'orbite est projetée dans le stade le long du gradient (elle glisse sur les murs).
 */
export function majCameraBut(
  e: EtatCamera, p: Readonly<ParamsCamera>, balle: Readonly<EtatBalle>, marqueur: Readonly<EtatVoiture> | null,
  arene: Arene, tempsPhase: number, dtBrut: number, aspect: number, mouvementReduit: boolean,
): PoseCamera {
  const a = annexesDe(e);
  const dt = clamp(Number.isFinite(dtBrut) ? dtBrut : 0, 0, 0.1);
  const centreBalle = balle.p;
  if (!a.but) {
    const depart: PoseCamera = a.dernierePose ?? { position: e.position, cible: centreBalle, haut: e.haut, fovVertical: fovVerticalDepuisHorizontal(p.fov, aspect) };
    a.but = { depart, azimut: Math.atan2(depart.position[0] - centreBalle[0], depart.position[2] - centreBalle[2]), t: 0, orbite: null };
  }
  a.but.t += dt;
  const centre = marqueur ? versMarqueur(centreBalle, marqueur.p, lisseEntre(ORBITE_BUT.versMarqueurDebutS, ORBITE_BUT.versMarqueurFinS, tempsPhase)) : centreBalle;
  // orbite autour de la balle ; balle au fond d'une cage (ou à son entrée) : la caméra ne fait plus le tour (la moitié de l'orbite
  // tomberait derrière la cage), elle BALANCE devant la bouche du but, du côté du terrain, à la même vitesse angulaire
  const tOrbite = mouvementReduit ? 0 : ORBITE_BUT.vitesse * tempsPhase;
  const azTour = a.but.azimut + tOrbite;
  const wCage = lisseEntre(STADE.demiLongueur - ORBITE_BUT.approcheCageM, STADE.demiLongueur, Math.abs(centre[2]));
  const ideal: Vec3 = [centre[0] + Math.sin(azTour) * ORBITE_BUT.rayon, centre[1] + ORBITE_BUT.hauteur, centre[2] + Math.cos(azTour) * ORBITE_BUT.rayon];
  if (wCage > 0) {
    // mélange des POSITIONS (continu), pas des angles : l'écart d'angle repasse par ±π à chaque tour et ferait sauter la caméra
    const azFace = centre[2] >= 0 ? Math.PI : 0;
    const amp = ORBITE_BUT.balancementRad;
    const ecartDepart = Math.atan2(Math.sin(a.but.azimut - azFace), Math.cos(a.but.azimut - azFace));
    const azBalance = azFace + amp * Math.sin(Math.asin(clamp(ecartDepart / amp, -1, 1)) + tOrbite / amp);
    const xMax = ORBITE_BUT.centreCageXM;
    const xBalance = clamp(centre[0], -xMax, xMax) + Math.sin(azBalance) * ORBITE_BUT.rayon;
    const zBalance = centre[2] + Math.cos(azBalance) * ORBITE_BUT.rayon;
    ideal[0] += (xBalance - ideal[0]) * wCage;
    ideal[2] += (zBalance - ideal[2]) * wCage;
  }
  ideal[1] = Math.min(ideal[1], STADE.hauteur - MARGE_PLAFOND_M);
  // le point de l'orbite s'arrête avant la première paroi, le long du rayon balle → orbite (jamais projeté depuis l'intérieur de la
  // matière : derrière une cage, le gradient bascule d'une image à l'autre entre la cage et le stade et la caméra se téléportait)
  // ancre de l'orbite : le centre suivi s'il est dans le stade, sinon (le centre glisse de la balle au fond de la cage vers le marqueur
  // et traverse une paroi) le dernier point dégagé entre la balle et lui
  const centreHaut: Vec3 = [centre[0], centre[1] + 0.3, centre[2]];
  const ancre = arene.sd(centreHaut) >= MARGE_CAMERA_M ? centreHaut : pointLibre(arene, [centreBalle[0], centreBalle[1] + 0.3, centreBalle[2]], centreHaut);
  const visee = pointLibre(arene, ancre, ideal);
  // puis lissé : si le rayon passe d'un côté d'un obstacle à l'autre, la longueur libre change d'un coup ; la caméra la rejoint en
  // douceur au lieu de sauter
  if (!a.but.orbite) a.but.orbite = visee;
  else {
    const pas = mult(soustraire(visee, a.but.orbite), 1 - Math.exp(-dt * SUIVI_ORBITE_BUT));
    const n = Math.hypot(pas[0], pas[1], pas[2]), nMax = VITESSE_ORBITE_BUT_MAX * dt;
    a.but.orbite = ajouter(a.but.orbite, n > nMax ? mult(pas, nMax / n) : pas);
  }
  const orbite: Vec3 = [a.but.orbite[0], a.but.orbite[1], a.but.orbite[2]];
  orbite[1] = clamp(orbite[1], HAUTEUR_MIN_M, STADE.hauteur - MARGE_PLAFOND_M);
  const fondu = lisse(a.but.t / ORBITE_BUT.fonduS);
  const pos = melanger(a.but.depart.position, orbite, fondu);
  const cible = melanger(a.but.depart.cible, [centre[0], centre[1] + 0.6, centre[2]], fondu);
  // le haut TOURNE vers celui du monde (autour de l'axe de visée s'il est opposé : car cam au plafond), jamais un mélange linéaire qui
  // passerait par le vecteur nul et retournerait l'horizon d'un coup à mi-fondu
  const axeVisee = normaliser(soustraire(a.but.depart.cible, a.but.depart.position), [0, 0, 1]);
  const haut = tournerVers(normaliser(a.but.depart.haut, HAUT_MONDE), HAUT_MONDE, fondu, axeVisee);
  e.position = pos;
  e.haut = haut;
  e.dir = normaliser(soustraire(cible, pos), e.dir);
  a.q = null;
  a.decalage = null;
  a.hautPivot = null;
  e.secousse = 0;
  return { position: pos, cible, haut, fovVertical: fovVerticalDepuisHorizontal(p.fov, aspect) };
}

/** Distance caméra → voiture (m), pour les tests et le réglage. */
export const distanceCameraVoiture = (pose: Readonly<PoseCamera>, moi: Readonly<EtatVoiture>): number => distance(pose.position, moi.p);
/** Distance caméra → centre de la caisse (m) : jamais sous `DISTANCE_MIN_M` (hors coupure franche). */
export const distanceCameraCaisse = (pose: Readonly<PoseCamera>, moi: Readonly<EtatVoiture>): number => distance(pose.position, centreCaisse(moi));
