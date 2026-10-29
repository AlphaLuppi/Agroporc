/**
 * Géométrie 2D du décor (PUR) : distance point-segment, point dans un anneau, grille spatiale de segments. Repère de scene.json (x est, z sud).
 */
import type { Vec2 } from "./types";

export interface Boite { x0: number; z0: number; x1: number; z1: number }

export function dansAnneau(x: number, z: number, r: readonly Vec2[]): boolean {
  let d = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) d = !d;
  }
  return d;
}

export function dansBoite(x: number, z: number, b: Boite): boolean {
  return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
}

/** Point le plus proche de (px, pz) sur le segment a-b : paramètre t dans [0, 1], point, distance. */
export function pointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { t: number; x: number; z: number; d: number } {
  const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ux + (pz - az) * uz) / l2)) : 0;
  const x = ax + t * ux, z = az + t * uz;
  return { t, x, z, d: Math.hypot(px - x, pz - z) };
}

/** Intersection stricte de deux segments : paramètres (t sur a-b, s sur c-d) ou null. */
export function croisement(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): { t: number; s: number; x: number; z: number } | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den, s = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return { t, s, x: ax + t * rx, z: az + t * rz };
}

/** Distance d'un point à un anneau (contour). */
export function distanceAnneau(x: number, z: number, r: readonly Vec2[]): number {
  let m = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    m = Math.min(m, pointSegment(x, z, a[0], a[1], b[0], b[1]).d);
  }
  return m;
}

/** Grille spatiale : chaque élément est rangé dans les cases que touche sa boîte englobante ; `proches` visite ceux d'une zone carrée. */
export class Grille<T> {
  private cases = new Map<number, T[]>();
  constructor(private readonly pas: number) {}
  private cle(i: number, j: number): number { return (i + 32768) * 65536 + (j + 32768); }
  ajouter(x0: number, z0: number, x1: number, z1: number, v: T): void {
    const i0 = Math.floor(Math.min(x0, x1) / this.pas), i1 = Math.floor(Math.max(x0, x1) / this.pas);
    const j0 = Math.floor(Math.min(z0, z1) / this.pas), j1 = Math.floor(Math.max(z0, z1) / this.pas);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.cle(i, j);
        const l = this.cases.get(k);
        if (l) l.push(v); else this.cases.set(k, [v]);
      }
    }
  }
  /** Éléments rangés dans les cases qui touchent le carré de demi-côté `rayon` autour de (x, z) ; un élément peut revenir (plusieurs cases). */
  proches(x: number, z: number, rayon: number, visite: (v: T) => void): void {
    const i0 = Math.floor((x - rayon) / this.pas), i1 = Math.floor((x + rayon) / this.pas);
    const j0 = Math.floor((z - rayon) / this.pas), j1 = Math.floor((z + rayon) / this.pas);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.cases.get(this.cle(i, j))?.forEach(visite);
  }
}
