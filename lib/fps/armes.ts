/**
 * Armes de l'arène FPS (PUR : ni three ni DOM, aucun `Math.random` ni `alea`).
 *
 * Registre extensible : UN SEUL endroit décrit une arme, `STATS[id]` (stats, catégorie, nom, description).
 * Ajouter une arme = son id dans la bonne liste de `protocole.ts`, une entrée `STATS`, puis les `Record<ArmeFeuId, …>`
 * de `rendu.ts`, `sons.ts` et `traceurs.ts` (qui cassent la compilation si on oublie : voulu).
 *
 * AUCUNE DISPERSION (v2 §13.1) : « ce qui est sous le réticule est touché ». Toutes les armes tirent exactement dans
 * l'axe de la vue, quels que soient le mouvement, le saut, le wall-run, l'accroupi ou la visée. Le fusil à pompe (et
 * toute arme à plusieurs plombs) tire une gerbe FIXE et déterministe : un plomb au centre et les autres sur un cercle
 * de demi-angle constant (`gerbe`). Le recul de la vue reste (il ne déplace que les tirs suivants).
 * SEULE EXCEPTION (v3 §1) : une arme à lunette (`hanche`, le sniper) tirée SANS lunette part dans un cône aléatoire
 * (`dispersionTir` + `devier`, hasard fourni par l'appelant) ; en lunette elle tire pile sous le réticule. Niveaux de zoom de
 * la lunette : `zooms`.
 * Partagé client (tir) et serveur (validation).
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§4 et §13.1), 2026-10-23-arene-v3-design.md (§1)
 */
import { estMelee, type ArmeFeuId, type ArmeId, type ArmeMeleeId, type Vec3, type Zone } from "./protocole";

export type CategorieArme = "principale" | "secondaire" | "speciale";

export interface Arme {
  id: ArmeFeuId;
  nom: string;
  /** libellé court pour le HUD (≤ 10 caractères) */
  nomCourt: string;
  categorie: CategorieArme;
  /** une phrase pour le lobby */
  description: string;
  /** dégâts d'un plomb au corps, à courte distance */
  degats: number;
  multTete: number;
  plombs: number;
  /**
   * Demi-angle (rad) de la gerbe FIXE des armes à plusieurs plombs : un plomb au centre, les `plombs − 1` autres répartis
   * régulièrement sur un cercle de ce demi-angle. 0 pour une arme à un seul plomb.
   */
  gerbe: number;
  /** délai minimal entre deux tirs (s) */
  cadenceS: number;
  /** maintenir la détente enchaîne les tirs */
  auto: boolean;
  /** chargeur ; pour une arme `sansRecharge` : munitions TOTALES offertes */
  chargeur: number;
  rechargeS: number;
  /** pas de rechargement : l'arme disparaît à 0 munition (armes spéciales) */
  sansRecharge: boolean;
  /**
   * INERTE depuis la v2 §13.1 (aucune dispersion) : valeurs historiques de départ, conservées pour mémoire et pour la
   * chaleur (`apresTir` / `refroidir`), qui n'influe plus sur la direction du tir.
   */
  dispersion: { base: number; mouvement: number; air: number; parTir: number; max: number; retourS: number; viseur?: number };
  /** rad par tir */
  recul: { tangage: number; lacet: number };
  portee: number;
  /** multiplicateur linéaire de `debut` à `fin` (m), plancher `min` au-delà */
  chute: { debut: number; fin: number; min: number };
  /** multiplicateur de déplacement */
  vitesse: number;
  /** champ de vision horizontal (°) en visée au niveau de zoom par défaut ; null = pas de lunette */
  zoom: number | null;
  /** niveaux de zoom de la lunette (champ horizontal en °, du plus large au plus serré) ; `zoom` en fait partie. Absent = un seul niveau */
  zooms?: readonly number[];
  /**
   * Dispersion du tir SANS lunette (rad, demi-angle du cône) d'une arme à lunette (v3 §1) : `base` à l'arrêt, + `mouvement` à
   * `VITESSE_REFERENCE_M_S`, + `air` en l'air. Absent = aucune dispersion (toutes les autres armes, §13.1).
   */
  hanche?: { base: number; mouvement: number; air: number };
}

