/**
 * Géométrie pure des bus (sans three.js) : abscisses curvilignes des arrêts
 * le long d'une voie et choix des voies desservies. Testé dans bus.test.ts.
 */
import type { Vec2 } from "./types";

/** Longueurs cumulées le long d'une polyligne (cum[0] = 0). */
export function cumulativeLengths(pts: Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** Projection d'un point sur une polyligne : abscisse s et distance au point projeté. */
function project(pts: Vec2[], cum: number[], [px, pz]: Vec2): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
    const qx = ax + u * dx, qz = az + u * dz;
    const d = Math.hypot(px - qx, pz - qz);
    if (d < best.d) best = { s: cum[i] + u * Math.sqrt(l2), d };
  }
  return best;
}

/**
 * Abscisses curvilignes s des arrêts situés à moins de maxDist m de la polyligne,
 * triées croissantes, dédoublonnées (deux arrêts à < 2 m de s l'un de l'autre ne
 * comptent qu'une fois).
 */
export function stopAbscissas(pts: Vec2[], stops: Vec2[], maxDist = 12): number[] {
  if (pts.length < 2 || stops.length === 0) return [];
  const cum = cumulativeLengths(pts);
  const found: number[] = [];
  for (const st of stops) {
    const { s, d } = project(pts, cum, st);
    if (d <= maxDist) found.push(s);
  }
  found.sort((a, b) => a - b);
  const out: number[] = [];
  for (const s of found) if (out.length === 0 || s - out[out.length - 1] >= 2) out.push(s);
  return out;
}

/**
 * Choisit jusqu'à `count` routes parmi `routes`, en privilégiant celles qui
 * desservent le plus d'arrêts puis les plus longues ; retourne les indices.
 */
export function pickBusRoutes(routes: { p: Vec2[] }[], stops: Vec2[], count: number, maxDist = 12): number[] {
  const scored = routes.map((r, i) => {
    const cum = cumulativeLengths(r.p);
    return { i, stops: stopAbscissas(r.p, stops, maxDist).length, len: cum[cum.length - 1] };
  });
  scored.sort((a, b) => b.stops - a.stops || b.len - a.len || a.i - b.i);
  return scored.slice(0, Math.max(0, count)).map((x) => x.i);
}
