/**
 * Voirie d'Agroparc (PUR, sans three ni DOM) : de simples axes de `scene.json` on dérive la chaussée (ruban), ses bords, les trottoirs, l'axe
 * pointillé, les passages piétons, les lignes d'arrêt, les dents de requin et le rond-point. Rendu seulement : aucune collision n'en dépend.
 *
 * Toutes les sorties sont des tableaux plats de nombres (repère de scene.json, x est, z sud) :
 *  - « segments » : [ax, az, bx, bz, …], pour un `LineSegments` ;
 *  - « triangles » : [x, z, x, z, x, z, …], pour un `Mesh` à plat (le rendu choisit la hauteur).
 * Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D2, D3).
 */
import { trouverRondPoint } from "../fps/zones";
import { Grille, croisement, dansAnneau, pointSegment } from "./geo";
import type { Building, Road, RoadClass, SceneData, Vec2 } from "./types";

/** Demi-largeur de la chaussée par classe de voie (m) : M 7 m (les voitures PNJ roulent à 2,1 m de l'axe, les bus à 2,6 m), R 5,5 m, S 3,8 m (allées). */
export const DEMI_LARGEUR: Record<RoadClass, number> = { M: 3.5, R: 2.75, S: 1.9, F: 0 };
/** Distance du trottoir au bord de la chaussée (m). */
export const TROTTOIR_M = 1.8;
/** Pas d'échantillonnage des bords (m). */
const PAS_BORD_M = 2;
/** Axe pointillé : trait et vide (m). */
export const AXE_TRAIT_M = 3;
export const AXE_VIDE_M = 6;
/** Passage piéton : longueur dans le sens de la circulation, largeur et espacement des bandes (m). */
export const ZEBRA_LONG_M = 3;
export const ZEBRA_BANDE_M = 0.5;
export const ZEBRA_PAS_M = 1;
/** Plafond de passages piétons et distance de dédoublonnage (m). */
export const PASSAGES_MAX = 160;
const PASSAGES_DEDOUBLONNAGE_M = 6;
/** Une voie piétonne plus courte ne fait pas traverser une allée S (m). */
const PIETON_MIN_S_M = 25;
/** Trottoir absent à moins de cette distance d'un bâtiment (m). */
const TROTTOIR_BATIMENT_M = 4;

export interface Passage {
  /** centre, sur l'axe de la voie */
  x: number;
  z: number;
  /** sens de la circulation (unitaire) */
  ux: number;
  uz: number;
  /** demi-largeur de la chaussée traversée */
  demi: number;
  /** vient d'OpenStreetMap (sinon croisement d'une voie piétonne) */
  osm: boolean;
}

/** Stop ou cédez-le-passage OSM ramené sur la voie : position sur l'axe, sens d'arrivée (unitaire) et demi-largeur. */
export interface Arret {
  genre: "stop" | "cedez";
  x: number;
  z: number;
  ux: number;
  uz: number;
  demi: number;
}

export interface Entree {
  /** point d'entrée du rond-point sur la branche (m) et sens d'arrivée (vers le rond-point), unitaire */
  x: number;
  z: number;
  ux: number;
  uz: number;
  demi: number;
}

export interface Voirie {
  /** chaussée M et R en triangles */
  ruban: number[];
  /** bords de chaussée, segments, par classe */
  bordsM: number[];
  bordsR: number[];
  /** trottoirs, segments */
  trottoirs: number[];
  /** axe pointillé des voies M, segments */
  axes: number[];
  /** bandes des passages piétons, triangles */
  zebras: number[];
  passages: Passage[];
  /** lignes d'arrêt (stops et cédez-le-passage OSM), triangles */
  lignesArret: number[];
  arrets: Arret[];
  /** dents de requin à chaque entrée du rond-point, triangles */
  dents: number[];
  /** flèches (chevrons) d'entrée du rond-point, triangles */
  fleches: number[];
  entrees: Entree[];
  /** rond-point : centre, rayon de l'axe, rayon de l'îlot central */
  giratoire: { centre: Vec2; rayon: number; ilot: number } | null;
  /** contour de l'îlot central, segments */
  ilotBord: number[];
}

