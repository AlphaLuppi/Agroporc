/**
 * Monde physique de l'arène FPS (PUR : ni three ni DOM, testé sur le vrai scene.json).
 *
 * Un bâtiment est le prisme de son emprise `r` (moins ses cours `holes`), de y = 0 à y = h. Les
 * joueurs sont des cylindres verticaux (pieds en p). Un prisme ne bloque que si les pieds sont
 * sous son toit (y < h − 0,05) : au-dessus, on marche sur le toit. Une grille uniforme (cellules
 * de 16 m) indexe les prismes pour que `resoudre` (60 Hz) et `lancerRayon` (chaque tir) restent
 * rapides. Repère de scene.json : x vers l'est, z vers le sud, y vers le haut, en mètres.
 *
 * Le contrôleur sous-découpe le temps (pas ≤ 1/120 s) : `resoudre` ne gère donc que de petits
 * enfoncements, mais un centre DANS le polygone sort par l'arête la plus proche (pas de
 * traversée d'un mur fin).
 */
import { dedans, distSegment } from "../agroparc3d/cachettes";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import type { Vec3 } from "./protocole";
import { obstacleTruck } from "./zones";

export interface Boite { x0: number; z0: number; x1: number; z1: number }

/** `h` = hauteur courante (0 une fois détruit : gravats plats, ni mur ni toit) ; `hOrigine` = hauteur de `scene.json`. */
export interface Prisme { anneau: Vec2[]; trous: Vec2[][]; h: number; hOrigine: number; boite: Boite; fixe?: boolean }

/** Grille uniforme : `cases[i + j × nx]` liste les prismes dont la boîte touche la case. */
export interface GrilleMonde {
  taille: number;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  cases: number[][];
  /** Marquage anti-doublon des requêtes (le monde n'est pas réentrant). */
  marques: Int32Array;
  tampon: number;
}

export interface Monde { prismes: Prisme[]; bornes: Boite; grille: GrilleMonde }

export interface Contact { nx: number; nz: number; profondeur: number; prisme: number }

/** Taille d'une case de la grille (m). */
export const CASE_M = 16;
/** Les bornes de l'arène : rectangle des centroïdes des bâtiments agrandi de cette marge. */
export const MARGE_BORNES_M = 25;
/** Un prisme ne bloque que si y < h − MARGE_TOIT : au-dessus (ou presque), on marche sur le toit. */
export const MARGE_TOIT_M = 0.05;
/** Tolérance par défaut de `solSous` : marche franchissable. */
export const TOLERANCE_SOL_M = 0.3;
/** Points d'apparition : distance minimale aux bâtiments, espacement, pas d'échantillonnage des routes. */
export const APPARITION_DISTANCE_BATIMENT_M = 2;
export const APPARITION_ESPACEMENT_M = 12;
const PAS_ECHANTILLON_M = 4;
const ITERATIONS_RESOLUTION = 4;
const EPSILON = 1e-9;

function boiteDe(pts: Vec2[]): Boite {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, z0, x1, z1 };
}

