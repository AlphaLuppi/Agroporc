/**
 * Rocket Muche : le stade « Soccar » (DFH Stadium de Rocket League) sous forme de champ de distance signée (SDF) continu et lisse.
 *
 * La balle y rebondit, la voiture y roule (sol, murs, plafond, pans coupés, et l'intérieur des cages) : tout le monde interroge la même
 * fonction `sd`. `sd > 0` = espace libre, `sd < 0` = matière, le gradient est la normale unitaire vers l'espace libre. PUR : aucun
 * `three`, aucun DOM, aucune horloge, aucun hasard ; `creerArene()` peut être appelée autant de fois qu'on veut (chaque arène a ses
 * propres variables de travail, aucune allocation dans `sd` / `sdNormale`).
 *
 * Construction :
 *  1. salle = prisme octogonal RÉTRÉCI de `r = 2,56 m` puis ÉLARGI d'une boule de rayon `r` : sol, plafond et arêtes verticales
 *     ont tous le même raccord arrondi, sans couture ; le gradient est calculé analytiquement (exact, pas de différences finies) ;
 *  2. cage = `{ |x| ≤ W } × P` (P : profil convexe de la cage de Rocket League dans le plan (profondeur, hauteur) : sol plat puis en
 *     pente douce, demi-cylindre du fond, plafond en pente tangent au cylindre puis plat), érodée de 1,12 m puis regonflée de 1,12 m :
 *     raccords concaves EXACTS de 1,12 m partout à l'intérieur (sol / parois, plafond / parois, fond / parois), comme dans le jeu (0,96 m dans RL, cf. `BUT.rayonInterieur`) ;
 *  3. union douce `smax(salle, cage, k = 0,15 m)` : arrondit (à peine) les poteaux et la barre transversale ; le gradient de l'union
 *     douce est exactement `h·∇a + (1 − h)·∇b` (propriété d'enveloppe de la formule polynomiale), donc sans différence finie non plus ;
 *  3 bis. pied des poteaux : de part et d'autre de la cage, le raccord sol / mur du fond se resserre à 1,12 m et fait le tour du pied
 *     du poteau pour rejoindre le raccord sol / paroi de la cage (union exacte avec le sol raccordé au mur du fond) : en fonçant dans
 *     le poteau ou en longeant le mur, on monte sur un arrondi, jamais sur une marche ;
 *  4. le tout est borné par le plan du sol `sd = min(sd, y)` : le sol est exactement à y = 0 (la pente du sol de la cage est au-dessus).
 *
 * Repère : Y vers le haut ; X = largeur ; Z = longueur ; l'équipe bleue défend le but de Z = -60 m, l'orange celui de Z = +60 m.
 * La fonction exploite la symétrie du stade (X → -X, Z → -Z) : elle n'évalue qu'un quadrant et retourne le gradient.
 */
import { BUT, COUPS_D_ENVOI, PLOTS, STADE } from "./contrat";
import type { Arene, Equipe, PosCoupDEnvoi, Vec3 } from "./contrat";

// ============================================================================================================================
// Géométrie dérivée de STADE et BUT
// ============================================================================================================================

/** Rayon commun des raccords sol / murs / plafond / arêtes verticales (la spec impose un rayon uniforme). */
const R = STADE.rayonSol;
/** demi-largeur / demi-longueur du prisme rétréci (le plan de l'octogone sans ses raccords) */
const A = STADE.demiLargeur - R;
const B = STADE.demiLongueur - R;
/** plan de coupe des coins : `|x| + |z| = COUPE` pour le stade réel, `C` pour le prisme rétréci (décalage perpendiculaire de r) */
const COUPE = STADE.demiLargeur + STADE.demiLongueur - STADE.panCoupe;
const C = COUPE - R * Math.SQRT2;
const UN_SUR_RACINE_2 = Math.SQRT1_2;
/** sommets du quadrant (x ≥ 0, z ≥ 0) du plan rétréci : (0,B) → (C-B, B) → (A, C-A) → (A, 0) */
const V1X = C - B;
const V2Z = C - A;
/** hauteur : le prisme occupe y ∈ [R, H - R] ; centre et demi-hauteur */
const YC = STADE.hauteur / 2;
const HH = (STADE.hauteur - 2 * R) / 2;

