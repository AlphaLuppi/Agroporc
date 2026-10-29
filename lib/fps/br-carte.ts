/**
 * Carte du mode Battle Royale (PUR : `scene.json` est un paramètre et n'est JAMAIS modifié). Les 142 bâtiments de la scène sont des prismes
 * pleins ; pour « fouiller les bâtiments », le BR en creuse 20 : les quatre des zombies (72, 70, 62, 74, murs, cloisons, fenêtres et mobilier de
 * `CREUSAGES`, SANS leurs portes : l'ouverture reste libre) et jusqu'à 16 autres, creusés procéduralement (une coque de quatre murs posée sur le
 * plus grand rectangle inscrit dans l'emprise, une porte au sud, une fenêtre au nord, 0 à 2 étagères). Un bâtiment creux est un prisme `creux`
 * de hauteur 0 (aucune collision) dont les murs sont des pièces ajoutées après l'index 142 ; le toit est OUVERT. Fournit aussi les emplacements
 * de butin (quatre pools) et les centres des bâtiments creux (biais du tirage de la zone).
 * Serveur ET client appellent `donneesBr` / `construireMondeBr` pour voir la même carte. Repère de scene.json : x vers l'est, z vers le sud,
 * mètres ; les bâtiments sont tournés de 16° (s le long des façades, t vers le nord).
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Carte : bâtiments fouillables », « Butin »)
 */
import { dedans, distSegment } from "../agroparc3d/cachettes";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { MARGE_BORNES_M, construireMonde, pointsApparition, resoudre, solSous, type Boite, type Monde } from "./collision";
import type { PointButin } from "./protocole";
import {
  ANGLE_BATIMENTS, BATIMENTS_CREUX, CREUSAGES, DEMI_EPAISSEUR_COQUE, INDEX_PREMIERE_PIECE, LARGEUR_FENETRE, LARGEUR_PORTE,
  batimentDePiece, copieBatiment, piecesCreusage, type PieceSynth,
} from "./zombies-carte";

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Nombre de bâtiments creusés procéduralement (au plus ; moins si la scène n'en offre pas assez). */
export const NB_PROCEDURAUX = 16;
/** Emprise d'un bâtiment procédural (m²), hauteur minimale (m) et remplissage minimal de son rectangle englobant (repère à 16°). */
export const AIRE_MIN_M2 = 100;
export const AIRE_MAX_M2 = 700;
export const HAUTEUR_MIN_M = 3.5;
export const REMPLISSAGE_MIN = 0.8;
/** Plus petit côté (m) du rectangle inscrit pour y poser une coque (porte de 2,6 m, murs de 0,4 m, étagères). */
export const COTE_MIN_M = 5;
/** Bâtiment écarté de la sélection : celui du Truck Muche. */
export const BATIMENT_TRUCK = 114;
/** Pas (m) de la grille de recherche du rectangle inscrit. */
export const PAS_RECTANGLE_M = 0.5;
/** Devant la porte : distance (m) du point de départ au seuil, rayon du joueur (m) et distance (m) à franchir pour être « dehors ». */
export const PORTE_DEPART_M = 1.0;
export const PORTE_RAYON_M = 0.4;
export const PORTE_SORTIE_M = 25;
/** Pas (m) du flood-fill de sortie. */
const PAS_SORTIE_M = 0.5;
/** Étagère : longueur, profondeur et hauteur (m). */
const ETAGERE = { ls: 1.6, lt: 0.6, h: 1.8 } as const;

/** Butin : pas des grilles (m), distances aux bords (m), hauteur minimale et emprises minimales (m²) des bâtiments. */
export const BUTIN = {
  pasInterieur: 3, margeMurInterieur: 1.0,
  pasToit: 5, margeBordToit: 1.5, aireMinToit: 40,
  pasFacade: 10, distanceFacade: 1.8, areteMinFacade: 4, aireMinFacade: 30,
  rayonJoueur: 0.4,
} as const;

export interface Rect { s0: number; s1: number; t0: number; t1: number }

// ---------------------------------------------------------------------------------------------
// Repère à 16° et géométrie
// ---------------------------------------------------------------------------------------------

const U: Vec2 = [Math.cos(ANGLE_BATIMENTS), Math.sin(ANGLE_BATIMENTS)];
const N: Vec2 = [Math.sin(ANGLE_BATIMENTS), -Math.cos(ANGLE_BATIMENTS)];
/** Coordonnées (s, t) du point (x, z) : s le long des façades, t vers le nord. */
export const versRepere = (x: number, z: number): Vec2 => [x * U[0] + z * U[1], x * N[0] + z * N[1]];
/** Point (x, z) des coordonnées (s, t) (le repère est orthonormé : l'inverse est la transposée). */
export const depuisRepere = (s: number, t: number): Vec2 => [s * U[0] + t * N[0], s * U[1] + t * N[1]];
/** Les quatre coins d'un rectangle du repère, en coordonnées de la carte. */
export const coinsRect = (r: Rect): Vec2[] => [depuisRepere(r.s0, r.t0), depuisRepere(r.s1, r.t0), depuisRepere(r.s1, r.t1), depuisRepere(r.s0, r.t1)];

const EPS = 1e-6;
const arr = (v: Vec2): Vec2 => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100];

