/**
 * Navigation des monstres (PUR) : grille d'occupation de la carte pour un rayon donné (une case est bloquée si un disque de ce rayon,
 * centré sur elle, touche un bâtiment ou sort des bornes), recherche de chemin A* (8 voisins, heuristique octile) et choix du point à viser
 * le long du chemin. Les grilles sont calculées une fois par monde et par rayon (cache), à la première demande.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { lancerRayon, resoudre, type Boite, type Monde } from "./collision";
import type { Vec3 } from "./protocole";

export interface CarteNav { taille: number; x0: number; z0: number; nx: number; nz: number; bloque: Uint8Array }

/** Au plus ce nombre de cases (la taille d'une case grandit sur une très grande carte, comme celle des tests). */
const CASES_MAX = 90_000;
const TAILLE_MIN_M = 3;
/** Grille en cache et ce qui l'a produite (rayon du disque, champs ignorés) : de quoi la recalculer case par case. */
interface EntreeNav { carte: CarteNav; rayon: number; ignorer: boolean }
const cache = new WeakMap<Monde, Map<string, EntreeNav>>();
/** Marge (m) ajoutée au rayon autour d'une boîte modifiée : les cases plus lointaines ne peuvent pas changer. */
const MARGE_MAJ_M = 0.5;

/** La case (i, j) est bloquée : un disque de `rayon` centré sur elle touche un bâtiment ou sort des bornes. */
function caseBloquee(monde: Monde, c: CarteNav, i: number, j: number, rayon: number, ignorer: boolean): 0 | 1 {
  const x = c.x0 + (i + 0.5) * c.taille, z = c.z0 + (j + 0.5) * c.taille;
  return resoudre(monde, [x, 0, z], rayon, 8, ignorer).contacts.length ? 1 : 0;
}

/** Options de `carteNavigation` : `taille` = taille minimale d'une case (m, 3 par défaut), `ignorerPasseTigre` = les « champs » de la carte zombies ne bloquent pas. */
export interface OptionsNav { taille?: number; ignorerPasseTigre?: boolean }

export function carteNavigation(monde: Monde, rayon: number, opts: OptionsNav = {}): CarteNav {
  let parCle = cache.get(monde);
  if (!parCle) { parCle = new Map(); cache.set(monde, parCle); }
  const tailleMin = opts.taille ?? TAILLE_MIN_M;
  const ignorer = opts.ignorerPasseTigre === true;
  const cle = `${rayon}|${tailleMin}|${ignorer ? 1 : 0}`;
  const deja = parCle.get(cle);
  if (deja) return deja.carte;
  const b = monde.bornes;
  const largeur = b.x1 - b.x0, profondeur = b.z1 - b.z0;
  const taille = Math.max(tailleMin, Math.sqrt((largeur * profondeur) / CASES_MAX));
  const nx = Math.max(1, Math.ceil(largeur / taille)), nz = Math.max(1, Math.ceil(profondeur / taille));
  const bloque = new Uint8Array(nx * nz);
  const carte: CarteNav = { taille, x0: b.x0, z0: b.z0, nx, nz, bloque };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) bloque[i + j * nx] = caseBloquee(monde, carte, i, j, rayon, ignorer);
  parCle.set(cle, { carte, rayon, ignorer });
  return carte;
}

/** Oublie les grilles du monde (un bâtiment a été détruit ou relevé : porte achetée, nouvelle partie) ; la prochaine demande les recalcule. */
export function invaliderNavigation(monde: Monde): void {
  cache.delete(monde);
}

/**
 * Mise à jour INCRÉMENTALE des grilles en cache du monde après la destruction (ou le relevé) des bâtiments dont on donne les `boites` : seules
 * les cases dont le disque peut toucher l'une d'elles sont recalculées, SUR PLACE (les `CarteNav` déjà distribuées restent valables). Le
 * résultat est identique à un recalcul complet (même prédicat, case par case) : une porte de la carte zombies coûte moins de 5 ms au lieu de
 * 40 à 80 ms pour les deux grilles (qui gelaient le processus entier, arène comprise).
 */