/** Segments d'un cercle de rayon `r` approché par `n` côtés. */
function cercle(cx: number, cz: number, r: number, n = 48): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    out.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r, cx + Math.cos(b) * r, cz + Math.sin(b) * r);
  }
  return out;
}

export interface Seg { road: number; k: number; ax: number; az: number; bx: number; bz: number; demi: number }

function longueur(p: readonly Vec2[]): number {
  let L = 0;
  for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  return L;
}

/** Contexte partagé des fonctions : grilles de segments, rond-point. */
export interface Contexte {
  data: SceneData;
  /** segments des voies à chaussée (M et R) */
  chaussees: Grille<Seg>;
  /** segments de toutes les voies carrossables (M, R, S) */
  carrossables: Grille<Seg>;
  /** arêtes de bâtiments */
  murs: Grille<[number, number, number, number]>;
  /** bâtiments rangés par boîte englobante */
  batiments: Grille<Building>;
  rond: { centre: Vec2; rayon: number } | null;
  /** voies M qui sont des arcs du rond-point */
  arcs: Set<number>;
}

function creerContexte(data: SceneData): Contexte {
  const chaussees = new Grille<Seg>(16), carrossables = new Grille<Seg>(16), murs = new Grille<[number, number, number, number]>(16), batiments = new Grille<Building>(32);
  const rond = trouverRondPoint(data);
  const arcs = new Set<number>();
  data.roads.forEach((r, i) => {
    if (r.c === "F") return;
    if (rond && r.c === "M" && r.p.every(([x, z]) => Math.abs(Math.hypot(x - rond.centre[0], z - rond.centre[1]) - rond.rayon) < 2)) arcs.add(i);
    for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      const s: Seg = { road: i, k, ax, az, bx, bz, demi: DEMI_LARGEUR[r.c] };
      carrossables.ajouter(ax, az, bx, bz, s);
      if (r.c === "M" || r.c === "R") chaussees.ajouter(ax, az, bx, bz, s);
    }
  });
  for (const b of data.buildings) {
    if (b.type && b.type !== "mur") continue;
    batiments.ajouter(Math.min(...b.r.map((p) => p[0])), Math.min(...b.r.map((p) => p[1])), Math.max(...b.r.map((p) => p[0])), Math.max(...b.r.map((p) => p[1])), b);
    for (let i = 0; i < b.r.length; i++) {
      const [ax, az] = b.r[i], [bx, bz] = b.r[(i + 1) % b.r.length];
      murs.ajouter(ax, az, bx, bz, [ax, az, bx, bz]);
    }
  }
  return { data, chaussees, carrossables, murs, batiments, rond, arcs };
}

/** Distance d'un point au bâtiment le plus proche (0 dedans), plafonnée à `max`. */
export function distanceBatiment(c: Contexte, x: number, z: number, max: number): number {
  let m = max;
  c.murs.proches(x, z, max, ([ax, az, bx, bz]) => { m = Math.min(m, pointSegment(x, z, ax, az, bx, bz).d); });
  return m > 0 && dansBatiment(c, x, z) ? 0 : m;
}

/** Le point est-il dans un bâtiment (hors cours intérieures) ? */
export function dansBatiment(c: Contexte, x: number, z: number): boolean {
  let dedans = false;
  c.batiments.proches(x, z, 0, (b) => { if (!dedans && dansAnneau(x, z, b.r) && !(b.holes ?? []).some((h) => dansAnneau(x, z, h))) dedans = true; });
  return dedans;
}

