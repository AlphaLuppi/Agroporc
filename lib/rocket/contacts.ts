/**
 * Rocket Muche : contacts voiture ↔ balle et voiture ↔ voiture (module C, seconde moitié).
 *
 * Voiture ↔ balle (spec § 5.9) : boîte orientée (la hitbox de l'Octane) contre sphère. La balle est repoussée hors de la boîte, puis
 * deux impulsions s'ajoutent comme dans Rocket League :
 *  1. un choc PHYSIQUE (masses 180 / 30, restitution 0 (RocketSim), inertie de la voiture pour le couple qu'elle reçoit, frottement tangentiel
 *     faible qui donne du spin à la balle) ;
 *  2. l'impulsion SUPPLÉMENTAIRE de Psyonix : direction = vecteur centre de hitbox → balle, composante verticale × 0,35 et composante
 *     le long de l'avant × 0,65 ; intensité = vitesse relative (plafonnée à 46 m/s) × courbe `CONTACT_BALLE.courbeImpulsion`. C'est elle
 *     qui rend les frappes plus longues qu'un choc physique et qui fait monter la balle prise par dessous. Elle n'est pas rejouée tant
 *     que le contact précédent date de moins de 0,1 s : une balle posée sur le toit (dribble) ne part pas en l'air.
 *
 * Voiture ↔ voiture (spec § 5.10) : SAT des deux boîtes orientées (15 axes), séparation, impulsion avec rotation (restitution 0,1,
 * frottement 0,3), BUMP (la plus lente des deux reçoit un surcroît de vitesse) et détection de la DÉMOLITION : l'attaquant est
 * supersonique, la victime est d'une autre équipe et le point de contact est dans l'angle avant de l'attaquant. Ce module ne marque
 * JAMAIS une voiture démolie : il rend `demolition` et `match.ts` applique.
 *
 * Flip reset : en l'air, quand les quatre roues touchent la balle (`rouesSurLaBalle`), le second saut est rendu et la fenêtre de 1,25 s
 * repart de zéro (aucun événement : le contrat n'en a pas ; le HUD peut appeler `rouesSurLaBalle`).
 *
 * Fidélité : courbe de l'impulsion et échelles 0,35 / 0,65 [RL] ; restitution du choc physique, frottement et inertie [~] ; démolition
 * [RL] (supersonique, 3 s) ; bump [~].
 *
 * Pur et déterministe, sans allocation hors des objets de résultat.
 *
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§ 5.9, § 5.10)
 */
import {
  BALLE,
  CONTACT_BALLE,
  CONTACT_VOITURES,
  PAS_S,
  VOITURE,
  interpolerTable,
  type ContactBalle,
  type ContactEntreVoitures,
  type ContactVoitureBalle,
  type EtatVoiture,
  type Vec3,
} from "./contrat";
import { DEMI_HITBOX, RAYON_ENGLOBANT, appliquerImpulsion, inverseMasseEffective, vitessePointDans } from "./voiture";

const [HX, HY, HZ] = DEMI_HITBOX;
const DEC = VOITURE.decalageHitbox;
const R = BALLE.rayon;
const MB = BALLE.masse;
/** Inertie d'une sphère pleine : `0,4·m·r²`. */
const IB = BALLE.facteurInertie * MB * R * R;

/** Frottement de Coulomb du choc voiture ↔ balle (RL : 2, le glissement est plafonné par `vt / raideur`, donc stable). */
const FROTTEMENT_BALLE = CONTACT_BALLE.frottement;
/** Délai entre deux impulsions de Psyonix pour une même voiture, en pas. */
const DELAI_IMPULSION_PAS = Math.round(CONTACT_BALLE.delaiImpulsionS / PAS_S);
const DELAI_BUMP_PAS = Math.round(CONTACT_VOITURES.bumpDelaiS / PAS_S);
/** Un bump exige une vitesse de rapprochement d'au moins ceci (m/s). */
const BUMP_RAPPROCHEMENT_MIN = 1;
/** Une démolition exige que l'attaquant fonce vers sa victime d'au moins ceci (m/s). */
const DEMO_RAPPROCHEMENT_MIN = 2;
/** Les axes de produit vectoriel ne sont retenus que s'ils pénètrent nettement moins que le meilleur axe de face. */
const BIAIS_ARETES = 1.05;