export function majNavigation(monde: Monde, boites: readonly Boite[]): void {
  const parCle = cache.get(monde);
  if (!parCle || !boites.length) return;
  for (const { carte: c, rayon, ignorer } of parCle.values()) {
    const marge = rayon + MARGE_MAJ_M;
    for (const bo of boites) {
      // cases dont le centre est à moins de `marge` de la boîte
      const i0 = Math.max(0, Math.floor((bo.x0 - marge - c.x0) / c.taille - 0.5)), i1 = Math.min(c.nx - 1, Math.ceil((bo.x1 + marge - c.x0) / c.taille - 0.5));
      const j0 = Math.max(0, Math.floor((bo.z0 - marge - c.z0) / c.taille - 0.5)), j1 = Math.min(c.nz - 1, Math.ceil((bo.z1 + marge - c.z0) / c.taille - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) c.bloque[i + j * c.nx] = caseBloquee(monde, c, i, j, rayon, ignorer);
    }
  }
}

/** Photographie des grilles en cache du monde (copie des cases bloquées par clé), à restaurer par `restaurerNavigation`. */
export type InstantaneNav = ReadonlyMap<string, Uint8Array>;

/** Copie des grilles en cache du monde, par exemple toutes portes fermées à la création de la salle des zombies. */
export function instantaneNavigation(monde: Monde): InstantaneNav {
  const r = new Map<string, Uint8Array>();
  for (const [cle, e] of cache.get(monde) ?? []) r.set(cle, e.carte.bloque.slice());
  return r;
}

/**
 * Remet SUR PLACE les grilles en cache du monde dans l'état photographié (le monde doit être revenu à cet état : portes refermées). Une grille
 * absente de la photographie ou de taille différente est oubliée (recalculée à la prochaine demande).
 */
export function restaurerNavigation(monde: Monde, inst: InstantaneNav): void {
  const parCle = cache.get(monde);
  if (!parCle) return;
  for (const [cle, e] of [...parCle]) {
    const copie = inst.get(cle);
    if (copie && copie.length === e.carte.bloque.length) e.carte.bloque.set(copie);
    else parCle.delete(cle);
  }
}

const caseDe = (c: CarteNav, x: number, z: number): [number, number] => [
  Math.min(c.nx - 1, Math.max(0, Math.floor((x - c.x0) / c.taille))),
  Math.min(c.nz - 1, Math.max(0, Math.floor((z - c.z0) / c.taille))),
];
const centre = (c: CarteNav, i: number, j: number): [number, number] => [c.x0 + (i + 0.5) * c.taille, c.z0 + (j + 0.5) * c.taille];

/** Case libre la plus proche (anneaux croissants jusqu'à `rayonMax` cases), ou null. */
function libreProche(c: CarteNav, i: number, j: number, rayonMax = 6): [number, number] | null {
  if (!c.bloque[i + j * c.nx]) return [i, j];
  for (let r = 1; r <= rayonMax; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < c.nx && b < c.nz && !c.bloque[a + b * c.nx]) return [a, b];
      }
    }
  }
  return null;
}

/** Tas binaire minimal sur des (priorité, indice). */
class Tas {
  private p: number[] = [];
  private v: number[] = [];
  get taille() { return this.v.length; }
  pousser(prio: number, val: number) {
    const p = this.p, v = this.v;
    let k = v.length;
    p.push(prio); v.push(val);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (p[parent] <= p[k]) break;
      [p[parent], p[k]] = [p[k], p[parent]];
      [v[parent], v[k]] = [v[k], v[parent]];
      k = parent;
    }
  }
  extraire(): number {
    const p = this.p, v = this.v;
    const haut = v[0];
    const dp = p.pop()!, dv = v.pop()!;
    if (v.length) {
      p[0] = dp; v[0] = dv;
      let k = 0;
      for (;;) {
        const g = 2 * k + 1, d = g + 1;
        let m = k;
        if (g < v.length && p[g] < p[m]) m = g;
        if (d < v.length && p[d] < p[m]) m = d;
        if (m === k) break;
        [p[m], p[k]] = [p[k], p[m]];
        [v[m], v[k]] = [v[k], v[m]];
        k = m;
      }
    }
    return haut;
  }
}

const VOISINS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Chemin (centres de cases, en m) de `de` vers `vers`, sans couper un coin bloqué ; null si aucun chemin. Départ ou arrivée dans une case
 * bloquée : la case libre la plus proche les remplace. `noeudsMax` borne le travail (cible inaccessible).
 */