/**
 * Le point (x, z), échantillon de la voie `road` dont le sens local est (ux, uz), tombe-t-il dans la chaussée d'une AUTRE voie élargie de `marge` ?
 * Une voie qui prolonge simplement la nôtre (même sens, au bout de la polyligne) ne compte pas : sinon chaque jonction de deux tronçons d'une
 * même rue serait coupée.
 */
function dansAutreChaussee(c: Contexte, x: number, z: number, road: number, ux: number, uz: number, marge: number): boolean {
  let dedans = false;
  c.chaussees.proches(x, z, 8, (s) => {
    if (dedans || s.road === road) return;
    const q = pointSegment(x, z, s.ax, s.az, s.bx, s.bz);
    if (q.d >= s.demi + marge) return;
    const p = c.data.roads[s.road].p;
    const bout = (s.k === 0 && q.t === 0) || (s.k === p.length - 2 && q.t === 1);
    if (bout) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
      if (Math.abs(((s.bx - s.ax) / L) * ux + ((s.bz - s.az) / L) * uz) > 0.82) return;
    }
    dedans = true;
  });
  return dedans;
}

/** Normales de miter aux sommets d'une polyligne (unitaires, longueur ≤ 1,6 pour ne pas pointer aux angles vifs). */
function normalesSommets(p: readonly Vec2[]): Vec2[] {
  const n: Vec2[] = [];
  const dir = (i: number): Vec2 => {
    const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  };
  for (let i = 0; i < p.length; i++) {
    const a = i > 0 ? dir(i - 1) : dir(0), b = i < p.length - 1 ? dir(i) : dir(p.length - 2);
    // normale gauche (−uz, ux) de chacun, moyenne puis renormalisée avec la correction 1/cos(demi-angle)
    let mx = -(a[1] + b[1]), mz = a[0] + b[0];
    const L = Math.hypot(mx, mz);
    if (L < 1e-6) { n.push([-a[1], a[0]]); continue; }
    mx /= L; mz /= L;
    const cos = Math.max(mx * -a[1] + mz * a[0], 0.62);
    n.push([mx / cos, mz / cos]);
  }
  return n;
}

/** Sens local (unitaire) d'une voie au point d'abscisse (segment k). */
function sens(p: readonly Vec2[], k: number): Vec2 {
  const dx = p[k + 1][0] - p[k][0], dz = p[k + 1][1] - p[k][1], L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}

/**
 * Ligne parallèle à chaque voie à `decalage(demi)` de son axe, des deux côtés, découpée en morceaux de ~2 m ; un morceau dont le milieu tombe
 * dans la chaussée d'une autre voie (élargie de `marge`) ou que `garder` refuse est supprimé : c'est ce qui dessine les carrefours.
 */
function bords(c: Contexte, classes: readonly RoadClass[], decalage: (demi: number) => number, marge: number, garder?: (x: number, z: number) => boolean): Record<string, number[]> {
  const sortie: Record<string, number[]> = {};
  c.data.roads.forEach((r: Road, i) => {
    if (!classes.includes(r.c) || r.p.length < 2) return;
    const out = (sortie[r.c] ??= []);
    const off = decalage(DEMI_LARGEUR[r.c]);
    const nm = normalesSommets(r.p);
    for (const cote of [1, -1]) {
      const pts: Vec2[] = r.p.map((p, k) => [p[0] + cote * nm[k][0] * off, p[1] + cote * nm[k][1] * off]);
      for (let k = 0; k < pts.length - 1; k++) {
        const L = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
        const n = Math.max(1, Math.round(L / PAS_BORD_M));
        const [ux, uz] = sens(r.p, k);
        for (let j = 0; j < n; j++) {
          const t0 = j / n, t1 = (j + 1) / n, tm = (t0 + t1) / 2;
          const mx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * tm, mz = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * tm;
          if (dansAutreChaussee(c, mx, mz, i, ux, uz, marge)) continue;
          if (garder && !garder(mx, mz)) continue;
          out.push(
            pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t0, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t0,
            pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t1, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t1,
          );
        }
      }
    }
  });
  return sortie;
}

