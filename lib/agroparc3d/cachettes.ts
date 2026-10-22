/**
 * Cachettes du tigre de la vue Palantir (PUR : ni three ni DOM, testé sur le vrai scene.json).
 *
 * Génération : une grille irrégulière (pas d'environ 6 m, décalages tirés avec une graine fixe)
 * couvre la zone jouable, le rectangle des bâtiments agrandi de 40 m. On écarte les points trop
 * près d'un bâtiment (1,5 m), d'une route (4 m) ou dans l'eau, on note la difficulté de chacun,
 * on ne garde que les points tapis contre un bâtiment (mur à moins de 8 m) et masqués par un
 * bâtiment depuis au moins 2 des 8 caméras (au moins 3 des 5 points du corps cachés depuis
 * chacune), puis on écarte le quart le moins difficile. Les
 * cachettes gardées sont classées par rang de difficulté (0 = la plus facile, 1 = la plus
 * difficile) : points et paliers suivent ce rang.
 *
 * Pourquoi ce filtre (ajouté après revue, en attente de validation) : sans lui, l'éloignement
 * suffisait à classer un point en terrain nu dans les paliers facile et moyenne, et 57 % des
 * tirages montraient le tigre à découvert. Le masquage seul admettait encore des points en terrain
 * dégagé à 15 ou 20 m d'un mur, d'où la distance au mur. Les arbres, en fil de fer translucide,
 * ne cachent rien et n'admettent pas un point à eux seuls.
 *
 * Difficulté = 0,45 masquage + 0,20 couvert d'arbres + 0,20 éloignement + 0,15 recoin.
 * Masquage : 5 points sur le corps du tigre (0,3 à 1 m de haut), visés depuis 8 caméras (la
 * position de repos `REST` de scene.ts et ses rotations de 45° autour du point visé, celles des
 * boutons « Pivoter ») : part des segments qui traversent un bâtiment extrudé, moyennée.
 *
 * Repère : celui de scene.json, x vers l'est, z vers le sud, y vers le haut, en mètres. Un
 * bâtiment est le prisme de son emprise `r`, de y = 0 à y = h.
 */
import type { SceneData, Vec2 } from "./types";

/** Position de repos de la caméra, en décalage du point visé `data.focus` (cf. `REST` de scene.ts). */
export interface ReposCamera { dx: number; y: number; dz: number }

export type Palier = "facile" | "moyenne" | "difficile";

export interface Cachette {
  x: number;
  z: number;
  /** Rotation du tigre autour de y (rad, celle du groupe three) : le museau pointe vers (sin, cos). */
  cap: number;
  /** Note brute de 0 à 1. */
  difficulte: number;
  /** Rang parmi les cachettes gardées, de 0 (la moins difficile) à 1. */
  rang: number;
  points: number;
  palier: Palier;
}

export const PAS_GRILLE_M = 6;
const GIGUE_M = 2.4;
const MARGE_ZONE_M = 40;
const DISTANCE_BATIMENT_M = 1.5;
const DISTANCE_ROUTE_M = 4;
/** Un cours d'eau n'est qu'une ligne dans scene.json : on l'élargit de 2 m de chaque côté. */
const DEMI_LARGEUR_RUISSEAU_M = 2;
const RAYON_ARBRES_M = 6;
const ARBRES_COUVERT_PLEIN = 6;
const RECOIN_PLEIN_M = 3;
const RECOIN_NUL_M = 15;
export const POIDS = { masquage: 0.45, arbres: 0.2, eloignement: 0.2, recoin: 0.15 } as const;
/** Points du corps : décalage le long du tigre (m, museau devant) et hauteur (m). */
const CORPS: ReadonlyArray<readonly [number, number]> = [[1.2, 0.9], [0.6, 1.0], [0, 0.8], [-0.6, 0.6], [-1.2, 0.3]];
const GRAINE = 20261022;
/** Une caméra « voit le tigre masqué » quand au moins 3 des 5 points du corps le sont. */
export const CORPS_MASQUE_MIN = 3;
/** Un point n'est une cachette que s'il est masqué depuis au moins 2 des 8 caméras. */
export const DIRECTIONS_MASQUEES_MIN = 2;
/** Et s'il est tapi contre un bâtiment : mur le plus proche à moins de 8 m. */
export const MUR_MAX_M = 8;

/** Le point est caché dans le décor : contre un mur, masqué par un bâtiment depuis assez de directions. */
export function estCache(p: Pick<PointNote, "directions" | "mur">): boolean {
  return p.directions >= DIRECTIONS_MASQUEES_MIN && p.mur < MUR_MAX_M;
}