/** Sans objet depuis la v2 §13.1 (plus de dispersion) ; conservée pour les lots qui l'importent encore. */
export const MULT_DISPERSION_ACCROUPI = 0.65;
/** Vitesse horizontale (m/s) de référence de l'ancienne dispersion de mouvement (= MOUV.marche). Sans effet depuis §13.1. */
export const VITESSE_REFERENCE_M_S = 9;

/** Arme blanche (slot `couteau`, v5 : couteau ou épée). Distances mesurées de la SURFACE de la capsule de la cible. */
export interface ArmeMelee {
  id: ArmeMeleeId;
  nom: string;
  /** libellé court pour le HUD (≤ 10 caractères) */
  nomCourt: string;
  description: string;
  /** dégâts à un joueur */
  degats: number;
  /** dégâts à un tigre zombie (mode zombies) */
  degatsZombie: number;
  /** portée annoncée (m, de la surface de la cible) et marge supplémentaire acceptée par le serveur */
  portee: number;
  margePortee: number;
  cadenceS: number;
  /** multiplicateur de marche ET de sprint */
  vitesse: number;
  /** cosinus du demi-angle du cône de frappe */
  cosCone: number;
  /** cibles touchées au plus par coup */
  nbCiblesMax: number;
  /** durée de l'animation de coup (s) */
  dureeCoupS: number;
}

export const MELEE: Record<ArmeMeleeId, ArmeMelee> = {
  couteau: {
    id: "couteau", nom: "Couteau", nomCourt: "Couteau",
    description: "Course bien plus rapide ; un coup au corps à corps tue un joueur sans bouclier.",
    degats: 100, degatsZombie: 100,
    portee: 2.2, margePortee: 0.6, cadenceS: 0.5, vitesse: 1.3,
    /** 55° */
    cosCone: 0.574, nbCiblesMax: 1, dureeCoupS: 0.4,
  },
  epee: {
    id: "epee", nom: "Épée", nomCourt: "Épée",
    description: "Longue portée, arc de 140° : un coup tranche jusqu'à trois cibles. Plus lente que le couteau.",
    degats: 140, degatsZombie: 220,
    portee: 2.6, margePortee: 0.7, cadenceS: 0.85, vitesse: 1.2,
    /** 70° */
    cosCone: 0.342, nbCiblesMax: 3, dureeCoupS: 0.55,
  },
};

/** Le couteau (arme blanche par défaut). */
export const COUTEAU = MELEE.couteau;