/** Ruban de chaussée (triangles) de chaque voie M et R : deux triangles par tronçon, aux sommets décalés de ± la demi-largeur. */
function ruban(c: Contexte): number[] {
  const t: number[] = [];
  for (const r of c.data.roads) {
    if ((r.c !== "M" && r.c !== "R") || r.p.length < 2) continue;
    const d = DEMI_LARGEUR[r.c], nm = normalesSommets(r.p);
    for (let k = 0; k < r.p.length - 1; k++) {
      const gA: Vec2 = [r.p[k][0] + nm[k][0] * d, r.p[k][1] + nm[k][1] * d], dA: Vec2 = [r.p[k][0] - nm[k][0] * d, r.p[k][1] - nm[k][1] * d];
      const gB: Vec2 = [r.p[k + 1][0] + nm[k + 1][0] * d, r.p[k + 1][1] + nm[k + 1][1] * d], dB: Vec2 = [r.p[k + 1][0] - nm[k + 1][0] * d, r.p[k + 1][1] - nm[k + 1][1] * d];
      t.push(gA[0], gA[1], dA[0], dA[1], gB[0], gB[1], dA[0], dA[1], dB[0], dB[1], gB[0], gB[1]);
    }
  }
  return t;
}

/** Axe pointillé des voies M (hors arcs du rond-point) : trait de 3 m puis vide de 6 m, coupé dans les carrefours. */
function axes(c: Contexte): number[] {
  const out: number[] = [];
  c.data.roads.forEach((r, i) => {
    if (r.c !== "M" || c.arcs.has(i)) return;
    let reste = 0; // distance parcourue dans le motif (0..9)
    for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const [ux, uz] = [(bx - ax) / L, (bz - az) / L];
      let s = 0;
      while (s < L) {
        const phase = reste % (AXE_TRAIT_M + AXE_VIDE_M);
        if (phase < AXE_TRAIT_M) {
          const fin = Math.min(L, s + (AXE_TRAIT_M - phase));
          const mx = ax + ux * ((s + fin) / 2), mz = az + uz * ((s + fin) / 2);
          const rondProche = c.rond && Math.hypot(mx - c.rond.centre[0], mz - c.rond.centre[1]) < c.rond.rayon + DEMI_LARGEUR.M + 2;
          if (!rondProche && !dansAutreChaussee(c, mx, mz, i, ux, uz, 1.5)) out.push(ax + ux * s, az + uz * s, ax + ux * fin, az + uz * fin);
          reste += fin - s;
          s = fin;
        } else {
          const fin = Math.min(L, s + (AXE_TRAIT_M + AXE_VIDE_M - phase));
          reste += fin - s;
          s = fin;
        }
      }
    }
  });
  return out;
}

/** Voie carrossable (M, R, S) la plus proche d'un point, à moins de `max` m. */
export function voieProche(c: Contexte, x: number, z: number, max: number): { seg: Seg; x: number; z: number; d: number } | null {
  let m: { seg: Seg; x: number; z: number; d: number } | null = null;
  c.carrossables.proches(x, z, max, (s) => {
    const q = pointSegment(x, z, s.ax, s.az, s.bx, s.bz);
    if (q.d <= max && (!m || q.d < m.d)) m = { seg: s, x: q.x, z: q.z, d: q.d };
  });
  return m;
}

