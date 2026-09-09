/**
 * Jauge de note de la vue 3D : couleur et remplissage d'une note sur 10.
 * Rouge (0) → ambre (5) → vert (10), interpolés linéairement en RGB ; les paliers
 * reprennent les seuils de `noteClass` (lib/format.ts) : < 5 mauvais, 5–7 correct, ≥ 7 bon.
 */
type Rgb = [number, number, number];

export const COULEUR_SANS_NOTE = "#6f8a96";
const ROUGE: Rgb = [255, 90, 74]; // #ff5a4a
const AMBRE: Rgb = [255, 179, 92]; // #ffb35c
const VERT: Rgb = [92, 224, 160]; // #5ce0a0

const borne = (n: number) => Math.min(10, Math.max(0, n));
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Fraction remplie de la jauge (0 sans note). */
export function remplissage(note?: number): number {
  return note == null || Number.isNaN(note) ? 0 : borne(note) / 10;
}

/** Couleur hex de la jauge pour une note ; neutre sans note. */
export function couleurNote(note?: number): string {
  if (note == null || Number.isNaN(note)) return COULEUR_SANS_NOTE;
  const n = borne(note);
  return n <= 5 ? hex(mix(ROUGE, AMBRE, n / 5)) : hex(mix(AMBRE, VERT, (n - 5) / 5));
}