/** rayon de l'union douce (poteaux, barre) */
const K = BUT.rayonArete;
/** fond de la cage (point le plus profond du demi-cylindre) : Z = ±60 m */
const Z_FOND = STADE.demiLongueur + BUT.profondeur;
/** la cage commence dans la zone où le sol de la salle est plat (d = -7,2 m) : sa face avant est dans l'espace libre de la salle */
const CAGE_Z0 = STADE.demiLongueur - 7.2;

// ---------- profil de la cage dans le plan (d, y), d = |z| - 51,2 ----------
//
// La cage est G = { |x| ≤ W } × P, P convexe ; on l'ÉRODE de RI (parois latérales en W' = W - RI, profil P' = P érodé de RI) puis
// on la regonfle de RI : `cage = RI - dist(p, E)`, E = [-W', W'] × P'. Les raccords concaves de RI = 1,12 m sont alors exacts partout
// (sol / paroi, plafond / paroi, fond / paroi, et les coins du profil), et la distance est exacte dans l'espace libre de la cage.
// P' est un polygone convexe à un arc : A0 → A1 (sol plat) → A2 (pente du sol) → arc du fond (centre CF, rayon RE) → A3 (point de
// tangence de la pente du plafond) → A4 (pente du plafond) → A5 (plafond plat) → A0 (face avant, dans l'espace libre de la salle).

/** paroi latérale de la cage et rayon des raccords intérieurs */
const W = BUT.demiLargeurParoi;
const RI = BUT.rayonInterieur;
const WP = W - RI;
/** centre et rayon du demi-cylindre du fond, et rayon érodé */
const CFD = BUT.profondeurCentreFond, CFY = BUT.hauteurCentreFond;
const RE = BUT.rayonFond - RI;
/** pente du sol : y = PENTE·(d - D_PENTE) */
const D_PENTE = BUT.penteSolDebut;
const PENTE = BUT.hauteurPenteSol / (CFD - D_PENTE);
const NF = Math.hypot(1, PENTE);
/** pente du plafond : passe par (plafondPlatJusqua, hauteurPlafond), tangente au demi-cylindre ; normale vers la matière (sin θ, cos θ) */
const HP = BUT.hauteurPlafond;
const DPP = BUT.plafondPlatJusqua;
const THETA = (() => {
  const a = CFD - DPP, b = CFY - HP;
  return Math.asin(-BUT.rayonFond / Math.hypot(a, b)) - Math.atan2(b, a);
})();
const SIN_T = Math.sin(THETA), COS_T = Math.cos(THETA);
/** sommets de P' */
const DAV = -7.2 + RI;
const A0: [number, number] = [DAV, RI];
const A1: [number, number] = [D_PENTE - (RI * (NF - 1)) / PENTE, RI];
const A2: [number, number] = (() => {
  // intersection de la pente du sol décalée de RI avec le cercle érodé : la plus profonde des deux (le profil reste convexe)
  const ux = 1 / NF, uy = PENTE / NF;
  const ox = D_PENTE - (PENTE * RI) / NF, oy = RI / NF;
  const px = ox - CFD, py = oy - CFY;
  const bq = px * ux + py * uy, cq = px * px + py * py - RE * RE;
  const t = -bq + Math.sqrt(bq * bq - cq);
  return [ox + ux * t, oy + uy * t];
})();
const A3: [number, number] = [CFD + RE * SIN_T, CFY + RE * COS_T];
const A4: [number, number] = [DPP - RI * Math.tan(THETA / 2), HP - RI];
const A5: [number, number] = [DAV, HP - RI];
/** angles (depuis le centre du fond) du début et de la fin de l'arc, parcouru dans le sens trigonométrique du plan (d, y) */
const ANG_A2 = Math.atan2(A2[1] - CFY, A2[0] - CFD);
const ANG_A3 = Math.atan2(A3[1] - CFY, A3[0] - CFD);
/** les cinq segments de P' à plat (ax, ay, bx, by) dans l'ordre de la chaîne ; l'arc A2 → A3 s'intercale entre le 2e et le 3e */
const SEG = new Float64Array([
  A0[0], A0[1], A1[0], A1[1],
  A1[0], A1[1], A2[0], A2[1],
  A3[0], A3[1], A4[0], A4[1],
  A4[0], A4[1], A5[0], A5[1],
  A5[0], A5[1], A0[0], A0[1],
]);
/** normales sortantes des segments (chaîne trigonométrique : sortante = (dy, -dx) normalisée), puis celle de la corde A2 → A3 */
const NSEG = new Float64Array(12);
for (let i = 0; i < 6; i++) {
  const ax = i < 5 ? SEG[4 * i] : A2[0], ay = i < 5 ? SEG[4 * i + 1] : A2[1];
  const bx = i < 5 ? SEG[4 * i + 2] : A3[0], by = i < 5 ? SEG[4 * i + 3] : A3[1];
  const l = Math.hypot(bx - ax, by - ay);
  NSEG[2 * i] = (by - ay) / l;
  NSEG[2 * i + 1] = -(bx - ax) / l;
}
/** inverse du carré de la longueur de chaque segment (projection sans division) */
const INV_L2 = new Float64Array(5);
for (let i = 0; i < 5; i++) INV_L2[i] = 1 / ((SEG[4 * i + 2] - SEG[4 * i]) ** 2 + (SEG[4 * i + 3] - SEG[4 * i + 1]) ** 2);
/** directions (depuis le centre du fond) des extrémités de l'arc : le secteur de l'arc (≈ 157°, moins d'un demi-tour) se teste par deux produits vectoriels */
const U2D = Math.cos(ANG_A2), U2Y = Math.sin(ANG_A2), U3D = Math.cos(ANG_A3), U3Y = Math.sin(ANG_A3);
const RE2 = RE * RE;