/** Passages piétons : nœuds OSM `highway=crossing` ramenés sur l'axe de la voie, puis croisements d'une voie piétonne et d'une voie carrossable. */
function passagesPietons(c: Contexte): Passage[] {
  const cand: Passage[] = [];
  const poser = (x: number, z: number, seg: Seg, osm: boolean) => {
    const L = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
    cand.push({ x, z, ux: (seg.bx - seg.ax) / L, uz: (seg.bz - seg.az) / L, demi: seg.demi, osm });
  };
  for (const [px, pz] of c.data.decor?.passages ?? []) {
    const v = voieProche(c, px, pz, 8);
    if (v) poser(v.x, v.z, v.seg, true);
  }
  // croisements : voie piétonne (F) × voie carrossable, où la voie piétonne traverse (le croisement n'est pas à son bout)
  const trouves: { x: number; z: number; seg: Seg; ordre: number }[] = [];
  c.data.roads.forEach((r) => {
    if (r.c !== "F" || r.p.length < 2) return;
    const Lf = longueur(r.p);
    for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      c.carrossables.proches((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + 1, (s) => {
        const x = croisement(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz);
        if (!x) return;
        const finDeVoie = (k === 0 && x.t === 0) || (k === r.p.length - 2 && x.t === 1);
        if (finDeVoie) return;
        if (c.data.roads[s.road].c === "S" && Lf < PIETON_MIN_S_M) return;
        trouves.push({ x: x.x, z: x.z, seg: s, ordre: s.road });
      });
    }
  });
  // M puis R puis S, puis position : déterministe
  const rang = { M: 0, R: 1, S: 2, F: 3 } as const;
  trouves.sort((a, b) => rang[c.data.roads[a.seg.road].c] - rang[c.data.roads[b.seg.road].c] || a.x - b.x || a.z - b.z);
  for (const t of trouves) poser(t.x, t.z, t.seg, false);
  // pas de passage sur le rond-point lui-même, ni dans un bâtiment ; dédoublonnage à 6 m (OSM d'abord)
  const gardes: Passage[] = [];
  const grille = new Grille<Passage>(PASSAGES_DEDOUBLONNAGE_M * 2);
  for (const p of cand) {
    if (gardes.length >= PASSAGES_MAX) break;
    if (c.rond && Math.hypot(p.x - c.rond.centre[0], p.z - c.rond.centre[1]) < c.rond.rayon + DEMI_LARGEUR.M + 2) continue;
    if (dansBatiment(c, p.x, p.z)) continue;
    let doublon = false;
    grille.proches(p.x, p.z, PASSAGES_DEDOUBLONNAGE_M, (q) => { if (Math.hypot(q.x - p.x, q.z - p.z) < PASSAGES_DEDOUBLONNAGE_M) doublon = true; });
    if (doublon) continue;
    grille.ajouter(p.x, p.z, p.x, p.z, p);
    gardes.push(p);
  }
  return gardes;
}

/** Quad (deux triangles) centré en (x, z), long de `l` selon (ux, uz) et large de `w`, décalé de `dec` selon la normale. */
function quad(out: number[], x: number, z: number, ux: number, uz: number, l: number, w: number, dec = 0): void {
  const nx = -uz, nz = ux;
  const cx = x + nx * dec, cz = z + nz * dec;
  const a: Vec2 = [cx - ux * l / 2 - nx * w / 2, cz - uz * l / 2 - nz * w / 2], b: Vec2 = [cx + ux * l / 2 - nx * w / 2, cz + uz * l / 2 - nz * w / 2];
  const d: Vec2 = [cx + ux * l / 2 + nx * w / 2, cz + uz * l / 2 + nz * w / 2], e: Vec2 = [cx - ux * l / 2 + nx * w / 2, cz - uz * l / 2 + nz * w / 2];
  out.push(a[0], a[1], b[0], b[1], d[0], d[1], a[0], a[1], d[0], d[1], e[0], e[1]);
}

function zebras(passages: readonly Passage[]): number[] {
  const out: number[] = [];
  for (const p of passages) {
    const k = Math.max(1, Math.floor((2 * p.demi) / ZEBRA_PAS_M));
    for (let j = 0; j < k; j++) quad(out, p.x, p.z, p.ux, p.uz, ZEBRA_LONG_M, ZEBRA_BANDE_M, (j - (k - 1) / 2) * ZEBRA_PAS_M);
  }
  return out;
}

