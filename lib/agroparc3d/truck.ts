import type { Vec2 } from "./types";

/** Longueur (m) parcourue sur la voie avant de quitter la route vers la place. */
export const ELAN_M = 95;

const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Point de la polyligne le plus proche de `target`, avec l'index du segment qui le porte. */
function plusProche(pts: Vec2[], target: Vec2): { pt: Vec2; seg: number } {
  let best = { d: Infinity, pt: pts[0], seg: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const abx = bx - ax, abz = bz - az;
    const u = Math.min(1, Math.max(0, ((target[0] - ax) * abx + (target[1] - az) * abz) / Math.max(abx * abx + abz * abz, 1e-6)));
    const pt: Vec2 = [ax + abx * u, az + abz * u];
    const d = dist(pt, target);
    if (d < best.d) best = { d, pt, seg: i };
  }
  return best;
}

/**
 * Remonte la voie depuis `from` (sur le segment `seg`) de `length` m dans le sens `dir`
 * (-1 : vers le début de la polyligne, +1 : vers la fin). Renvoie les points du départ vers `from`.
 */
function elan(pts: Vec2[], from: Vec2, seg: number, dir: -1 | 1, length: number): Vec2[] {
  const out: Vec2[] = [];
  let cur = from, reste = length;
  let i = dir === -1 ? seg : seg + 1;
  while (reste > 0 && i >= 0 && i < pts.length) {
    const next = pts[i], d = dist(cur, next);
    if (d >= reste) {
      const u = reste / d;
      out.push([cur[0] + (next[0] - cur[0]) * u, cur[1] + (next[1] - cur[1]) * u]);
      reste = 0;
    } else {
      out.push(next);
      reste -= d;
      cur = next;
      i += dir;
    }
  }
  return out.reverse();
}

const longueur = (pts: Vec2[]) => pts.reduce((acc, p, i) => (i === 0 ? 0 : acc + dist(pts[i - 1], p)), 0);

/**
 * Trajet d'arrivée du food truck : le long de la voie `road` sur ELAN_M mètres (dans le sens
 * qui offre le plus de longueur), jusqu'au point de la voie le plus proche de `park`, puis tout
 * droit jusqu'à la place. Le dernier segment est celui que le générateur de scène a vérifié
 * libre de bâtiments ; le reste suit la route.
 */
export function trajetTruck(road: Vec2[], park: Vec2, elanM = ELAN_M): Vec2[] {
  if (road.length < 2) return [park];
  const { pt, seg } = plusProche(road, park);
  const arriere = elan(road, pt, seg, -1, elanM);
  const avant = elan(road, pt, seg, 1, elanM);
  const approche = longueur([...arriere, pt]) >= longueur([...avant, pt]) ? arriere : avant;
  return [...approche, pt, park];
}
