/**
 * Rocket Muche : le stade « Soccar » (DFH Stadium de Rocket League) sous forme de champ de distance signée (SDF) continu et lisse.
 *
 * La balle y rebondit, la voiture y roule (sol, murs, plafond, pans coupés) : tout le monde interroge la même fonction `sd`.
 * `sd > 0` = espace libre, `sd < 0` = matière, le gradient est la normale unitaire vers l'espace libre. PUR : aucun `three`, aucun
 * DOM, aucune horloge, aucun hasard ; `creerArene()` peut être appelée autant de fois qu'on veut (chaque arène a ses propres
 * variables de travail, aucune allocation dans `sd` / `sdNormale`).
 *
 * Construction (spec § 3.2, avec deux corrections de détail décrites plus bas) :
 *  1. salle = prisme octogonal RÉTRÉCI de `r = 2,56 m` puis ÉLARGI d'une boule de rayon `r` : sol, plafond et arêtes verticales
 *     ont tous le même raccord arrondi, sans couture ; le gradient est calculé analytiquement (exact, pas de différences finies) ;
 *  2. cage = boîte rétrécie de 0,25 m puis élargie de 0,25 m (angles intérieurs adoucis) ;
 *  3. union douce `smax(salle, cage, k = 0,15 m)` : arrondit les poteaux et la barre transversale ; le gradient de l'union douce est
 *     exactement `h·∇a + (1 − h)·∇b` (propriété d'enveloppe de la formule polynomiale), donc sans différence finie non plus.
 *
 * Corrections par rapport au texte de la spec (nécessaires pour une cage sans marche à l'entrée) :
 *  - la boîte de la cage démarre à Z = ±44 m (pas ±50) et son plancher est abaissé à -1 m : sinon le raccord arrondi sol/fond de
 *    terrain (qui monte de 39 cm à Z = 50) forme une marche devant la cage, et le plancher de la cage coïncidant avec celui de la
 *    salle, l'union douce le relèverait de k/4 = 3,75 cm ;
 *  - le tout est ensuite borné par le plan du sol `sd = min(sd, y)` : le sol est exactement à y = 0, jusque dans la cage
 *    (la salle est incluse dans `y ≥ 0`, donc cette borne ne change rien ailleurs).
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

/** rayon de l'union douce (poteaux, barre) et rayon des angles intérieurs de la cage */
const K = BUT.rayonArete;
const RHO = BUT.rayonInterieur;
/** fond de la cage : Z = ±60 m */
const Z_FOND = STADE.demiLongueur + BUT.profondeur;
/** la boîte de la cage commence dans la zone où le sol de la salle est plat, et plonge sous le sol (voir l'en-tête) */
const CAGE_Z0 = STADE.demiLongueur - 7.2;
const CAGE_Y0 = -1;
/** boîte rétrécie de RHO : demi-tailles et centre */
const BX = BUT.demiLargeur - RHO;
const BCY = (CAGE_Y0 + BUT.hauteur) / 2;
const BHY = (BUT.hauteur - CAGE_Y0) / 2 - RHO;
const BCZ = (CAGE_Z0 + Z_FOND) / 2;
const BHZ = (Z_FOND - CAGE_Z0) / 2 - RHO;

/**
 * Biseau des raccords à côté des poteaux : plan par A = (demiLargeur, 0, zMur), B = (demiLargeur + T, 0, zMur - R) et
 * C = (demiLargeur + T, R, zMur). Normale unitaire vers l'espace libre, exprimée avec `zm = zMur - z` : (-R, T, T) / norme.
 */
