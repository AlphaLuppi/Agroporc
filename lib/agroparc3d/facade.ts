/**
 * Façades des bâtiments d'Agroparc (arène FPS) : fonctions PURES, sans three ni DOM.
 * `decor.ts` s'en sert pour construire les murs (un quad par arête) et le nuanceur qui dessine
 * étages, fenêtres, corniche et porte reprend les mêmes constantes et le même hachage.
 * Rendu seulement : aucune collision ne dépend de ce module.
 */
import type { Building, Vec2 } from "./types";

/** Hauteur nominale d'un étage (m) : `nbEtages = round(h / ETAGE_M)`. */
export const ETAGE_M = 3.2;
/** Pas entre deux colonnes de fenêtres (m). */
export const PAS_COLONNE_M = 3;
/** Marge laissée à chaque bout d'un mur avant la première fenêtre (pilastre compris, m). */
export const MARGE_COLONNE_M = 1;
/** Fenêtre : largeur et hauteur (m). */
export const FENETRE_L_M = 1.3;
export const FENETRE_H_M = 1.4;
/** Porte du rez-de-chaussée : largeur et hauteur (m). */
export const PORTE_L_M = 1.6;
export const PORTE_H_M = 2.4;
/** Un mur plus court est lisse ; un bâtiment plus bas ou de moins de 40 m² l'est tout entier. */
export const LISSE_ARETE_M = 3;
export const LISSE_HAUTEUR_M = 3;
export const LISSE_EMPRISE_M2 = 40;
/** Part des fenêtres allumées. */
export const PART_ALLUMEES = 0.25;
/** Surface de toit par équipement (m²). */
export const TOIT_M2_PAR_EQUIPEMENT = 150;

export function aireSignee(r: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return a / 2;
}

/** Surface de toit (m²) : emprise moins les cours intérieures. */
export function aireEmprise(b: Pick<Building, "r" | "holes">): number {
  let a = Math.abs(aireSignee(b.r));
  for (const h of b.holes ?? []) a -= Math.abs(aireSignee(h));
  return Math.max(0, a);
}

export function nbEtages(h: number): number {
  return Math.max(1, Math.round(h / ETAGE_M));
}

/** Nombre de colonnes de fenêtres d'un mur de `L` m (0 : le mur ne tient pas une fenêtre). */
export function colonnes(L: number): number {
  const x = L - 2 * MARGE_COLONNE_M;
  if (x < FENETRE_L_M) return 0;
  return Math.max(1, Math.floor(x / PAS_COLONNE_M + 0.5));
}

export function murLisse(L: number): boolean {
  return L < LISSE_ARETE_M;
}