// ---- tampons ----
const C: Vec3 = [0, 0, 0];
const N: Vec3 = [0, 0, 0];
const PT: Vec3 = [0, 0, 0];
const RC: Vec3 = [0, 0, 0];
const RB: Vec3 = [0, 0, 0];
const UREL: Vec3 = [0, 0, 0];
const TAN: Vec3 = [0, 0, 0];
const DIR: Vec3 = [0, 0, 0];

const dot3 = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** Centre de la hitbox, écrit dans `out`. */
function centreDans(out: Vec3, v: Readonly<EtatVoiture>): Vec3 {
  const { avant, droite, haut } = v.base;
  out[0] = v.p[0] + avant[0] * DEC[0] + droite[0] * DEC[1] + haut[0] * DEC[2];
  out[1] = v.p[1] + avant[1] * DEC[0] + droite[1] * DEC[1] + haut[1] * DEC[2];
  out[2] = v.p[2] + avant[2] * DEC[0] + droite[2] * DEC[1] + haut[2] * DEC[2];
  return out;
}

// ============================================================================================================================
// Voiture ↔ balle
// ============================================================================================================================

/**
 * Vrai si les QUATRE roues touchent la balle (centre de chaque roue à moins de `rayon de balle + rayon de roue + marge` du centre de
 * la balle) : la voiture est « posée » sur la balle, c'est le FLIP RESET. Sert aussi au HUD.
 */
export function rouesSurLaBalle(v: Readonly<EtatVoiture>, bp: Readonly<Vec3>): boolean {
  const { avant, droite, haut } = v.base;
  for (let i = 0; i < 4; i++) {
    const roue = VOITURE.roues[i];
    const lx = roue.local[0], ly = roue.local[1], lz = roue.local[2];
    const dx = v.p[0] + avant[0] * lx + droite[0] * ly + haut[0] * lz - bp[0];
    const dy = v.p[1] + avant[1] * lx + droite[1] * ly + haut[1] * lz - bp[1];
    const dz = v.p[2] + avant[2] * lx + droite[2] * ly + haut[2] * lz - bp[2];
    const lim = R + roue.rayon + VOITURE.margeContactRoue;
    if (dx * dx + dy * dy + dz * dz > lim * lim) return false;
  }
  return true;
}

/**
 * Contact de la hitbox orientée avec la balle. Rend null sans contact (ou si la voiture est démolie). `force` est la vitesse relative
 * balle / voiture AVANT le choc ; `point` est le point de la hitbox touché. Ne modifie ni `balle.dernierToucheur` ni les statistiques.
 */
