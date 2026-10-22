/**
 * Maths de la vue à la première personne (PUR : ni three ni DOM), utilisées par jeu.ts et le HUD.
 * Repère de protocole.ts : x est, z sud, y haut ; `lacet` 0 = regard vers −z, positif = tourne vers
 * la gauche (convention three) ; `tangage` positif = regard vers le haut.
 */
import type { Vec3 } from "./protocole";

/** Direction unitaire du regard. */
export function directionRegard(lacet: number, tangage: number): Vec3 {
  const c = Math.cos(tangage);
  return [-Math.sin(lacet) * c, Math.sin(tangage), -Math.cos(lacet) * c];
}

/** Lacet et tangage qui regardent dans la direction (dx, dy, dz), pas nécessairement normalisée. */
export function anglesVers(dx: number, dy: number, dz: number): { lacet: number; tangage: number } {
  const h = Math.hypot(dx, dz);
  return { lacet: Math.atan2(-dx, -dz), tangage: Math.atan2(dy, h) };
}

/** Champ de vision vertical (°) qui donne `fovHorizontalDeg` pour ce rapport largeur/hauteur. */
export function fovVerticalDeg(fovHorizontalDeg: number, aspect: number): number {
  const a = Math.max(0.2, aspect);
  const v = 2 * Math.atan(Math.tan((fovHorizontalDeg * Math.PI) / 360) / a) * (180 / Math.PI);
  return Math.min(110, Math.max(4, v));
}

/**
 * Angle (rad) de la direction horizontale (dx, dz) par rapport au regard : 0 = devant,
 * +π/2 = à droite, −π/2 = à gauche, ±π = derrière.
 */
export function angleRelatif(lacet: number, dx: number, dz: number): number {
  const avantX = -Math.sin(lacet), avantZ = -Math.cos(lacet);
  const droiteX = Math.cos(lacet), droiteZ = -Math.sin(lacet);
  return Math.atan2(dx * droiteX + dz * droiteZ, dx * avantX + dz * avantZ);
}

/** Panoramique −1 (gauche) … 1 (droite) d'un son venant de (dx, dz) par rapport à la vue. */
export function panSon(lacet: number, dx: number, dz: number): number {
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.sin(angleRelatif(lacet, dx, dz));
}

/** Écart (px) entre le centre et les traits du viseur pour une dispersion donnée (demi-angle, rad). */
export function ecartViseurPx(dispersion: number, fovVerticalDegres: number, hauteurPx: number): number {
  const demi = Math.tan((fovVerticalDegres * Math.PI) / 360);
  if (demi <= 0) return 0;
  return (Math.tan(Math.max(0, dispersion)) / demi) * (hauteurPx / 2);
}

/** Part de l'écart rattrapée en `dt` s par un lissage exponentiel de raideur `k` (1/s). */
export function lissage(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/** « m:ss » d'une durée en ms (arrondie à la seconde supérieure, jamais négative). */
export function chrono(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
