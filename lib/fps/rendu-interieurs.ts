/**
 * Rendu des intérieurs de la carte zombies v7 (three) : les quatre bâtiments creusés (72, 70, 62, 74) et leurs pièces `coque` / `cloison`
 * / `meuble` / `fenetre`, que le décor ne dessine pas. Murs en boîtes à deux faces (façade sombre à arêtes cyan dehors, enduit dedans avec
 * plinthe et cimaise), linteaux au-dessus des portes et des fenêtres, allèges sous les fenêtres, sol carrelé, faux plafond à dalles
 * lumineuses à `PLAFOND_M`, toit à la hauteur du bâtiment, mobilier par genre, dedans comme dehors (v8 : oliviers low poly dans leur bac,
 * voitures garées, conteneurs, palettes, haies, terrasses ; feuillage et haies dans un maillage à part). Éclairage : secours rouge qui pulse tant que le courant est
 * coupé, lumière chaude une fois le disjoncteur réarmé (`majCourant`). Les portes payantes restent au décor (elles s'effondrent avec lui).
 * Aucun test vitest (three) : la géométrie vient de `zombies-carte.ts` (testée), les régressions se voient aux captures.
 * Le Battle Royale (`br-carte.ts`) réutilise ce rendu pour ses 20 bâtiments creusés, toit ouvert (`OptionsInterieurs`).
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Carte « Service de midi » »)
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shapeFrom } from "../agroparc3d/decor";
import type { SceneData, Vec2 } from "../agroparc3d/types";
import { ANGLE_BATIMENTS, BATIMENTS_CREUX, HAUTEUR_PLAFOND_ZOMBIES, HAUTEUR_PORTE_INTERIEURE, OLIVIER, batimentDePiece, plafondZombies, type GenreMeuble, type PieceSynth } from "./zombies-carte";

/** Hauteur du faux plafond (m, solide aussi pour la tête du joueur : `construireMondeZombies`) et des fenêtres (allège, linteau). */
export const PLAFOND_M = HAUTEUR_PLAFOND_ZOMBIES;
export const FENETRE_BAS_M = 0.9;
export const FENETRE_HAUT_M = 2.3;

const C_FACADE = new THREE.Color(0x05080c);
const C_ENDUIT = new THREE.Color(0x1c2129);
const C_PLINTHE = new THREE.Color(0x2c333d);
const C_DESSUS = new THREE.Color(0x0a0d12);
const C_ARETES = 0x9be9ff;
const C_SECOURS = new THREE.Color(0xff2a1a);
const C_LUMIERE = new THREE.Color(0xffe3b0);

/**
 * Réglages du rendu des intérieurs. `batiments` : index des bâtiments creusés à dessiner (défaut : `BATIMENTS_CREUX`, les quatre de la carte
 * zombies). `sansPlafond` : toit ouvert (carte du Battle Royale), ni faux plafond ni toit, on voit le ciel en fil de fer.
 */
export interface OptionsInterieurs {
  sansPlafond?: boolean;
  batiments?: readonly number[];
  /** Éclairage chaud dès la création (carte sans disjoncteur) au lieu du secours rouge qui pulse ; `majCourant` reste utilisable. */
  courant?: boolean;
}

export interface RenduInterieurs {
  /** courant rétabli : passage progressif (≈ 1,5 s) du secours rouge à la lumière */
  majCourant(on: boolean): void;
  /** `t` : horloge (s), `dt` : pas (s) */
  maj(t: number, dt: number): void;
  /** (v8) éclat d'un éclair (0..1) : les pièces s'illuminent un instant, courant coupé ou non */
  flash(k: number): void;
  dispose(): void;
}