export function construireMonde(data: SceneData): Monde {
  const prismes: Prisme[] = data.buildings.map((b) => ({ anneau: b.r, trous: b.holes ?? [], h: b.h, hOrigine: b.h, boite: boiteDe(b.r) }));
  // le Truck Muche garé (v3 §2) est un obstacle comme un bâtiment : on ne le traverse pas, il arrête les balles, on peut monter dessus ;
  // il n'est pas destructible (`fixe`)
  const truck = obstacleTruck(data);
  if (truck) prismes.push({ anneau: truck.r, trous: [], h: truck.h, hOrigine: truck.h, boite: boiteDe(truck.r), fixe: true });
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const b of data.buildings) {
    bx0 = Math.min(bx0, b.c[0]); bx1 = Math.max(bx1, b.c[0]); bz0 = Math.min(bz0, b.c[1]); bz1 = Math.max(bz1, b.c[1]);
  }
  if (!prismes.length) { bx0 = bz0 = bx1 = bz1 = 0; }
  const bornes: Boite = { x0: bx0 - MARGE_BORNES_M, z0: bz0 - MARGE_BORNES_M, x1: bx1 + MARGE_BORNES_M, z1: bz1 + MARGE_BORNES_M };

  // La grille couvre les bornes ET toutes les emprises (certaines dépassent les bornes).
  let gx0 = bornes.x0, gz0 = bornes.z0, gx1 = bornes.x1, gz1 = bornes.z1;
  for (const p of prismes) {
    gx0 = Math.min(gx0, p.boite.x0); gz0 = Math.min(gz0, p.boite.z0); gx1 = Math.max(gx1, p.boite.x1); gz1 = Math.max(gz1, p.boite.z1);
  }
  gx0 -= 1; gz0 -= 1; gx1 += 1; gz1 += 1;
  const nx = Math.max(1, Math.ceil((gx1 - gx0) / CASE_M)), nz = Math.max(1, Math.ceil((gz1 - gz0) / CASE_M));
  const cases: number[][] = Array.from({ length: nx * nz }, () => []);
  prismes.forEach((p, id) => {
    const i0 = Math.floor((p.boite.x0 - gx0) / CASE_M), i1 = Math.floor((p.boite.x1 - gx0) / CASE_M);
    const j0 = Math.floor((p.boite.z0 - gz0) / CASE_M), j1 = Math.floor((p.boite.z1 - gz0) / CASE_M);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cases[i + j * nx].push(id);
  });
  return { prismes, bornes, grille: { taille: CASE_M, x0: gx0, z0: gz0, nx, nz, cases, marques: new Int32Array(prismes.length), tampon: 0 } };
}

/** Prismes dont une case touche la boîte donnée, sans doublon, rangés dans `sortie`. */
function candidats(m: Monde, x0: number, z0: number, x1: number, z1: number, sortie: number[]): number[] {
  const g = m.grille;
  sortie.length = 0;
  const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.taille)), i1 = Math.min(g.nx - 1, Math.floor((x1 - g.x0) / g.taille));
  const j0 = Math.max(0, Math.floor((z0 - g.z0) / g.taille)), j1 = Math.min(g.nz - 1, Math.floor((z1 - g.z0) / g.taille));
  const tampon = ++g.tampon;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    for (const id of g.cases[i + j * g.nx]) if (g.marques[id] !== tampon) { g.marques[id] = tampon; sortie.push(id); }
  }
  return sortie;
}

/** Le point (x, z) est dans la partie pleine du prisme : dans l'emprise, hors des cours. */
function dansSolide(p: Prisme, x: number, z: number): boolean {
  const b = p.boite;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false;
  if (!dedans(x, z, p.anneau)) return false;
  for (const t of p.trous) if (dedans(x, z, t)) return false;
  return true;
}

const tamponSol: number[] = [];

/** Hauteur du sol sous (x, z) pour des pieds à y : le toit le plus haut ≤ y + tolerance, sinon 0. */
export function solSous(m: Monde, x: number, z: number, y: number, tolerance: number = TOLERANCE_SOL_M): number {
  let sol = 0;
  for (const id of candidats(m, x, z, x, z, tamponSol)) {
    const p = m.prismes[id];
    if (p.h > sol && p.h <= y + tolerance && dansSolide(p, x, z)) sol = p.h;
  }
  return sol;
}

/** Arête la plus proche de (x, z) parmi les anneaux du prisme : distance, point le plus proche, arête. */
interface Proche { d: number; qx: number; qz: number; ax: number; az: number; bx: number; bz: number }
const proche: Proche = { d: 0, qx: 0, qz: 0, ax: 0, az: 0, bx: 0, bz: 0 };

function plusProcheAnneau(anneau: Vec2[], x: number, z: number): void {
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const ax = anneau[j][0], az = anneau[j][1], bx = anneau[i][0], bz = anneau[i][1];
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
    const qx = ax + t * ux, qz = az + t * uz;
    const d = Math.hypot(x - qx, z - qz);
    if (d < proche.d) { proche.d = d; proche.qx = qx; proche.qz = qz; proche.ax = ax; proche.az = az; proche.bx = bx; proche.bz = bz; }
  }
}