export const STATS: Record<ArmeFeuId, Arme> = {
  pistolet: {
    id: "pistolet", nom: "Pistolet", nomCourt: "Pistolet", categorie: "secondaire",
    description: "Précis et polyvalent. Une balle à la tête fait 56.",
    degats: 28, multTete: 2, plombs: 1, gerbe: 0,
    cadenceS: 0.2, auto: false, chargeur: 12, rechargeS: 1.3, sansRecharge: false,
    dispersion: { base: 0.004, mouvement: 0.018, air: 0.035, parTir: 0.012, max: 0.06, retourS: 0.3, viseur: 0.0015 },
    recul: { tangage: 0.022, lacet: 0.006 },
    portee: 120, chute: { debut: 25, fin: 70, min: 0.7 },
    vitesse: 1, zoom: null,
  },
  mitraillette: {
    id: "mitraillette", nom: "Mitraillette", nomCourt: "Mitraill.", categorie: "principale",
    description: "Cadence folle : redoutable de près, le recul demande de la maîtrise.",
    degats: 16, multTete: 1.6, plombs: 1, gerbe: 0,
    cadenceS: 0.075, auto: true, chargeur: 32, rechargeS: 2.0, sansRecharge: false,
    dispersion: { base: 0.012, mouvement: 0.025, air: 0.05, parTir: 0.006, max: 0.09, retourS: 0.45, viseur: 0.008 },
    recul: { tangage: 0.012, lacet: 0.008 },
    portee: 90, chute: { debut: 15, fin: 50, min: 0.55 },
    vitesse: 1, zoom: null,
  },
  pompe: {
    // 20 par plomb : 5 plombs sur 9 (la majorité) au corps à bout portant font 100 = un mort.
    // Gerbe fixe (§13.1) : 1 plomb au centre + 8 sur un cercle de 0,055 rad.
    id: "pompe", nom: "Fusil à pompe", nomCourt: "Pompe", categorie: "principale",
    description: "Dévastateur de près, presque inoffensif au-delà de 30 m. Gerbe fixe de 9 plombs.",
    degats: 20, multTete: 1.5, plombs: 9, gerbe: 0.055,
    cadenceS: 0.85, auto: false, chargeur: 6, rechargeS: 2.4, sansRecharge: false,
    dispersion: { base: 0.085, mouvement: 0.012, air: 0.02, parTir: 0, max: 0.11, retourS: 0.5, viseur: 0.07 },
    recul: { tangage: 0.09, lacet: 0.01 },
    portee: 45, chute: { debut: 8, fin: 30, min: 0.25 },
    vitesse: 1, zoom: null,
  },
  sniper: {
    id: "sniper", nom: "Sniper", nomCourt: "Sniper", categorie: "principale",
    description: "Un tir à la tête tue, au corps 95. Lunette au clic droit.",
    degats: 95, multTete: 2.5, plombs: 1, gerbe: 0,
    cadenceS: 1.35, auto: false, chargeur: 5, rechargeS: 2.9, sansRecharge: false,
    dispersion: { base: 0.09, mouvement: 0.05, air: 0.09, parTir: 0.02, max: 0.12, retourS: 0.8, viseur: 0 },
    recul: { tangage: 0.04, lacet: 0.004 },
    portee: 400, chute: { debut: 400, fin: 400, min: 1 },
    // ×3, ×6 (défaut, l'ancien 18°) et ×12 : 2·atan(tan 45° / k)
    vitesse: 0.9, zoom: 18.92, zooms: [36.87, 18.92, 9.53],
    hanche: { base: 0.045, mouvement: 0.035, air: 0.06 },
  },
  fusil_assaut: {
    id: "fusil_assaut", nom: "Fusil d'assaut", nomCourt: "Fusil", categorie: "principale",
    description: "Polyvalent : cadence soutenue, bonne précision à moyenne distance.",
    degats: 22, multTete: 1.8, plombs: 1, gerbe: 0,
    cadenceS: 0.10, auto: true, chargeur: 30, rechargeS: 2.2, sansRecharge: false,
    dispersion: { base: 0.006, mouvement: 0.022, air: 0.045, parTir: 0.005, max: 0.07, retourS: 0.5, viseur: 0.002 },
    recul: { tangage: 0.014, lacet: 0.007 },
    portee: 140, chute: { debut: 30, fin: 90, min: 0.6 },
    vitesse: 0.97, zoom: null,
  },
  mitrailleuse: {
    id: "mitrailleuse", nom: "Mitrailleuse", nomCourt: "M. lourde", categorie: "principale",
    description: "Un grand chargeur pour arroser longtemps ; lente à recharger et à porter.",
    degats: 19, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 0.085, auto: true, chargeur: 60, rechargeS: 4.2, sansRecharge: false,
    dispersion: { base: 0.014, mouvement: 0.03, air: 0.055, parTir: 0.004, max: 0.10, retourS: 0.6, viseur: 0.009 },
    recul: { tangage: 0.011, lacet: 0.010 },
    portee: 110, chute: { debut: 20, fin: 60, min: 0.5 },
    vitesse: 0.88, zoom: null,
  },
  revolver: {
    id: "revolver", nom: "Revolver", nomCourt: "Revolver", categorie: "secondaire",
    description: "Six balles, un coup lent et puissant : deux touches au corps font mal.",
    degats: 55, multTete: 2, plombs: 1, gerbe: 0,
    cadenceS: 0.50, auto: false, chargeur: 6, rechargeS: 2.2, sansRecharge: false,
    dispersion: { base: 0.003, mouvement: 0.02, air: 0.04, parTir: 0.02, max: 0.06, retourS: 0.45, viseur: 0.001 },
    recul: { tangage: 0.05, lacet: 0.008 },
    portee: 130, chute: { debut: 30, fin: 80, min: 0.7 },
    vitesse: 1, zoom: null,
  },
  mini_uzi: {
    id: "mini_uzi", nom: "Mini Uzi", nomCourt: "Mini uzi", categorie: "secondaire",
    description: "Cadence frénétique à courte portée, pour finir un duel au corps à corps.",
    degats: 11, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 0.06, auto: true, chargeur: 25, rechargeS: 1.6, sansRecharge: false,
    dispersion: { base: 0.02, mouvement: 0.03, air: 0.055, parTir: 0.008, max: 0.10, retourS: 0.4, viseur: 0.014 },
    recul: { tangage: 0.010, lacet: 0.012 },
    portee: 45, chute: { debut: 8, fin: 30, min: 0.4 },
    vitesse: 1.05, zoom: null,
  },
  railgun: {
    id: "railgun", nom: "Railgun", nomCourt: "Railgun", categorie: "speciale",
    description: "Offert par Elsa : 6 tirs seulement, aucune perte de dégâts, la tête tue toujours.",
    degats: 140, multTete: 1.5, plombs: 1, gerbe: 0,
    cadenceS: 1.20, auto: false, chargeur: 6, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.001, mouvement: 0.03, air: 0.05, parTir: 0.01, max: 0.06, retourS: 0.6, viseur: 0 },
    recul: { tangage: 0.06, lacet: 0.004 },
    portee: 500, chute: { debut: 500, fin: 500, min: 1 },
    vitesse: 0.9, zoom: null,
  },
  minigun: {
    id: "minigun", nom: "Minigun", nomCourt: "Minigun", categorie: "speciale",
    description: "Offert par Elsa : 150 balles à une cadence démente, mais on avance lentement.",
    degats: 13, multTete: 1.4, plombs: 1, gerbe: 0,
    cadenceS: 0.04, auto: true, chargeur: 150, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.025, mouvement: 0.03, air: 0.06, parTir: 0.006, max: 0.10, retourS: 0.5, viseur: 0.018 },
    recul: { tangage: 0.006, lacet: 0.012 },
    portee: 100, chute: { debut: 20, fin: 70, min: 0.5 },
    vitesse: 0.75, zoom: null,
  },
  magnum_dore: {
    id: "magnum_dore", nom: "Magnum doré", nomCourt: "Magnum", categorie: "speciale",
    description: "Offert par Elsa : 8 balles, la tête tue en un coup jusqu'à 40 m.",
    degats: 70, multTete: 3, plombs: 1, gerbe: 0,
    cadenceS: 0.70, auto: false, chargeur: 8, rechargeS: 0, sansRecharge: true,
    dispersion: { base: 0.002, mouvement: 0.02, air: 0.04, parTir: 0.02, max: 0.06, retourS: 0.5, viseur: 0.0008 },
    recul: { tangage: 0.07, lacet: 0.01 },
    portee: 160, chute: { debut: 40, fin: 100, min: 0.8 },
    vitesse: 1, zoom: null,
  },
};

