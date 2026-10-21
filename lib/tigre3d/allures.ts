/**
 * Allures du tigre (pur) : marche, trot, galop, et tout l'entre-deux. Une allure n'est pas un
 * état : c'est un réglage continu (`a` ∈ [0, 2] : 0 = marche, 1 = trot, 2 = galop) qui suit la
 * vitesse par un ressort. Phases des pattes, facteur d'appui, hauteur de pas, cadence : tout est
 * interpolé, donc un changement d'allure se fait foulée après foulée, sans saut de pose.
 *
 * Unités : mètres et secondes du MODÈLE (le tigre fait 1,104 m du museau au bout de la queue,
 * garrot 0,55 m, patte ≈ 0,2 m). Un petit (échelle 0,4) a les mêmes allures dans SES unités.
 */
import { borne, lerp } from "./ressorts";
import type { Patte } from "./os";

export interface ReglageAllure {
  /** Décalage de phase de chaque patte (fraction de foulée), relatif à l'arrière gauche. */
  decalages: Record<Patte, number>;
  /** Part de la foulée où la patte est au sol. */
  appui: number;
  /** Hauteur de levée du pied (m), avant / arrière. */
  levee: { av: number; ar: number };
  /** Rebond vertical du corps (m) : > 0 = monte à mi-appui (marche, pendule), < 0 = s'écrase (course). */
  rebond: number;
  /** Flexion / extension du dos par foulée (rad). */
  flexion: number;
  /** Abaissement du corps (m) : on court plus ramassé qu'on ne marche. */
  ramasse: number;
}

/**
 * Marche : séquence latérale (arG, avG, arD, avD). Trot : diagonales (arG + avD, arD + avG).
 * Galop transverse : arG, arD, puis avG, avD. Les décalages ne sont pas pris modulo 1 : l'avant
 * droit passe de 0,75 (marche) à 1 (trot) puis 0,65 (galop) par le chemin le plus court.
 */
export const ALLURES: readonly ReglageAllure[] = [
  {
    decalages: { arG: 0, avG: 0.25, arD: 0.5, avD: 0.75 }, appui: 0.66,
    levee: { av: 0.04, ar: 0.032 }, rebond: 0.005, flexion: 0.015, ramasse: 0,
  },
  {
    decalages: { arG: 0, avG: 0.5, arD: 0.5, avD: 1.0 }, appui: 0.44,
    levee: { av: 0.055, ar: 0.045 }, rebond: -0.009, flexion: 0.03, ramasse: 0.008,
  },
  {
    decalages: { arG: 0, arD: 0.14, avG: 0.5, avD: 0.64 }, appui: 0.32,
    levee: { av: 0.075, ar: 0.05 }, rebond: -0.016, flexion: 0.11, ramasse: 0.015,
  },
];

/** Allure visée pour une vitesse (m/s modèle) : 0 marche, 1 trot, 2 galop, transitions linéaires. */
export function allurePourVitesse(v: number): number {
  const a = Math.abs(v);
  if (a < 0.45) return 0;
  if (a < 0.8) return (a - 0.45) / 0.35;
  if (a < 1.5) return 1;
  if (a < 2.1) return 1 + (a - 1.5) / 0.6;
  return 2;
}

/** Réglage interpolé pour une allure continue `a`. */
export function reglage(a: number, sortie?: ReglageAllure): ReglageAllure {
  const x = borne(a, 0, 2);
  const i = Math.min(1, Math.floor(x));
  const k = x - i;
  const A = ALLURES[i], B = ALLURES[i + 1];
  const r = sortie ?? {
    decalages: { arG: 0, avG: 0, arD: 0, avD: 0 }, appui: 0, levee: { av: 0, ar: 0 }, rebond: 0, flexion: 0, ramasse: 0,
  };
  for (const p of ["arG", "avG", "arD", "avD"] as Patte[]) r.decalages[p] = lerp(A.decalages[p], B.decalages[p], k);
  r.appui = lerp(A.appui, B.appui, k);
  r.levee.av = lerp(A.levee.av, B.levee.av, k);
  r.levee.ar = lerp(A.levee.ar, B.levee.ar, k);
  r.rebond = lerp(A.rebond, B.rebond, k);
  r.flexion = lerp(A.flexion, B.flexion, k);
  r.ramasse = lerp(A.ramasse, B.ramasse, k);
  return r;
}

/**
 * Cadence (foulées par seconde) pour une vitesse : elle monte vite puis plafonne, la foulée
 * s'allonge ensuite. Sur place (piétinement pour tourner), `CADENCE_SUR_PLACE`.
 */
export const CADENCE_MIN = 1.25;
export const CADENCE_MAX = 4.3;
export const CADENCE_SUR_PLACE = 1.9;
export function cadence(v: number): number {
  return CADENCE_MIN + (CADENCE_MAX - CADENCE_MIN) * (1 - Math.exp(-Math.abs(v) / 1.45));
}

/**
 * Facteur d'appui à grande vitesse : au-delà du galop de croisière la patte reste moins
 * longtemps au sol, sinon son balayage (v · appui / cadence) dépasserait sa portée.
 */
export function appuiAVitesse(appui: number, v: number): number {
  return appui * (1 - 0.4 * borne((Math.abs(v) - 2.4) / 5, 0, 1));
}

/** Longueur balayée par un pied pendant son appui (m) : ce que l'IK doit pouvoir couvrir. */
export function balayage(v: number, a = allurePourVitesse(v)): number {
  return (Math.abs(v) * appuiAVitesse(reglage(a).appui, v)) / cadence(v);
}