/** Correction calculée pour un prisme (réutilisée entre les appels). */
const correction = { x: 0, z: 0, nx: 0, nz: 0, profondeur: 0 };

/**
 * Pousse le cercle (x, z, rayon) hors de la partie pleine du prisme par son arête la plus proche.
 * Renvoie faux si rien à corriger ; sinon remplit `correction` (nouvelle position, normale sortante).
 */
function pousser(p: Prisme, x: number, z: number, rayon: number): boolean {
  const b = p.boite;
  if (x < b.x0 - rayon || x > b.x1 + rayon || z < b.z0 - rayon || z > b.z1 + rayon) return false;
  const sol = dansSolide(p, x, z);
  proche.d = Infinity;
  plusProcheAnneau(p.anneau, x, z);
  for (const t of p.trous) plusProcheAnneau(t, x, z);
  if (!sol && proche.d >= rayon) return false;
  // Normale sortante du plein : centre dedans → on va du centre vers le point le plus proche
  // (qui est sur la sortie) ; centre dehors → on s'éloigne de ce point.
  let nx: number, nz: number;
  if (proche.d > EPSILON) {
    const s = sol ? 1 : -1;
    nx = (s * (proche.qx - x)) / proche.d;
    nz = (s * (proche.qz - z)) / proche.d;
  } else {
    // Pile sur l'arête : normale de l'arête, orientée vers l'extérieur du plein.
    const ux = proche.bx - proche.ax, uz = proche.bz - proche.az, l = Math.hypot(ux, uz) || 1;
    nx = uz / l; nz = -ux / l;
    if (dansSolide(p, proche.qx + nx * 1e-3, proche.qz + nz * 1e-3)) { nx = -nx; nz = -nz; }
  }
  correction.x = proche.qx + nx * rayon;
  correction.z = proche.qz + nz * rayon;
  correction.nx = nx;
  correction.nz = nz;
  correction.profondeur = sol ? proche.d + rayon : rayon - proche.d;
  return true;
}

const tamponResolution: number[] = [];

/**
 * Pousse un cylindre vertical (pieds en p, rayon, hauteur) hors des prismes qu'il chevauche
 * (un prisme ne bloque que si y < h − 0,05 : au-dessus on marche sur le toit) et le garde dans
 * `bornes`. Renvoie la position corrigée (y inchangé) et les contacts de murs (normale
 * horizontale unitaire sortante, profondeur = enfoncement avant correction). Les bornes de
 * l'arène renvoient aussi un contact (prisme = -1, normale vers l'intérieur de l'arène).
 */
export function resoudre(m: Monde, p: Vec3, rayon: number, _hauteur: number): { p: Vec3; contacts: Contact[] } {
  let x = p[0];
  const y = p[1];
  let z = p[2];
  const contacts: Contact[] = [];
  const noter = (c: Contact) => {
    for (const k of contacts) {
      if (k.prisme === c.prisme && k.nx * c.nx + k.nz * c.nz > 0.99) { if (c.profondeur > k.profondeur) k.profondeur = c.profondeur; return; }
    }
    contacts.push(c);
  };
  const liste = candidats(m, x - rayon - 1, z - rayon - 1, x + rayon + 1, z + rayon + 1, tamponResolution);
  // Une poussée peut enfoncer dans un voisin : quelques passes suffisent pour les angles.
  for (let passe = 0; passe < ITERATIONS_RESOLUTION; passe++) {
    let bouge = false;
    for (const id of liste) {
      const pr = m.prismes[id];
      if (y >= pr.h - MARGE_TOIT_M) continue;
      if (!pousser(pr, x, z, rayon)) continue;
      x = correction.x; z = correction.z;
      noter({ nx: correction.nx, nz: correction.nz, profondeur: correction.profondeur, prisme: id });
      bouge = true;
    }
    const b = m.bornes;
    if (x < b.x0 + rayon) { noter({ nx: 1, nz: 0, profondeur: b.x0 + rayon - x, prisme: -1 }); x = b.x0 + rayon; bouge = true; }
    else if (x > b.x1 - rayon) { noter({ nx: -1, nz: 0, profondeur: x - (b.x1 - rayon), prisme: -1 }); x = b.x1 - rayon; bouge = true; }
    if (z < b.z0 + rayon) { noter({ nx: 0, nz: 1, profondeur: b.z0 + rayon - z, prisme: -1 }); z = b.z0 + rayon; bouge = true; }
    else if (z > b.z1 - rayon) { noter({ nx: 0, nz: -1, profondeur: z - (b.z1 - rayon), prisme: -1 }); z = b.z1 - rayon; bouge = true; }
    if (!bouge) break;
  }
  return { p: [x, y, z], contacts };
}

