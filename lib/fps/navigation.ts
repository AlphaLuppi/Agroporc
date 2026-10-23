/**
 * Navigation des monstres (PUR) : grille d'occupation de la carte pour un rayon donné (une case est bloquée si un disque de ce rayon,
 * centré sur elle, touche un bâtiment ou sort des bornes), recherche de chemin A* (8 voisins, heuristique octile) et choix du point à viser
 * le long du chemin. Les grilles sont calculées une fois par monde et par rayon (cache), à la première demande.
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { lancerRayon, resoudre, type Monde } from "./collision";
import type { Vec3 } from "./protocole";

export interface CarteNav { taille: number; x0: number; z0: number; nx: number; nz: number; bloque: Uint8Array }

/** Au plus ce nombre de cases (la taille d'une case grandit sur une très grande carte, comme celle des tests). */
const CASES_MAX = 90_000;
const TAILLE_MIN_M = 3;
const cache = new WeakMap<Monde, Map<number, CarteNav>>();

export function carteNavigation(monde: Monde, rayon: number): CarteNav {
  let parRayon = cache.get(monde);
  if (!parRayon) { parRayon = new Map(); cache.set(monde, parRayon); }
  const deja = parRayon.get(rayon);
  if (deja) return deja;
  const b = monde.bornes;
  const largeur = b.x1 - b.x0, profondeur = b.z1 - b.z0;
  const taille = Math.max(TAILLE_MIN_M, Math.sqrt((largeur * profondeur) / CASES_MAX));
  const nx = Math.max(1, Math.ceil(largeur / taille)), nz = Math.max(1, Math.ceil(profondeur / taille));
  const bloque = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = b.x0 + (i + 0.5) * taille, z = b.z0 + (j + 0.5) * taille;
      if (resoudre(monde, [x, 0, z], rayon, 8).contacts.length) bloque[i + j * nx] = 1;
    }
  }
  const carte = { taille, x0: b.x0, z0: b.z0, nx, nz, bloque };
  parRayon.set(rayon, carte);
  return carte;
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