/** Boîte orientée du rectangle d'une pièce, de `y0` à `y1`, à couleurs par face (intérieur si la face regarde `centre`). */
function boitePiece(p: PieceSynth, y0: number, y1: number, centre: Vec2 | null, pos: number[], col: number[]): void {
  const r = batimentDePiece(p).r;
  const faces: [number, number, number, number][] = [];
  const v = (i: number, y: number): [number, number, number] => [r[i][0], y, r[i][1]];
  const quad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], couleur: THREE.Color) => {
    for (const q of [a, b, c, a, c, d]) { pos.push(q[0], q[1], q[2]); col.push(couleur.r, couleur.g, couleur.b); }
  };
  // côtés : i → i+1
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mx = (r[i][0] + r[j][0]) / 2, mz = (r[i][1] + r[j][1]) / 2;
    // normale sortante du rectangle
    const cx = (r[0][0] + r[2][0]) / 2, cz = (r[0][1] + r[2][1]) / 2;
    const nx = mx - cx, nz = mz - cz;
    const interieur = p.type === "cloison" || p.type === "meuble" || (centre !== null && (centre[0] - mx) * nx + (centre[1] - mz) * nz > 0);
    const c = interieur ? (p.type === "meuble" ? C_PLINTHE : C_ENDUIT) : C_FACADE;
    quad(v(i, y0), v(j, y0), v(j, y1), v(i, y1), c);
    faces.push([i, j, 0, 0]);
  }
  quad(v(0, y1), v(1, y1), v(2, y1), v(3, y1), C_DESSUS);
}

/** Géométrie à couleurs par sommet, faces visibles des deux côtés (l'ordre des sommets varie selon l'anneau). */
function geometrie(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Hachage (0 à 1) d'un id de pièce et d'un rang : variations stables d'un rendu à l'autre (couleur d'une voiture, hauteur d'une haie). */
function hacher(id: string, k = 0): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Triangles à couleur par face (sommets en coordonnées de la carte) : le mobilier et la végétation y ajoutent leurs faces. */
interface Faces { pos: number[]; col: number[] }
const tri = (f: Faces, a: readonly number[], b: readonly number[], c: readonly number[], couleur: THREE.Color) => {
  for (const q of [a, b, c]) { f.pos.push(q[0], q[1], q[2]); f.col.push(couleur.r, couleur.g, couleur.b); }
};

/** Prisme droit d'un polygone convexe (sommets dans le plan xz) de `y0` à `y1` : côtés et dessus. */
function prismePolygone(f: Faces, pts: readonly Vec2[], y0: number, y1: number, cote: THREE.Color, dessus: THREE.Color): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    tri(f, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], cote);
    tri(f, [a[0], y0, a[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], cote);
  }
  for (let i = 1; i < pts.length - 1; i++) tri(f, [pts[0][0], y1, pts[0][1]], [pts[i][0], y1, pts[i][1]], [pts[i + 1][0], y1, pts[i + 1][1]], dessus);
}

/** Tronçon de branche : tube à six pans de `a` (rayon `ra`) à `b` (rayon `rb`). */
function tube(f: Faces, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, c: THREE.Color): void {
  const d = new THREE.Vector3().subVectors(b, a).normalize();
  const haut = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(d, haut).normalize(), e2 = new THREE.Vector3().crossVectors(d, e1);
  const anneau = (o: THREE.Vector3, r: number) => Array.from({ length: 6 }, (_, k) => {
    const t = (k / 6) * Math.PI * 2;
    return o.clone().addScaledVector(e1, Math.cos(t) * r).addScaledVector(e2, Math.sin(t) * r).toArray();
  });
  const A = anneau(a, ra), B = anneau(b, rb);
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    // une face sur deux un peu plus claire : le pan tourné vers le ciel ressort sans éclairage
    const cc = k % 2 ? c : c.clone().multiplyScalar(1.25);
    tri(f, A[k], A[j], B[j], cc);
    tri(f, A[k], B[j], B[k], cc);
  }
}

/** Touffe de feuillage : icosaèdre aplati, une couleur par face (gris-vert de l'olivier, quelques reflets argentés). */
function touffe(f: Faces, centre: THREE.Vector3, r: number, aplati: number, base: THREE.Color, graine: string): void {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.getAttribute("position");
  for (let i = 0; i < p.count; i += 3) {
    const k = hacher(graine, i);
    const c = base.clone().multiplyScalar(0.7 + 0.45 * k);
    if (k > 0.88) c.lerp(new THREE.Color(0x9aa892), 0.35);
    const v = (j: number) => [centre.x + p.getX(j) * r, centre.y + p.getY(j) * r * aplati, centre.z + p.getZ(j) * r];
    tri(f, v(i), v(i + 1), v(i + 2), c);
  }
  geo.dispose();
  if (geo !== g) g.dispose();
}