/**
 * Lignes d'arrêt des stops et cédez-le-passage OSM : une barre de 0,5 m sur la moitié droite de la chaussée dans le sens d'arrivée, vers le
 * rond-point s'il est à moins de 80 m, sinon vers le bout de voie le plus proche.
 */
function lignesArret(c: Contexte): { tri: number[]; arrets: Arret[] } {
  const tri: number[] = [], arrets: Arret[] = [];
  const d = c.data.decor;
  if (!d) return { tri, arrets };
  for (const [genre, liste] of [["stop", d.stops], ["cedez", d.cedez]] as const) {
    for (const [px, pz] of liste) {
      const v = voieProche(c, px, pz, 8);
      if (!v) continue;
      const p = c.data.roads[v.seg.road].p;
      let [ux, uz] = sens(p, v.seg.k);
      // sens d'arrivée : vers le rond-point, sinon vers le bout de voie le plus proche
      let cx: number, cz: number;
      if (c.rond && Math.hypot(v.x - c.rond.centre[0], v.z - c.rond.centre[1]) < 80) [cx, cz] = c.rond.centre;
      else {
        const a = p[0], b = p[p.length - 1];
        [cx, cz] = Math.hypot(v.x - a[0], v.z - a[1]) < Math.hypot(v.x - b[0], v.z - b[1]) ? a : b;
      }
      if ((cx - v.x) * ux + (cz - v.z) * uz < 0) { ux = -ux; uz = -uz; }
      // moitié droite du sens d'arrivée : normale droite (−uz, ux) en repère x est / z sud
      const demi = v.seg.demi;
      quad(tri, v.x, v.z, ux, uz, 0.5, demi, demi / 2);
      arrets.push({ genre, x: v.x, z: v.z, ux, uz, demi });
    }
  }
  return { tri, arrets };
}

/** Entrées du rond-point : voies M/R non circulaires dont un bout touche l'anneau ; point à 5 m du bout, sens vers le rond-point. */
function entreesRond(c: Contexte): Entree[] {
  const rond = c.rond;
  if (!rond) return [];
  const out: Entree[] = [];
  c.data.roads.forEach((r, i) => {
    if ((r.c !== "M" && r.c !== "R") || c.arcs.has(i)) return;
    for (const fin of [0, 1]) {
      const bout = fin === 0 ? r.p[0] : r.p[r.p.length - 1];
      if (Math.abs(Math.hypot(bout[0] - rond.centre[0], bout[1] - rond.centre[1]) - rond.rayon) > 3) continue;
      // marcher le long de la voie, depuis le bout, sur 5 m
      const pts = fin === 0 ? r.p : [...r.p].reverse();
      let reste = 5, x = pts[0][0], z = pts[0][1], ux = 0, uz = 0;
      for (let k = 0; k < pts.length - 1 && reste > 0; k++) {
        const L = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
        if (L < 1e-6) continue;
        const pas = Math.min(reste, L);
        ux = (pts[k][0] - pts[k + 1][0]) / L; uz = (pts[k][1] - pts[k + 1][1]) / L; // vers le bout (le rond-point)
        x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * (pas / L); z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * (pas / L);
        reste -= pas;
      }
      if (ux === 0 && uz === 0) continue;
      out.push({ x, z, ux, uz, demi: DEMI_LARGEUR[r.c] });
    }
  });
  // déterministe
  return out.sort((a, b) => a.x - b.x || a.z - b.z);
}

/** Dents de requin (triangles de 0,6 × 0,4 m espacés de 0,8 m, pointe vers le rond-point) sur la moitié droite de chaque entrée. */
function dentsRequin(entrees: readonly Entree[]): number[] {
  const out: number[] = [];
  for (const e of entrees) {
    const nx = -e.uz, nz = e.ux; // droite du sens d'arrivée
    const n = Math.floor(e.demi / 0.8);
    for (let j = 0; j < n; j++) {
      const dec = 0.4 + j * 0.8;
      const bx = e.x + nx * dec, bz = e.z + nz * dec;
      out.push(
        bx - nx * 0.3, bz - nz * 0.3,
        bx + nx * 0.3, bz + nz * 0.3,
        bx + e.ux * 0.4, bz + e.uz * 0.4,
      );
    }
  }
  return out;
}