/**
 * Plus petit t ≥ 0 (≤ max) où le rayon o + t·d (d normalisé) entre dans le prisme : mur (arête
 * d'un anneau ou d'une cour, à une hauteur dans [0, h]) ou toit par au-dessus ; 0 si l'origine est
 * dans le plein. Infinity sinon.
 */
function rayonPrisme(p: Prisme, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  let meilleur = Infinity;
  if (oy < p.h && dansSolide(p, ox, oz)) return 0;
  if (dy < 0 && oy > p.h) {
    const t = (p.h - oy) / dy;
    if (t <= max && dansSolide(p, ox + dx * t, oz + dz * t)) meilleur = t;
  }
  const arete = (anneau: Vec2[]) => {
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const ax = anneau[j][0], az = anneau[j][1];
      const ex = anneau[i][0] - ax, ez = anneau[i][1] - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - ox) * ez - (az - oz) * ex) / den;
      if (t < 0 || t > max || t >= meilleur) continue;
      const u = ((ax - ox) * dz - (az - oz) * dx) / den;
      if (u < 0 || u > 1) continue;
      const yy = oy + dy * t;
      if (yy < 0 || yy > p.h) continue;
      meilleur = t;
    }
  };
  arete(p.anneau);
  for (const t of p.trous) arete(t);
  return meilleur;
}

/** Distance du premier bâtiment touché par le rayon (o, d normalisé) jusqu'à `max`, ou Infinity. */
export function lancerRayon(m: Monde, o: Vec3, d: Vec3, max: number): number {
  if (!(max >= 0)) return Infinity;
  const g = m.grille;
  const [ox, oy, oz] = o, [dx, dy, dz] = d;
  // Découpe du rayon à la boîte de la grille (horizontalement).
  const gx1 = g.x0 + g.nx * g.taille, gz1 = g.z0 + g.nz * g.taille;
  let tmin = 0, tmax = max;
  if (Math.abs(dx) < 1e-12) { if (ox < g.x0 || ox > gx1) return Infinity; }
  else {
    let a = (g.x0 - ox) / dx, b = (gx1 - ox) / dx;
    if (a > b) { const s = a; a = b; b = s; }
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, b);
  }
  if (Math.abs(dz) < 1e-12) { if (oz < g.z0 || oz > gz1) return Infinity; }
  else {
    let a = (g.z0 - oz) / dz, b = (gz1 - oz) / dz;
    if (a > b) { const s = a; a = b; b = s; }
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, b);
  }
  if (tmin > tmax) return Infinity;

  // Parcours de la grille (Amanatides-Woo) en paramètre t du rayon.
  const px = ox + dx * tmin, pz = oz + dz * tmin;
  let i = Math.min(g.nx - 1, Math.max(0, Math.floor((px - g.x0) / g.taille)));
  let j = Math.min(g.nz - 1, Math.max(0, Math.floor((pz - g.z0) / g.taille)));
  const pasI = dx > 0 ? 1 : -1, pasJ = dz > 0 ? 1 : -1;
  const deltaX = Math.abs(dx) < 1e-12 ? Infinity : g.taille / Math.abs(dx);
  const deltaZ = Math.abs(dz) < 1e-12 ? Infinity : g.taille / Math.abs(dz);
  let tX = deltaX === Infinity ? Infinity : ((dx > 0 ? g.x0 + (i + 1) * g.taille : g.x0 + i * g.taille) - ox) / dx;
  let tZ = deltaZ === Infinity ? Infinity : ((dz > 0 ? g.z0 + (j + 1) * g.taille : g.z0 + j * g.taille) - oz) / dz;
  const tampon = ++g.tampon;
  let meilleur = Infinity;
  for (;;) {
    for (const id of g.cases[i + j * g.nx]) {
      if (g.marques[id] === tampon) continue;
      g.marques[id] = tampon;
      const t = rayonPrisme(m.prismes[id], ox, oy, oz, dx, dy, dz, max);
      if (t < meilleur) meilleur = t;
    }
    const sortie = Math.min(tX, tZ);
    if (meilleur <= sortie || sortie >= tmax) break;
    if (tX < tZ) { i += pasI; tX += deltaX; } else { j += pasJ; tZ += deltaZ; }
    if (i < 0 || i >= g.nx || j < 0 || j >= g.nz) break;
  }
  return meilleur <= max ? meilleur : Infinity;
}