/**
 * Olivier (centre `c`) : bac octogonal de pierre et sa terre, tronc tordu en trois tronçons qui se partage en trois charpentières, ramure
 * de touffes gris-vert entre 2,6 et 4,6 m (au-dessus du tronc de collision : les balles y passent).
 */
function olivier(id: string, c: Vec2, f: Faces, veg: Faces): void {
  const o = OLIVIER, R = o.apothemeBac / Math.cos(Math.PI / 8);
  const octo = (r: number): Vec2[] => Array.from({ length: 8 }, (_, k) => {
    const a = ANGLE_BATIMENTS + Math.PI / 8 + (k * Math.PI) / 4;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  });
  const pierre = new THREE.Color(0x4a4640), margelle = new THREE.Color(0x67635a), terre = new THREE.Color(0x2b2119);
  prismePolygone(f, octo(R), 0, o.hauteurBac, pierre, margelle);
  prismePolygone(f, octo(R - 0.22), o.hauteurBac, o.hauteurBac + 0.012, terre, terre);
  const V = (dx: number, y: number, dz: number) => new THREE.Vector3(c[0] + dx, y, c[1] + dz);
  const ecorce = new THREE.Color(0x4d4237);
  // torsion bornée : le tronc dessiné reste dans le carré de collision (diagonale 0,64 m)
  const tors = (k: number) => (hacher(id, k) - 0.5) * 0.3;
  const pts = [V(0, 0.3, 0), V(0.1 + tors(1), 1.0, -0.08), V(-0.1, 1.7, 0.12 + tors(2)), V(0.08, 2.3, -0.05)];
  const rayons = [0.4, 0.33, 0.27, 0.22];
  for (let k = 0; k < pts.length - 1; k++) tube(f, pts[k], pts[k + 1], rayons[k], rayons[k + 1], ecorce);
  const feuillage = new THREE.Color(0x5b6e53);
  const tete = pts[pts.length - 1];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + hacher(id, 10 + k) * 1.2;
    const bout = V(Math.cos(a) * 1.5, 3.2 + hacher(id, 20 + k) * 0.5, Math.sin(a) * 1.5);
    const coude = tete.clone().lerp(bout, 0.5).add(new THREE.Vector3(0, 0.25, 0));
    tube(f, tete, coude, 0.17, 0.12, ecorce);
    tube(f, coude, bout, 0.12, 0.07, ecorce);
    touffe(veg, bout.clone().add(new THREE.Vector3(0, 0.45, 0)), 1.35 + hacher(id, 30 + k) * 0.4, 0.62, feuillage, `${id}t${k}`);
  }
  touffe(veg, V(0, 4.1, 0), 1.6, 0.55, feuillage, `${id}h`);
  touffe(veg, V(0.6, 3.5, -0.8), 1.1, 0.6, feuillage, `${id}h2`);
}

/** Couleurs de carrosserie des voitures garées (sombres, comme le reste de la carte). */
const CARROSSERIES = [0x2a3a55, 0x553030, 0x34463a, 0x4c4c48, 0x2a2a30, 0x5a4a2a].map((c) => new THREE.Color(c));
/** Couleurs de conteneurs maritimes. */
const CONTENEURS = [0x5a2a1e, 0x1f3550, 0x2f4a2c].map((c) => new THREE.Color(c));

