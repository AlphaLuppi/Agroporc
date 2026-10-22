/**
 * Hitscan de l'arène FPS (PUR) : premier objet touché par un rayon (joueur ou bâtiment) et
 * validation serveur d'une touche déclarée par le client. Hitbox = SILHOUETTE de protocole.ts :
 * tête = sphère, corps = capsule verticale (pieds en p).
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */
import { lancerRayon, visible, type Monde } from "./collision";
import { SILHOUETTE, type Vec3, type Zone } from "./protocole";

export interface Cible { id: string; p: Vec3; vivant: boolean }
export interface Impact { cible: string | null; zone: Zone | null; distance: number; point: Vec3 }

/** Tolérance de `toucheVraisemblable` : écart maximal (m) entre le centre de la cible et le rayon, vitesse nulle. */
export const TOLERANCE_RAYON_M = 1.2;
/** Latence couverte (s) par la marge proportionnelle à la vitesse de la cible. */
export const LATENCE_TOLEREE_S = 0.2;
/** Marge (m) sur la portée à la validation. */
export const MARGE_PORTEE_M = 2;
/** Hauteur du centre de la silhouette (m au-dessus des pieds). */
const CENTRE_Y = SILHOUETTE.hauteur / 2;

/** Plus petite distance t ≥ 0 d'entrée du rayon dans la sphère (c, r), 0 si l'origine est dedans, Infinity sinon. */
function rayonSphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number {
  const mx = o[0] - cx, my = o[1] - cy, mz = o[2] - cz;
  const b = mx * d[0] + my * d[1] + mz * d[2];
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  return -b - Math.sqrt(disc);
}

/** Capsule verticale : segment (x, y0..y1, z) épaissi de r. */
function rayonCapsule(o: Vec3, d: Vec3, x: number, y0: number, y1: number, z: number, r: number): number {
  let meilleur = Math.min(rayonSphere(o, d, x, y0, z, r), rayonSphere(o, d, x, y1, z, r));
  // partie cylindrique : intersection avec le cylindre infini d'axe vertical, puis tranche y0..y1
  const mx = o[0] - x, mz = o[2] - z;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a > 1e-12) {
    const b = mx * d[0] + mz * d[2];
    const c = mx * mx + mz * mz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0 && t < meilleur) {
        const y = o[1] + d[1] * t;
        if (y >= y0 && y <= y1) meilleur = t;
      }
    }
  }
  return meilleur;
}

/**
 * Premier objet touché par le rayon (o, d normalisé) jusqu'à `portee` : joueur vivant (la tête
 * prime sur le corps dès que la sphère de la tête est touchée, puisqu'elle émerge de la capsule) ou
 * bâtiment (cible null, zone null), sinon impact en l'air à `portee`. Le tireur est exclu.
 */
export function tracer(monde: Monde, o: Vec3, d: Vec3, portee: number, cibles: Cible[], tireur: string): Impact {
  const mur = lancerRayon(monde, o, d, portee);
  const limite = Math.min(portee, mur);
  let tMeilleur = Infinity;
  let touche: Cible | null = null;
  let zone: Zone | null = null;
  const { tete, corps } = SILHOUETTE;
  for (const c of cibles) {
    if (c.id === tireur || !c.vivant) continue;
    const [px, py, pz] = c.p;
    // rejet rapide : le rayon passe-t-il à portée de la boule englobante ?
    const wx = px - o[0], wy = py + CENTRE_Y - o[1], wz = pz - o[2];
    const proj = wx * d[0] + wy * d[1] + wz * d[2];
    const rb = SILHOUETTE.hauteur / 2 + SILHOUETTE.rayon;
    if (proj < -rb || proj > limite + rb) continue;
    if (wx * wx + wy * wy + wz * wz - proj * proj > rb * rb) continue;
    const tTete = rayonSphere(o, d, px, py + tete.y, pz, tete.rayon);
    const tCorps = rayonCapsule(o, d, px, py + corps.y0, py + corps.y1, pz, corps.rayon);
    let t: number, z: Zone;
    if (tTete < Infinity) { t = tTete; z = "tete"; }
    else if (tCorps < Infinity) { t = tCorps; z = "corps"; }
    else continue;
    if (t <= limite && t < tMeilleur) { tMeilleur = t; touche = c; zone = z; }
  }
  if (touche) {
    return { cible: touche.id, zone, distance: tMeilleur, point: [o[0] + d[0] * tMeilleur, o[1] + d[1] * tMeilleur, o[2] + d[2] * tMeilleur] };
  }
  const distance = mur <= portee ? mur : portee;
  return { cible: null, zone: null, distance, point: [o[0] + d[0] * distance, o[1] + d[1] * distance, o[2] + d[2] * distance] };
}

/**
 * Validation serveur d'une touche déclarée (tolérance de latence) : cible vivante, distance ≤
 * portée + 2, centre de la cible à ≤ 1,2 m du rayon (+ marge proportionnelle à la vitesse de la
 * cible), ligne de vue non bloquée (le rayon jusqu'au point le plus proche de la cible est libre ET
 * la tête, le centre ou les pieds de la cible sont visibles de l'œil du tireur).
 */
export function toucheVraisemblable(monde: Monde, o: Vec3, d: Vec3, portee: number, cible: Cible, vitesseCible: number): boolean {
  if (!cible.vivant) return false;
  const [px, py, pz] = cible.p;
  const wx = px - o[0], wy = py + CENTRE_Y - o[1], wz = pz - o[2];
  const dist = Math.hypot(wx, wy, wz);
  if (dist > portee + MARGE_PORTEE_M) return false;
  const tolerance = TOLERANCE_RAYON_M + Math.max(0, vitesseCible) * LATENCE_TOLEREE_S;
  const proj = wx * d[0] + wy * d[1] + wz * d[2];
  if (proj < 0) return dist <= tolerance;
  const ex = wx - d[0] * proj, ey = wy - d[1] * proj, ez = wz - d[2] * proj;
  if (Math.hypot(ex, ey, ez) > tolerance) return false;
  // le rayon doit être libre jusqu'à la cible
  if (lancerRayon(monde, o, d, Math.min(proj, portee + MARGE_PORTEE_M)) !== Infinity) return false;
  return (
    visible(monde, o, [px, py + CENTRE_Y, pz]) ||
    visible(monde, o, [px, py + SILHOUETTE.tete.y, pz]) ||
    visible(monde, o, [px, py + SILHOUETTE.corps.y0 + 0.1, pz])
  );
}