/** Multiplicateur de déplacement de l'arme en main (couteau compris). */
export function vitesseArme(id: ArmeId): number { return estMelee(id) ? MELEE[id].vitesse : STATS[id].vitesse; }
export function nomArme(id: ArmeId): string { return estMelee(id) ? MELEE[id].nom : STATS[id].nom; }

/** Multiplicateur de dégâts selon la distance : 1 jusqu'à `debut`, `min` à partir de `fin`, linéaire entre les deux. */
export function multiplicateurChute(arme: ArmeFeuId, distance: number): number {
  const { debut, fin, min } = STATS[arme].chute;
  if (distance <= debut) return 1;
  if (distance >= fin) return min;
  return 1 - (1 - min) * ((distance - debut) / (fin - debut));
}

/** Dégâts d'un plomb (entier) selon la zone touchée et la distance parcourue. */
export function degatsPlomb(arme: ArmeFeuId, zone: Zone, distance: number): number {
  const a = STATS[arme];
  const d = Math.max(0, distance);
  return Math.round(a.degats * (zone === "tete" ? a.multTete : 1) * multiplicateurChute(arme, d));
}

/**
 * Demi-angle (rad) du cône de dispersion : TOUJOURS 0 (v2 §13.1, aucune dispersion). Le mouvement, le saut, le wall-run,
 * l'accroupi, la visée et la chaleur n'écartent plus le tir. Les paramètres sont conservés pour les appelants existants.
 */