/** Mobilier : boîtes simples par genre, dans le repère du rectangle (u le long, v en travers), ajoutées en coordonnées de la carte. */
function meuble(p: PieceSynth, pos: number[], col: number[], led: number[], veg: Faces): void {
  const [px, pz] = p.p, [qx, qz] = p.q;
  const L = Math.hypot(qx - px, qz - pz) || 1;
  const ux = (qx - px) / L, uz = (qz - pz) / L, vx = -uz, vz = ux;
  const cx = (px + qx) / 2, cz = (pz + qz) / 2;
  const l = p.demi * 2;
  const principal: Faces = { pos, col };
  const b = (u0: number, u1: number, w0: number, w1: number, y0: number, y1: number, c: THREE.Color, f: Faces = principal) => {
    const k = (u: number, w: number): Vec2 => [cx + ux * u + vx * w, cz + uz * u + vz * w];
    const coins = [k(u0, w0), k(u1, w0), k(u1, w1), k(u0, w1)];
    const quad = (a: number[], bb: number[], cc: number[], d: number[]) => { for (const q of [a, bb, cc, a, cc, d]) { f.pos.push(q[0], q[1], q[2]); f.col.push(c.r, c.g, c.b); } };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad([coins[i][0], y0, coins[i][1]], [coins[j][0], y0, coins[j][1]], [coins[j][0], y1, coins[j][1]], [coins[i][0], y1, coins[i][1]]);
    }
    quad([coins[0][0], y1, coins[0][1]], [coins[1][0], y1, coins[1][1]], [coins[2][0], y1, coins[2][1]], [coins[3][0], y1, coins[3][1]]);
  };
  const h = p.h;
  const bois = new THREE.Color(0x3a2a1c), metal = new THREE.Color(0x2a313a), sombre = new THREE.Color(0x12161c), tissu = new THREE.Color(0x3a2230);
  const ledAt = (u: number, w: number, y: number, c: THREE.Color) => led.push(cx + ux * u + vx * w, y, cz + uz * u + vz * w, c.r, c.g, c.b);
  switch (p.genre as GenreMeuble) {
    case "olivier":
      olivier(p.id, [cx, cz], principal, veg);
      break;
    case "bac":
      // barres de collision du bac : il est dessiné avec l'olivier
      break;
    case "haie": {
      // tronçons de 0,8 m de hauteur inégale, un peu ventrus : une haie taillée mais vivante
      const n = Math.max(1, Math.round(L / 0.8));
      for (let k = 0; k < n; k++) {
        const u0 = -L / 2 + (k * L) / n, u1 = -L / 2 + ((k + 1) * L) / n;
        const r = hacher(p.id, k);
        const vert = new THREE.Color(0x1f3a24).multiplyScalar(0.8 + 0.5 * r);
        b(u0, u1, -l / 2 - 0.05 * r, l / 2 + 0.05 * r, 0, h - 0.3 * hacher(p.id, k + 50), vert, veg);
      }
      break;
    }
    case "conteneur": {
      const c = CONTENEURS[Math.floor(hacher(p.id) * CONTENEURS.length)];
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, c);
      // nervures des grands côtés, portes et barres de fermeture au bout
      const nervure = c.clone().multiplyScalar(1.35);
      for (let u = -L / 2 + 0.3; u < L / 2 - 0.2; u += 0.6) for (const s of [-1, 1]) b(u - 0.08, u + 0.08, s * l / 2 - 0.03, s * l / 2 + 0.03, 0.08, h - 0.08, nervure);
      for (const w of [-l / 4 - 0.15, -l / 4 + 0.15, l / 4 - 0.15, l / 4 + 0.15]) b(L / 2, L / 2 + 0.04, w - 0.025, w + 0.025, 0.1, h - 0.1, metal);
      break;
    }
    case "palette": {
      // deux palettes de 1,2 m chargées de cartons, sur deux niveaux
      const planche = new THREE.Color(0x5a4630), carton = new THREE.Color(0x6b5338);
      for (const s of [-1, 1]) {
        const u0 = s < 0 ? -L / 2 : 0.02, u1 = s < 0 ? -0.02 : L / 2;
        for (const [y0, y1] of [[0, 0.62], [0.65, h]] as const) {
          b(u0, u1, -l / 2, l / 2, y0, y0 + 0.14, planche);
          b(u0 + 0.05, u1 - 0.05, -l / 2 + 0.05, l / 2 - 0.05, y0 + 0.14, y1, carton.clone().multiplyScalar(0.85 + 0.3 * hacher(p.id, s + y0 * 10)));
        }
      }
      break;
    }
    case "voiture": {
      // caisse, habitacle vitré plus étroit, quatre roues ; phares jaunes à l'avant, feux rouges à l'arrière
      const c = CARROSSERIES[Math.floor(hacher(p.id) * CARROSSERIES.length)];
      const vitre = new THREE.Color(0x101820), pneu = new THREE.Color(0x0b0b0d);
      for (const su of [-1, 1]) for (const sw of [-1, 1]) b(su * L * 0.32 - 0.33, su * L * 0.32 + 0.33, sw * l / 2 - 0.25, sw * l / 2 + 0.02, 0, 0.62, pneu);
      b(-L / 2, L / 2, -l / 2 + 0.03, l / 2 - 0.03, 0.3, 0.92, c);
      b(-L * 0.24, L * 0.2, -l / 2 + 0.15, l / 2 - 0.15, 0.92, h - 0.06, vitre);
      b(-L * 0.22, L * 0.18, -l / 2 + 0.18, l / 2 - 0.18, h - 0.06, h, c);
      for (const w of [-l / 2 + 0.3, l / 2 - 0.3]) { ledAt(L / 2 + 0.01, w, 0.72, new THREE.Color(0xffe08a)); ledAt(-L / 2 - 0.01, w, 0.75, new THREE.Color(0xff3a2a)); }
      break;
    }
    case "terrasse": {
      // table de bistrot, deux chaises, parasol fermé
      b(-0.38, 0.38, -0.38, 0.38, h - 0.04, h, bois);
      b(-0.04, 0.04, -0.04, 0.04, 0, h - 0.04, metal);
      for (const s of [-1, 1]) { b(s * 0.62 - 0.2, s * 0.62 + 0.2, -0.2, 0.2, 0, 0.45, metal); b(s * 0.8 - 0.03, s * 0.8 + 0.03, -0.2, 0.2, 0.45, 0.9, metal); }
      b(-0.025, 0.025, -0.025, 0.025, h, 2.1, metal);
      b(-0.12, 0.12, -0.12, 0.12, 1.3, 2.1, new THREE.Color(0x6a2a24));
      break;
    }
    case "muret":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h - 0.06, new THREE.Color(0x3a3a40));
      b(-L / 2 - 0.03, L / 2 + 0.03, -l / 2 - 0.04, l / 2 + 0.04, h - 0.06, h, new THREE.Color(0x55555c));
      break;
    case "bureau":
      b(-L / 2, L / 2, -l / 2, l / 2, h - 0.05, h, bois);
      for (const su of [-1, 1]) for (const sw of [-1, 1]) b(su * L / 2 - su * 0.08 - 0.03, su * L / 2 - su * 0.08 + 0.03, sw * l / 2 - sw * 0.08 - 0.03, sw * l / 2 - sw * 0.08 + 0.03, 0, h - 0.05, metal);
      // deux écrans de part et d'autre de la séparation
      for (const u of [-L / 4, L / 4]) for (const w of [-l / 4, l / 4]) { b(u - 0.28, u + 0.28, w - 0.02, w + 0.02, h + 0.12, h + 0.46, sombre); ledAt(u, w, h + 0.3, new THREE.Color(0x3fd0ff)); }
      b(-L / 2, L / 2, -0.02, 0.02, h, h + 0.4, metal);
      break;
    case "table":
      b(-L / 2, L / 2, -l / 2, l / 2, h - 0.04, h, bois);
      b(-0.06, 0.06, -0.06, 0.06, 0, h - 0.04, metal);
      for (const u of [-L / 2 - 0.35, L / 2 + 0.35]) b(u - 0.2, u + 0.2, -0.2, 0.2, 0, 0.45, tissu);
      break;
    case "canape":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, 0.42, tissu);
      b(-L / 2, L / 2, l / 2 - 0.18, l / 2, 0.42, h, tissu);
      break;
    case "comptoir":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h - 0.05, metal);
      b(-L / 2 - 0.03, L / 2 + 0.03, -l / 2 - 0.03, l / 2 + 0.03, h - 0.05, h, new THREE.Color(0x46505c));
      break;
    case "piano":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, metal);
      for (let k = 0; k < 4; k++) { const u = -L / 2 + (k + 0.5) * (L / 4); ledAt(u, 0, h + 0.02, new THREE.Color(0xff6a2a)); }
      break;
    case "etagere":
      for (const y of [0, 0.6, 1.2, h - 0.04]) b(-L / 2, L / 2, -l / 2, l / 2, y, y + 0.04, bois);
      for (const su of [-1, 1]) b(su * L / 2 - 0.03, su * L / 2 + 0.03, -l / 2, l / 2, 0, h, bois);
      break;
    case "rack":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, sombre);
      for (let k = 0; k < 6; k++) ledAt(-L / 2 + 0.2 + (k % 3) * 0.3, l / 2 + 0.01, 0.4 + Math.floor(k / 3) * 0.9, new THREE.Color(k % 2 ? 0x3fff7a : 0xffb35c));
      break;
    case "paillasse":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h - 0.05, new THREE.Color(0x1f2a2a));
      b(-L / 2, L / 2, -l / 2, l / 2, h - 0.05, h, new THREE.Color(0x3a4a4a));
      for (const u of [-L / 3, 0, L / 3]) { b(u - 0.06, u + 0.06, -0.06, 0.06, h, h + 0.25, new THREE.Color(0x2a4a5a)); ledAt(u, 0, h + 0.2, new THREE.Color(0x5dff6a)); }
      break;
    case "cuve":
      b(-L / 2, L / 2, -l / 2, l / 2, 0, h, new THREE.Color(0x1a2836));
      ledAt(0, l / 2 + 0.01, h * 0.6, new THREE.Color(0x7fd8ff));
      break;
  }
}