/** Chevron (flèche) d'entrée du rond-point : pointe vers l'anneau, à 9 m de l'entrée, sur la voie d'entrée. */
function flechesEntree(entrees: readonly Entree[]): number[] {
  const out: number[] = [];
  for (const e of entrees) {
    const nx = -e.uz, nz = e.ux;
    const bx = e.x - e.ux * 4 + nx * (e.demi / 2), bz = e.z - e.uz * 4 + nz * (e.demi / 2);
    // pointe, puis deux ailes
    out.push(
      bx + e.ux * 1.4, bz + e.uz * 1.4, bx - e.ux * 0.6 + nx * 0.8, bz - e.uz * 0.6 + nz * 0.8, bx - e.ux * 0.2, bz - e.uz * 0.2,
      bx + e.ux * 1.4, bz + e.uz * 1.4, bx - e.ux * 0.2, bz - e.uz * 0.2, bx - e.ux * 0.6 - nx * 0.8, bz - e.uz * 0.6 - nz * 0.8,
    );
  }
  return out;
}

const memoContexte = new WeakMap<object, { roads: unknown; c: Contexte }>();

/** Grilles de voies et de bâtiments de la scène, mémoïsées par `data.buildings` (partagées par voirie.ts, parkings.ts, vegetation.ts, mobilier.ts). */
export function contexteSol(data: SceneData): Contexte {
  const m = memoContexte.get(data.buildings);
  if (m && m.roads === data.roads) return m.c;
  const c = creerContexte(data);
  memoContexte.set(data.buildings, { roads: data.roads, c });
  return c;
}

const memo = new WeakMap<object, Voirie>();

/**
 * Voirie dérivée de `data.roads` (et des nœuds OSM de `data.decor` s'il existe). Déterministe et mémoïsée par `data.roads` : les copies de la
 * scène des zombies et du Battle Royale la partagent.
 */
export function deriverVoirie(data: SceneData): Voirie {
  const cle = data.roads;
  const vu = memo.get(cle);
  if (vu && (vu as Voirie & { decor?: unknown }).decor === data.decor) return vu;
  const c = contexteSol(data);
  const bordsChaussee = bords(c, ["M", "R"], (d) => d, 0);
  const trottoirs = bords(c, ["M", "R"], (d) => d + TROTTOIR_M, TROTTOIR_M, (x, z) => distanceBatiment(c, x, z, TROTTOIR_BATIMENT_M) >= TROTTOIR_BATIMENT_M);
  const passages = passagesPietons(c);
  const entrees = entreesRond(c);
  const arrets = lignesArret(c);
  const v: Voirie & { decor?: unknown } = {
    ruban: ruban(c),
    bordsM: bordsChaussee.M ?? [], bordsR: bordsChaussee.R ?? [],
    trottoirs: [...(trottoirs.M ?? []), ...(trottoirs.R ?? [])],
    axes: axes(c),
    zebras: zebras(passages), passages,
    lignesArret: arrets.tri, arrets: arrets.arrets,
    dents: dentsRequin(entrees), fleches: flechesEntree(entrees), entrees,
    giratoire: c.rond ? { centre: c.rond.centre, rayon: c.rond.rayon, ilot: c.rond.rayon - DEMI_LARGEUR.M } : null,
    ilotBord: c.rond ? cercle(c.rond.centre[0], c.rond.centre[1], c.rond.rayon - DEMI_LARGEUR.M) : [],
    decor: data.decor,
  };
  memo.set(cle, v);
  return v;
}