export function dispersionCourante(
  _arme: ArmeFeuId,
  _ctx?: { vitesseH?: number; auSol?: boolean; vise?: boolean; chaleur?: number; accroupi?: boolean },
): number {
  return 0;
}

/**
 * Demi-angle (rad) du cône de dispersion d'un tir (v3 §1) : 0 pour toute arme sans `hanche` et pour un tir EN LUNETTE ; sinon
 * `base` + `mouvement` × min(vitesse horizontale / VITESSE_REFERENCE_M_S, 1.5) + `air` hors du sol.
 */
export function dispersionTir(arme: ArmeFeuId, ctx: { lunette: boolean; vitesseH: number; auSol: boolean }): number {
  const h = STATS[arme].hanche;
  if (!h || ctx.lunette) return 0;
  const v = Math.min(Math.max(ctx.vitesseH, 0) / VITESSE_REFERENCE_M_S, 1.5);
  return h.base + h.mouvement * v + (ctx.auSol ? 0 : h.air);
}

/**
 * Direction `d` déviée d'un angle tiré uniformément dans le DISQUE de demi-angle `angle` (rad). `u` et `v` dans [0, 1[ : le hasard
 * est fourni par l'appelant (`Math.random` côté client, rien côté serveur). `angle` ≤ 0 renvoie `d` normalisée.
 */
