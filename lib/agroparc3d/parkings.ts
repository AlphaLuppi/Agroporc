/**
 * Places de parking (PUR) : les séparateurs de places de chaque parking de `scene.json` (jamais ceux de `decor.json`). Rendu seulement :
 * ni voiture factice (elles ne bloqueraient pas les balles et se confondraient avec les conduisibles de l'arène), ni collision.
 * Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D2, D3).
 */
import { dansAnneau, dansBoite, pointSegment, type Boite } from "./geo";
import { DEMI_LARGEUR, contexteSol, dansBatiment, type Contexte } from "./voirie";
import type { SceneData, Vec2 } from "./types";

/** Place : 2,5 m de large le long de la rangée, 5 m de profondeur. */
export const PLACE_LARGEUR_M = 2.5;
export const PLACE_PROFONDEUR_M = 5;
/** Un parking de moins de cette surface n'est pas marqué (m²). */
export const PARKING_MIN_M2 = 150;
/** Marge entre un séparateur et une chaussée ou un bâtiment (m). */
const MARGE_M = 0.3;

function aire(r: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
  return Math.abs(a / 2);
}

/** Angle (rad) de la rangée : celui de l'allée S la plus proche du centre (à moins de 40 m), sinon le petit côté du rectangle d'aire minimale. */
function angleRangee(c: Contexte, r: readonly Vec2[], cx: number, cz: number): number {
  let meilleur: { d: number; a: number } | null = null;
  c.carrossables.proches(cx, cz, 40, (s) => {
    if (c.data.roads[s.road].c !== "S") return;
    const q = pointSegment(cx, cz, s.ax, s.az, s.bx, s.bz);
    if (!meilleur || q.d < meilleur.d) meilleur = { d: q.d, a: Math.atan2(s.bz - s.az, s.bx - s.ax) };
  });
  const aleatoire = meilleur as { d: number; a: number } | null;
  if (aleatoire) return aleatoire.a;
  // rectangle d'aire minimale : on essaie l'angle de chaque arête, on tourne le long côté sur la rangée
  let best = { aire: Infinity, a: 0, l: 0, h: 0 };
  for (let i = 0; i < r.length; i++) {
    const a = Math.atan2(r[(i + 1) % r.length][1] - r[i][1], r[(i + 1) % r.length][0] - r[i][0]);
    const co = Math.cos(a), si = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    for (const [x, z] of r) { const u = x * co + z * si, n = -x * si + z * co; u0 = Math.min(u0, u); u1 = Math.max(u1, u); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
    const A = (u1 - u0) * (n1 - n0);
    if (A < best.aire) best = { aire: A, a, l: u1 - u0, h: n1 - n0 };
  }
  // le long côté porte la rangée : les séparateurs lui sont perpendiculaires, donc les places se suivent le long du long côté
  return best.l >= best.h ? best.a : best.a + Math.PI / 2;
}

const memo = new WeakMap<object, Map<string, number[]>>();

/**
 * Séparateurs de places : segments [ax, az, bx, bz, …] (5 m, perpendiculaires à la rangée, un tous les 2,5 m), dans chaque parking d'au moins
 * 150 m², hors bâtiments, hors chaussée des voies carrossables (allées S, routes), hors boîtes `exclure`. Déterministe.
 */
export function placesParking(data: SceneData, exclure: readonly Boite[] = []): number[] {
  const cleExclusion = JSON.stringify(exclure);
  const parCle = memo.get(data.parkings) ?? new Map<string, number[]>();
  memo.set(data.parkings, parCle);
  const vu = parCle.get(cleExclusion + data.buildings.length);
  if (vu) return vu;
  const c = contexteSol(data);
  const out: number[] = [];
  for (const r of data.parkings) {
    if (r.length < 3 || aire(r) < PARKING_MIN_M2) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of r) { cx += x; cz += z; }
    cx /= r.length; cz /= r.length;
    const a = angleRangee(c, r, cx, cz);
    const co = Math.cos(a), si = Math.sin(a);
    // repère (u le long de la rangée, n perpendiculaire) centré sur le centroïde
    let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    for (const [x, z] of r) { const u = (x - cx) * co + (z - cz) * si, n = -(x - cx) * si + (z - cz) * co; u0 = Math.min(u0, u); u1 = Math.max(u1, u); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
    const monde = (u: number, n: number): Vec2 => [cx + u * co - n * si, cz + u * si + n * co];
    const libre = (x: number, z: number): boolean => {
      if (!dansAnneau(x, z, r)) return false;
      if (exclure.some((b) => dansBoite(x, z, b))) return false;
      if (dansBatiment(c, x, z)) return false;
      let ok = true;
      c.carrossables.proches(x, z, 4, (s) => {
        if (!ok) return;
        if (pointSegment(x, z, s.ax, s.az, s.bx, s.bz).d < DEMI_LARGEUR[c.data.roads[s.road].c] + MARGE_M) ok = false;
      });
      return ok;
    };
    for (let n = n0; n + PLACE_PROFONDEUR_M <= n1 + 1e-6; n += PLACE_PROFONDEUR_M) {
      for (let u = u0 + PLACE_LARGEUR_M / 2; u <= u1; u += PLACE_LARGEUR_M) {
        const A = monde(u, n), B = monde(u, n + PLACE_PROFONDEUR_M), M = monde(u, n + PLACE_PROFONDEUR_M / 2);
        if (libre(A[0], A[1]) && libre(B[0], B[1]) && libre(M[0], M[1])) out.push(A[0], A[1], B[0], B[1]);
      }
    }
  }
  parCle.set(cleExclusion + data.buildings.length, out);
  return out;
}
