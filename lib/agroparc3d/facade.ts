/**
 * Façades des bâtiments d'Agroparc (arène FPS) : fonctions PURES, sans three ni DOM.
 * `decor.ts` s'en sert pour construire les murs (un quad par arête) et le nuanceur qui dessine
 * étages, fenêtres, corniche et porte reprend les mêmes constantes et le même hachage.
 * Rendu seulement : aucune collision ne dépend de ce module.
 */
import { hachage32, mulberry32 } from "./hasard";
import type { Building, PoiType, Vec2 } from "./types";

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
/** Porte sectionnelle des bâtiments industriels (m). */
export const INDUSTRIEL_PORTE_L_M = 4;
export const INDUSTRIEL_PORTE_H_M = 3.2;
/** Rez-de-chaussée vitré d'une façade percée : bas et haut de la vitrine (m). */
export const VITRINE_BAS_M = 0.35;
export const VITRINE_HAUT_M = 2.6;
/** Mur rideau : côté d'une cellule vitrée (m). */
export const MUR_RIDEAU_CELLULE_M = 1.5;
/** Enseigne néon d'un restaurant : barre ambre au-dessus de la porte (largeur, hauteur, hauteur du centre, m). */
export const ENSEIGNE_L_M = 2.4;
export const ENSEIGNE_H_M = 0.28;
export const ENSEIGNE_Y_M = 2.7;
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

export type TypeEquipement = "clim" | "edicule" | "antenne" | "solaire";

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
  /** inclinaison autour de l'axe horizontal de la boîte (rad) : les panneaux solaires seulement */
  incl?: number;
}

/** Dimensions des équipements (m). */
export const DIMENSIONS: Record<TypeEquipement, readonly [number, number, number]> = {
  clim: [1.5, 1, 1.2],
  edicule: [2.6, 2.2, 2.6],
  antenne: [0.14, 3.6, 0.14],
  solaire: [3, 0.12, 1.6],
};

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

// ---------------------------------------------------------------------------------------------------------------------
// Panneaux solaires (D6) : un tirage à part, jamais mêlé à celui de `placementsToit` (ses positions ne bougent pas)
// ---------------------------------------------------------------------------------------------------------------------

/** Un toit plat de plus de cette surface (m²) peut porter des panneaux solaires. */
export const SOLAIRE_MIN_M2 = 300;
/** Inclinaison des panneaux (rad). */
export const SOLAIRE_INCLINAISON = (25 * Math.PI) / 180;

/**
 * Panneaux solaires d'un toit : un tirage (≈ 60 % des toits de plus de 300 m²), de 2 panneaux côte à côte, inclinés, hors du bord. Déterministe pour un
 * même (bâtiment, graine) ; aucun pour un bâtiment lisse ou de moins de 300 m². Tirage indépendant de `placementsToit` (autre graine).
 */