export function creerRenduInterieurs(scene: THREE.Scene, data: SceneData, pieces: readonly PieceSynth[], options: OptionsInterieurs = {}): RenduInterieurs {
  const batiments: readonly number[] = options.batiments ?? BATIMENTS_CREUX;
  const sansPlafond = options.sansPlafond === true;
  const racine = new THREE.Group();
  racine.name = "interieurs";
  scene.add(racine);
  const aDisposer: { dispose(): void }[] = [];

  // ---- murs, linteaux, allèges, mobilier ----
  const pos: number[] = [], col: number[] = [];
  const posM: number[] = [], colM: number[] = [], leds: number[] = [];
  const veg: Faces = { pos: [], col: [] };
  const centres = new Map<number, Vec2>();
  for (const b of batiments) centres.set(b, data.buildings[b].c);
  for (const p of pieces) {
    // le mobilier se dessine aussi dehors (aménagements de la v8 : olivier, voitures, conteneurs, haies…)
    if (p.type === "meuble") { meuble(p, posM, colM, leds, veg); continue; }
    if (p.batiment === undefined) continue;
    const h = data.buildings[p.batiment]?.h ?? p.h;
    const centre = centres.get(p.batiment) ?? null;
    if (p.type === "coque" || p.type === "cloison") boitePiece(p, 0, h, centre, pos, col);
    else if (p.type === "porte") boitePiece({ ...p, type: p.type }, HAUTEUR_PORTE_INTERIEURE, h, centre, pos, col);
    else if (p.type === "fenetre") { boitePiece(p, 0, FENETRE_BAS_M, centre, pos, col); boitePiece(p, FENETRE_HAUT_M, h, centre, pos, col); }
  }
  const geoMurs = geometrie(pos, col);
  const matMurs = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  const uLumiere = { value: options.courant ? 1 : 0 };
  const uSecours = { value: options.courant ? 0 : 1 };
  // plinthe et cimaise sur l'enduit, lueur du plafond qui descend sur les murs (rouge de secours ou chaude)
  matMurs.onBeforeCompile = (sh) => {
    sh.uniforms.uLumiere = uLumiere;
    sh.uniforms.uSecours = uSecours;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeI;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMondeI = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeI;\nuniform float uLumiere;\nuniform float uSecours;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float enduit = step(0.06, diffuseColor.r);
        float y = vMondeI.y;
        float plinthe = 1.0 - smoothstep(0.1, 0.14, y);
        float cimaise = 1.0 - smoothstep(0.0, 0.025, abs(y - 1.05));
        float haut = smoothstep(1.2, ${PLAFOND_M.toFixed(2)}, y) * step(y, ${PLAFOND_M.toFixed(2)});
        vec3 lueur = mix(vec3(0.55, 0.05, 0.03) * uSecours, vec3(0.35, 0.3, 0.22), uLumiere);
        diffuseColor.rgb += enduit * (plinthe * 0.08 + cimaise * 0.12 + haut * 0.18) * vec3(0.6, 0.85, 1.0) * (0.4 + 0.6 * uLumiere);
        diffuseColor.rgb += enduit * lueur * (0.08 + 0.12 * haut);
      `);
  };
  matMurs.customProgramCacheKey = () => "pdj-interieurs-murs";
  const murs = new THREE.Mesh(geoMurs, matMurs);
  racine.add(murs);
  const aretes = new THREE.LineSegments(new THREE.EdgesGeometry(geoMurs, 20), new THREE.LineBasicMaterial({ color: C_ARETES, transparent: true, opacity: 0.32 }));
  racine.add(aretes);
  aDisposer.push(geoMurs, matMurs, aretes.geometry, aretes.material as THREE.Material);

  if (posM.length) {
    const geoMeubles = geometrie(posM, colM);
    const matMeubles = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    racine.add(new THREE.Mesh(geoMeubles, matMeubles));
    const aretesM = new THREE.LineSegments(new THREE.EdgesGeometry(geoMeubles, 20), new THREE.LineBasicMaterial({ color: 0xffd59a, transparent: true, opacity: 0.35 }));
    racine.add(aretesM);
    aDisposer.push(geoMeubles, matMeubles, aretesM.geometry, aretesM.material as THREE.Material);
  }
  // végétation (feuillage des oliviers, haies) : à part, arêtes vertes très discrètes (les arêtes ambre des meubles hérisseraient le feuillage)
  if (veg.pos.length) {
    const geoVeg = geometrie(veg.pos, veg.col);
    const matVeg = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    racine.add(new THREE.Mesh(geoVeg, matVeg));
    const aretesV = new THREE.LineSegments(new THREE.EdgesGeometry(geoVeg, 30), new THREE.LineBasicMaterial({ color: 0xb8e6a8, transparent: true, opacity: 0.14 }));
    racine.add(aretesV);
    aDisposer.push(geoVeg, matVeg, aretesV.geometry, aretesV.material as THREE.Material);
  }
  // voyants des meubles (écrans, LED, brûleurs) : petits points lumineux, au-dessus du seuil du halo
  const nLed = leds.length / 6;
  if (nLed) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(nLed * 3), c = new Float32Array(nLed * 3);
    for (let i = 0; i < nLed; i++) { p.set(leds.slice(i * 6, i * 6 + 3), i * 3); c.set(leds.slice(i * 6 + 3, i * 6 + 6), i * 3); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const m = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    racine.add(new THREE.Points(g, m));
    aDisposer.push(g, m);
  }

  // ---- sols, plafonds, toits ----
  const uSol = { value: options.courant ? 1 : 0 };
  const geoSols: THREE.BufferGeometry[] = [], geoPlafonds: THREE.BufferGeometry[] = [], geoToits: THREE.BufferGeometry[] = [];
  for (const b of batiments) {
    const bat = data.buildings[b];
    const forme = shapeFrom(bat.r, bat.holes);
    const sol = new THREE.ShapeGeometry(forme);
    sol.rotateX(-Math.PI / 2);
    sol.translate(0, 0.012, 0);
    geoSols.push(sol);
    if (sansPlafond) continue;
    const plafond = new THREE.ShapeGeometry(forme);
    plafond.rotateX(-Math.PI / 2);
    plafond.translate(0, plafondZombies(bat.h), 0);
    geoPlafonds.push(plafond);
    const toit = new THREE.ShapeGeometry(forme);
    toit.rotateX(-Math.PI / 2);
    toit.translate(0, bat.h, 0);
    geoToits.push(toit);
  }
  const fusion = (l: THREE.BufferGeometry[]) => {
    if (!l.length) return null;
    const g = mergeGeometries(l, false)!;
    for (const x of l) x.dispose();
    aDisposer.push(g);
    return g;
  };
  const gSol = fusion(geoSols), gPlafond = fusion(geoPlafonds), gToit = fusion(geoToits);

  const matSol = new THREE.MeshBasicMaterial({ color: 0x0d1116, side: THREE.DoubleSide });
  matSol.onBeforeCompile = (sh) => {
    sh.uniforms.uLumiere = uSol;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeS;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMondeS = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeS;\nuniform float uLumiere;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 c = abs(fract(vMondeS.xz / 0.6) - 0.5);
        float joint = 1.0 - smoothstep(0.46, 0.49, max(c.x, c.y));
        vec2 dam = floor(vMondeS.xz / 0.6);
        float case_ = mod(dam.x + dam.y, 2.0);
        diffuseColor.rgb += vec3(0.02, 0.025, 0.03) * case_ * (0.6 + 0.8 * uLumiere);
        diffuseColor.rgb += (1.0 - joint) * vec3(0.05, 0.08, 0.1) * (0.5 + 0.5 * uLumiere);
      `);
  };
  matSol.customProgramCacheKey = () => "pdj-interieurs-sol";
  if (gSol) racine.add(new THREE.Mesh(gSol, matSol));
  aDisposer.push(matSol);

  // faux plafond : dalles de 0,6 m, une dalle lumineuse sur cinq ; lumière de secours rouge qui pulse tant que le courant est coupé
  const uPulse = { value: 0 };
  const matPlafond = new THREE.MeshBasicMaterial({ color: 0x0b0e12, side: THREE.DoubleSide });
  matPlafond.onBeforeCompile = (sh) => {
    sh.uniforms.uLumiere = uLumiere;
    sh.uniforms.uSecours = uSecours;
    sh.uniforms.uPulse = uPulse;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMondeP = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMondeP;\nuniform float uLumiere;\nuniform float uSecours;\nuniform float uPulse;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 g = vMondeP.xz / 0.6;
        vec2 c = abs(fract(g) - 0.5);
        float joint = 1.0 - smoothstep(0.45, 0.48, max(c.x, c.y));
        vec2 dalle = floor(g);
        float lum = step(0.5, fract(sin(dot(dalle, vec2(12.9898, 78.233))) * 43758.5453)) * step(mod(dalle.x + 2.0 * dalle.y, 5.0), 0.5);
        vec3 chaud = vec3(1.0, 0.92, 0.75) * 1.15;
        vec3 rouge = vec3(0.9, 0.08, 0.04) * (0.35 + 0.65 * uPulse) * uSecours;
        diffuseColor.rgb += (1.0 - joint) * 0.03;
        diffuseColor.rgb += lum * joint * mix(rouge * 0.6, chaud, uLumiere);
      `);
  };
  matPlafond.customProgramCacheKey = () => "pdj-interieurs-plafond";
  aDisposer.push(matPlafond);
  if (gPlafond) racine.add(new THREE.Mesh(gPlafond, matPlafond));

  // toit à la hauteur du bâtiment (absent du Battle Royale : toit ouvert)
  const matToit = new THREE.MeshBasicMaterial({ color: C_FACADE, side: THREE.DoubleSide });
  aDisposer.push(matToit);
  if (gToit) {
    racine.add(new THREE.Mesh(gToit, matToit));
    const aretesToit = new THREE.LineSegments(new THREE.EdgesGeometry(gToit, 20), new THREE.LineBasicMaterial({ color: C_ARETES, transparent: true, opacity: 0.55 }));
    racine.add(aretesToit);
    aDisposer.push(aretesToit.geometry, aretesToit.material as THREE.Material);
  }

  // ---- éclairage ----
  let courant = options.courant === true;
  let lumiere = courant ? 1 : 0;
  let eclair = 0;
  let lumiereCourante = lumiere;
  return {
    majCourant(on) { courant = on; },
    flash(k) {
      eclair = Math.max(0, Math.min(1, k));
      uLumiere.value = Math.min(1.6, lumiereCourante + eclair);
      uSol.value = Math.min(1.6, lumiere + eclair);
    },
    maj(t, dt) {
      const cible = courant ? 1 : 0;
      // le courant revient en clignotant (néons qui s'amorcent), puis tient
      lumiere += (cible - lumiere) * (1 - Math.exp(-dt * 2.2));
      const scintille = courant && lumiere < 0.92 ? (Math.sin(t * 47) > 0.2 ? 1 : 0.35) : 1;
      lumiereCourante = lumiere * scintille;
      uLumiere.value = Math.min(1.6, lumiereCourante + eclair);
      uSecours.value = 1 - lumiere;
      uPulse.value = 0.5 + 0.5 * Math.sin(t * 3.1);
      uSol.value = Math.min(1.6, lumiere + eclair);
      void C_SECOURS; void C_LUMIERE;
    },
    dispose() {
      scene.remove(racine);
      for (const x of aDisposer) x.dispose();
      aDisposer.length = 0;
    },
  };
}
