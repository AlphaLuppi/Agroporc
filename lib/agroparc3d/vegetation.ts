/**
 * Végétation du décor (PUR) : type, échelle, rotation et teinte de chaque arbre de `scene.json`, haies, pelouses et arbustes dérivés de
 * `decor.json` (et du rond-point). Aucune essence n'est documentée dans OpenStreetMap : les types sont des HYPOTHÈSES de paysage provençal
 * (platanes d'alignement, pins parasols, cyprès, oliviers, feuillus), choisies par règles, isolées dans ce module. Rendu seulement.
 * Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D2, D4).
 */
import { alea01, hachagePos, mulberry32 } from "./hasard";
import { Grille, dansAnneau, dansBoite, distanceAnneau, pointSegment, type Boite } from "./geo";
import { DEMI_LARGEUR, contexteSol, dansBatiment, distanceBatiment, deriverVoirie } from "./voirie";
import type { SceneData, Vec2 } from "./types";

export type TypeArbre = "platane" | "pin" | "cypres" | "olivier" | "feuillu";
export const TYPES_ARBRE: readonly TypeArbre[] = ["platane", "pin", "cypres", "olivier", "feuillu"];

export interface ArbreClasse {
  /** position de `scene.trees` (jamais déplacée) */
  x: number;
  z: number;
  type: TypeArbre;
  /** échelle 0,75 à 1,3 */
  echelle: number;
  /** rotation autour de y (rad) */
  rot: number;
  /** variation de teinte 0,85 à 1,15 */
  teinte: number;
  /** platane de teinte d'automne (fin octobre) */
  automne: boolean;
  /** faux pour l'arbre planté dans un bâtiment : il est retiré du rendu seulement (le nombre d'arbres, lui, reste celui de `scene.trees`) */
  visible: boolean;
}

/** Part des platanes parmi les arbres d'un alignement près d'une voie, des cyprès / oliviers près d'un bâtiment, etc. */
const REGLES = {
  platane: 0.7,
  automne: 0.35,
  cypresBatiment: 0.3,
  olivierBatiment: 0.45,
  olivierParking: 0.3,
  pinOuvert: 0.35,
  /** distance à un bâtiment qui compte comme « près » (m) */
  prochePres: 8,
  /** distance d'une voie M ou R qui compte comme « d'alignement » (m) */
  procheVoie: 8,
} as const;

/** Segments de polylignes (alignements, haies) rangés dans une grille. */
function grilleLignes(lignes: readonly (readonly Vec2[])[]): Grille<[number, number, number, number]> {
  const g = new Grille<[number, number, number, number]>(16);
  for (const l of lignes) for (let i = 0; i < l.length - 1; i++) g.ajouter(l[i][0], l[i][1], l[i + 1][0], l[i + 1][1], [l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]]);
  return g;
}

function distanceLignes(g: Grille<[number, number, number, number]>, x: number, z: number, max: number): number {
  let d = max;
  g.proches(x, z, max, ([ax, az, bx, bz]) => { d = Math.min(d, pointSegment(x, z, ax, az, bx, bz).d); });
  return d;
}

function grilleAnneaux(anneaux: readonly (readonly Vec2[])[]): Grille<readonly Vec2[]> {
  const g = new Grille<readonly Vec2[]>(32);
  for (const r of anneaux) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    g.ajouter(x0, z0, x1, z1, r);
  }
  return g;
}

function dansUnAnneau(g: Grille<readonly Vec2[]>, x: number, z: number): boolean {
  let d = false;
  g.proches(x, z, 0, (r) => { if (!d && dansAnneau(x, z, r)) d = true; });
  return d;
}

const memoArbres = new WeakMap<object, { decor: unknown; liste: ArbreClasse[] }>();

/**
 * Classe chaque arbre de `data.trees`, dans le même ordre et à la même position. Règles (premier qui s'applique) : dans un bois OSM, pin ;
 * sur un alignement (OSM ou voisins alignés à 6–14 m) à moins de 8 m d'une voie M ou R, platane (70 %) ; près d'un bâtiment, cyprès (30 %) puis olivier
 * (45 %) ; dans un parking, olivier (30 %) ; en terrain ouvert, pin (35 %) ; sinon feuillu. Déterministe (hachage de la position).
 */