const BISEAU_T = BUT.longueurBiseau;
const KB = BUT.rayonBiseau;
const NB = Math.hypot(R, BISEAU_T, BISEAU_T);
const PNX = -R / NB, PNY = BISEAU_T / NB, PNZ = BISEAU_T / NB;
/** le biseau ne concerne que la bande du raccord devant le mur du fond : fenêtre (z, x, y) et largeurs de son fondu */
const ZB0 = STADE.demiLongueur - R - 2;
const BISEAU_X1 = BUT.demiLargeur + BISEAU_T + 3;
const BISEAU_Y1 = R + 1.5;
const BISEAU_FONDU = 1;
const BISEAU_FONDU_X = 2;

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
  /** Z du fond de chaque cage (±60 m) */
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
    if (z >= CAGE_Z0 - 2) {
      const sby = py >= BCY ? 1 : -1, sbz = z >= BCZ ? 1 : -1;
      const bqx = x - BX, bqy = (py - BCY) * sby - BHY, bqz = (z - BCZ) * sbz - BHZ;
      const ox = bqx > 0 ? bqx : 0, oy = bqy > 0 ? bqy : 0, oz = bqz > 0 ? bqz : 0;
      const l2 = ox * ox + oy * oy + oz * oz;
      let dist: number, bgx: number, bgy: number, bgz: number;
      if (l2 > 0) {
        dist = Math.sqrt(l2);
        bgx = ox / dist; bgy = (oy * sby) / dist; bgz = (oz * sbz) / dist;
      } else if (bqx >= bqy && bqx >= bqz) { dist = bqx; bgx = 1; bgy = 0; bgz = 0; }
      else if (bqy >= bqz) { dist = bqy; bgx = 0; bgy = sby; bgz = 0; }
      else { dist = bqz; bgx = 0; bgy = 0; bgz = sbz; }
      const b = RHO - dist;
      // smax polynomial : mix(b, a, h) + k·h·(1 - h), gradient exact h·∇a + (1 - h)·∇b
      const h0 = 0.5 + (0.5 * (a - b)) / K;
      const h = h0 < 0 ? 0 : h0 > 1 ? 1 : h0;
      s = b * (1 - h) + a * h + K * h * (1 - h);
      sgx = h * sgx - (1 - h) * bgx;
      sgy = h * sgy - (1 - h) * bgy;
      sgz = h * sgz - (1 - h) * bgz;
    }

    // 3 bis. biseau de part et d'autre de la cage : un demi-espace libre oblique qui passe par le pied du poteau, par le début du
    // raccord au sol et par son sommet sur le mur, `BUT.longueurBiseau` plus loin. Il rabote le raccord arrondi, entièrement au poteau
    // (le mur y tombe droit sur le sol : plus d'aileron qui dépasse dans le terrain) et plus du tout au bout. Il ne libère que de la
    // matière du raccord : devant le mur du fond (borne `zMur - z`), jamais plus que le mur lui-même.
    // Hors du voisinage du raccord, une fenêtre `w` ramène continûment à la valeur d'origine (qui reste une borne sûre de la distance).
    if (z > ZB0 && x < BISEAU_X1 && py < BISEAU_Y1) {
      // (derrière le plan du mur, `zm` < 0 : la borne rend la profondeur dans le mur, continue avec l'avant du mur)
      const zm = STADE.demiLongueur - z;
      {
        const pl = PNX * (x - BUT.demiLargeur) + PNY * py + PNZ * zm;
        // union douce du biseau avec le reste
        const h0 = 0.5 + (0.5 * (s - pl)) / KB;
        const h = h0 < 0 ? 0 : h0 > 1 ? 1 : h0;
        let u = pl * (1 - h) + s * h + KB * h * (1 - h);
        let ux = h * sgx + (1 - h) * PNX, uy = h * sgy + (1 - h) * PNY, uz = h * sgz - (1 - h) * PNZ;
        if (u > zm) { u = zm; ux = 0; uy = 0; uz = -1; }
        if (u > s) {
          const wz = (z - ZB0) / BISEAU_FONDU, wx = (BISEAU_X1 - x) / BISEAU_FONDU_X, wy = (BISEAU_Y1 - py) / BISEAU_FONDU;
          let w = wz < wx ? wz : wx;
          if (wy < w) w = wy;
          if (w > 1) w = 1;
          s += (u - s) * w;
          sgx += (ux - sgx) * w; sgy += (uy - sgy) * w; sgz += (uz - sgz) * w;
        }
      }
    }

    // 4. le sol est un plan exact, y compris dans la cage
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
