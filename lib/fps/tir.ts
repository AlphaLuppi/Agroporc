/**
 * Hitscan de l'arène FPS (PUR) : premier objet touché par un rayon (joueur ou bâtiment) et
 * validation serveur d'une touche déclarée par le client. Hitbox = silhouette de protocole.ts (`silhouetteDe(cible.accroupi)`) :
 * tête = sphère, corps = capsule verticale (pieds en p), agrandies par `ECHELLE_AVATAR`, plus basses quand la cible est accroupie.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md, 2026-10-22-arene-v2-design.md (§2.1, §6, §13.2)
 */
import { lancerRayon, visible, type Monde } from "./collision";
import { silhouetteDe, type Vec3, type Zone } from "./protocole";

/** Cible d'un tir : position des pieds, vivante ou non, accroupie (silhouette basse, `SILHOUETTE_ACCROUPIE`) ou debout (défaut). */
export interface Cible { id: string; p: Vec3; vivant: boolean; accroupi?: boolean }
export interface Impact { cible: string | null; zone: Zone | null; distance: number; point: Vec3 }

/** Tolérance de `toucheVraisemblable` : écart maximal (m) entre l'AXE de la silhouette de la cible et le rayon, vitesse nulle. */
export const TOLERANCE_RAYON_M = 1.2;
/** Latence couverte (s) par la marge proportionnelle à la vitesse de la cible. */
export const LATENCE_TOLEREE_S = 0.2;
/** Marge (m) sur la portée à la validation. */
export const MARGE_PORTEE_M = 2;
/** Nombre de points de l'axe de la silhouette (de `corps.y0` à `tete.y`) dont `toucheVraisemblable` mesure l'écart au rayon. */
const POINTS_AXE = 5;

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
  for (const c of cibles) {
    if (c.id === tireur || !c.vivant) continue;
    const { tete, corps, centreY, rayonEnglobant: rb } = silhouetteDe(c.accroupi);
    const [px, py, pz] = c.p;
    // rejet rapide : le rayon passe-t-il à portée de la boule englobante de CETTE silhouette ?
    const wx = px - o[0], wy = py + centreY - o[1], wz = pz - o[2];
    const proj = wx * d[0] + wy * d[1] + wz * d[2];
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
 * Points de visibilité de la cible vus de l'œil `o` : tête, centre, pieds (+ 0,1 m) de SA silhouette, ramenés vers l'œil de
 * `rayon` (rayon de la tête pour la tête, du corps pour les deux autres), c'est-à-dire sur la surface de la hitbox côté tireur et
 * non sur son axe : une cible collée à un angle de mur est touchable par un rayon qui rase l'angle alors que son axe, lui, est
 * derrière (§13.2.3). Partagé avec `melee.ts`.
 */
export function pointsVisibilite(o: Vec3, cible: Cible): Vec3[] {
  const { tete, corps, centreY } = silhouetteDe(cible.accroupi);
  const [px, py, pz] = cible.p;
  const hx = o[0] - px, hz = o[2] - pz;
  const l = Math.hypot(hx, hz);
  const vers = (y: number, r: number): Vec3 => {
    // œil à l'aplomb de la cible : aucun côté à privilégier, l'axe lui-même
    if (l < 1e-6) return [px, py + y, pz];
    const k = Math.min(r, l) / l;
    return [px + hx * k, py + y, pz + hz * k];
  };
  return [vers(tete.y, tete.rayon), vers(centreY, corps.rayon), vers(corps.y0 + 0.1, corps.rayon)];
}

/**
 * Validation serveur d'une touche déclarée (tolérance de latence) : cible vivante, distance ≤
 * portée + 2, AXE de la silhouette de la cible (5 points de `corps.y0` à `tete.y`, debout ou accroupie) à ≤ 1,2 m du rayon (+ marge
 * proportionnelle à la vitesse de la cible), ligne de vue non bloquée (le rayon est libre jusqu'au POINT D'ENTRÉE dans la capsule,
 * `proj − corps.rayon`, et non jusqu'au centre, ET la tête, le centre ou les pieds de la cible sont visibles de l'œil du tireur).
 *
 * L'écart se mesure à l'axe et non au centre : le centre est à 1,05 m, une touche au sommet de la tête (2,3 m) était
 * acceptée par `tracer` mais refusée ici. Élargir la tolérance à 1,5 m aurait cassé `match.reseau.test.ts` (une cible à
 * 1,3 m du rayon doit être refusée) ; mesurer à l'axe laisse la tolérance horizontale à 1,2 m.
 *
 * Ligne de vue limitée à l'entrée dans la capsule (§13.2.3) : une cible collée à un mur a son axe dans l'ombre du mur pour un rayon
 * rasant ; le rayon qui la touche pourtant (`tracer`) était rejeté parce qu'il devait atteindre l'axe.
 */
export function toucheVraisemblable(monde: Monde, o: Vec3, d: Vec3, portee: number, cible: Cible, vitesseCible: number): boolean {
  if (!cible.vivant) return false;
  const [px, py, pz] = cible.p;
  const { tete, corps, centreY } = silhouetteDe(cible.accroupi);
  const wx = px - o[0], wy = py + centreY - o[1], wz = pz - o[2];
  const dist = Math.hypot(wx, wy, wz);
  if (dist > portee + MARGE_PORTEE_M) return false;
  const tolerance = TOLERANCE_RAYON_M + Math.max(0, vitesseCible) * LATENCE_TOLEREE_S;
  // écart minimal entre le rayon et l'axe de la silhouette
  let ecart = Infinity;
  for (let k = 0; k < POINTS_AXE; k++) {
    const y = corps.y0 + ((tete.y - corps.y0) * k) / (POINTS_AXE - 1);
    const ax = px - o[0], ay = py + y - o[1], az = pz - o[2];
    const t = ax * d[0] + ay * d[1] + az * d[2];
    const e = t < 0
      ? Math.hypot(ax, ay, az)
      : Math.hypot(ax - d[0] * t, ay - d[1] * t, az - d[2] * t);
    if (e < ecart) ecart = e;
  }
  const proj = wx * d[0] + wy * d[1] + wz * d[2];
  if (proj < 0) return ecart <= tolerance;
  if (ecart > tolerance) return false;
  // le rayon doit être libre jusqu'à l'entrée dans la capsule (un mur collé à la cible ne compte pas)
  if (lancerRayon(monde, o, d, Math.min(proj - corps.rayon, portee + MARGE_PORTEE_M)) !== Infinity) return false;
  return pointsVisibilite(o, cible).some((pt) => visible(monde, o, pt));
}