export const contactVoitureBalle: ContactVoitureBalle = (v, b, tick, _dt) => {
  if (v.demolie) return null;
  const { avant, droite, haut } = v.base;
  centreDans(C, v);
  const dx = b.p[0] - C[0], dy = b.p[1] - C[1], dz = b.p[2] - C[2];
  if (dx * dx + dy * dy + dz * dz > (RAYON_ENGLOBANT + R) * (RAYON_ENGLOBANT + R)) return null;
  // flip reset : en l'air, les quatre roues sur la balle rendent le second saut (et rouvrent la fenêtre de 1,25 s)
  if (!v.auSol && v.rouesContact === 0 && rouesSurLaBalle(v, b.p)) {
    v.saut.secondUtilise = false;
    v.saut.tempsEnLAir = 0;
    v.saut.tenue = false;
  }
  // centre de la balle dans le repère de la hitbox, point le plus proche de la boîte
  const lx = dx * avant[0] + dy * avant[1] + dz * avant[2];
  const ly = dx * droite[0] + dy * droite[1] + dz * droite[2];
  const lz = dx * haut[0] + dy * haut[1] + dz * haut[2];
  const cx = clamp(lx, -HX, HX), cy = clamp(ly, -HY, HY), cz = clamp(lz, -HZ, HZ);
  let nx = lx - cx, ny = ly - cy, nz = lz - cz;
  let dist = Math.hypot(nx, ny, nz);
  let px = cx, py = cy, pz = cz;
  if (dist >= R) return null;
  if (dist < 1e-9) {
    // centre de la balle DANS la boîte : on la sort par la face la plus proche
    const ex = HX - Math.abs(lx), ey = HY - Math.abs(ly), ez = HZ - Math.abs(lz);
    nx = 0; ny = 0; nz = 0;
    if (ex <= ey && ex <= ez) { nx = lx >= 0 ? 1 : -1; px = nx * HX; dist = -ex; }
    else if (ey <= ez) { ny = ly >= 0 ? 1 : -1; py = ny * HY; dist = -ey; }
    else { nz = lz >= 0 ? 1 : -1; pz = nz * HZ; dist = -ez; }
  } else {
    nx /= dist; ny /= dist; nz /= dist;
  }
  // normale monde (de la voiture vers la balle) et point de contact monde
  N[0] = avant[0] * nx + droite[0] * ny + haut[0] * nz;
  N[1] = avant[1] * nx + droite[1] * ny + haut[1] * nz;
  N[2] = avant[2] * nx + droite[2] * ny + haut[2] * nz;
  PT[0] = C[0] + avant[0] * px + droite[0] * py + haut[0] * pz;
  PT[1] = C[1] + avant[1] * px + droite[1] * py + haut[1] * pz;
  PT[2] = C[2] + avant[2] * px + droite[2] * py + haut[2] * pz;
  const profondeur = R - dist;
  const point: Vec3 = [PT[0], PT[1], PT[2]];

  // vitesses avant le choc
  RC[0] = PT[0] - v.p[0]; RC[1] = PT[1] - v.p[1]; RC[2] = PT[2] - v.p[2];
  RB[0] = PT[0] - b.p[0]; RB[1] = PT[1] - b.p[1]; RB[2] = PT[2] - b.p[2];
  const rel = vitesseRelative(v, b);
  const force = Math.hypot(rel[0], rel[1], rel[2]);
  const vn = dot3(rel, N);
  // vitesse relative des centres (pour l'impulsion de Psyonix)
  const rvx = b.v[0] - v.v[0], rvy = b.v[1] - v.v[1], rvz = b.v[2] - v.v[2];
  const vitesseCentres = Math.hypot(rvx, rvy, rvz);

  // séparation : la balle est repoussée hors de la boîte
  b.p[0] += N[0] * profondeur; b.p[1] += N[1] * profondeur; b.p[2] += N[2] * profondeur;

  const delaiOk = tick - v.dernierContactBalleTick > DELAI_IMPULSION_PAS;
  if (vn < 0) {
    // choc physique
    const j = (-(1 + CONTACT_BALLE.restitution) * vn) / (inverseMasseEffective(v.base, RC, N) + 1 / MB);
    b.v[0] += (N[0] * j) / MB; b.v[1] += (N[1] * j) / MB; b.v[2] += (N[2] * j) / MB;
    appliquerImpulsion(v, RC, N, -j);
    // frottement tangentiel faible : donne du spin à la balle
    const rel2 = vitesseRelative(v, b);
    const vn2 = dot3(rel2, N);
    TAN[0] = rel2[0] - N[0] * vn2; TAN[1] = rel2[1] - N[1] * vn2; TAN[2] = rel2[2] - N[2] * vn2;
    const vt = Math.hypot(TAN[0], TAN[1], TAN[2]);
    if (vt > 1e-6) {
      TAN[0] /= vt; TAN[1] /= vt; TAN[2] /= vt;
      const raideurBalle = 1 / MB + (R * R) / IB; // r ⟂ t : 1/m + r²/I
      const jt = Math.min(FROTTEMENT_BALLE * j, vt / (raideurBalle + inverseMasseEffective(v.base, RC, TAN)));
      // sur la balle : -jt·t au point (-n·R) ; sur la voiture : +jt·t
      b.v[0] -= (TAN[0] * jt) / MB; b.v[1] -= (TAN[1] * jt) / MB; b.v[2] -= (TAN[2] * jt) / MB;
      const rx = -N[0] * R, ry = -N[1] * R, rz = -N[2] * R;
      const fx = -TAN[0] * jt, fy = -TAN[1] * jt, fz = -TAN[2] * jt;
      b.w[0] += (ry * fz - rz * fy) / IB; b.w[1] += (rz * fx - rx * fz) / IB; b.w[2] += (rx * fy - ry * fx) / IB;
      appliquerImpulsion(v, RC, TAN, jt);
    }
    // impulsion supplémentaire de Psyonix
    if (delaiOk) psyonix(v, b, vitesseCentres);
  }
  v.dernierContactBalleTick = tick;
  const r: ContactBalle = { force, point };
  return r;
};