/** Vrai si le segment a→b ne traverse aucun bâtiment. */
export function visible(m: Monde, a: Vec3, b: Vec3): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < EPSILON) return true;
  return lancerRayon(m, a, [dx / l, dy / l, dz / l], l - 1e-4) === Infinity;
}

const tamponApparition: number[] = [];

/** Le point est dans un bâtiment ou à moins de `dist` d'un mur. */
function pres(m: Monde, x: number, z: number, dist: number): boolean {
  for (const id of candidats(m, x - dist, z - dist, x + dist, z + dist, tamponApparition)) {
    const p = m.prismes[id];
    if (dansSolide(p, x, z)) return true;
    const test = (anneau: Vec2[]) => {
      for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        if (distSegment(x, z, anneau[j][0], anneau[j][1], anneau[i][0], anneau[i][1]) < dist) return true;
      }
      return false;
    };
    if (test(p.anneau) || p.trous.some(test)) return true;
  }
  return false;
}

/**
 * Points d'apparition : sur la voirie (data.roads classes M/R/S, échantillonnée tous les 4 m),
 * hors bâtiments (≥ 2 m) et hors de l'eau, dans les bornes, espacés d'au moins 12 m. Pas de hasard :
 * l'ordre des routes de scene.json fixe le résultat.
 */
export function pointsApparition(data: SceneData, m: Monde): Vec2[] {
  const b = m.bornes;
  const eaux = data.water.map((w) => ({ r: w, ...boiteDe(w) }));
  const gardes: Vec2[] = [];
  const e2 = APPARITION_ESPACEMENT_M * APPARITION_ESPACEMENT_M;
  const essayer = (x: number, z: number) => {
    if (x < b.x0 + 1 || x > b.x1 - 1 || z < b.z0 + 1 || z > b.z1 - 1) return;
    for (const [gx, gz] of gardes) if ((gx - x) ** 2 + (gz - z) ** 2 < e2) return;
    if (pres(m, x, z, APPARITION_DISTANCE_BATIMENT_M)) return;
    if (eaux.some((w) => x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && dedans(x, z, w.r))) return;
    gardes.push([x, z]);
  };
  for (const r of data.roads) {
    if (r.c !== "M" && r.c !== "R" && r.c !== "S") continue;
    for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
      const l = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(l / PAS_ECHANTILLON_M));
      for (let s = 0; s < n; s++) essayer(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
    }
    const [fx, fz] = r.p[r.p.length - 1];
    essayer(fx, fz);
  }
  return gardes;
}

// ---------------------------------------------------------------------------------------------
// Destruction (v3 : le tigre robot écrase les bâtiments)
// ---------------------------------------------------------------------------------------------