export function chemin(c: CarteNav, de: [number, number], vers: [number, number], noeudsMax = 60_000): [number, number][] | null {
  const d0 = caseDe(c, de[0], de[1]), a0 = caseDe(c, vers[0], vers[1]);
  const d = libreProche(c, d0[0], d0[1]), a = libreProche(c, a0[0], a0[1]);
  if (!d || !a) return null;
  const n = c.nx * c.nz;
  const cout = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const ferme = new Uint8Array(n);
  const id = (i: number, j: number) => i + j * c.nx;
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - a[0]), dz = Math.abs(j - a[1]);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const tas = new Tas();
  const depart = id(d[0], d[1]), arrivee = id(a[0], a[1]);
  cout[depart] = 0;
  tas.pousser(h(d[0], d[1]), depart);
  let vus = 0;
  while (tas.taille) {
    const k = tas.extraire();
    if (ferme[k]) continue;
    ferme[k] = 1;
    if (k === arrivee) break;
    if (++vus > noeudsMax) return null;
    const i = k % c.nx, j = (k - i) / c.nx;
    for (const [di, dj, l] of VOISINS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= c.nx || nj >= c.nz) continue;
      const nk = id(ni, nj);
      if (c.bloque[nk] || ferme[nk]) continue;
      // en diagonale, les deux cases voisines doivent être libres (pas de coin coupé)
      if (di && dj && (c.bloque[id(i + di, j)] || c.bloque[id(i, j + dj)])) continue;
      const cc = cout[k] + l;
      if (cc < cout[nk]) {
        cout[nk] = cc;
        parent[nk] = k;
        tas.pousser(cc + h(ni, nj), nk);
      }
    }
  }
  if (parent[arrivee] === -1 && arrivee !== depart) return null;
  const res: [number, number][] = [];
  for (let k = arrivee; k !== -1; k = parent[k]) {
    const i = k % c.nx, j = (k - i) / c.nx;
    res.push(centre(c, i, j));
  }
  res.reverse();
  return res;
}

/**
 * Point à viser le long du chemin depuis `p` : le plus lointain des points du chemin qu'on voit sans bâtiment (rayons au centre et aux
 * flancs à `demiLargeur`), jusqu'à `porteeMax` m ; à défaut le premier point à plus de `pasMin` m.
 */
export function pointDeVisee(monde: Monde, p: Vec3, ch: readonly [number, number][], demiLargeur: number, porteeMax = 40, pasMin = 4): Vec3 | null {
  if (!ch.length) return null;
  const vu = (x: number, z: number) => {
    const dx = x - p[0], dz = z - p[2];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return true;
    const ux = dx / l, uz = dz / l;
    for (const k of [0, -1, 1]) {
      const o: Vec3 = [p[0] - uz * demiLargeur * k, 1, p[2] + ux * demiLargeur * k];
      if (lancerRayon(monde, o, [ux, 0, uz], l) !== Infinity) return false;
    }
    return true;
  };
  let choisi: [number, number] | null = null;
  for (const q of ch) {
    const l = Math.hypot(q[0] - p[0], q[1] - p[2]);
    if (l > porteeMax) break;
    if (l >= pasMin && vu(q[0], q[1])) choisi = q;
  }
  if (!choisi) choisi = ch.find((q) => Math.hypot(q[0] - p[0], q[1] - p[2]) >= pasMin) ?? ch[ch.length - 1];
  return [choisi[0], 0, choisi[1]];
}


// ---------------------------------------------------------------------------------------------
// Champ de distance (poursuite des tigres zombies)
// ---------------------------------------------------------------------------------------------

/** Distance d'une case jamais atteinte (bloquée, hors de portée, ou au-delà de l'arrêt anticipé). */
export const DIST_INF = 0x3fffffff;
/** Poids entiers du champ : 10 par case orthogonale, 14 en diagonale (≈ 10 √2). Une unité = 0,1 case. */
export const POIDS_ORTHO = 10;
export const POIDS_DIAG = 14;
const NB_SEAUX = 16; // > poids max (14) : le seau (d mod 16) ne reçoit jamais un voisin de la distance courante

const DI = new Int8Array([1, -1, 0, 0, 1, 1, -1, -1]);
const DJ = new Int8Array([0, 0, 1, -1, 1, -1, 1, -1]);
const DW = new Int32Array([10, 10, 10, 10, 14, 14, 14, 14]);

const seaux: number[][] = Array.from({ length: NB_SEAUX }, () => []);
let marquesCibles = new Uint8Array(0);

export interface OptionsChamp {
  /** Cases (m) à régler : le parcours s'arrête quand elles le sont toutes et que la distance dépasse la plus lointaine + `marge`. Les cases plus lointaines restent à `DIST_INF`. */
  cases?: readonly (readonly [number, number])[];
  /** Marge (unités de distance, 10 = une case orthogonale) ajoutée à la plus lointaine des `cases` avant l'arrêt. */
  marge?: number;
  /** Tableau de sortie réutilisé (taille nx × nz) ; sinon un nouveau est créé. */
  sortie?: Int32Array;
}

/**
 * Champ de distance multi-sources (file à seaux de Dial) : pour chaque case, la longueur du plus court chemin (8 voisins, jamais de coin
 * coupé, poids entiers 10 / 14) jusqu'à la source la plus proche ; `DIST_INF` si inaccessible. Les sources dans une case bloquée sont
 * ramenées à la case libre la plus proche. Identique à un Dijkstra, mais ≈ 1 ms sur la grille de 138 × 90 cases contre 8 à 30 ms pour un
 * tas binaire. Sans allocation en dehors du tableau de sortie.
 */
