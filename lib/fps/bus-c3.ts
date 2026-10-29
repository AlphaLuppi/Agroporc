/**
 * Bus C3 express de l'arène (PUR, aucun import three ni DOM).
 *
 * Le bus C3 (Chrono'hop d'Avignon) traverse l'arène à pleine vitesse ("à fond" : 24 m/s, soit ~86 km/h) :
 *  - Il arrive périodiquement (annoncé avec coups de klaxon).
 *  - En passant, il largue des armes uniques sur la chaussée (lance-grenades, bazooka, fumigène).
 *  - Il écrase impitoyablement les joueurs au sol sur sa trajectoire ("peut rouler sur les gens").
 *  - Les joueurs agiles ou rapides peuvent sauter sur son toit (hauteur 3,2 m) ou y monter pour surfer à pleine vitesse.
 */
import type { ArmeLacheeSnap, ArmeUniqueId, BusSnap, Vec3 } from "./protocole";

export const BUS_C3 = {
  longueur: 12.0,
  largeur: 3.0,
  hauteur: 3.2,
  toitY: 3.2,
  vitesse: 24, // m/s (~86 km/h)
  intervalleMinMs: 45_000,
  intervalleMaxMs: 75_000,
  dureeAnnonceMs: 4_000,
  rayonRamassageM: 2.8,
  distanceMonterM: 4.5,
  dureeArmeAuSolMs: 60_000,
} as const;

export interface PointTrajectoire {
  x: number;
  z: number;
}

/** Trajet type du Bus C3 à travers le grand axe et l'anneau d'Agroparc. */
export const TRAJET_BUS_C3: readonly [number, number][] = [
  [220, 20],
  [120, 25],
  [46.3, 5.8],
  [38.1, 17.8],
  [31.2, 20.5],
  [23.8, 20.1],
  [14.0, 13.7],
  [11.0, 8.5],
  [11.0, -3.2],
  [-62.0, -21.0],
  [-110.0, -35.0],
  [-170.0, -50.0],
  [-120.0, 60.0],
  [-40.0, 90.0],
  [17.3, 44.7],
  [46.3, 5.8],
  [120.0, 25.0],
  [240.0, 20.0],
];

export interface ArmeLachee {
  id: string;
  arme: ArmeUniqueId;
  p: Vec3;
  expireT: number;
}

export type PhaseBus = "attente" | "annonce" | "course";

/** Intervalle entre deux passages (ms), surchargeable pour les tests de bout en bout (`PDJ_FPS_BUS_MIN_MS` / `_MAX_MS` du serveur). */
export interface IntervalleBus { minMs: number; maxMs: number }
const INTERVALLE_DEFAUT: IntervalleBus = { minMs: BUS_C3.intervalleMinMs, maxMs: BUS_C3.intervalleMaxMs };

export interface EtatBusC3 {
  phase: PhaseBus;
  prochaineT: number;
  debutCourseT: number;
  finCourseT: number;
  compteurPassages: number;
  p: Vec3;
  cap: number;
  v: number;
  longueurTrajet: number;
  cumuls: number[];
  armesLachees: ArmeLachee[];
  lachementsFaits: Set<number>;
  passagers: Set<string>;
  /** intervalle entre deux passages */
  intervalle: IntervalleBus;
}

/** Calcule les longueurs cumulées d'une polyligne. */
export function calculerCumuls(pts: readonly [number, number][]): { cumuls: number[]; longueur: number } {
  const cumuls = [0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cumuls.push(cumuls[i - 1] + d);
  }
  return { cumuls, longueur: cumuls[cumuls.length - 1] };
}

export function creerEtatBusC3(maintenant: number, alea: () => number = Math.random, intervalle: IntervalleBus = INTERVALLE_DEFAUT): EtatBusC3 {
  const { cumuls, longueur } = calculerCumuls(TRAJET_BUS_C3);
  const delai = intervalle.minMs + alea() * (intervalle.maxMs - intervalle.minMs);
  return {
    phase: "attente",
    prochaineT: maintenant + delai,
    debutCourseT: 0,
    finCourseT: 0,
    compteurPassages: 0,
    p: [TRAJET_BUS_C3[0][0], 0, TRAJET_BUS_C3[0][1]],
    cap: 0,
    v: 0,
    longueurTrajet: longueur,
    cumuls,
    armesLachees: [],
    lachementsFaits: new Set(),
    passagers: new Set(),
    intervalle: { minMs: intervalle.minMs, maxMs: intervalle.maxMs },
  };
}