/** Aire (m²) d'un anneau (formule du lacet, valeur absolue). */
function aireAnneau(a: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1];
  return Math.abs(s) / 2;
}
/** Emprise réelle d'un bâtiment : anneau extérieur moins ses cours. */
const aireBatiment = (b: Building): number => aireAnneau(b.r) - (b.holes ?? []).reduce((t, h) => t + aireAnneau(h), 0);

/** Le point est sur le bord d'un des anneaux (à EPS près). */
function surBord(x: number, z: number, anneaux: readonly (readonly Vec2[])[]): boolean {
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) if (distSegment(x, z, a[j][0], a[j][1], a[i][0], a[i][1]) < EPS) return true;
  return false;
}
/** Le point est dans l'emprise (anneau extérieur, hors cours) ou sur son bord. */
function dansEmprise(x: number, z: number, anneau: readonly Vec2[], trous: readonly (readonly Vec2[])[]): boolean {
  if (surBord(x, z, [anneau, ...trous])) return true;
  return dedans(x, z, anneau as Vec2[]) && !trous.some((t) => dedans(x, z, t as Vec2[]));
}

// ---------------------------------------------------------------------------------------------
// Rectangle inscrit
// ---------------------------------------------------------------------------------------------

/** Le pourtour du rectangle (échantillonné tous les 0,25 m) reste dans l'emprise `anneau` (en coordonnées de la carte), cours exclues. */
export function rectDansEmprise(r: Rect, anneau: Vec2[], trous: Vec2[][] = []): boolean {
  const pas = 0.25;
  const bord: [number, number, number, number][] = [[r.s0, r.t0, r.s1, r.t0], [r.s1, r.t0, r.s1, r.t1], [r.s1, r.t1, r.s0, r.t1], [r.s0, r.t1, r.s0, r.t0]];
  for (const [sa, ta, sb, tb] of bord) {
    const n = Math.max(1, Math.ceil(Math.hypot(sb - sa, tb - ta) / pas));
    for (let k = 0; k <= n; k++) {
      const [x, z] = depuisRepere(sa + ((sb - sa) * k) / n, ta + ((tb - ta) * k) / n);
      if (!dansEmprise(x, z, anneau, trous)) return false;
    }
  }
  // une cour entièrement logée dans le rectangle ne touche pas son pourtour
  for (const h of trous) for (const [x, z] of h) { const [s, t] = versRepere(x, z); if (s > r.s0 + EPS && s < r.s1 - EPS && t > r.t0 + EPS && t < r.t1 - EPS) return false; }
  return true;
}

/**
 * Plus grand rectangle (en aire) inscrit dans le polygone `anneau` privé des `trous`, aligné sur le repère à 16° des bâtiments. Recherche sur
 * une grille de 0,5 m : une cellule est libre si ses quatre coins et son centre sont dans l'emprise et qu'aucun sommet ne tombe dans la cellule
 * (le plus grand rectangle de cellules libres se trouve en une passe par histogrammes). Le résultat est ensuite vérifié sur son pourtour
 * (rétréci de 0,25 m au plus quatre fois si une pointe de l'emprise l'entame). `null` si l'emprise ne contient aucune cellule. Déterministe.
 */