/** Générateur pseudo-aléatoire (mulberry32) : même graine, même suite. */
export function aleaGraine(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Zone { x0: number; z0: number; x1: number; z1: number }

/** Rectangle qui englobe tous les bâtiments, agrandi de 40 m de chaque côté. */
export function zoneJouable(data: SceneData): Zone {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of data.buildings) for (const [x, z] of b.r) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0: x0 - MARGE_ZONE_M, z0: z0 - MARGE_ZONE_M, x1: x1 + MARGE_ZONE_M, z1: z1 + MARGE_ZONE_M };
}

/** Les 8 caméras : la position de repos et ses 7 rotations de 45° autour du point visé. */
export function camerasRepos(focus: Vec2, repos: ReposCamera): Array<[number, number, number]> {
  return Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    // Même sens que Vector3.applyAxisAngle autour de +y (scene.ts, spin).
    return [focus[0] + repos.dx * c + repos.dz * s, repos.y, focus[1] - repos.dx * s + repos.dz * c];
  });
}

/** Grille spatiale de boîtes : chaque case liste les objets dont la boîte la touche. */
class Grille {
  private cases = new Map<number, number[]>();
  private taille: number;
  constructor(taille: number) { this.taille = taille; }
  private cle(i: number, j: number) { return (i + 5000) * 10000 + (j + 5000); }
  ajouter(id: number, x0: number, z0: number, x1: number, z1: number) {
    const t = this.taille;
    for (let i = Math.floor(x0 / t); i <= Math.floor(x1 / t); i++) for (let j = Math.floor(z0 / t); j <= Math.floor(z1 / t); j++) {
      const k = this.cle(i, j);
      const l = this.cases.get(k);
      if (l) l.push(id); else this.cases.set(k, [id]);
    }
  }
  /** Ids des objets des cases touchées par la boîte, sans doublon (marquage par `tampon`). */
  chercher(x0: number, z0: number, x1: number, z1: number, marques: Int32Array, tampon: number, sortie: number[]): number[] {
    sortie.length = 0;
    const t = this.taille;
    for (let i = Math.floor(x0 / t); i <= Math.floor(x1 / t); i++) for (let j = Math.floor(z0 / t); j <= Math.floor(z1 / t); j++) {
      const l = this.cases.get(this.cle(i, j));
      if (!l) continue;
      for (const id of l) if (marques[id] !== tampon) { marques[id] = tampon; sortie.push(id); }
    }
    return sortie;
  }
}

function dedans(x: number, z: number, anneau: Vec2[]): boolean {
  let d = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, zi] = anneau[i], [xj, zj] = anneau[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) d = !d;
  }
  return d;
}

/** Distance du point au segment ab, et paramètre du projeté. */
function distSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
  return Math.hypot(x - ax - t * ux, z - az - t * uz);
}

/** Les segments [p, q] et [a, b] se coupent (cas dégénérés colinéaires ignorés). */
function coupe(px: number, pz: number, qx: number, qz: number, ax: number, az: number, bx: number, bz: number): boolean {
  const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const d2 = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
  if ((d1 > 0) === (d2 > 0)) return false;
  const d3 = (qx - px) * (az - pz) - (qz - pz) * (ax - px);
  const d4 = (qx - px) * (bz - pz) - (qz - pz) * (bx - px);
  return (d3 > 0) !== (d4 > 0);
}

interface Boite { x0: number; z0: number; x1: number; z1: number }
const boiteDe = (pts: Vec2[]): Boite => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, z0, x1, z1 };
};

const arrondi = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;

export function palierDuRang(rang: number): Palier {
  return rang < 1 / 3 ? "facile" : rang < 2 / 3 ? "moyenne" : "difficile";
}

/** 100 + 400 × rang, arrondi à la dizaine : de 100 à 500. */
export function pointsDuRang(rang: number): number {
  return Math.round((100 + 400 * rang) / 10) * 10;
}

/** Point candidat et ses quatre critères, chacun de 0 à 1, avant tout tri. */
export interface PointNote {
  x: number;
  z: number;
  cap: number;
  masquage: number;
  /** Nombre des 8 caméras depuis lesquelles au moins 3 des 5 points du corps sont masqués. */
  directions: number;
  /** Distance (m) au mur de bâtiment le plus proche, Infinity si aucun bâtiment à moins de 15 m environ. */
  mur: number;
  /** Nombre d'arbres à moins de 6 m. */
  arbres: number;
  couvert: number;
  eloignement: number;
  recoin: number;
  difficulte: number;
}