/** Bâtiment lisse (sans fenêtres ni équipements) : bas ou petit. */
export function estLisse(b: Pick<Building, "h" | "r" | "holes">): boolean {
  return b.h < LISSE_HAUTEUR_M || aireEmprise(b) < LISSE_EMPRISE_M2;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hachage des fenêtres allumées : entier 32 bits, identique au nuanceur (uint, produits modulo 2^32).
// ---------------------------------------------------------------------------------------------------------------------

function hachage32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Seuil du nuanceur : `(hachage & 0xffff) < SEUIL_ALLUMEES`. */
export const SEUIL_ALLUMEES = Math.round(PART_ALLUMEES * 65536);

/**
 * La fenêtre (étage, colonne) du bâtiment `aBat` est-elle allumée ? Déterministe (≈ 25 %). `mur` distingue les murs d'un même
 * bâtiment (le nuanceur passe `floor(L × 8 + 0,5)` : l'arrondi évite qu'une longueur ronde, interpolée avec une erreur de 1e-7, tombe au hasard d'un côté ou de l'autre de l'entier), pour que les façades ne se répètent pas.
 */
export function fenetreAllumee(aBat: number, etage: number, colonne: number, mur = 0): boolean {
  const cle = (Math.imul(aBat, 73856093) ^ Math.imul(etage, 19349663) ^ Math.imul(colonne, 83492791) ^ Math.imul(mur, 2654435761)) >>> 0;
  return (hachage32(cle) & 0xffff) < SEUIL_ALLUMEES;
}

// ---------------------------------------------------------------------------------------------------------------------
// Murs
// ---------------------------------------------------------------------------------------------------------------------

/** Un mur : arête d'un anneau extérieur ou d'une cour intérieure, orientée pour que sa face avant regarde vers l'extérieur du plein. */
export interface Mur {
  /** début et fin du mur (a → b), dans l'ordre d'un quad dont la face avant est la face visible */
  a: Vec2;
  b: Vec2;
  /** longueur (m) */
  L: number;
  /** normale sortante (du plein vers l'air), unitaire */
  nx: number;
  nz: number;
  /** mur d'une cour intérieure (tourné vers l'intérieur de la cour) */
  trou: boolean;
  /** porte du rez-de-chaussée sur ce mur */
  porte: boolean;
  /** mur sans motif (arête courte ou bâtiment lisse) */
  lisse: boolean;
  /** numéro de l'arête dans son anneau (arête i : r[i] → r[i + 1]) */
  arete: number;
}

/**
 * Murs d'un bâtiment. `porteArete` est le numéro d'arête de l'anneau extérieur qui porte la porte (cf. `murDePorte`), ou null.
 * Les arêtes de moins de 1 cm sont ignorées.
 */
export function mursDe(b: Pick<Building, "h" | "r" | "holes">, porteArete: number | null = null): Mur[] {
  const lisseBat = estLisse(b);
  const murs: Mur[] = [];
  const anneau = (r: readonly Vec2[], trou: boolean) => {
    const s = aireSignee(r) >= 0 ? 1 : -1;
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      // normale sortante de l'anneau : (dz, -dx) pour une aire signée positive ; une cour est inversée
      let nx = (s * dz) / L, nz = (-s * dx) / L;
      if (trou) { nx = -nx; nz = -nz; }
      // face avant d'un quad A, B (bas), B (haut) : normale (-dz, dx) ; sinon on parcourt l'arête à l'envers
      const avant = -dz * nx + dx * nz > 0;
      murs.push({
        a: avant ? p : q, b: avant ? q : p, L, nx, nz, trou,
        porte: !trou && porteArete === i, lisse: lisseBat || murLisse(L), arete: i,
      });
    }
  };
  anneau(b.r, false);
  for (const h of b.holes ?? []) anneau(h, true);
  return murs;
}

type Routes = readonly { readonly p: readonly Vec2[] }[];

/** Point le plus proche de (x, z) sur les routes (`d` = distance au carré), ou null sans route. */
function pointRouteProche(x: number, z: number, routes: Routes): { d2: number; x: number; z: number } | null {
  let d2 = Infinity, qx = 0, qz = 0;
  for (const r of routes) {
    for (let i = 0; i < r.p.length - 1; i++) {
      const ax = r.p[i][0], az = r.p[i][1];
      const ux = r.p[i + 1][0] - ax, uz = r.p[i + 1][1] - az, l2 = ux * ux + uz * uz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
      const px = ax + t * ux, pz = az + t * uz;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < d2) { d2 = d; qx = px; qz = pz; }
    }
  }
  return d2 === Infinity ? null : { d2, x: qx, z: qz };
}

/**
 * Numéro d'arête (anneau extérieur) qui porte la porte : le mur le plus long dont la normale sortante regarde la route la plus
 * proche du bâtiment. Sans route, ou si aucun mur ne regarde la route, le mur le plus long. Null pour un bâtiment lisse.
 */