/** Position et cap sur le trajet à la distance `s`. */
export function evaluerTrajet(
  s: number,
  pts: readonly [number, number][] = TRAJET_BUS_C3,
  cumuls: readonly number[]
): { p: [number, number]; cap: number } {
  const clampS = Math.max(0, Math.min(s, cumuls[cumuls.length - 1]));
  let i = 1;
  while (i < cumuls.length - 1 && cumuls[i] < clampS) i++;
  const segLen = Math.max(1e-6, cumuls[i] - cumuls[i - 1]);
  const u = (clampS - cumuls[i - 1]) / segLen;
  const p0 = pts[i - 1], p1 = pts[i];
  const x = p0[0] + (p1[0] - p0[0]) * u;
  const z = p0[1] + (p1[1] - p0[1]) * u;
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  // Convention lacet FPS (0 = vers -z)
  const cap = Math.atan2(dx, -dz);
  return { p: [x, z], cap };
}

/** Vérifie si un joueur est écrasé par le devant du bus (au sol). */
export function ecraseParBus(pJoueur: Vec3, pBus: Vec3, capBus: number): boolean {
  if (pJoueur[1] > 2.2) return false; // Trop haut (en l'air ou sur le toit)
  // Repère local du bus
  const c = Math.cos(capBus), s = Math.sin(capBus);
  const rx = pJoueur[0] - pBus[0], rz = pJoueur[2] - pBus[2];
  // En convention FPS (regard vers -z) : localX = rx*c + rz*s, localZ = -rx*s + rz*c
  const lx = rx * c + rz * s;
  const lz = -rx * s + rz * c;

  // Le bus avance vers -z local
  // Zone d'impact frontal : lz entre [-longueur/2 - 0.8, -longueur/4] et |lx| <= largeur/2 + 0.3
  const demiL = BUS_C3.longueur / 2;
  const demiW = BUS_C3.largeur / 2 + 0.35;
  if (Math.abs(lx) <= demiW && lz >= -demiL - 1.0 && lz <= -demiL + 2.0) {
    return true;
  }
  return false;
}

/** Vérifie si le joueur est sur le toit du bus. */
export function estSurLeToit(pJoueur: Vec3, pBus: Vec3, capBus: number): boolean {
  if (pJoueur[1] < BUS_C3.toitY - 0.75) return false; // En dessous du toit
  const c = Math.cos(capBus), s = Math.sin(capBus);
  const rx = pJoueur[0] - pBus[0], rz = pJoueur[2] - pBus[2];
  const lx = rx * c + rz * s;
  const lz = -rx * s + rz * c;
  const demiL = BUS_C3.longueur / 2 + 0.4;
  const demiW = BUS_C3.largeur / 2 + 0.4;
  return Math.abs(lx) <= demiW && Math.abs(lz) <= demiL;
}

/** Vérifie si un joueur proche peut monter sur le toit du bus. */
export function peutMonterSurBus(pJoueur: Vec3, pBus: Vec3): boolean {
  const d = Math.hypot(pJoueur[0] - pBus[0], pJoueur[2] - pBus[2]);
  return d <= BUS_C3.distanceMonterM;
}

export type EvenementBus =
  | { type: "annonce" }
  | { type: "debutCourse"; p: Vec3; cap: number; v: number }
  | { type: "lachement"; arme: ArmeUniqueId; p: Vec3 }
  | { type: "finCourse" };