/** Étapes 1 à 3 : grille, points écartés (bâtiment, route, eau), critères et note de chaque point restant. */
export function evaluerPoints(data: SceneData, repos: ReposCamera): PointNote[] {
  const zone = zoneJouable(data);
  const alea = aleaGraine(GRAINE);
  const cameras = camerasRepos(data.focus, repos);
  const bats = data.buildings.map((b) => ({ r: b.r, h: b.h, ...boiteDe(b.r) }));
  const nb = bats.length;
  const marques = new Int32Array(nb);
  let tampon = 0;
  const liste: number[] = [];

  // Bâtiments proches (distance, recoin) : boîte élargie de la portée du recoin.
  const grilleProches = new Grille(20);
  bats.forEach((b, i) => grilleProches.ajouter(i, b.x0 - RECOIN_NUL_M, b.z0 - RECOIN_NUL_M, b.x1 + RECOIN_NUL_M, b.z1 + RECOIN_NUL_M));
  // Bâtiments par emprise (masquage) : on interroge la boîte du bout de segment utile.
  const grilleEmprises = new Grille(20);
  bats.forEach((b, i) => grilleEmprises.ajouter(i, b.x0, b.z0, b.x1, b.z1));
  const hMax = bats.reduce((m, b) => Math.max(m, b.h), 0);

  // Routes et cours d'eau en segments.
  const segRoutes: number[] = [];
  for (const r of data.roads) for (let i = 0; i < r.p.length - 1; i++) segRoutes.push(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]);
  const grilleRoutes = new Grille(20);
  for (let s = 0; s < segRoutes.length / 4; s++) {
    const [ax, az, bx, bz] = segRoutes.slice(s * 4, s * 4 + 4);
    grilleRoutes.ajouter(s, Math.min(ax, bx) - DISTANCE_ROUTE_M, Math.min(az, bz) - DISTANCE_ROUTE_M, Math.max(ax, bx) + DISTANCE_ROUTE_M, Math.max(az, bz) + DISTANCE_ROUTE_M);
  }
  const marquesRoutes = new Int32Array(segRoutes.length / 4);
  const segRuisseaux: number[] = [];
  for (const w of data.wlines) for (let i = 0; i < w.length - 1; i++) segRuisseaux.push(w[i][0], w[i][1], w[i + 1][0], w[i + 1][1]);
  const grilleRuisseaux = new Grille(20);
  for (let s = 0; s < segRuisseaux.length / 4; s++) {
    const k = s * 4, m = DEMI_LARGEUR_RUISSEAU_M;
    grilleRuisseaux.ajouter(s, Math.min(segRuisseaux[k], segRuisseaux[k + 2]) - m, Math.min(segRuisseaux[k + 1], segRuisseaux[k + 3]) - m,
      Math.max(segRuisseaux[k], segRuisseaux[k + 2]) + m, Math.max(segRuisseaux[k + 1], segRuisseaux[k + 3]) + m);
  }
  const marquesRuisseaux = new Int32Array(segRuisseaux.length / 4);
  const eaux = data.water.map((w) => ({ r: w, ...boiteDe(w) }));

  const grilleArbres = new Grille(12);
  data.trees.forEach(([x, z], i) => grilleArbres.ajouter(i, x, z, x, z));
  const marquesArbres = new Int32Array(data.trees.length);

  const F = data.focus;
  const eloignementMax = Math.max(...[[zone.x0, zone.z0], [zone.x1, zone.z0], [zone.x0, zone.z1], [zone.x1, zone.z1]].map(([x, z]) => Math.hypot(x - F[0], z - F[1])));

  const candidats: PointNote[] = [];
  const nx = Math.floor((zone.x1 - zone.x0) / PAS_GRILLE_M), nz = Math.floor((zone.z1 - zone.z0) / PAS_GRILLE_M);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    // Les tirages sont faits pour chaque case, gardée ou non : la grille ne dépend que de la graine.
    const gx = (alea() * 2 - 1) * GIGUE_M, gz = (alea() * 2 - 1) * GIGUE_M, capAlea = alea() * Math.PI * 2;
    const x = zone.x0 + (i + 0.5) * PAS_GRILLE_M + gx, z = zone.z0 + (j + 0.5) * PAS_GRILLE_M + gz;

    // Eau.
    if (eaux.some((w) => x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && dedans(x, z, w.r))) continue;
    let ruisseau = false;
    for (const s of grilleRuisseaux.chercher(x, z, x, z, marquesRuisseaux, ++tampon, liste)) {
      const k = s * 4;
      if (distSegment(x, z, segRuisseaux[k], segRuisseaux[k + 1], segRuisseaux[k + 2], segRuisseaux[k + 3]) < DEMI_LARGEUR_RUISSEAU_M) { ruisseau = true; break; }
    }
    if (ruisseau) continue;

    // Routes.
    let route = false;
    for (const s of grilleRoutes.chercher(x, z, x, z, marquesRoutes, ++tampon, liste)) {
      const k = s * 4;
      if (distSegment(x, z, segRoutes[k], segRoutes[k + 1], segRoutes[k + 2], segRoutes[k + 3]) < DISTANCE_ROUTE_M) { route = true; break; }
    }
    if (route) continue;

    // Bâtiments proches : mur le plus proche (distance et direction).
    let dMur = Infinity, capMur = capAlea, interieur = false;
    for (const bi of grilleProches.chercher(x, z, x, z, marques, ++tampon, liste)) {
      const b = bats[bi];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && dedans(x, z, b.r)) { interieur = true; break; }
      for (let k = 0, l = b.r.length - 1; k < b.r.length; l = k++) {
        const [ax, az] = b.r[l], [bx, bz] = b.r[k];
        const d = distSegment(x, z, ax, az, bx, bz);
        // Le tigre se couche le long du mur le plus proche.
        if (d < dMur) { dMur = d; capMur = Math.atan2(bx - ax, bz - az); }
      }
    }
    if (interieur || dMur < DISTANCE_BATIMENT_M) continue;
    const cap = dMur <= RECOIN_NUL_M ? capMur : capAlea;

    // Masquage depuis les 8 caméras. Un rayon ne peut toucher qu'un bâtiment proche : au-delà
    // d'une fraction du segment, il passe au-dessus de tous les toits.
    const sx = Math.sin(cap), sz = Math.cos(cap);
    let portee = 0;
    for (const [cx, cy, cz] of cameras) portee = Math.max(portee, ((hMax - 0.3) / (cy - 0.3)) * (Math.hypot(cx - x, cz - z) + 2));
    const voisins = grilleEmprises.chercher(x - portee, z - portee, x + portee, z + portee, marques, ++tampon, liste).slice();
    let caches = 0, directions = 0;
    for (const [cx, cy, cz] of cameras) {
      let cachesCamera = 0;
      for (const [off, hauteur] of CORPS) {
        const px = x + sx * off, pz = z + sz * off;
        let cache = false;
        for (const bi of voisins) {
          const b = bats[bi];
          if (b.h <= hauteur) continue;
          const f = (b.h - hauteur) / (cy - hauteur);
          const ex = px + (cx - px) * f, ez = pz + (cz - pz) * f;
          if (Math.max(px, ex) < b.x0 || Math.min(px, ex) > b.x1 || Math.max(pz, ez) < b.z0 || Math.min(pz, ez) > b.z1) continue;
          for (let k = 0, l = b.r.length - 1; k < b.r.length && !cache; l = k++) {
            cache = coupe(px, pz, ex, ez, b.r[l][0], b.r[l][1], b.r[k][0], b.r[k][1]);
          }
          if (cache) break;
        }
        if (cache) cachesCamera++;
      }
      caches += cachesCamera;
      if (cachesCamera >= CORPS_MASQUE_MIN) directions++;
    }
    const masquage = caches / (CORPS.length * cameras.length);

    let arbres = 0;
    for (const t of grilleArbres.chercher(x - RAYON_ARBRES_M, z - RAYON_ARBRES_M, x + RAYON_ARBRES_M, z + RAYON_ARBRES_M, marquesArbres, ++tampon, liste)) {
      const [tx, tz] = data.trees[t];
      if (Math.hypot(tx - x, tz - z) < RAYON_ARBRES_M) arbres++;
    }
    const couvert = Math.min(1, arbres / ARBRES_COUVERT_PLEIN);
    const eloignement = Math.hypot(x - F[0], z - F[1]) / eloignementMax;
    const recoin = dMur < RECOIN_PLEIN_M ? 1 : Math.max(0, 1 - (dMur - RECOIN_PLEIN_M) / (RECOIN_NUL_M - RECOIN_PLEIN_M));
    const difficulte = POIDS.masquage * masquage + POIDS.arbres * couvert + POIDS.eloignement * eloignement + POIDS.recoin * recoin;
    candidats.push({ x, z, cap, masquage, directions, mur: dMur, arbres, couvert, eloignement, recoin, difficulte });
  }
  return candidats;
}