export function murDePorte(b: Pick<Building, "h" | "r" | "holes">, routes: Routes): number | null {
  if (estLisse(b)) return null;
  const murs = mursDe(b).filter((m) => !m.trou);
  if (!murs.length) return null;
  // route la plus proche du bâtiment : le point de route le plus près d'un milieu de mur
  let q: { d2: number; x: number; z: number } | null = null;
  for (const m of murs) {
    const p = pointRouteProche((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, routes);
    if (p && (!q || p.d2 < q.d2)) q = p;
  }
  const plusLong = (liste: Mur[]) => liste.reduce((x, y) => (y.L > x.L ? y : x));
  if (!q) return plusLong(murs).arete;
  const regardent = murs.filter((m) => m.L >= LISSE_ARETE_M
    && m.nx * (q.x - (m.a[0] + m.b[0]) / 2) + m.nz * (q.z - (m.a[1] + m.b[1]) / 2) > 0);
  return plusLong(regardent.length ? regardent : murs).arete;
}

// ---------------------------------------------------------------------------------------------------------------------
// Équipements de toit
// ---------------------------------------------------------------------------------------------------------------------

export type TypeEquipement = "clim" | "edicule" | "antenne";

export interface Equipement {
  type: TypeEquipement;
  /** centre au sol de la boîte (m) ; la boîte pose sur le toit (y = h) */
  x: number;
  z: number;
  /** dimensions (m) avant rotation */
  sx: number;
  sy: number;
  sz: number;
  /** rotation autour de l'axe vertical (rad) : celle du plus long mur, pour que ça paraisse posé */
  rot: number;
}

/** Dimensions des équipements (m). */
export const DIMENSIONS: Record<TypeEquipement, readonly [number, number, number]> = {
  clim: [1.5, 1, 1.2],
  edicule: [2.6, 2.2, 2.6],
  antenne: [0.14, 3.6, 0.14],
};

function mulberry32(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dansAnneau(x: number, z: number, r: readonly Vec2[]): boolean {
  let d = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) d = !d;
  }
  return d;
}

function distanceAnneau(x: number, z: number, r: readonly Vec2[]): number {
  let m = Infinity;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
    m = Math.min(m, Math.hypot(x - ax - t * ux, z - az - t * uz));
  }
  return m;
}

/**
 * Équipements d'un toit : ≈ 1 par 150 m² (caissons de clim, édicules, antennes), hors du bord et des cours intérieures,
 * deux équipements jamais l'un dans l'autre. Déterministe pour un même (bâtiment, graine) ; aucun pour un bâtiment lisse.
 */
export function placementsToit(b: Pick<Building, "h" | "r" | "holes">, graine: number): Equipement[] {
  if (estLisse(b)) return [];
  const alea = mulberry32(Math.imul(graine | 0, 2654435761) ^ 0x9e3779b9);
  const nombre = Math.floor(aireEmprise(b) / TOIT_M2_PAR_EQUIPEMENT + alea());
  if (nombre <= 0) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of b.r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const murs = mursDe(b).filter((m) => !m.trou);
  const long = murs.length ? murs.reduce((u, v) => (v.L > u.L ? v : u)) : null;
  const rot = long ? -Math.atan2(long.b[1] - long.a[1], long.b[0] - long.a[0]) : 0;
  const out: Equipement[] = [];
  const rayons: number[] = [];
  for (let k = 0; k < nombre; k++) {
    const t = alea();
    const type: TypeEquipement = t < 0.6 ? "clim" : t < 0.85 ? "edicule" : "antenne";
    const [sx, sy, sz] = DIMENSIONS[type];
    const rayon = Math.hypot(sx, sz) / 2;
    for (let essai = 0; essai < 40; essai++) {
      const x = x0 + alea() * (x1 - x0), z = z0 + alea() * (z1 - z0);
      if (!dansAnneau(x, z, b.r)) continue;
      if ((b.holes ?? []).some((h) => dansAnneau(x, z, h))) continue;
      const marge = rayon + 0.8;
      if (distanceAnneau(x, z, b.r) < marge) continue;
      if ((b.holes ?? []).some((h) => distanceAnneau(x, z, h) < marge)) continue;
      if (out.some((o, i) => Math.hypot(o.x - x, o.z - z) < rayons[i] + rayon + 0.8)) continue;
      out.push({ type, x, z, sx, sy, sz, rot });
      rayons.push(rayon);
      break;
    }
  }
  return out;
}