export function rectangleInscrit(anneau: Vec2[], trous: Vec2[][] = []): Rect | null {
  const st = (a: readonly Vec2[]): Vec2[] => a.map(([x, z]) => versRepere(x, z));
  const anneauST = st(anneau), trousST = trous.map(st);
  let s0 = Infinity, t0 = Infinity, s1 = -Infinity, t1 = -Infinity;
  for (const [s, t] of anneauST) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const W = Math.ceil((s1 - s0) / PAS_RECTANGLE_M - EPS), H = Math.ceil((t1 - t0) / PAS_RECTANGLE_M - EPS);
  if (W < 1 || H < 1) return null;
  const dansST = (s: number, t: number): boolean => dansEmprise(s, t, anneauST, trousST);

  const noeuds = new Uint8Array((W + 1) * (H + 1));
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) noeuds[i + j * (W + 1)] = dansST(s0 + i * PAS_RECTANGLE_M, t0 + j * PAS_RECTANGLE_M) ? 1 : 0;
  // cellules qui contiennent strictement un sommet (pointe de l'emprise, coin d'une cour)
  const bloquee = new Uint8Array(W * H);
  for (const a of [anneauST, ...trousST]) {
    for (const [s, t] of a) {
      const fi = (s - s0) / PAS_RECTANGLE_M, fj = (t - t0) / PAS_RECTANGLE_M;
      const i = Math.floor(fi), j = Math.floor(fj);
      if (fi - i < EPS || fj - j < EPS || i < 0 || j < 0 || i >= W || j >= H) continue;
      bloquee[i + j * W] = 1;
    }
  }
  const libre = (i: number, j: number): boolean =>
    !bloquee[i + j * W] && noeuds[i + j * (W + 1)] === 1 && noeuds[i + 1 + j * (W + 1)] === 1 && noeuds[i + (j + 1) * (W + 1)] === 1
    && noeuds[i + 1 + (j + 1) * (W + 1)] === 1 && dansST(s0 + (i + 0.5) * PAS_RECTANGLE_M, t0 + (j + 0.5) * PAS_RECTANGLE_M);

  const hauteurs = new Int32Array(W);
  let aire = 0, gi0 = 0, gi1 = 0, gj0 = 0, gj1 = 0;
  const pile: number[] = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) hauteurs[i] = libre(i, j) ? hauteurs[i] + 1 : 0;
    pile.length = 0;
    for (let i = 0; i <= W; i++) {
      const h = i < W ? hauteurs[i] : 0;
      while (pile.length && h < hauteurs[pile[pile.length - 1]]) {
        const hh = hauteurs[pile.pop()!];
        const gauche = pile.length ? pile[pile.length - 1] + 1 : 0;
        if (hh * (i - gauche) > aire) { aire = hh * (i - gauche); gi0 = gauche; gi1 = i; gj0 = j - hh + 1; gj1 = j + 1; }
      }
      pile.push(i);
    }
  }
  if (!aire) return null;
  let r: Rect = { s0: s0 + gi0 * PAS_RECTANGLE_M, s1: s0 + gi1 * PAS_RECTANGLE_M, t0: t0 + gj0 * PAS_RECTANGLE_M, t1: t0 + gj1 * PAS_RECTANGLE_M };
  for (let k = 0; k < 4 && !rectDansEmprise(r, anneau, trous); k++) {
    r = { s0: r.s0 + 0.25, s1: r.s1 - 0.25, t0: r.t0 + 0.25, t1: r.t1 - 0.25 };
    if (r.s1 <= r.s0 || r.t1 <= r.t0) return null;
  }
  return rectDansEmprise(r, anneau, trous) ? r : null;
}

// ---------------------------------------------------------------------------------------------
// Sélection et pièces des bâtiments procéduraux
// ---------------------------------------------------------------------------------------------