/** Cachettes gardées, triées par rang croissant. */
export function genererCachettes(data: SceneData, repos: ReposCamera): Cachette[] {
  const candidats = evaluerPoints(data, repos).filter(estCache);

  // Tri stable par note, puis on écarte le quart le moins difficile. Valeurs arrondies comme dans
  // public/agroparc/cachettes.json, pour que le fichier se régénère à l'identique.
  candidats.sort((a, b) => a.difficulte - b.difficulte);
  const gardes = candidats.slice(Math.floor(candidats.length / 4));
  return classer(gardes.map((c) => ({ x: arrondi(c.x, 1), z: arrondi(c.z, 1), cap: arrondi(c.cap, 2), difficulte: arrondi(c.difficulte, 3) })));
}

/** Rang, points et palier d'une liste déjà triée de la moins difficile à la plus difficile. */
function classer(liste: Array<Pick<Cachette, "x" | "z" | "cap" | "difficulte">>): Cachette[] {
  const n = liste.length;
  return liste.map((c, i) => {
    const rang = n > 1 ? i / (n - 1) : 1;
    return { ...c, rang, points: pointsDuRang(rang), palier: palierDuRang(rang) };
  });
}

/** Fichier précalculé (public/agroparc/cachettes.json) : une cachette par ligne, de la plus facile à la plus difficile. */
export interface FichierCachettes {
  source: string;
  repos: ReposCamera;
  champs: ["x", "z", "cap", "difficulte"];
  cachettes: Array<[number, number, number, number]>;
}