export function placementsSolaires(b: Pick<Building, "h" | "r" | "holes">, graine: number): Equipement[] {
  if (estLisse(b) || aireEmprise(b) < SOLAIRE_MIN_M2) return [];
  const alea = mulberry32(Math.imul(graine | 0, 2246822519) ^ 0x85ebca6b);
  if (alea() > 0.6) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of b.r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const murs = mursDe(b).filter((m) => !m.trou);
  const long = murs.length ? murs.reduce((u, v) => (v.L > u.L ? v : u)) : null;
  const rot = long ? -Math.atan2(long.b[1] - long.a[1], long.b[0] - long.a[0]) : 0;
  const [sx, sy, sz] = DIMENSIONS.solaire;
  const out: Equipement[] = [];
  for (let essai = 0; essai < 60 && out.length < 1; essai++) {
    const x = x0 + alea() * (x1 - x0), z = z0 + alea() * (z1 - z0);
    // le centre d'un couple de panneaux (2 × 3 m), loin des bords et des cours
    const c = Math.cos(rot), si = Math.sin(rot);
    const pts: Vec2[] = [[x, z], [x + c * 3.2, z - si * 3.2], [x - c * 3.2, z + si * 3.2]];
    if (!pts.every(([px, pz]) => dansAnneau(px, pz, b.r) && distanceAnneau(px, pz, b.r) > 2.5 && !(b.holes ?? []).some((h) => dansAnneau(px, pz, h) || distanceAnneau(px, pz, h) < 2.5))) continue;
    out.push({ type: "solaire", x: pts[1][0], z: pts[1][1], sx, sy, sz, rot, incl: SOLAIRE_INCLINAISON });
    out.push({ type: "solaire", x: pts[2][0], z: pts[2][1], sx, sy, sz, rot, incl: SOLAIRE_INCLINAISON });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Acrotère : liseré intérieur d'un toit, à 0,5 m du bord
// ---------------------------------------------------------------------------------------------------------------------

/** Distance du liseré d'acrotère au bord du toit (m) et surface minimale d'un toit qui en porte un (m²). */
export const ACROTERE_M = 0.5;
export const ACROTERE_MIN_M2 = 100;

/**
 * Liseré d'acrotère : l'anneau extérieur décalé de 0,5 m vers l'intérieur (miter limité). Vide pour un bâtiment lisse, de moins de 100 m², ou si le
 * décalage sort de l'emprise (anneau trop fin ou trop concave). Segments [ax, az, bx, bz, …].
 */
export function acrotere(b: Pick<Building, "h" | "r" | "holes">): number[] {
  if (estLisse(b) || aireEmprise(b) < ACROTERE_MIN_M2 || b.r.length < 3) return [];
  const sens = aireSignee(b.r) >= 0 ? 1 : -1;
  const n = b.r.length;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = b.r[(i + n - 1) % n], c = b.r[i], d = b.r[(i + 1) % n];
    const l1 = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, l2 = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1;
    // normales intérieures des deux arêtes : (−dz, dx) pour une aire signée positive
    const n1: Vec2 = [(-sens * (c[1] - a[1])) / l1, (sens * (c[0] - a[0])) / l1], n2: Vec2 = [(-sens * (d[1] - c[1])) / l2, (sens * (d[0] - c[0])) / l2];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const L = Math.hypot(mx, mz);
    if (L < 1e-6) return [];
    mx /= L; mz /= L;
    const k = ACROTERE_M / Math.max(0.5, mx * n1[0] + mz * n1[1]);
    pts.push([c[0] + mx * k, c[1] + mz * k]);
  }
  if (!pts.every(([x, z]) => dansAnneau(x, z, b.r) && !(b.holes ?? []).some((h) => dansAnneau(x, z, h)))) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(pts[i][0], pts[i][1], pts[(i + 1) % n][0], pts[(i + 1) % n][1]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Styles de façade (D6) : hypothèses de paysage tertiaire, isolées dans cette table
// ---------------------------------------------------------------------------------------------------------------------

export type StyleFacade = "percee" | "bandeau" | "mur_rideau" | "industriel";

/** Code du style dans l'attribut `aStyle` (bits bas) ; le drapeau « restaurant » (enseigne néon) est le bit 3, soit +8. */
export const CODE_STYLE: Record<StyleFacade, number> = { percee: 0, bandeau: 1, mur_rideau: 2, industriel: 3 };
export const BIT_RESTO = 8;

/** Parts visées (parmi les styles admissibles) : façade percée 50 %, bandeau 25 %, mur rideau 15 %, industriel 10 %. */
export const PARTS_STYLE: Record<StyleFacade, number> = { percee: 0.5, bandeau: 0.25, mur_rideau: 0.15, industriel: 0.1 };
/** Conditions d'admission : bandeau dès 2 étages, mur rideau si h ≥ 9 m et emprise ≥ 150 m², industriel si h < 7 m et emprise ≥ 400 m². */
export const MUR_RIDEAU_H_MIN_M = 9;
export const MUR_RIDEAU_M2_MIN = 150;
export const INDUSTRIEL_H_MAX_M = 7;
export const INDUSTRIEL_M2_MIN = 400;

/**
 * Style de façade d'un bâtiment (déterministe : hachage de `id`). Les restaurants et la base sont toujours « percée » (enseigne néon pour les restos) ;
 * un bâtiment lisse aussi. `simple` (qualité basse) retombe sur « percée » pour le mur rideau et l'industriel.
 */
export function styleFacade(b: Pick<Building, "h" | "r" | "holes">, id: number, poiType?: PoiType, simple = false): StyleFacade {
  if (poiType === "home" || poiType === "resto" || estLisse(b)) return "percee";
  const aire = aireEmprise(b);
  const admis: StyleFacade[] = ["percee"];
  if (nbEtages(b.h) >= 2) admis.push("bandeau");
  if (!simple && b.h >= MUR_RIDEAU_H_MIN_M && aire >= MUR_RIDEAU_M2_MIN) admis.push("mur_rideau");
  if (!simple && b.h < INDUSTRIEL_H_MAX_M && aire >= INDUSTRIEL_M2_MIN) admis.push("industriel");
  const total = admis.reduce((t, k) => t + PARTS_STYLE[k], 0);
  let r = (hachage32((Math.imul(id | 0, 2654435761) ^ 0x2f6b5c11) >>> 0) / 4294967296) * total;
  for (const k of admis) { r -= PARTS_STYLE[k]; if (r < 0) return k; }
  return "percee";
}

/** Valeur de l'attribut `aStyle` d'un bâtiment. */
export function codeFacade(b: Pick<Building, "h" | "r" | "holes">, id: number, poiType?: PoiType, simple = false): number {
  return CODE_STYLE[styleFacade(b, id, poiType, simple)] + (poiType === "resto" ? BIT_RESTO : 0);
}

/** Teinte d'accent d'un bâtiment (0 cyan, 1 bleu-vert, 2 gris-bleu) : trois nuances, toutes sous le seuil du bloom. */
export function teinteBatiment(id: number): number {
  return hachage32((Math.imul(id | 0, 0x9e3779b1) ^ 0x1b873593) >>> 0) % 3;
}