export function champDistance(c: CarteNav, sources: readonly (readonly [number, number])[], opts: OptionsChamp = {}): Int32Array {
  const n = c.nx * c.nz;
  const dist = opts.sortie && opts.sortie.length === n ? opts.sortie : new Int32Array(n);
  dist.fill(DIST_INF);
  const nx = c.nx, nz = c.nz, bloque = c.bloque;
  for (const s of seaux) s.length = 0;
  let restant = 0; // entrées en attente dans les seaux (certaines périmées)
  for (const [x, z] of sources) {
    const [i0, j0] = caseDe(c, x, z);
    const l = libreProche(c, i0, j0);
    if (!l) continue;
    const k = l[0] + l[1] * nx;
    if (dist[k] === 0) continue;
    dist[k] = 0;
    seaux[0].push(k);
    restant++;
  }
  // arrêt anticipé : cases à régler
  let aRegler = 0;
  let arret = Infinity;
  const marge = opts.marge ?? 0;
  if (opts.cases && opts.cases.length) {
    if (marquesCibles.length < n) marquesCibles = new Uint8Array(n);
    for (const [x, z] of opts.cases) {
      const [i0, j0] = caseDe(c, x, z);
      const l = libreProche(c, i0, j0, 3);
      if (!l) continue;
      const k = l[0] + l[1] * nx;
      if (!marquesCibles[k]) { marquesCibles[k] = 1; aRegler++; }
    }
  }
  const cibles = aRegler > 0 ? opts.cases : undefined;
  let d = 0;
  while (restant > 0 && d <= arret) {
    const seau = seaux[d & (NB_SEAUX - 1)];
    const taille = seau.length;
    restant -= taille;
    for (let q = 0; q < taille; q++) {
      const k = seau[q];
      if (dist[k] !== d) continue; // entrée périmée (une distance plus courte a été trouvée)
      if (cibles && marquesCibles[k] === 1) {
        marquesCibles[k] = 2;
        if (--aRegler === 0) arret = d + marge;
      }
      const i = k % nx, j = (k - i) / nx;
      for (let v = 0; v < 8; v++) {
        const ni = i + DI[v], nj = j + DJ[v];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = k + DI[v] + DJ[v] * nx;
        if (bloque[nk]) continue;
        if (v >= 4 && (bloque[k + DI[v]] || bloque[k + DJ[v] * nx])) continue; // pas de coin coupé
        const nd = d + DW[v];
        if (nd < dist[nk]) {
          dist[nk] = nd;
          seaux[nd & (NB_SEAUX - 1)].push(nk);
          restant++;
        }
      }
    }
    seau.length = 0;
    d++;
  }
  if (opts.cases && marquesCibles.length) {
    // remet à zéro les marques utilisées (cases demandées uniquement)
    for (const [x, z] of opts.cases) {
      const [i0, j0] = caseDe(c, x, z);
      const l = libreProche(c, i0, j0, 3);
      if (l) marquesCibles[l[0] + l[1] * nx] = 0;
    }
  }
  return dist;
}

/**
 * Descente de gradient : centre de la case voisine de plus faible distance (jusqu'à `pas` cases de suite, 1 par défaut), sans couper
 * un coin bloqué. null si la case de départ est déjà une source (distance 0), n'a pas de champ (`DIST_INF`) ou n'a aucun voisin plus proche.
 */
export function descente(c: CarteNav, champ: Int32Array, x: number, z: number, pas = 1): [number, number] | null {
  const nx = c.nx, nz = c.nz, bloque = c.bloque;
  let [i, j] = caseDe(c, x, z);
  let courant = champ[i + j * nx];
  if (courant === 0) return null;
  let bouge = false;
  for (let s = 0; s < pas; s++) {
    const k = i + j * nx;
    let meilleur = courant, mi = -1, mj = -1;
    for (let v = 0; v < 8; v++) {
      const ni = i + DI[v], nj = j + DJ[v];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const nk = k + DI[v] + DJ[v] * nx;
      if (bloque[nk]) continue;
      if (v >= 4 && (bloque[k + DI[v]] || bloque[k + DJ[v] * nx])) continue;
      if (champ[nk] < meilleur) { meilleur = champ[nk]; mi = ni; mj = nj; }
    }
    if (mi < 0) break;
    i = mi; j = mj; courant = meilleur; bouge = true;
    if (courant === 0) break;
  }
  return bouge ? centre(c, i, j) : null;
}