/** Fait progresser l'état du bus d'un tic de jeu. */
export function avancerBusC3(
  e: EtatBusC3,
  maintenant: number,
  alea: () => number = Math.random
): EvenementBus[] {
  const evts: EvenementBus[] = [];

  // 1. Nettoyage des armes expirées
  e.armesLachees = e.armesLachees.filter((a) => a.expireT > maintenant);

  if (e.phase === "attente") {
    if (maintenant >= e.prochaineT) {
      e.phase = "annonce";
      e.debutCourseT = maintenant + BUS_C3.dureeAnnonceMs;
      evts.push({ type: "annonce" });
    }
  } else if (e.phase === "annonce") {
    if (maintenant >= e.debutCourseT) {
      e.phase = "course";
      const dureeS = e.longueurTrajet / BUS_C3.vitesse;
      e.finCourseT = e.debutCourseT + dureeS * 1000;
      e.compteurPassages++;
      e.lachementsFaits.clear();
      e.passagers.clear();
      const posInit = evaluerTrajet(0, TRAJET_BUS_C3, e.cumuls);
      e.p = [posInit.p[0], 0, posInit.p[1]];
      e.cap = posInit.cap;
      e.v = BUS_C3.vitesse;
      evts.push({ type: "debutCourse", p: [...e.p], cap: e.cap, v: e.v });
    }
  } else if (e.phase === "course") {
    const elapsedS = (maintenant - e.debutCourseT) / 1000;
    const s = elapsedS * BUS_C3.vitesse;

    if (maintenant >= e.finCourseT || s >= e.longueurTrajet) {
      e.phase = "attente";
      const intervalle = e.intervalle.minMs + alea() * (e.intervalle.maxMs - e.intervalle.minMs);
      e.prochaineT = maintenant + intervalle;
      e.v = 0;
      e.passagers.clear();
      evts.push({ type: "finCourse" });
    } else {
      const pos = evaluerTrajet(s, TRAJET_BUS_C3, e.cumuls);
      e.p = [pos.p[0], 0, pos.p[1]];
      e.cap = pos.cap;
      e.v = BUS_C3.vitesse;

      // Largage d'armes uniques à 25%, 50%, 75% du trajet
      const fractions = [0.25, 0.5, 0.75] as const;
      const armes: ArmeUniqueId[] = ["lance_grenades", "bazooka", "fumigene"];
      for (let idx = 0; idx < fractions.length; idx++) {
        if (!e.lachementsFaits.has(idx) && s >= e.longueurTrajet * fractions[idx]) {
          e.lachementsFaits.add(idx);
          const arme = armes[idx];
          // Dépôt au sol derrière le bus
          const dx = Math.sin(e.cap) * 3.5;
          const dz = -Math.cos(e.cap) * 3.5;
          const pLachee: Vec3 = [e.p[0] + dx, 0.4, e.p[2] + dz];
          const item: ArmeLachee = {
            id: `arme_c3_${e.compteurPassages}_${idx}`,
            arme,
            p: pLachee,
            expireT: maintenant + BUS_C3.dureeArmeAuSolMs,
          };
          e.armesLachees.push(item);
          evts.push({ type: "lachement", arme, p: pLachee });
        }
      }
    }
  }

  return evts;
}

/** Tente de faire ramasser une arme au sol par un joueur à proximité. */
export function ramasserArmeC3(
  e: EtatBusC3,
  pJoueur: Vec3
): ArmeLachee | null {
  for (let i = 0; i < e.armesLachees.length; i++) {
    const item = e.armesLachees[i];
    const d = Math.hypot(pJoueur[0] - item.p[0], pJoueur[2] - item.p[2]);
    if (d <= BUS_C3.rayonRamassageM && Math.abs(pJoueur[1] - item.p[1]) <= 2.0) {
      e.armesLachees.splice(i, 1);
      return item;
    }
  }
  return null;
}

/** Convertit l'état du bus en BusSnap pour le réseau. */
export function busEnSnap(e: EtatBusC3): BusSnap {
  return {
    p: [Math.round(e.p[0] * 100) / 100, Math.round(e.p[1] * 100) / 100, Math.round(e.p[2] * 100) / 100],
    cap: Math.round(e.cap * 1000) / 1000,
    v: Math.round(e.v * 10) / 10,
    actif: e.phase === "course",
    passagers: [...e.passagers],
  };
}

/** Convertit les armes au sol en ArmeLacheeSnap[]. */
export function armesEnSnap(e: EtatBusC3): ArmeLacheeSnap[] {
  return e.armesLachees.map((a) => ({
    id: a.id,
    arme: a.arme,
    p: [Math.round(a.p[0] * 100) / 100, Math.round(a.p[1] * 100) / 100, Math.round(a.p[2] * 100) / 100],
  }));
}