export function devier(d: Vec3, angle: number, u: number, v: number): Vec3 {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const fx = d[0] / n, fy = d[1] / n, fz = d[2] / n;
  if (!(angle > 0)) return [fx, fy, fz];
  let ux: number, uy: number, uz: number;
  if (Math.abs(fy) > 0.999) { ux = 1; uy = 0; uz = 0; }
  else { const l = Math.hypot(fz, fx); ux = fz / l; uy = 0; uz = -fx / l; }
  const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
  const r = angle * Math.sqrt(Math.min(Math.max(u, 0), 1)), phi = 2 * Math.PI * v;
  const s = Math.sin(r), c = Math.cos(r);
  const a = s * Math.cos(phi), b = s * Math.sin(phi);
  const x = fx * c + ux * a + wx * b, y = fy * c + uy * a + wy * b, z = fz * c + uz * a + wz * b;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Niveaux de zoom de la lunette de l'arme (champ horizontal en °), [] sans lunette. */
export function niveauxZoom(arme: ArmeFeuId): readonly number[] {
  const a = STATS[arme];
  if (a.zoom === null) return [];
  return a.zooms && a.zooms.length ? a.zooms : [a.zoom];
}

/** Index du niveau de zoom par défaut (celui qui vaut `zoom`, sinon le premier). */
export function niveauZoomDefaut(arme: ArmeFeuId): number {
  const a = STATS[arme];
  const n = niveauxZoom(arme);
  const i = n.findIndex((z) => Math.abs(z - (a.zoom ?? NaN)) < 1e-6);
  return i < 0 ? 0 : i;
}

/** Chaleur après un tir. N'influe plus sur la direction du tir (§13.1) ; conservée pour mémoire. */
export function apresTir(arme: ArmeFeuId, chaleur: number): number {
  const dp = STATS[arme].dispersion;
  return Math.min(dp.max, chaleur + dp.parTir);
}

/**
 * Délai (s) après un tir avant que la chaleur commence à retomber ; sert aussi à `delaiRecul` (le retour de la vue
 * après le recul attend le même délai). Un peu plus que l'intervalle entre deux tirs : pendant une rafale (ou en
 * cliquant à la cadence max.), le recul s'accumule ; en espaçant les tirs, la vue redescend.
 */
export function delaiRefroidissement(arme: ArmeFeuId): number {
  return STATS[arme].cadenceS * 1.25 + 0.04;
}

/** Retour du recul de tangage : part rattrapée par seconde (exponentiel), vitesse minimale (rad/s), délai maximal après un tir (s). */
export const RETOUR_RECUL = { parSeconde: 5, minimum: 0.03, delaiMaxS: 0.2 } as const;

/** Délai (s) après un tir avant que la vue ne redescende du recul : celui de la chaleur, plafonné (le pompe tire toutes les 0,85 s). */
export function delaiRecul(arme: ArmeFeuId): number {
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

/** Chaleur après `dt` secondes sans tirer (de `max` à 0 en `retourS`). N'influe plus sur la direction du tir (§13.1). */
export function refroidir(arme: ArmeFeuId, chaleur: number, dt: number): number {
  const dp = STATS[arme].dispersion;
  return Math.max(0, chaleur - (dt * dp.max) / dp.retourS);
}

/** Écart toléré (rad) entre la gerbe déclarée par un client et la gerbe fixe de `directionsTir` (§13.1) : les arrondis réseau, pas plus. */
export const TOLERANCE_GERBE_RAD = 0.02;

/**
 * Les directions d'un tir à plusieurs plombs respectent-elles la gerbe FIXE à `tolerance` près ? Le plomb 0 est l'axe de visée ; chaque
 * plomb `i` doit être à moins de `tolerance` rad de `directionsTir(arme, dirs[0])[i]`. Un tir à un plomb (ou une arme à un plomb) est
 * toujours conforme (la visée seule est contrôlée par ailleurs). Plus de plombs que l'arme n'en tire : non conforme.
 */
export function gerbeRespectee(arme: ArmeFeuId, dirs: readonly Vec3[], tolerance: number = TOLERANCE_GERBE_RAD): boolean {
  const { plombs } = STATS[arme];
  if (dirs.length > plombs) return false;
  if (plombs <= 1 || dirs.length <= 1) return true;
  const attendues = directionsTir(arme, dirs[0]);
  for (let i = 1; i < dirs.length; i++) {
    const d = dirs[i], a = attendues[i];
    const n = Math.hypot(d[0], d[1], d[2]) || 1;
    const cos = (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / n;
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > tolerance) return false;
  }
  return true;
}

/**
 * Directions normalisées des `plombs` de l'arme pour un tir visant `d` : DÉTERMINISTES, aucun hasard (§13.1).
 * Une arme à un plomb tire pile dans l'axe `d`. Une arme à plusieurs plombs tire la gerbe fixe : le plomb 0 au
 * centre, les `plombs − 1` suivants répartis régulièrement sur un cercle de demi-angle `gerbe`, le premier dans la
 * direction `u` de la base (u, w) perpendiculaire à `d` (u horizontal, perpendiculaire au regard).
 */
export function directionsTir(arme: ArmeFeuId, d: Vec3): Vec3[] {
  const { plombs, gerbe } = STATS[arme];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const fx = d[0] / n, fy = d[1] / n, fz = d[2] / n;
  const sorties: Vec3[] = [[fx, fy, fz]];
  if (plombs <= 1) return sorties;
  // base orthonormée (u, w) perpendiculaire à f
  let ux: number, uy: number, uz: number;
  if (Math.abs(fy) > 0.999) { ux = 1; uy = 0; uz = 0; }
  else {
    // u = normalise(f × haut) avec haut = (0, 1, 0)
    const l = Math.hypot(fz, fx);
    ux = fz / l; uy = 0; uz = -fx / l;
  }
  const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
  const s = Math.sin(gerbe), c = Math.cos(gerbe);
  const anneau = plombs - 1;
  for (let i = 0; i < anneau; i++) {
    const phi = (2 * Math.PI * i) / anneau;
    const a = s * Math.cos(phi), b = s * Math.sin(phi);
    const x = fx * c + ux * a + wx * b, y = fy * c + uy * a + wy * b, z = fz * c + uz * a + wz * b;
    const l = Math.hypot(x, y, z);
    sorties.push([x / l, y / l, z / l]);
  }
  return sorties;
}
