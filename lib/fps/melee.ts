/**
 * Arme blanche (couteau, épée) de l'arène (PUR) : portée mesurée à la SURFACE de la capsule de la cible, cône de frappe, ligne de vue.
 * Côté client `trouverCiblesMelee` (ou `trouverCibleCouteau`) choisit les cibles ; côté serveur `coupVraisemblable` valide le coup de chaque cible (portée + marge, cône, ligne
 * de vue tête / torse / pieds, cible vivante). Les positions de la cible sont rejouées sur `REWIND_MELEE_MS`, pas `REWIND_MAX_MS`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.4, §5.2), 2026-10-27-arene-zombies-design.md (épée)
 */
import { MELEE } from "./armes";
import { visible, type Monde } from "./collision";
import { silhouetteDe, type ArmeMeleeId, type Vec3 } from "./protocole";
import { pointsVisibilite, type Cible } from "./tir";

export interface CibleMelee extends Cible { accroupi?: boolean }
/** Fenêtre de rejeu des positions de la cible pour un coup de couteau (ms), plus courte que REWIND_MAX_MS (300 ms ajouteraient ≈ 5 m de portée à 16 m/s). */
export const REWIND_MELEE_MS = 200;

/** Point de l'axe de la capsule (segment vertical corps.y0..corps.y1 au-dessus des pieds) le plus proche de `o`. */
function pointAxe(o: Vec3, cible: CibleMelee): Vec3 {
  const { corps } = silhouetteDe(cible.accroupi);
  const [px, py, pz] = cible.p;
  const y = Math.min(py + corps.y1, Math.max(py + corps.y0, o[1]));
  return [px, y, pz];
}

/** Distance (m) de l'œil `o` à la SURFACE de la capsule de la cible (axe vertical, rayon corps.rayon), 0 si dedans. */
export function distanceSurface(o: Vec3, cible: CibleMelee): number {
  const a = pointAxe(o, cible);
  return Math.max(0, Math.hypot(a[0] - o[0], a[1] - o[1], a[2] - o[2]) - silhouetteDe(cible.accroupi).corps.rayon);
}

/**
 * Vrai si la capsule de la cible est dans le cône de frappe (demi-angle d'arc `cosCone`, 55° au couteau, 70° à l'épée) autour de `d` : l'angle se mesure
 * vers le point de l'axe le plus proche, élargi de ce que le rayon de la capsule occupe à cette distance (une cible de côté dont le
 * bord est dans le cône est frappée). Dedans (distance à l'axe nulle ou inférieure au rayon), toujours vrai.
 */
export function dansCone(o: Vec3, d: Vec3, cible: CibleMelee, cosCone: number): boolean {
  const a = pointAxe(o, cible);
  const vx = a[0] - o[0], vy = a[1] - o[1], vz = a[2] - o[2];
  const l = Math.hypot(vx, vy, vz);
  const rayon = silhouetteDe(cible.accroupi).corps.rayon;
  if (l <= rayon) return true;
  const cos = Math.max(-1, Math.min(1, (vx * d[0] + vy * d[1] + vz * d[2]) / l));
  return Math.acos(cos) <= Math.acos(cosCone) + Math.asin(rayon / l);
}

/** Ligne de vue de l'œil à la surface de la cible : tête, centre ou pieds visibles (mêmes points que le tir, côté tireur). */
function ligneDeVue(monde: Monde, o: Vec3, cible: CibleMelee): boolean {
  return pointsVisibilite(o, cible).some((pt) => visible(monde, o, pt));
}

/**
 * Client : cibles frappées par l'arme blanche `arme` : à ≤ `portee` de surface, dans son cône, ligne de vue libre, au plus
 * `nbCiblesMax`, triées de la plus proche à la plus lointaine. `cibles` peut mélanger joueurs et tigres (même forme de capsule).
 */
export function trouverCiblesMelee(
  monde: Monde, o: Vec3, d: Vec3, cibles: readonly CibleMelee[], tireur: string, arme: ArmeMeleeId = "couteau",
): { cible: string; distance: number }[] {
  const m = MELEE[arme];
  const trouvees: { cible: string; distance: number }[] = [];
  for (const c of cibles) {
    if (c.id === tireur || !c.vivant) continue;
    const distance = distanceSurface(o, c);
    if (distance > m.portee) continue;
    if (!dansCone(o, d, c, m.cosCone) || !ligneDeVue(monde, o, c)) continue;
    trouvees.push({ cible: c.id, distance });
  }
  trouvees.sort((a, b) => a.distance - b.distance);
  return trouvees.length > m.nbCiblesMax ? trouvees.slice(0, m.nbCiblesMax) : trouvees;
}

/** Client : cible la plus proche du couteau (comportement historique : une seule cible). */
export function trouverCibleCouteau(monde: Monde, o: Vec3, d: Vec3, cibles: readonly CibleMelee[], tireur: string): { cible: string; distance: number } | null {
  return trouverCiblesMelee(monde, o, d, cibles, tireur, "couteau")[0] ?? null;
}

/**
 * Serveur : validation d'un coup (portée + margePortee de l'arme, cône, ligne de vue tête/torse/pieds, cible vivante). La cible est celle
 * rejouée à l'instant du coup sur `REWIND_MELEE_MS` : la vitesse de la cible n'élargit PAS la portée (c'est le rôle du rejeu).
 */
export function coupVraisemblable(monde: Monde, o: Vec3, d: Vec3, cible: CibleMelee, arme: ArmeMeleeId = "couteau"): boolean {
  if (!cible.vivant) return false;
  const m = MELEE[arme];
  if (distanceSurface(o, cible) > m.portee + m.margePortee) return false;
  return dansCone(o, d, cible, m.cosCone) && ligneDeVue(monde, o, cible);
}