// ---------- raccord du mur du fond près des poteaux (pied du poteau) ----------
//
// Fenêtre |x| < X_FEN, y < Y_FEN, zm = 51,2 - |z| ∈ ]-1 ; ZM_FEN[ : on ajoute (union) la surface exacte « sol raccordé au solide Q »,
// où Q = { |x| ≥ W, zm ≤ 0 } est le mur du fond à côté de la cage, avec un raccord de rayon r(|x|) : RI au poteau (le même que le
// raccord sol / paroi de la cage, auquel il se raccorde en faisant le tour du pied du poteau), puis jusqu'à `STADE.rayonSol` à |x| = 18 m,
// où il redevient celui de la salle. Un rayon plus petit libère plus d'espace : l'union est correcte. La fenêtre (min avec la distance à
// ses bords) ramène continûment à la valeur de la salle et de la cage, qui y sont au moins aussi libres.

const R_POTEAU = BUT.rayonRaccordPoteau;
const X_R0 = BUT.raccordPoteauJusqua, X_R1 = BUT.raccordFondDes;
const X_FEN = X_R1 + 0.5, Y_FEN = 3, ZM_FEN = 3.5;

/** Rayon du raccord sol / mur du fond à l'abscisse |x| (RI = 1,12 m au poteau, `STADE.rayonSol` au-delà de 18 m). */
export function rayonRaccordFond(x: number): number {
  const ax = Math.abs(x);
  if (ax <= X_R0) return R_POTEAU;
  if (ax >= X_R1) return STADE.rayonSol;
  const t = (ax - X_R0) / (X_R1 - X_R0);
  return R_POTEAU + (STADE.rayonSol - R_POTEAU) * t * t * (3 - 2 * t);
}