/** Vitesse relative balle − voiture au point de contact (`RB`, `RC` posés par l'appelant), écrite dans le tampon `UREL`. */
function vitesseRelative(v: Readonly<EtatVoiture>, b: Readonly<{ v: Vec3; w: Vec3 }>): Vec3 {
  const vcx = v.v[0] + (v.w[1] * RC[2] - v.w[2] * RC[1]);
  const vcy = v.v[1] + (v.w[2] * RC[0] - v.w[0] * RC[2]);
  const vcz = v.v[2] + (v.w[0] * RC[1] - v.w[1] * RC[0]);
  const vbx = b.v[0] + (b.w[1] * RB[2] - b.w[2] * RB[1]);
  const vby = b.v[1] + (b.w[2] * RB[0] - b.w[0] * RB[2]);
  const vbz = b.v[2] + (b.w[0] * RB[1] - b.w[1] * RB[0]);
  UREL[0] = vbx - vcx; UREL[1] = vby - vcy; UREL[2] = vbz - vcz;
  return UREL;
}

/** L'impulsion supplémentaire de Psyonix (voir en-tête). `vitesseCentres` : |v_balle − v_voiture| avant le choc. */
function psyonix(v: Readonly<EtatVoiture>, b: { p: Vec3; v: Vec3 }, vitesseCentres: number): void {
  centreDans(C, v);
  DIR[0] = b.p[0] - C[0]; DIR[1] = (b.p[1] - C[1]) * CONTACT_BALLE.echelleVerticale; DIR[2] = b.p[2] - C[2];
  // composante le long de l'avant ramenée à 65 %
  const af = dot3(DIR, v.base.avant) * (1 - CONTACT_BALLE.echelleAvant);
  DIR[0] -= v.base.avant[0] * af; DIR[1] -= v.base.avant[1] * af; DIR[2] -= v.base.avant[2] * af;
  const n = Math.hypot(DIR[0], DIR[1], DIR[2]);
  if (n < 1e-9) return;
  const vr = Math.min(vitesseCentres, CONTACT_BALLE.vitesseRelativeMax);
  const intensite = vr * interpolerTable(CONTACT_BALLE.courbeImpulsion, vr);
  b.v[0] += (DIR[0] / n) * intensite; b.v[1] += (DIR[1] / n) * intensite; b.v[2] += (DIR[2] / n) * intensite;
  const vit = Math.hypot(b.v[0], b.v[1], b.v[2]);
  if (vit > BALLE.vitesseMax) { const k = BALLE.vitesseMax / vit; b.v[0] *= k; b.v[1] *= k; b.v[2] *= k; }
}

// ============================================================================================================================
// Voiture ↔ voiture
// ============================================================================================================================

/** Axes et demi-dimensions d'une hitbox pour le SAT. */
const DEMI = [HX, HY, HZ] as const;
const CA: Vec3 = [0, 0, 0];
const CB: Vec3 = [0, 0, 0];
const T: Vec3 = [0, 0, 0];
const L: Vec3 = [0, 0, 0];
const NMIN: Vec3 = [0, 0, 0];
const PTV: Vec3 = [0, 0, 0];
const RA: Vec3 = [0, 0, 0];
const RBB: Vec3 = [0, 0, 0];
const UA: Vec3 = [0, 0, 0];
const UB: Vec3 = [0, 0, 0];
const SA: Vec3 = [0, 0, 0];
const SB: Vec3 = [0, 0, 0];
/** 12 coins (8 par voiture, sommes dans PTV). */
const COIN: Vec3 = [0, 0, 0];
/** moyennes des coins de a dans b (MA) et de b dans a (MB_) */
const MA: Vec3 = [0, 0, 0];
const MB_: Vec3 = [0, 0, 0];
/** vitesses des deux voitures avant le choc (bump) */
const VAV: Vec3 = [0, 0, 0];
const VBV: Vec3 = [0, 0, 0];

function axesDe(v: Readonly<EtatVoiture>): readonly [Vec3, Vec3, Vec3] {
  return [v.base.avant, v.base.droite, v.base.haut];
}

/** Rayon de projection d'une boîte sur l'axe L. */
function rayonSur(axes: readonly [Vec3, Vec3, Vec3], l: Readonly<Vec3>): number {
  return HX * Math.abs(dot3(l, axes[0])) + HY * Math.abs(dot3(l, axes[1])) + HZ * Math.abs(dot3(l, axes[2]));
}