export const SOURCE_CACHETTES = "Généré par scripts/agroparc/generer_cachettes.mjs depuis public/agroparc/scene.json : ne pas éditer à la main.";

/** Texte exact du fichier précalculé (le script l'écrit, le test le compare à l'octet). */
export function serialiserCachettes(cachettes: readonly Cachette[], repos: ReposCamera): string {
  const lignes = cachettes.map((c) => "  " + JSON.stringify([c.x, c.z, c.cap, c.difficulte]));
  return `{\n "source": ${JSON.stringify(SOURCE_CACHETTES)},\n "repos": ${JSON.stringify({ dx: repos.dx, y: repos.y, dz: repos.dz })},\n`
    + ` "champs": ["x", "z", "cap", "difficulte"],\n "cachettes": [\n${lignes.join(",\n")}\n ]\n}\n`;
}

/** Relit le fichier précalculé : rang, points et palier viennent de l'ordre des lignes. */
export function lireCachettes(f: FichierCachettes): Cachette[] {
  return classer(f.cachettes.map(([x, z, cap, difficulte]) => ({ x, z, cap, difficulte })));
}

/** Probabilité de tirer chaque palier. */
export const PROBA_PALIERS: ReadonlyArray<readonly [Palier, number]> = [["facile", 0.15], ["moyenne", 0.45], ["difficile", 0.4]];
/** Distance minimale (m) aux cachettes précédentes retenues. */
export const ECART_MIN_M = 80;
export const PRECEDENTES_RETENUES = 5;

/**
 * Tire une cachette : un palier selon `PROBA_PALIERS`, puis une cachette de ce palier, chacune avec
 * la même chance, à 80 m au moins des 5 dernières de `precedentes`. Si le palier n'en a aucune
 * assez loin, on prend parmi tous les paliers, puis, en dernier recours, sans la règle des 80 m.
 */
export function tirerCachette(cachettes: readonly Cachette[], precedentes: ReadonlyArray<{ x: number; z: number }>, alea: () => number): Cachette | null {
  if (!cachettes.length) return null;
  let r = alea(), palier: Palier = PROBA_PALIERS[PROBA_PALIERS.length - 1][0];
  for (const [p, proba] of PROBA_PALIERS) { if (r < proba) { palier = p; break; } r -= proba; }
  const recentes = precedentes.slice(-PRECEDENTES_RETENUES);
  const loin = (c: Cachette) => recentes.every((p) => Math.hypot(c.x - p.x, c.z - p.z) >= ECART_MIN_M);
  let choix = cachettes.filter((c) => c.palier === palier && loin(c));
  if (!choix.length) choix = cachettes.filter(loin);
  if (!choix.length) choix = cachettes.filter((c) => c.palier === palier);
  if (!choix.length) choix = [...cachettes];
  return choix[Math.min(choix.length - 1, Math.floor(alea() * choix.length))];
}