/**
 * Hauteur du sol raccordé au pied d'un poteau, devant la cage (zm = 51,2 - |z| ≥ 0, |x| ≤ W) ou le long du mur du fond (|x| ≥ W) :
 * `r - √(r² - (r - D)²)` où D est la distance en plan au mur du fond / au poteau. Pour le rendu et les tests.
 */
export function hauteurPiedPoteau(x: number, zm: number): number {
  const ax = Math.abs(x);
  const D = ax >= W ? zm : zm > 0 ? Math.hypot(W - ax, zm) : W - ax;
  const r = rayonRaccordFond(ax);
  if (D >= r) return 0;
  const u = r - Math.max(D, 0);
  return r - Math.sqrt(Math.max(0, r * r - u * u));
}

/** Profil de la cage exporté pour le rendu (repère (d, y) : profondeur derrière la ligne de but, hauteur). */
export const PROFIL_CAGE = {
  /** demi-largeur de la paroi (W) et du profil érodé (W') */
  demiLargeur: W,
  demiLargeurErodee: WP,
  /** rayon des raccords intérieurs */
  rayon: RI,
  /** sommets de P' (A0 … A5) */
  sommets: [A0, A1, A2, A3, A4, A5] as readonly (readonly [number, number])[],
  /** arc du fond érodé : centre, rayon, angles de début (A2) et de fin (A3), parcouru dans le sens trigonométrique */
  centreFond: [CFD, CFY] as readonly [number, number],
  rayonFondErode: RE,
  angleDebutArc: ANG_A2,
  angleFinArc: ANG_A3,
  /** angle de la pente du plafond (rad, ≈ 17,6°) */
  pentePlafond: THETA,
} as const;

/** Constantes géométriques dérivées, exportées pour le rendu (coque) et les tests. */
export const GEOMETRIE_ARENE = {
  /** demi-dimensions du plan du prisme rétréci */
  demiLargeurRetrecie: A,
  demiLongueurRetrecie: B,
  /** constante du plan de coupe des coins du prisme rétréci : `|x| + |z| = coupeRetrecie` */
  coupeRetrecie: C,
  /** constante du plan de coupe des coins du stade réel : `|x| + |z| = 80,64` */
  coupe: COUPE,
  /** rayon des raccords */
  rayon: R,
  /** Z du point le plus profond de chaque cage (±60 m, à la hauteur du centre du demi-cylindre) */
  fondBut: Z_FOND,
} as const;

/** Ordonnée du plan du sol, plancher de toute la scène. */
const NIVEAU_SOL = 0;

// ============================================================================================================================
// Utilitaires
// ============================================================================================================================

/** Équipe qui DÉFEND la cage située du côté `signeZ` (Z > 0 : orange, Z < 0 : bleue). */
const equipeDefenseur = (z: number): Equipe => (z > 0 ? "orange" : "bleue");

/**
 * Position d'un coup d'envoi pour une équipe : l'emplacement `pos` (défini pour la BLEUE) est tourné de 180° autour de Y pour
 * l'ORANGE (x → -x, z → -z, cap + π). Le cap est celui de `PosCoupDEnvoi` : avant = (sin cap, 0, cos cap).
 */
export function placeCoupDEnvoi(equipe: Equipe, pos: PosCoupDEnvoi): { x: number; z: number; cap: number } {
  return equipe === "bleue" ? { x: pos.x, z: pos.z, cap: pos.cap } : { x: -pos.x, z: -pos.z, cap: pos.cap + Math.PI };
}

/** Les 34 plots officiels (ré-exportés du contrat pour que le stade soit complet en un seul import). */
export const plotsDuStade = (): typeof PLOTS => PLOTS;
/** Les 5 positions de coup d'envoi de l'équipe bleue. */
export const coupsDEnvoiDuStade = (): typeof COUPS_D_ENVOI => COUPS_D_ENVOI;

// ============================================================================================================================
// L'arène
// ============================================================================================================================

