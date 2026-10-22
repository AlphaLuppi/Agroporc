/**
 * Armes de l'arène FPS (PUR : ni three ni DOM, aucun `Math.random` : un `alea` est injecté).
 *
 * Caractéristiques, dégâts (tête, chute avec la distance), dispersion (angle de demi-cône, en radians)
 * et tirage des directions des plombs. Partagé client (viseur, tir) et serveur (validation).
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */
import type { ArmeId, Vec3, Zone } from "./protocole";

export interface Arme {
  id: ArmeId;
  nom: string;
  /** dégâts d'un plomb au corps, à courte distance */
  degats: number;
  multTete: number;
  plombs: number;
  /** délai minimal entre deux tirs (s) */
  cadenceS: number;
  /** maintenir la détente enchaîne les tirs */
  auto: boolean;
  chargeur: number;
  rechargeS: number;
  /**
   * Demi-angle du cône de dispersion (rad) : `base` immobile au sol, `mouvement` ajouté à pleine
   * vitesse de marche, `air` ajouté en l'air, `parTir` ajouté à la chaleur à chaque tir (la chaleur
   * retombe de `max` à 0 en `retourS`), `max` plafond, `viseur` valeur de base en visée.
   */
  dispersion: { base: number; mouvement: number; air: number; parTir: number; max: number; retourS: number; viseur?: number };
  /** rad par tir */
  recul: { tangage: number; lacet: number };
  portee: number;
  /** multiplicateur linéaire de `debut` à `fin` (m), plancher `min` au-delà */
  chute: { debut: number; fin: number; min: number };
  /** multiplicateur de déplacement */
  vitesse: number;
  /** champ de vision (°) en visée ; null = pas de lunette */
  zoom: number | null;
}

/** Vitesse horizontale (m/s) à partir de laquelle la dispersion de mouvement est maximale. */
export const VITESSE_REFERENCE_M_S = 6.5;

export const STATS: Record<ArmeId, Arme> = {
  pistolet: {
    id: "pistolet", nom: "Pistolet", degats: 28, multTete: 2, plombs: 1,
    cadenceS: 0.2, auto: false, chargeur: 12, rechargeS: 1.3,
    dispersion: { base: 0.004, mouvement: 0.018, air: 0.035, parTir: 0.012, max: 0.06, retourS: 0.3, viseur: 0.0015 },
    recul: { tangage: 0.022, lacet: 0.006 },
    portee: 120, chute: { debut: 25, fin: 70, min: 0.7 },
    vitesse: 1, zoom: null,
  },
  mitraillette: {
    id: "mitraillette", nom: "Mitraillette", degats: 16, multTete: 1.6, plombs: 1,
    cadenceS: 0.075, auto: true, chargeur: 32, rechargeS: 2.0,
    dispersion: { base: 0.012, mouvement: 0.025, air: 0.05, parTir: 0.006, max: 0.09, retourS: 0.45, viseur: 0.008 },
    recul: { tangage: 0.012, lacet: 0.008 },
    portee: 90, chute: { debut: 15, fin: 50, min: 0.55 },
    vitesse: 1, zoom: null,
  },
  pompe: {
    // 20 par plomb : 5 plombs sur 9 (la majorité) au corps à bout portant font 100 = un mort.
    id: "pompe", nom: "Fusil à pompe", degats: 20, multTete: 1.5, plombs: 9,
    cadenceS: 0.85, auto: false, chargeur: 6, rechargeS: 2.4,
    dispersion: { base: 0.085, mouvement: 0.012, air: 0.02, parTir: 0, max: 0.11, retourS: 0.5, viseur: 0.07 },
    recul: { tangage: 0.09, lacet: 0.01 },
    portee: 45, chute: { debut: 8, fin: 30, min: 0.25 },
    vitesse: 1, zoom: null,
  },
  sniper: {
    id: "sniper", nom: "Sniper", degats: 95, multTete: 2.5, plombs: 1,
    cadenceS: 1.35, auto: false, chargeur: 5, rechargeS: 2.9,
    // très imprécis sans lunette, parfait immobile avec (viseur 0)
    dispersion: { base: 0.09, mouvement: 0.05, air: 0.09, parTir: 0.02, max: 0.12, retourS: 0.8, viseur: 0 },
    recul: { tangage: 0.04, lacet: 0.004 },
    portee: 400, chute: { debut: 400, fin: 400, min: 1 },
    vitesse: 0.9, zoom: 18,
  },
};

/** Multiplicateur de dégâts selon la distance : 1 jusqu'à `debut`, `min` à partir de `fin`, linéaire entre les deux. */
export function multiplicateurChute(arme: ArmeId, distance: number): number {
  const { debut, fin, min } = STATS[arme].chute;
  if (distance <= debut) return 1;
  if (distance >= fin) return min;
  return 1 - (1 - min) * ((distance - debut) / (fin - debut));
}