/** Vrai si le point `p` est dans la hitbox de `v` (marge de 1 mm). */
function dansHitbox(v: Readonly<EtatVoiture>, c: Readonly<Vec3>, p: Readonly<Vec3>): boolean {
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
  const { avant, droite, haut } = v.base;
  return (
    Math.abs(dx * avant[0] + dy * avant[1] + dz * avant[2]) <= HX + 1e-3 &&
    Math.abs(dx * droite[0] + dy * droite[1] + dz * droite[2]) <= HY + 1e-3 &&
    Math.abs(dx * haut[0] + dy * haut[1] + dz * haut[2]) <= HZ + 1e-3
  );
}

/**
 * Ajoute à `PTV` (somme) les coins de `a` qui sont dans la boîte de `b` ; leur moyenne seule va dans `moyenne` si elle est fournie.
 * Rend le nombre de coins retenus.
 */
function coinsDedans(a: Readonly<EtatVoiture>, ca: Readonly<Vec3>, b: Readonly<EtatVoiture>, cb: Readonly<Vec3>, moyenne: Vec3): number {
  let compte = 0;
  moyenne[0] = 0; moyenne[1] = 0; moyenne[2] = 0;
  const { avant, droite, haut } = a.base;
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1;
    COIN[0] = ca[0] + avant[0] * sx * HX + droite[0] * sy * HY + haut[0] * sz * HZ;
    COIN[1] = ca[1] + avant[1] * sx * HX + droite[1] * sy * HY + haut[1] * sz * HZ;
    COIN[2] = ca[2] + avant[2] * sx * HX + droite[2] * sy * HY + haut[2] * sz * HZ;
    if (dansHitbox(b, cb, COIN)) { moyenne[0] += COIN[0]; moyenne[1] += COIN[1]; moyenne[2] += COIN[2]; compte++; }
  }
  if (compte > 0) { moyenne[0] /= compte; moyenne[1] /= compte; moyenne[2] /= compte; }
  return compte;
}

/**
 * Contact de deux voitures (SAT à 15 axes). Rend null sans contact (ou si l'une est démolie). `a` et `b` sont modifiés : séparation,
 * impulsion, bump. La démolition est seulement DÉTECTÉE (`demolition`) : `match.ts` marque la victime. Si les deux voitures sont
 * supersoniques et peuvent se démolir, celle qui fonce le plus vite sur l'autre est l'auteur.
 */