export function classerArbres(data: SceneData): ArbreClasse[] {
  const vu = memoArbres.get(data.trees);
  if (vu && vu.decor === data.decor) return vu.liste;
  const c = contexteSol(data);
  const decor = data.decor;
  const bois = grilleAnneaux(decor?.bois ?? []);
  const align = grilleLignes(decor?.alignements ?? []);
  const haies = grilleLignes(decor?.haies ?? []);
  const parkings = grilleAnneaux(data.parkings);
  const voisins = new Grille<number>(16);
  data.trees.forEach(([x, z], i) => voisins.ajouter(x, z, x, z, i));
  const liste = data.trees.map(([x, z], i): ArbreClasse => {
    const r = alea01(x, z, 1);
    const visible = !dansBatiment(c, x, z);
    let type: TypeArbre = "feuillu";
    const pres = distanceBatiment(c, x, z, REGLES.prochePres) < REGLES.prochePres;
    // à moins de 8 m d'une voie M ou R
    let pesVoie = false;
    c.chaussees.proches(x, z, REGLES.procheVoie + 4, (s) => { if (!pesVoie && pointSegment(x, z, s.ax, s.az, s.bx, s.bz).d <= REGLES.procheVoie + DEMI_LARGEUR[c.data.roads[s.road].c]) pesVoie = true; });
    // alignement : OSM (à 3 m), ou deux voisins de part et d'autre à 6–14 m, presque en ligne
    let aligne = distanceLignes(align, x, z, 3) < 3;
    if (!aligne && pesVoie) {
      const dirs: Vec2[] = [];
      voisins.proches(x, z, 14, (j) => {
        if (j === i) return;
        const d = Math.hypot(data.trees[j][0] - x, data.trees[j][1] - z);
        if (d >= 6 && d <= 14) dirs.push([(data.trees[j][0] - x) / d, (data.trees[j][1] - z) / d]);
      });
      aligne = dirs.some((a, k) => dirs.some((b, l) => l > k && a[0] * b[0] + a[1] * b[1] < -0.87));
    }
    if (dansUnAnneau(bois, x, z)) type = "pin";
    else if (aligne && pesVoie && r < REGLES.platane) type = "platane";
    else if (pres && alea01(x, z, 2) < REGLES.cypresBatiment) type = "cypres";
    else if (pres && alea01(x, z, 3) < REGLES.olivierBatiment / (1 - REGLES.cypresBatiment)) type = "olivier";
    else if (dansUnAnneau(parkings, x, z) && alea01(x, z, 4) < REGLES.olivierParking) type = "olivier";
    else if (!pres && alea01(x, z, 5) < REGLES.pinOuvert) type = "pin";
    else if (distanceLignes(haies, x, z, 2) < 2 && alea01(x, z, 6) < 0.3) type = "cypres";
    return {
      x, z, type, visible,
      echelle: 0.75 + alea01(x, z, 7) * 0.55,
      rot: alea01(x, z, 8) * Math.PI * 2,
      teinte: 0.85 + alea01(x, z, 9) * 0.3,
      automne: type === "platane" && alea01(x, z, 10) < REGLES.automne,
    };
  });
  memoArbres.set(data.trees, { decor: data.decor, liste });
  return liste;
}

// ---------------------------------------------------------------------------------------------------------------------
// Haies, pelouses, arbustes
// ---------------------------------------------------------------------------------------------------------------------

/** Longueur d'un tronçon de haie (m) : un tronçon = 0,9 m × 1,1 m de haut. */
export const HAIE_TRONCON_M = 0.9;
export const HAIE_HAUTEUR_M = 1.1;
/** Distance minimale d'une cachette du tigre au mobilier, aux haies et aux arbustes (m). */
export const DISTANCE_CACHETTE_M = 3;