/**
 * Un joueur de rayon `rayon` parti de (x, z) à pied peut-il s'éloigner d'au moins `distance` m (flood-fill 4-connexe au pas de 0,5 m, rayon libre
 * partout, `resoudre` sur `monde`) ? Faux si le départ est lui-même dans un mur, ou si la zone atteignable est une poche fermée (porte qui donne sur
 * les murs pleins de voisins, cour enclose). `interdit` : un rectangle du repère à 16° qu'on ne traverse pas (la coque d'un bâtiment dont on teste
 * la porte : sans elle, le flood-fill sortirait par l'intérieur ouvert du bâtiment). Déterministe, borné par le disque de rayon `distance`.
 */
export function atteintLExterieur(monde: Monde, x: number, z: number, rayon: number, distance: number, interdit?: Rect): boolean {
  const libre = (px: number, pz: number): boolean => {
    if (interdit) { const [s, t] = versRepere(px, pz); if (s > interdit.s0 - rayon && s < interdit.s1 + rayon && t > interdit.t0 - rayon && t < interdit.t1 + rayon) return false; }
    return resoudre(monde, [px, 0, pz], rayon, 1.8).contacts.length === 0;
  };
  if (!libre(x, z)) return false;
  const cle = (i: number, j: number): string => `${i},${j}`;
  const vus = new Set<string>([cle(0, 0)]);
  const file: [number, number][] = [[0, 0]];
  while (file.length) {
    const [i, j] = file.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, k = cle(a, b);
      if (vus.has(k)) continue;
      vus.add(k);
      const px = x + a * PAS_SORTIE_M, pz = z + b * PAS_SORTIE_M;
      if (!libre(px, pz)) continue;
      if (Math.hypot(a, b) * PAS_SORTIE_M >= distance) return true;
      file.push([a, b]);
    }
  }
  return false;
}

const EXCLUS: ReadonlySet<number> = new Set<number>([...BATIMENTS_CREUX, BATIMENT_TRUCK]);

interface Candidat { i: number; aire: number; c: Vec2; rect: Rect }