/** Détruit le bâtiment `id` : sa hauteur passe à 0 (gravats plats : plus de mur ni de toit pour le mouvement, les tirs et les vues). */
export function detruireBatiment(m: Monde, id: number): boolean {
  const p = m.prismes[id];
  if (!p || p.fixe || p.h === 0) return false;
  p.h = 0;
  return true;
}

/** Relève le bâtiment `id`. */
export function releverBatiment(m: Monde, id: number): void {
  const p = m.prismes[id];
  if (p) p.h = p.hOrigine;
}

/** Relève tous les bâtiments (nouveau match). */
export function releverBatiments(m: Monde): void {
  for (const p of m.prismes) p.h = p.hOrigine;
}

/** Ids des bâtiments détruits, dans l'ordre. */
export function batimentsDetruits(m: Monde): number[] {
  const r: number[] = [];
  m.prismes.forEach((p, id) => { if (p.h === 0 && p.hOrigine > 0) r.push(id); });
  return r;
}

const tamponSous: number[] = [];
/** Bâtiments debout dont l'emprise contient (x, z), ou en est à moins de `marge` m (approché par la boîte élargie puis un point au bord). */
export function batimentsSous(m: Monde, x: number, z: number, marge = 0): number[] {
  const r: number[] = [];
  for (const id of candidats(m, x - marge, z - marge, x + marge, z + marge, tamponSous)) {
    const p = m.prismes[id];
    if (p.h === 0) continue;
    if (dansSolide(p, x, z)) { r.push(id); continue; }
    if (marge > 0) {
      const b = p.boite;
      const cx = Math.min(Math.max(x, b.x0), b.x1), cz = Math.min(Math.max(z, b.z0), b.z1);
      // point du bord de la boîte le plus proche, poussé d'un millimètre vers l'intérieur
      const ix = cx + Math.sign((b.x0 + b.x1) / 2 - cx) * 1e-3, iz = cz + Math.sign((b.z0 + b.z1) / 2 - cz) * 1e-3;
      if (Math.hypot(cx - x, cz - z) <= marge && dansSolide(p, ix, iz)) r.push(id);
    }
  }
  return r;
}

const tamponNormale: number[] = [];
/**
 * Normale de la surface touchée en `pt` (impact d'un tir) : sol ou toit → vers le haut, sinon la normale du mur le plus proche, tournée
 * vers `de` (le tireur). Sert à poser les traces d'impact à plat sur les murs.
 */
export function normaleImpact(m: Monde, pt: Vec3, de: Vec3): Vec3 {
  if (pt[1] < 0.06) return [0, 1, 0];
  let meilleur = Infinity, nx = 0, nz = 0;
  for (const id of candidats(m, pt[0] - 1, pt[2] - 1, pt[0] + 1, pt[2] + 1, tamponNormale)) {
    const p = m.prismes[id];
    if (p.h === 0) continue;
    if (pt[1] >= p.h - 0.06 && dansSolide(p, pt[0], pt[2])) return [0, 1, 0];
    const tester = (anneau: Vec2[]) => {
      for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        const ax = anneau[j][0], az = anneau[j][1], bx = anneau[i][0], bz = anneau[i][1];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
        if (l2 < 1e-9) continue;
        const k = Math.max(0, Math.min(1, ((pt[0] - ax) * ex + (pt[2] - az) * ez) / l2));
        const d = Math.hypot(pt[0] - (ax + ex * k), pt[2] - (az + ez * k));
        if (d < meilleur) { meilleur = d; const l = Math.sqrt(l2); nx = -ez / l; nz = ex / l; }
      }
    };
    tester(p.anneau);
    for (const t of p.trous) tester(t);
  }
  if (meilleur === Infinity) return [0, 1, 0];
  // vers le tireur
  if (nx * (de[0] - pt[0]) + nz * (de[2] - pt[2]) < 0) { nx = -nx; nz = -nz; }
  return [nx + 0, 0, nz + 0];
}