export interface OptionsVegetation {
  qualite?: "haute" | "basse";
  exclure?: readonly Boite[];
  eviter?: readonly Vec2[];
}

/** Grille des positions à dégager (cachettes). */
function grilleEviter(eviter: readonly Vec2[] | undefined): Grille<Vec2> | null {
  if (!eviter?.length) return null;
  const g = new Grille<Vec2>(16);
  for (const p of eviter) g.ajouter(p[0], p[1], p[0], p[1], p);
  return g;
}
function pres(g: Grille<Vec2> | null, x: number, z: number, d: number): boolean {
  let p = false;
  g?.proches(x, z, d, (q) => { if (Math.hypot(q[0] - x, q[1] - z) < d) p = true; });
  return p;
}
const exclu = (b: readonly Boite[] | undefined, x: number, z: number) => !!b?.some((k) => dansBoite(x, z, k));

/**
 * Haies OSM découpées en tronçons de 0,9 m : [x, z, ux, uz, …] (centre et sens). Hors bâtiments, hors chaussée M et R, hors boîtes exclues,
 * à plus de 3 m d'une cachette ; rien en qualité basse.
 */
export function haies(data: SceneData, o: OptionsVegetation = {}): number[] {
  if (o.qualite === "basse" || !data.decor) return [];
  const c = contexteSol(data), ev = grilleEviter(o.eviter);
  const out: number[] = [];
  for (const l of data.decor.haies) {
    for (let i = 0; i < l.length - 1; i++) {
      const [ax, az] = l[i], [bx, bz] = l[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const n = Math.max(1, Math.round(L / HAIE_TRONCON_M)), ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let k = 0; k < n; k++) {
        const x = ax + ux * L * ((k + 0.5) / n), z = az + uz * L * ((k + 0.5) / n);
        if (exclu(o.exclure, x, z) || pres(ev, x, z, DISTANCE_CACHETTE_M) || dansBatiment(c, x, z)) continue;
        let surRoute = false;
        c.chaussees.proches(x, z, 6, (s) => { if (!surRoute && pointSegment(x, z, s.ax, s.az, s.bx, s.bz).d < s.demi + 0.3) surRoute = true; });
        if (surRoute) continue;
        out.push(x, z, ux, uz);
      }
    }
  }
  return out;
}

// -- triangulation (ear clipping) ----------------------------------------------------------------------------------------

function aireSignee(r: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
  return a / 2;
}

/** Triangule un anneau simple (oreilles successives, borné en itérations ; un anneau dégénéré se replie sur un éventail). Rend des indices triplés. */
export function trianguler(anneau: readonly Vec2[]): number[] {
  const n = anneau.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (aireSignee(anneau) < 0) idx.reverse();
  const out: number[] = [];
  const dedans = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let garde = n * n + 10;
  while (idx.length > 3 && garde-- > 0) {
    let coupe = false;
    for (let i = 0; i < idx.length; i++) {
      const a = anneau[idx[(i + idx.length - 1) % idx.length]], b = anneau[idx[i]], c = anneau[idx[(i + 1) % idx.length]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-9) continue; // sommet rentrant ou plat
      let libre = true;
      for (const k of idx) {
        const p = anneau[k];
        if (p === a || p === b || p === c) continue;
        if (dedans(p, a, b, c)) { libre = false; break; }
      }
      if (!libre) continue;
      out.push(idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]);
      idx.splice(i, 1);
      coupe = true;
      break;
    }
    if (!coupe) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]); // repli : éventail
  return out;
}

/** Anneau d'un cercle approché (rond-point). */
function cercleAnneau(cx: number, cz: number, r: number, n = 24): Vec2[] {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * r, cz + Math.sin((i / n) * 2 * Math.PI) * r] as Vec2);
}

/** Pelouses : anneaux OSM (pelouses, jardins, parcs, prairies) et îlot du rond-point. */
function anneauxPelouse(data: SceneData): { r: readonly Vec2[]; k: string }[] {
  const liste: { r: readonly Vec2[]; k: string }[] = (data.decor?.pelouses ?? []).map((p) => ({ r: p.r, k: p.k }));
  const g = deriverVoirie(data).giratoire;
  if (g) liste.push({ r: cercleAnneau(g.centre[0], g.centre[1], g.ilot - 0.2), k: "ilot" });
  return liste;
}