export const contactVoitureVoiture: ContactEntreVoitures = (a, b, tick) => {
  if (a.demolie || b.demolie) return null;
  centreDans(CA, a); centreDans(CB, b);
  T[0] = CB[0] - CA[0]; T[1] = CB[1] - CA[1]; T[2] = CB[2] - CA[2];
  const d2 = T[0] * T[0] + T[1] * T[1] + T[2] * T[2];
  if (d2 > 4 * RAYON_ENGLOBANT * RAYON_ENGLOBANT) return null;
  const ea = axesDe(a), eb = axesDe(b);

  // --- SAT : 3 + 3 axes de face, 9 axes d'arête
  let minOverlap = Infinity;
  let minFace = Infinity;
  for (let i = 0; i < 6; i++) {
    const ax = i < 3 ? ea[i] : eb[i - 3];
    const o = rayonSur(ea, ax) + rayonSur(eb, ax) - Math.abs(dot3(T, ax));
    if (o <= 0) return null;
    if (o < minOverlap) { minOverlap = o; NMIN[0] = ax[0]; NMIN[1] = ax[1]; NMIN[2] = ax[2]; }
    if (o < minFace) minFace = o;
  }
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const p = ea[i], q = eb[j];
      L[0] = p[1] * q[2] - p[2] * q[1]; L[1] = p[2] * q[0] - p[0] * q[2]; L[2] = p[0] * q[1] - p[1] * q[0];
      const nl = Math.hypot(L[0], L[1], L[2]);
      if (nl < 1e-6) continue;
      L[0] /= nl; L[1] /= nl; L[2] /= nl;
      const o = rayonSur(ea, L) + rayonSur(eb, L) - Math.abs(dot3(T, L));
      if (o <= 0) return null;
      if (o * BIAIS_ARETES < minOverlap) { minOverlap = o; NMIN[0] = L[0]; NMIN[1] = L[1]; NMIN[2] = L[2]; }
    }
  }
  // normale de a vers b
  const s = dot3(T, NMIN) >= 0 ? 1 : -1;
  const n: Vec3 = [NMIN[0] * s, NMIN[1] * s, NMIN[2] * s];

  // --- point de contact : moyenne des coins de chacune dans l'autre ; sinon milieu des points d'appui (arête contre arête)
  const nA = coinsDedans(a, CA, b, CB, MA);
  const nB = coinsDedans(b, CB, a, CA, MB_);
  if (nA + nB > 0) {
    PTV[0] = (MA[0] * nA + MB_[0] * nB) / (nA + nB); PTV[1] = (MA[1] * nA + MB_[1] * nB) / (nA + nB); PTV[2] = (MA[2] * nA + MB_[2] * nB) / (nA + nB);
  } else {
    for (let k = 0; k < 3; k++) {
      const sa = dot3(n, ea[k]) >= 0 ? 1 : -1, sb = dot3(n, eb[k]) >= 0 ? 1 : -1;
      const hk = DEMI[k];
      SA[0] += ea[k][0] * sa * hk; SA[1] += ea[k][1] * sa * hk; SA[2] += ea[k][2] * sa * hk;
      SB[0] -= eb[k][0] * sb * hk; SB[1] -= eb[k][1] * sb * hk; SB[2] -= eb[k][2] * sb * hk;
    }
    PTV[0] = (CA[0] + SA[0] + CB[0] + SB[0]) / 2; PTV[1] = (CA[1] + SA[1] + CB[1] + SB[1]) / 2; PTV[2] = (CA[2] + SA[2] + CB[2] + SB[2]) / 2;
    SA[0] = SA[1] = SA[2] = SB[0] = SB[1] = SB[2] = 0;
  }
  RA[0] = PTV[0] - a.p[0]; RA[1] = PTV[1] - a.p[1]; RA[2] = PTV[2] - a.p[2];
  RBB[0] = PTV[0] - b.p[0]; RBB[1] = PTV[1] - b.p[1]; RBB[2] = PTV[2] - b.p[2];

  // --- vitesses avant le choc
  const vitRelCentres = Math.hypot(b.v[0] - a.v[0], b.v[1] - a.v[1], b.v[2] - a.v[2]);
  // contributions au rapprochement : a fonce vers b (le long de n) de ca, b fonce vers a de cb
  const ca = dot3(a.v, n), cb = -dot3(b.v, n);

  // le point d'attaque d'une voiture = ses PROPRES coins entrés dans l'autre (la moyenne commune dérive vers l'arrière quand le
  // chevauchement est grand, à 45 m/s de rapprochement on pénètre de 40 cm en un pas)
  const avantDe = (v: EtatVoiture, propres: Readonly<Vec3>, n: number): boolean => {
    const pt = n > 0 ? propres : PTV;
    return (pt[0] - v.p[0]) * v.base.avant[0] + (pt[1] - v.p[1]) * v.base.avant[1] + (pt[2] - v.p[2]) * v.base.avant[2] > CONTACT_VOITURES.demoAvantMinM;
  };
  const pareChocsA = avantDe(a, MA, nA), pareChocsB = avantDe(b, MB_, nB);

  // --- démolition : l'attaquant est supersonique, la victime d'une autre équipe, le contact est dans l'angle avant de l'attaquant
  let demolition: { auteur: number; victime: number } | null = null;
  const memeEquipe = a.equipe === b.equipe;
  if (!memeEquipe || CONTACT_VOITURES.tirAmi) {
    const avantA = a.supersonique && ca > DEMO_RAPPROCHEMENT_MIN && pareChocsA;
    const avantB = b.supersonique && cb > DEMO_RAPPROCHEMENT_MIN && pareChocsB;
    if (avantA && (!avantB || ca >= cb)) demolition = { auteur: a.id, victime: b.id };
    else if (avantB) demolition = { auteur: b.id, victime: a.id };
  }

  // --- séparation (moitié chacune)
  const demi = minOverlap / 2;
  a.p[0] -= n[0] * demi; a.p[1] -= n[1] * demi; a.p[2] -= n[2] * demi;
  b.p[0] += n[0] * demi; b.p[1] += n[1] * demi; b.p[2] += n[2] * demi;

  // vitesses AVANT le choc, pour le bump (RocketSim lit les vitesses avant la résolution du solveur)
  VAV[0] = a.v[0]; VAV[1] = a.v[1]; VAV[2] = a.v[2]; VBV[0] = b.v[0]; VBV[1] = b.v[1]; VBV[2] = b.v[2];

  // --- impulsion avec rotation
  vitessePointDans(UA, a, RA);
  vitessePointDans(UB, b, RBB);
  const un = (UB[0] - UA[0]) * n[0] + (UB[1] - UA[1]) * n[1] + (UB[2] - UA[2]) * n[2];
  if (un < 0) {
    const raideur = inverseMasseEffective(a.base, RA, n) + inverseMasseEffective(b.base, RBB, n);
    const j = (-(1 + CONTACT_VOITURES.restitution) * un) / raideur;
    appliquerImpulsion(b, RBB, n, j);
    appliquerImpulsion(a, RA, n, -j);
    // frottement
    vitessePointDans(UA, a, RA);
    vitessePointDans(UB, b, RBB);
    let tx = UB[0] - UA[0], ty = UB[1] - UA[1], tz = UB[2] - UA[2];
    const un2 = tx * n[0] + ty * n[1] + tz * n[2];
    tx -= n[0] * un2; ty -= n[1] * un2; tz -= n[2] * un2;
    const vt = Math.hypot(tx, ty, tz);
    if (vt > 1e-6) {
      DIR[0] = tx / vt; DIR[1] = ty / vt; DIR[2] = tz / vt;
      const kt = inverseMasseEffective(a.base, RA, DIR) + inverseMasseEffective(b.base, RBB, DIR);
      const jt = Math.min(CONTACT_VOITURES.frottement * j, vt / kt);
      appliquerImpulsion(b, RBB, DIR, -jt);
      appliquerImpulsion(a, RA, DIR, jt);
    }
  }

  // --- bump (RocketSim) : l'attaquant qui fonce vers l'autre PAR SON PARE-CHOCS AVANT lui ajoute de la vitesse le long de sa propre
  // direction de marche (+ une poussée verticale). Chaque voiture est testée à son tour (un choc frontal bumpe les deux).
  let bump: { vitesse: number } | null = null;
  const rapprochement = ca + cb;
  if (!demolition && rapprochement > BUMP_RAPPROCHEMENT_MIN && tick - a.dernierBumpTick > DELAI_BUMP_PAS && tick - b.dernierBumpTick > DELAI_BUMP_PAS) {
    centreDans(CA, a); centreDans(CB, b);
    for (let k = 0; k < 2; k++) {
      const att = k === 0 ? a : b, vic = k === 0 ? b : a;
      if (!(k === 0 ? pareChocsA : pareChocsB)) continue;
      // direction attaquant → victime (centres) et vitesse de l'attaquant dans cette direction
      const s0 = k === 0 ? 1 : -1;
      DIR[0] = (CB[0] - CA[0]) * s0; DIR[1] = (CB[1] - CA[1]) * s0; DIR[2] = (CB[2] - CA[2]) * s0;
      const nd = Math.hypot(DIR[0], DIR[1], DIR[2]) || 1;
      const va = k === 0 ? VAV : VBV;
      const vers = (va[0] * DIR[0] + va[1] * DIR[1] + va[2] * DIR[2]) / nd;
      const vitAtt = Math.hypot(va[0], va[1], va[2]);
      if (vers <= BUMP_RAPPROCHEMENT_MIN || vitAtt < 1e-6) continue;
      const poussee = interpolerTable(vic.auSol ? CONTACT_VOITURES.bumpSol : CONTACT_VOITURES.bumpAir, vers);
      const haut = interpolerTable(CONTACT_VOITURES.bumpHaut, vers);
      const hx = vic.auSol ? vic.base.haut[0] : 0, hy = vic.auSol ? vic.base.haut[1] : 1, hz = vic.auSol ? vic.base.haut[2] : 0;
      vic.v[0] += (va[0] / vitAtt) * poussee + hx * haut;
      vic.v[1] += (va[1] / vitAtt) * poussee + hy * haut;
      vic.v[2] += (va[2] / vitAtt) * poussee + hz * haut;
      bump = { vitesse: Math.max(bump ? bump.vitesse : 0, vitRelCentres) };
    }
    if (bump) { a.dernierBumpTick = tick; b.dernierBumpTick = tick; }
  }
  return { demolition, bump };
};