/** Dégâts d'un plomb (entier) selon la zone touchée et la distance parcourue. */
export function degatsPlomb(arme: ArmeId, zone: Zone, distance: number): number {
  const a = STATS[arme];
  const d = Math.max(0, distance);
  return Math.round(a.degats * (zone === "tete" ? a.multTete : 1) * multiplicateurChute(arme, d));
}

/**
 * Demi-angle (rad) du cône de dispersion. `chaleur` = dispersion accumulée par les tirs récents
 * (rad, voir `apresTir` / `refroidir`). En visée avec `viseur`, la base descend à `viseur`
 * (la lunette du sniper est parfaite à l'arrêt) ; le mouvement et l'air s'ajoutent toujours.
 */
export function dispersionCourante(arme: ArmeId, ctx: { vitesseH: number; auSol: boolean; vise: boolean; chaleur: number }): number {
  const dp = STATS[arme].dispersion;
  const base = ctx.vise && dp.viseur !== undefined ? dp.viseur : dp.base;
  const facteur = Math.min(1, Math.max(0, ctx.vitesseH) / VITESSE_REFERENCE_M_S);
  const total = base + dp.mouvement * facteur + (ctx.auSol ? 0 : dp.air) + Math.max(0, ctx.chaleur);
  return Math.min(dp.max, total);
}

/** Chaleur après un tir. */
export function apresTir(arme: ArmeId, chaleur: number): number {
  const dp = STATS[arme].dispersion;
  return Math.min(dp.max, chaleur + dp.parTir);
}

/**
 * Délai (s) après un tir avant que la chaleur commence à retomber. Sans lui, le refroidissement
 * (`max` / `retourS` par seconde) dépasse ce que les tirs ajoutent à la cadence de chaque arme
 * (mitraillette : 0,08 rad/s ajoutés pour 0,2 rad/s retirés) : la chaleur ne montait jamais et la
 * rafale restait aussi précise que le premier coup. Un peu plus que l'intervalle entre deux tirs :
 * pendant une rafale (ou en cliquant à la cadence max.), elle s'accumule ; en espaçant les tirs, elle retombe.
 */
export function delaiRefroidissement(arme: ArmeId): number {
  return STATS[arme].cadenceS * 1.25 + 0.04;
}

/** Retour du recul de tangage : part rattrapée par seconde (exponentiel), vitesse minimale (rad/s), délai maximal après un tir (s). */
export const RETOUR_RECUL = { parSeconde: 5, minimum: 0.03, delaiMaxS: 0.2 } as const;

/** Délai (s) après un tir avant que la vue ne redescende du recul : celui de la chaleur, plafonné (le pompe tire toutes les 0,85 s). */
export function delaiRecul(arme: ArmeId): number {
  return Math.min(delaiRefroidissement(arme), RETOUR_RECUL.delaiMaxS);
}

/**
 * Part (rad) du recul de tangage `reculAcc` (soulevé par les tirs, pas encore compensé) que la vue
 * redescend en `dt` secondes, une fois le délai écoulé. Jamais plus que `reculAcc`.
 */
export function retourRecul(reculAcc: number, dt: number): number {
  if (!(reculAcc > 0) || !(dt > 0)) return 0;
  return Math.min(reculAcc, reculAcc * (1 - Math.exp(-RETOUR_RECUL.parSeconde * dt)) + RETOUR_RECUL.minimum * dt);
}

/** Chaleur après `dt` secondes sans tirer (de `max` à 0 en `retourS`). */
export function refroidir(arme: ArmeId, chaleur: number, dt: number): number {
  const dp = STATS[arme].dispersion;
  return Math.max(0, chaleur - (dt * dp.max) / dp.retourS);
}

/**
 * `plombs` directions normalisées tirées uniformément dans le cône de demi-angle `dispersion`
 * autour de `d`. Sans dispersion, chaque direction est `d` normalisé.
 */
export function directionsTir(arme: ArmeId, d: Vec3, dispersion: number, alea: () => number): Vec3[] {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const fx = d[0] / n, fy = d[1] / n, fz = d[2] / n;
  // base orthonormée (u, w) perpendiculaire à f
  let ux: number, uy: number, uz: number;
  if (Math.abs(fy) > 0.999) { ux = 1; uy = 0; uz = 0; }
  else {
    // u = normalise(f × haut) avec haut = (0, 1, 0)
    const l = Math.hypot(fz, fx);
    ux = fz / l; uy = 0; uz = -fx / l;
  }
  const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
  const sorties: Vec3[] = [];
  for (let i = 0; i < STATS[arme].plombs; i++) {
    if (dispersion <= 0) { sorties.push([fx, fy, fz]); continue; }
    const theta = dispersion * Math.sqrt(alea());
    const phi = 2 * Math.PI * alea();
    const s = Math.sin(theta), c = Math.cos(theta);
    const a = s * Math.cos(phi), b = s * Math.sin(phi);
    const x = fx * c + ux * a + wx * b, y = fy * c + uy * a + wy * b, z = fz * c + uz * a + wz * b;
    const l = Math.hypot(x, y, z);
    sorties.push([x / l, y / l, z / l]);
  }
  return sorties;
}