/** Bâtiments éligibles (emprise, hauteur, remplissage, rectangle inscrit assez grand) dans l'ordre des index. */
function candidats(scene: SceneData): Candidat[] {
  const res: Candidat[] = [];
  // monde d'essai pour la porte : celui de la carte BR (sans le Truck), les voisins pleins ; le candidat testé est rendu traversable comme il le sera
  let essai: Monde | null = null;
  const porteDegagee = (i: number, r: Rect): boolean => {
    essai ??= construireMonde({ ...scene, pois: scene.pois.filter((p) => p.type !== "truck") });
    const prisme = essai.prismes[i];
    const h = prisme.h, hOrigine = prisme.hOrigine;
    prisme.h = 0; prisme.hOrigine = 0;
    const [x, z] = depuisRepere((r.s0 + r.s1) / 2, r.t0 - PORTE_DEPART_M);
    const ok = atteintLExterieur(essai, x, z, PORTE_RAYON_M, PORTE_SORTIE_M, r);
    prisme.h = h; prisme.hOrigine = hOrigine;
    return ok;
  };
  scene.buildings.forEach((b, i) => {
    if (i >= INDEX_PREMIERE_PIECE || EXCLUS.has(i) || b.h < HAUTEUR_MIN_M) return;
    const aire = aireBatiment(b);
    if (aire < AIRE_MIN_M2 || aire > AIRE_MAX_M2) return;
    let s0 = Infinity, t0 = Infinity, s1 = -Infinity, t1 = -Infinity;
    for (const [x, z] of b.r) { const [s, t] = versRepere(x, z); s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    if (aire / ((s1 - s0) * (t1 - t0)) < REMPLISSAGE_MIN) return;
    const rect = rectangleInscrit(b.r, b.holes);
    if (!rect || Math.min(rect.s1 - rect.s0, rect.t1 - rect.t0) < COTE_MIN_M) return;
    // la porte donne sur l'extérieur : pas sur les murs pleins de voisins collés, qui feraient de l'intérieur une pièce où l'on n'entre pas
    if (!porteDegagee(i, rect)) return;
    res.push({ i, aire, c: b.c, rect });
  });
  return res;
}

/** Éloignement maximal : on part du plus grand, puis on ajoute à chaque fois le candidat le plus loin des choisis (égalité : index le plus petit). */
function choisir(cands: readonly Candidat[]): Candidat[] {
  if (!cands.length) return [];
  const choisis: Candidat[] = [cands.reduce((m, c) => (c.aire > m.aire ? c : m))];
  const reste = cands.filter((c) => c !== choisis[0]);
  while (choisis.length < NB_PROCEDURAUX && reste.length) {
    let meilleur = 0, dMeilleur = -1;
    reste.forEach((c, k) => {
      const d = Math.min(...choisis.map((o) => Math.hypot(c.c[0] - o.c[0], c.c[1] - o.c[1])));
      if (d > dMeilleur) { dMeilleur = d; meilleur = k; }
    });
    choisis.push(reste.splice(meilleur, 1)[0]);
  }
  return choisis;
}

/**
 * Index (croissants) des bâtiments à creuser procéduralement : emprise de 100 à 700 m², hauteur ≥ 3,5 m, remplissage de leur rectangle
 * englobant (repère à 16°) ≥ 0,8, porte dégagée (`atteintLExterieur` depuis le seuil), hors les quatre des zombies et le bâtiment 114 (Truck Muche), choisis par éloignement maximal pour couvrir la
 * carte, jusqu'à 16 (repli : tous s'il y en a moins).
 */
export function choisirBatimentsProcedurals(scene: SceneData): number[] {
  return choisir(candidats(scene)).map((c) => c.i).sort((a, b) => a - b);
}

/** Hachage entier (32 bits) d'un index de bâtiment : tire le nombre et la place des étagères. */
const hachage = (i: number): number => Math.imul(i + 1, 2654435761) >>> 0;

/** Coque, fenêtre et étagères d'un bâtiment procédural posés sur son rectangle inscrit. */
function piecesDeCoque(i: number, r: Rect, h: number): PieceSynth[] {
  const E = DEMI_EPAISSEUR_COQUE;
  const res: PieceSynth[] = [];
  const mur = (id: string, type: PieceSynth["type"], a: Vec2, b: Vec2, o: { demi?: number; h?: number; genre?: PieceSynth["genre"] } = {}) => {
    res.push({ id, type, p: arr(depuisRepere(a[0], a[1])), q: arr(depuisRepere(b[0], b[1])), demi: o.demi ?? E, prolonge: 0, h: o.h ?? h, batiment: i, ...(o.genre ? { genre: o.genre } : {}) });
  };
  const sm = (r.s0 + r.s1) / 2;
  const ds = LARGEUR_PORTE / 2, df = LARGEUR_FENETRE / 2;
  // murs ouest et est sur toute la hauteur t, murs sud et nord entre eux (les quatre rectangles se touchent sans se recouvrir)
  mur(`${i}c0`, "coque", [r.s0 + E, r.t0], [r.s0 + E, r.t1]);
  mur(`${i}c1`, "coque", [r.s1 - E, r.t0], [r.s1 - E, r.t1]);
  // sud (t minimal) : porte ouverte de 2,6 m au milieu, aucune pièce dans l'ouverture
  mur(`${i}c2`, "coque", [r.s0 + 2 * E, r.t0 + E], [sm - ds, r.t0 + E]);
  mur(`${i}c3`, "coque", [sm + ds, r.t0 + E], [r.s1 - 2 * E, r.t0 + E]);
  // nord : fenêtre de 1,8 m au milieu (bloque les joueurs, pas les balles)
  mur(`${i}c4`, "coque", [r.s0 + 2 * E, r.t1 - E], [sm - df, r.t1 - E]);
  mur(`${i}F`, "fenetre", [sm - df, r.t1 - E], [sm + df, r.t1 - E]);
  mur(`${i}c5`, "coque", [sm + df, r.t1 - E], [r.s1 - 2 * E, r.t1 - E]);
  // 0 à 2 étagères contre les murs ouest puis est, à une place tirée par le hachage de l'index
  const hh = hachage(i), n = hh % 3;
  const libre = r.t1 - r.t0 - 4 * E - ETAGERE.ls;
  for (let k = 0; k < n; k++) {
    const f = ((hh >>> (8 + 8 * k)) & 255) / 255;
    const t = r.t0 + 2 * E + f * libre;
    const s = k === 0 ? r.s0 + 2 * E + ETAGERE.lt / 2 : r.s1 - 2 * E - ETAGERE.lt / 2;
    mur(`${i}m${k}`, "meuble", [s, t], [s, t + ETAGERE.ls], { demi: ETAGERE.lt / 2, h: ETAGERE.h, genre: "etagere" });
  }
  return res;
}

/** Pièces (coques, fenêtres, étagères) des bâtiments d'index `indices`, dans l'ordre donné. Un bâtiment sans rectangle inscrit est ignoré. */
export function piecesProcedurales(scene: SceneData, indices: readonly number[]): PieceSynth[] {
  const res: PieceSynth[] = [];
  for (const i of indices) {
    const b = scene.buildings[i];
    const r = b && rectangleInscrit(b.r, b.holes);
    if (b && r) res.push(...piecesDeCoque(i, r, b.h));
  }
  return res;
}

interface Procedural { indices: number[]; rects: Map<number, Rect>; pieces: PieceSynth[] }
const cache = new WeakMap<SceneData, Procedural>();
/** Sélection, rectangles et pièces procéduraux d'une scène, calculés une fois (la scène n'est jamais modifiée). */
function procedural(scene: SceneData): Procedural {
  let p = cache.get(scene);
  if (!p) {
    const choisis = choisir(candidats(scene)).sort((a, b) => a.i - b.i);
    p = { indices: choisis.map((c) => c.i), rects: new Map(choisis.map((c) => [c.i, c.rect])), pieces: [] };
    for (const c of choisis) p.pieces.push(...piecesDeCoque(c.i, c.rect, scene.buildings[c.i].h));
    cache.set(scene, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Données de scène et monde
// ---------------------------------------------------------------------------------------------

export interface DonneesBr {
  /** copie de la scène : bâtiments creusés en `type: "creux"`, pièces ajoutées à la fin de `buildings`, sans le POI `truck`, `modeCarte: "br"` */
  data: SceneData;
  /** pièces, dans l'ordre de leur index dans `buildings` (à partir de `INDEX_PREMIERE_PIECE`) */
  pieces: PieceSynth[];
  /** index (croissants) des bâtiments creux : les quatre des zombies et les procéduraux */
  creux: number[];
  /** bornes du monde : celles de `construireMonde` sur les 142 bâtiments d'origine */
  bornes: Boite;
}

/** Bornes de l'arène : rectangle des centroïdes des bâtiments agrandi de `MARGE_BORNES_M` (comme `construireMonde`). */
function bornesDe(buildings: readonly Building[]): Boite {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of buildings) { x0 = Math.min(x0, b.c[0]); x1 = Math.max(x1, b.c[0]); z0 = Math.min(z0, b.c[1]); z1 = Math.max(z1, b.c[1]); }
  return { x0: x0 - MARGE_BORNES_M, z0: z0 - MARGE_BORNES_M, x1: x1 + MARGE_BORNES_M, z1: z1 + MARGE_BORNES_M };
}

/** Bornes du monde du Battle Royale d'après la scène d'origine (cadrage de l'aperçu de la vue Palantir). */
export const bornesBr = (scene: SceneData): Boite => bornesDe(scene.buildings.slice(0, INDEX_PREMIERE_PIECE));

/** Pièces des quatre bâtiments des zombies, sans leurs portes (l'ouverture reste libre). */
const piecesZombiesSansPortes = (scene: SceneData): PieceSynth[] =>
  CREUSAGES.flatMap((c) => piecesCreusage(c, scene.buildings[c.b]?.h ?? 6)).filter((p) => p.type !== "porte");

/**
 * Scène de la carte BR, SANS modifier `scene` : bâtiments copiés en profondeur, les 20 creusés passent en `creux`, les pièces s'ajoutent à la
 * fin (à partir de l'index 142), le POI `truck` est retiré (aucun prisme `fixe`) et la scène porte `modeCarte: "br"`.
 */
export function donneesBr(scene: SceneData): DonneesBr {
  const buildings = scene.buildings.map(copieBatiment);
  if (buildings.length !== INDEX_PREMIERE_PIECE) throw new Error(`scene.json : ${buildings.length} bâtiments, ${INDEX_PREMIERE_PIECE} attendus`);
  const proc = procedural(scene);
  const creux = [...BATIMENTS_CREUX as readonly number[], ...proc.indices].sort((a, b) => a - b);
  for (const b of creux) buildings[b].type = "creux";
  const pieces = [...piecesZombiesSansPortes(scene), ...proc.pieces];
  for (const p of pieces) buildings.push(batimentDePiece(p));
  const data: SceneData = { ...scene, buildings, pois: scene.pois.filter((p) => p.type !== "truck"), modeCarte: "br" };
  return { data, pieces, creux, bornes: bornesDe(scene.buildings) };
}

/**
 * Monde de collision de la carte BR : MUTABLE (brèches), une instance par salle. Les bâtiments creux n'ont pas de hauteur (ni collision ni
 * toit, jamais relevés), les murs, fenêtres et étagères gardent leur hauteur (wall-run, double saut et escalade restent actifs). Les `bornes`
 * sont RÉÉCRITES à partir des 142 bâtiments d'origine : `construireMonde` les calcule sur tous les `buildings`, pièces comprises.
 */
export function construireMondeBr(scene: SceneData): Monde {
  const donnees = donneesBr(scene);
  const monde = construireMonde(donnees.data);
  monde.bornes = { ...donnees.bornes };
  monde.prismes.forEach((p, i) => {
    if (donnees.data.buildings[i]?.type === "creux") { p.h = 0; p.hOrigine = 0; }
  });
  return monde;
}

/**
 * Centres (x, z) des bâtiments creux, dans l'ordre des index : centroïde pour les quatre des zombies, centre du rectangle inscrit (là où est la
 * coque) pour les procéduraux. Biais du tirage du centre de la zone (les seuls endroits où l'on trouve un abri et du butin).
 */
export function centresBatimentsEligibles(scene: SceneData): [number, number][] {
  const proc = procedural(scene);
  const centres: [number, number][] = [];
  for (const i of [...BATIMENTS_CREUX as readonly number[], ...proc.indices].sort((a, b) => a - b)) {
    const r = proc.rects.get(i);
    if (r) { const [x, z] = depuisRepere((r.s0 + r.s1) / 2, (r.t0 + r.t1) / 2); centres.push([x, z]); }
    else centres.push([scene.buildings[i].c[0], scene.buildings[i].c[1]]);
  }
  return centres;
}

// ---------------------------------------------------------------------------------------------
// Emplacements de butin
// ---------------------------------------------------------------------------------------------

const dansEau = (scene: SceneData, x: number, z: number): boolean => scene.water.some((w) => dedans(x, z, w));
/** Un joueur de rayon `rayon` debout en (x, y, z) ne touche aucun mur, meuble ni borne du monde. */
const degage = (monde: Monde, x: number, y: number, z: number, rayon: number): boolean => resoudre(monde, [x, y, z], rayon, 1.8).contacts.length === 0;

/**
 * Emplacements de butin, déterministes (ordre stable : intérieur, toit, façade, route), répartis en quatre pools :
 * - `interieur` : grille de 3 m dans l'intérieur des bâtiments creux, à ≥ 1 m de tout mur ou meuble ;
 * - `toit` : grille de 5 m sur les toits des bâtiments pleins de ≥ 3,5 m de haut et ≥ 40 m², à ≥ 1,5 m du bord, y = hauteur du toit ;
 * - `facade` : à 1,8 m des murs extérieurs, un tous les 10 m d'arête (arêtes ≥ 4 m, bâtiments ≥ 30 m²) ;
 * - `route` : les points d'apparition de `collision.ts`.
 * Chaque point est libre pour un joueur de rayon 0,4 (`resoudre` sur le monde BR) et hors de l'eau.
 */
export function pointsButin(scene: SceneData, monde: Monde): PointButin[] {
  const proc = procedural(scene);
  const creux = new Set<number>([...BATIMENTS_CREUX as readonly number[], ...proc.indices]);
  const points: PointButin[] = [];
  const vus = new Set<string>();
  const ajouter = (pool: PointButin["pool"], x: number, y: number, z: number, cle: string) => {
    if (vus.has(cle)) return;
    vus.add(cle);
    points.push({ p: [x, y, z], pool });
  };

  // intérieur
  const pas = BUTIN.pasInterieur;
  for (const i of [...creux].sort((a, b) => a - b)) {
    const b = scene.buildings[i], r = proc.rects.get(i);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of b.r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let kz = Math.ceil(z0 / pas); kz * pas <= z1; kz++) for (let kx = Math.ceil(x0 / pas); kx * pas <= x1; kx++) {
      const x = kx * pas, z = kz * pas;
      let dans: boolean;
      if (r) { const [s, t] = versRepere(x, z); dans = s > r.s0 && s < r.s1 && t > r.t0 && t < r.t1; }
      else dans = dedans(x, z, b.r) && !(b.holes ?? []).some((h) => dedans(x, z, h));
      if (dans && !dansEau(scene, x, z) && degage(monde, x, 0, z, BUTIN.margeMurInterieur)) ajouter("interieur", x, 0, z, `i:${kx},${kz}`);
    }
  }

  // toit
  const pt = BUTIN.pasToit;
  scene.buildings.forEach((b, i) => {
    if (i >= INDEX_PREMIERE_PIECE || creux.has(i) || b.h < HAUTEUR_MIN_M || aireBatiment(b) < BUTIN.aireMinToit) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of b.r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const bords = [b.r, ...(b.holes ?? [])];
    const distBord = (x: number, z: number): number => {
      let d = Infinity;
      for (const a of bords) for (let k = 0, j = a.length - 1; k < a.length; j = k++) d = Math.min(d, distSegment(x, z, a[j][0], a[j][1], a[k][0], a[k][1]));
      return d;
    };
    for (let kz = Math.ceil(z0 / pt); kz * pt <= z1; kz++) for (let kx = Math.ceil(x0 / pt); kx * pt <= x1; kx++) {
      const x = kx * pt, z = kz * pt;
      if (!dedans(x, z, b.r) || (b.holes ?? []).some((h) => dedans(x, z, h)) || distBord(x, z) < BUTIN.margeBordToit) continue;
      // le toit de ce bâtiment est la surface la plus haute du point (un voisin plus haut qui le recouvre le masque)
      if (Math.abs(solSous(monde, x, z, 1e4, 0) - b.h) > EPS) continue;
      if (!dansEau(scene, x, z) && degage(monde, x, b.h, z, BUTIN.rayonJoueur)) ajouter("toit", x, b.h, z, `t:${kx},${kz},${b.h}`);
    }
  });

  // façade
  const rayonFacade = BUTIN.distanceFacade - EPS;
  scene.buildings.forEach((b, i) => {
    if (i >= INDEX_PREMIERE_PIECE || creux.has(i) || aireBatiment(b) < BUTIN.aireMinFacade) return;
    for (let k = 0, j = b.r.length - 1; k < b.r.length; j = k++) {
      const [ax, az] = b.r[j], [bx, bz] = b.r[k];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < BUTIN.areteMinFacade) continue;
      // normale sortante : celle des deux qui ne pointe pas vers l'intérieur
      let nx = -(bz - az) / L, nz = (bx - ax) / L;
      if (dedans((ax + bx) / 2 + nx * 0.01, (az + bz) / 2 + nz * 0.01, b.r)) { nx = -nx; nz = -nz; }
      const n = Math.max(1, Math.floor(L / BUTIN.pasFacade));
      for (let q = 0; q < n; q++) {
        const f = (q + 0.5) / n;
        const x = ax + (bx - ax) * f + nx * BUTIN.distanceFacade, z = az + (bz - az) * f + nz * BUTIN.distanceFacade;
        if (!dansEau(scene, x, z) && degage(monde, x, 0, z, rayonFacade)) ajouter("facade", x, 0, z, `f:${i},${k},${q}`);
      }
    }
  });

  // route
  for (const [x, z] of pointsApparition(scene, monde)) {
    if (!dansEau(scene, x, z) && degage(monde, x, 0, z, BUTIN.rayonJoueur)) ajouter("route", x, 0, z, `r:${x},${z}`);
  }
  return points;
}