/**
 * Crée le stade. Pure, déterministe ; les variables de travail (gradient courant, point le plus proche) sont locales à l'instance et
 * jamais conservées d'un appel à l'autre au-delà de la valeur rendue.
 */
export function creerArene(): Arene {
  // --- variables de travail (aucune allocation dans le chemin chaud) ---
  /** gradient du dernier `evaluer`, dans le repère réel */
  let gx = 0;
  let gy = 1;
  let gz = 0;
  /** gradient 2D (x, z) du dernier `plan`, dans le quadrant replié */
  let g2x = 0;
  let g2z = 0;
  /** point le plus proche du dernier `segment` */
  let qx = 0;
  let qz = 0;
  /** gradient (d, y) du dernier `profil` */
  let gpd = 0;
  let gpy = 0;

  /** carré de la distance du point (px, pz) au segment [a, b] ; écrit le point le plus proche dans (qx, qz) */
  function segment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const ex = bx - ax, ez = bz - az;
    const t0 = ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez);
    const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
    qx = ax + ex * t;
    qz = az + ez * t;
    const dx = px - qx, dz = pz - qz;
    return dx * dx + dz * dz;
  }

  /**
   * Distance signée EXACTE (négative dedans) au polygone du plan rétréci, pour un point du quadrant x ≥ 0, z ≥ 0 (le plan est convexe
   * et symétrique : le point le plus proche est dans le même quadrant). Écrit le gradient dans (g2x, g2z).
   */
  function plan(x: number, z: number): number {
    const dx = x - A, dz = z - B, dd = (x + z - C) * UN_SUR_RACINE_2;
    const dmax = dx >= dz ? (dx >= dd ? dx : dd) : dz >= dd ? dz : dd;
    if (dmax <= 0) {
      // dedans : la plus proche des trois faces
      if (dmax === dx) { g2x = 1; g2z = 0; }
      else if (dmax === dz) { g2x = 0; g2z = 1; }
      else { g2x = UN_SUR_RACINE_2; g2z = UN_SUR_RACINE_2; }
      return dmax;
    }
    // dehors : plus court des trois segments de la chaîne du quadrant
    let best = segment(x, z, 0, B, V1X, B);
    let bqx = qx, bqz = qz;
    let d2 = segment(x, z, V1X, B, A, V2Z);
    if (d2 < best) { best = d2; bqx = qx; bqz = qz; }
    d2 = segment(x, z, A, V2Z, A, 0);
    if (d2 < best) { best = d2; bqx = qx; bqz = qz; }
    const d = Math.sqrt(best);
    if (d > 1e-12) { g2x = (x - bqx) / d; g2z = (z - bqz) / d; }
    else if (dmax === dx) { g2x = 1; g2z = 0; }
    else if (dmax === dz) { g2x = 0; g2z = 1; }
    else { g2x = UN_SUR_RACINE_2; g2z = UN_SUR_RACINE_2; }
    return d;
  }

  /**
   * Distance signée EXACTE (négative dedans) au profil érodé P' de la cage, en (d, y). Appartenance : du bon côté des cinq segments, et
   * de la corde de l'arc OU dans le disque. Dedans (P' convexe) : la plus proche des droites des segments, ou du cercle si le point est
   * dans le secteur de l'arc. Dehors : le plus proche des segments dont la droite voit le point (tous en dernier recours) et de l'arc.
   * Écrit le gradient dans (gpd, gpy).
   */
  function profil(d: number, y: number): number {
    // distances signées aux droites des cinq segments (négatives du côté de la cage)
    let hmax = -Infinity, imax = 0, h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0;
    for (let i = 0; i < 5; i++) {
      const h = (d - SEG[4 * i]) * NSEG[2 * i] + (y - SEG[4 * i + 1]) * NSEG[2 * i + 1];
      if (i === 0) h0 = h; else if (i === 1) h1 = h; else if (i === 2) h2 = h; else if (i === 3) h3 = h; else h4 = h;
      if (h > hmax) { hmax = h; imax = i; }
    }
    const cx = d - CFD, cy = y - CFY;
    const rc2 = cx * cx + cy * cy;
    const secteur = U2D * cy - U2Y * cx >= 0 && cx * U3Y - cy * U3D >= 0;
    const dedans = hmax <= 0 && ((d - A2[0]) * NSEG[10] + (y - A2[1]) * NSEG[11] <= 0 || rc2 <= RE2);
    if (dedans) {
      // dedans (profil convexe) : la plus proche des droites des segments, ou le cercle du fond si le point est dans le secteur de l'arc
      let dist = -hmax;
      gpd = NSEG[2 * imax]; gpy = NSEG[2 * imax + 1];
      if (secteur) {
        const rc = Math.sqrt(rc2);
        if (RE - rc < dist && rc > 1e-12) { dist = RE - rc; gpd = cx / rc; gpy = cy / rc; }
      }
      return -dist;
    }
    // dehors : plus court des segments dont la droite voit le point, et l'arc si le point est dans son secteur
    let best = Infinity, bd = 0, by = 0, bi = 0;
    for (let pass = 0; pass < 2 && best === Infinity; pass++) {
      for (let i = 0; i < 5; i++) {
        const h = i === 0 ? h0 : i === 1 ? h1 : i === 2 ? h2 : i === 3 ? h3 : h4;
        if (pass === 0 && h < 0) continue;
        const ax = SEG[4 * i], ay = SEG[4 * i + 1], ex = SEG[4 * i + 2] - ax, ey = SEG[4 * i + 3] - ay;
        const t0 = ((d - ax) * ex + (y - ay) * ey) * INV_L2[i];
        const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
        const ux = d - (ax + ex * t), uy = y - (ay + ey * t);
        const d2 = ux * ux + uy * uy;
        if (d2 < best) { best = d2; bd = ax + ex * t; by = ay + ey * t; bi = i; }
      }
      if (secteur && rc2 > RE2) {
        const rc = Math.sqrt(rc2), da = rc - RE;
        if (da * da < best) { best = da * da; bd = CFD + (cx / rc) * RE; by = CFY + (cy / rc) * RE; bi = 5; }
      }
    }
    const dist = Math.sqrt(best);
    if (dist > 1e-12) { gpd = (d - bd) / dist; gpy = (y - by) / dist; }
    else if (bi === 5) { const rc = Math.sqrt(rc2); gpd = cx / rc; gpy = cy / rc; }
    else { gpd = NSEG[2 * bi]; gpy = NSEG[2 * bi + 1]; }
    return dist;
  }

  /** Évalue `sd` en (px, py, pz) et laisse le gradient (non normalisé de force, mais de norme ≤ 1) dans (gx, gy, gz). */
  function evaluer(px: number, py: number, pz: number): number {
    // repli sur le quadrant x ≥ 0, z ≥ 0
    const sx = px < 0 ? -1 : 1, sz = pz < 0 ? -1 : 1;
    const x = px * sx, z = pz * sz;

    // 1. salle : r - distance au prisme
    const d2 = plan(x, z);
    const sy = py >= YC ? 1 : -1;
    const dy = (py - YC) * sy - HH;
    let dp: number, hx: number, hy: number, hz: number;
    if (d2 <= 0 && dy <= 0) {
      if (d2 >= dy) { dp = d2; hx = g2x; hy = 0; hz = g2z; }
      else { dp = dy; hx = 0; hy = sy; hz = 0; }
    } else {
      const ox = d2 > 0 ? d2 : 0, oy = dy > 0 ? dy : 0;
      dp = Math.sqrt(ox * ox + oy * oy);
      const inv = 1 / dp;
      hx = ox * g2x * inv; hy = oy * sy * inv; hz = ox * g2z * inv;
    }
    const a = R - dp;
    let s = a, sgx = -hx, sgy = -hy, sgz = -hz;

    // 2. cage (celle du côté du point) + 3. union douce
    // (la cage tient dans la boîte |x| ≤ W, y ≤ HP, d ∈ [-7,2 ; 8,8] : si même la distance à cette boîte laisse la salle plus libre de
    // K, l'union douce rend exactement la salle, on ne calcule pas le profil)
    let bMax = W - x;
    if (Z_FOND - z < bMax) bMax = Z_FOND - z;
    if (HP - py < bMax) bMax = HP - py;
    if (z - CAGE_Z0 < bMax) bMax = z - CAGE_Z0;
    if (z >= CAGE_Z0 - 2 && bMax > a - K) {
      const delta = profil(z - STADE.demiLongueur, py);
      const ex = x - WP;
      let dist: number, bgx: number, bgy: number, bgz: number;
      if (ex <= 0 && delta <= 0) {
        if (ex >= delta) { dist = ex; bgx = 1; bgy = 0; bgz = 0; }
        else { dist = delta; bgx = 0; bgy = gpy; bgz = gpd; }
      } else {
        const ox = ex > 0 ? ex : 0, od = delta > 0 ? delta : 0;
        dist = Math.sqrt(ox * ox + od * od);
        bgx = ox / dist; bgy = (od * gpy) / dist; bgz = (od * gpd) / dist;
      }
      const b = RI - dist;
      // smax polynomial : mix(b, a, h) + k·h·(1 - h), gradient exact h·∇a + (1 - h)·∇b
      const h0 = 0.5 + (0.5 * (a - b)) / K;
      const h = h0 < 0 ? 0 : h0 > 1 ? 1 : h0;
      s = b * (1 - h) + a * h + K * h * (1 - h);
      sgx = h * sgx - (1 - h) * bgx;
      sgy = h * sgy - (1 - h) * bgy;
      sgz = h * sgz - (1 - h) * bgz;
    }

    // 3 bis. pied des poteaux : sol raccordé (rayon r(x)) au mur du fond Q = { x ≥ W, zm ≤ 0 }, en union, dans sa fenêtre
    const zm = STADE.demiLongueur - z;
    if (x < X_FEN && py < Y_FEN && zm > -1 && zm < ZM_FEN) {
      // D : distance signée en plan à Q (négative dans Q), gradient (dDx, dDz) dans le repère replié
      const ax = W - x;
      let D: number, dDx: number, dDz: number;
      if (ax <= 0 && zm <= 0) {
        if (ax >= zm) { D = ax; dDx = -1; dDz = 0; } else { D = zm; dDx = 0; dDz = -1; }
      } else if (ax <= 0) { D = zm; dDx = 0; dDz = -1; }
      else if (zm <= 0) { D = ax; dDx = -1; dDz = 0; }
      else { D = Math.sqrt(ax * ax + zm * zm); dDx = -ax / D; dDz = -zm / D; }
      // rayon du raccord et sa dérivée en x
      let r = R_POTEAU, rp = 0;
      if (x > X_R0) {
        if (x >= X_R1) r = R;
        else {
          const t = (x - X_R0) / (X_R1 - X_R0);
          r = R_POTEAU + (R - R_POTEAU) * t * t * (3 - 2 * t);
          rp = ((R - R_POTEAU) * 6 * t * (1 - t)) / (X_R1 - X_R0);
        }
      }
      let f: number, fgx: number, fgy: number, fgz: number;
      if (D < r && py < r) {
        const u = r - D, v = r - py, l = Math.sqrt(u * u + v * v);
        f = r - l;
        const fr = 1 - (u + v) / l;
        fgx = (u / l) * dDx + fr * rp; fgy = v / l; fgz = (u / l) * dDz;
      } else if (D <= py) { f = D; fgx = dDx; fgy = 0; fgz = dDz; }
      else { f = py; fgx = 0; fgy = 1; fgz = 0; }
      // bords de la fenêtre
      if (Y_FEN - py < f) { f = Y_FEN - py; fgx = 0; fgy = -1; fgz = 0; }
      if (zm + 1 < f) { f = zm + 1; fgx = 0; fgy = 0; fgz = -1; }
      if (X_FEN - x < f) { f = X_FEN - x; fgx = -1; fgy = 0; fgz = 0; }
      if (f > s) { s = f; sgx = fgx; sgy = fgy; sgz = fgz; }
    }

    // 4. le sol est un plan exact
    if (py - NIVEAU_SOL < s) { s = py - NIVEAU_SOL; sgx = 0; sgy = 1; sgz = 0; }

    gx = sgx * sx; gy = sgy; gz = sgz * sz;
    return s;
  }

  /** Écrit dans `n` le gradient courant NORMALISÉ (sécurité : l'union douce peut le raccourcir d'au plus 30 %). */
  function ecrireNormale(n: Vec3): void {
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l < 1e-9) { n[0] = 0; n[1] = 1; n[2] = 0; return; }
    n[0] = gx / l; n[1] = gy / l; n[2] = gz / l;
  }

  const sd = (p: Readonly<Vec3>): number => evaluer(p[0], p[1], p[2]);

  function sdNormale(p: Readonly<Vec3>, n: Vec3): number {
    const s = evaluer(p[0], p[1], p[2]);
    ecrireNormale(n);
    return s;
  }

  function normale(p: Readonly<Vec3>): Vec3 {
    const n: Vec3 = [0, 1, 0];
    sdNormale(p, n);
    return n;
  }

  function butMarque(p: Readonly<Vec3>, rayon: number): Equipe | null {
    const az = Math.abs(p[2]);
    if (az > BUT.seuilMarque + rayon && az <= Z_FOND + rayon && Math.abs(p[0]) < BUT.demiLargeur && p[1] < BUT.hauteur + rayon) {
      // la balle est dans la cage du côté de Z : elle compte pour l'ADVERSAIRE de l'équipe qui défend cette cage
      return p[2] > 0 ? "bleue" : "orange";
    }
    return null;
  }

  function dansCage(p: Readonly<Vec3>): Equipe | null {
    const az = Math.abs(p[2]);
    if (az >= STADE.demiLongueur && az <= Z_FOND && Math.abs(p[0]) < BUT.demiLargeur && p[1] >= 0 && p[1] < BUT.hauteur) {
      return equipeDefenseur(p[2]);
    }
    return null;
  }

  function lancerRayon(o: Readonly<Vec3>, d: Readonly<Vec3>, max: number): number | null {
    const ln = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (ln < 1e-12) return null;
    const dx = d[0] / ln, dy = d[1] / ln, dz = d[2] / ln;
    let t = 0;
    for (let i = 0; i < 256; i++) {
      const s = evaluer(o[0] + dx * t, o[1] + dy * t, o[2] + dz * t);
      if (s < 1e-3) {
        if (s >= 0 || i === 0) return t;
        // on a dépassé la surface (l'union douce surestime `sd` d'au plus 4 cm) : dichotomie sur le dernier pas
        let lo = Math.max(0, t - 0.05), hi = t;
        for (let j = 0; j < 14; j++) {
          const m = 0.5 * (lo + hi);
          if (evaluer(o[0] + dx * m, o[1] + dy * m, o[2] + dz * m) < 1e-3) hi = m; else lo = m;
        }
        return hi;
      }
      t += s > 0.02 ? s : 0.02;
      if (t > max) return null;
    }
    return null;
  }

  function surfaceProche(p: Readonly<Vec3>): { point: Vec3; normale: Vec3; distance: number } {
    const point: Vec3 = [p[0], p[1], p[2]];
    const n: Vec3 = [0, 1, 0];
    const s0 = sdNormale(point, n);
    let s = s0;
    for (let i = 0; i < 4; i++) {
      point[0] -= n[0] * s; point[1] -= n[1] * s; point[2] -= n[2] * s;
      s = sdNormale(point, n);
    }
    return { point, normale: n, distance: Math.abs(s0) };
  }

  return { sd, normale, sdNormale, butMarque, dansCage, lancerRayon, surfaceProche };
}