/**
 * Pelouses en triangles [x, z, …] : chaque anneau est triangulé ; un triangle dont le centre est dans un bâtiment, à moins de `demi + 0,3` m
 * de l'axe d'une chaussée M ou R, ou dans une boîte exclue est retiré. Rien dans les boîtes exclues (zombies).
 */
export function pelouses(data: SceneData, o: OptionsVegetation = {}): number[] {
  const c = contexteSol(data);
  const out: number[] = [];
  for (const { r } of anneauxPelouse(data)) {
    const t = trianguler(r);
    for (let i = 0; i < t.length; i += 3) {
      const a = r[t[i]], b = r[t[i + 1]], d = r[t[i + 2]];
      const x = (a[0] + b[0] + d[0]) / 3, z = (a[1] + b[1] + d[1]) / 3;
      if (exclu(o.exclure, x, z) || dansBatiment(c, x, z)) continue;
      let route = false;
      c.chaussees.proches(x, z, 6, (s) => { if (!route && pointSegment(x, z, s.ax, s.az, s.bx, s.bz).d < s.demi + 0.3) route = true; });
      if (route) continue;
      out.push(a[0], a[1], b[0], b[1], d[0], d[1]);
    }
  }
  return out;
}

/** Plafond d'arbustes et rayon du poisson-disc (m). */
export const ARBUSTES_MAX = 400;
export const ARBUSTES_ECART_M = 3;

/**
 * Arbustes [x, z, …] : poisson-disc de 3 m dans les jardins et les pelouses des parcs, et un massif sur l'îlot du rond-point (aucun arbre
 * ni mât au centre : les joueurs de l'arène y apparaissent). 400 au plus ; hors bâtiments, hors boîtes exclues, à plus de 3 m d'une cachette ;
 * rien en qualité basse.
 */
export function arbustes(data: SceneData, o: OptionsVegetation = {}): number[] {
  if (o.qualite === "basse") return [];
  const c = contexteSol(data), ev = grilleEviter(o.eviter);
  const g = deriverVoirie(data).giratoire;
  const candidats: { r: readonly Vec2[]; ilot: boolean }[] = [];
  // l'îlot du rond-point d'abord : le plafond ne doit pas l'oublier
  if (g) candidats.push({ r: cercleAnneau(g.centre[0], g.centre[1], g.ilot - 1.2), ilot: true });
  for (const p of data.decor?.pelouses ?? []) if (p.k === "garden" || p.k === "park") candidats.push({ r: p.r, ilot: false });
  const out: number[] = [];
  const pris = new Grille<Vec2>(ARBUSTES_ECART_M * 2);
  for (const { r, ilot } of candidats) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const alea = mulberry32(hachagePos((x0 + x1) / 2, (z0 + z1) / 2, 11));
    const essais = Math.min(400, Math.ceil(((x1 - x0) * (z1 - z0)) / 6));
    for (let k = 0; k < essais && out.length / 2 < ARBUSTES_MAX; k++) {
      const x = x0 + alea() * (x1 - x0), z = z0 + alea() * (z1 - z0);
      if (!dansAnneau(x, z, r) || distanceAnneau(x, z, r) < 0.8) continue;
      if (!ilot && (exclu(o.exclure, x, z) || dansBatiment(c, x, z) || distanceBatiment(c, x, z, 1.2) < 1.2)) continue;
      if (pres(ev, x, z, DISTANCE_CACHETTE_M)) continue;
      let proche = false;
      pris.proches(x, z, ARBUSTES_ECART_M, (q) => { if (Math.hypot(q[0] - x, q[1] - z) < ARBUSTES_ECART_M * (ilot ? 0.6 : 1)) proche = true; });
      if (proche) continue;
      pris.ajouter(x, z, x, z, [x, z]);
      out.push(x, z);
    }
  }
  return out;
}
