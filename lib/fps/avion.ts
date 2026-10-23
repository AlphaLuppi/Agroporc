/**
 * Avion de l'arène (PUR, `alea` et horloge injectés) : de temps en temps, un avion traverse la zone de jeu en ligne droite et largue un
 * tigre sauvage en parachute au-dessus d'une cachette. Ce module tient le minuteur des passages, leurs conditions (phase de jeu,
 * 2 joueurs en arène au moins, aucun tigre sauvage en vie), le choix de la cachette (anneau de jeu, à plus de 30 m de tout joueur
 * vivant), la trajectoire et l'instant du largage. Le service de salle (`match-tigres.ts`) crée le tigre au largage.
 * Repère de scene.json : x est, z sud, y haut.
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Avion et largage)
 */
import type { Boite } from "./collision";
import type { PassageAvion, Vec3 } from "./protocole";
import type { CachetteTigre } from "./tigre-arene";
import type { Vec2 } from "../agroparc3d/types";

export const AVION = {
  /** un passage toutes les 90 à 180 s */
  intervalleMinMs: 90_000,
  intervalleMaxMs: 180_000,
  altitude: 120,
  vitesse: 60,
  /** la trajectoire passe à moins de 60 m de la cachette choisie */
  ecartMaxM: 60,
  /** la cachette est à plus de 30 m de tout joueur vivant */
  distanceJoueursMinM: 30,
  /** joueurs en arène nécessaires à un passage */
  joueursMin: 2,
} as const;

/** Intervalle entre deux passages, surchargeable (tests de bout en bout : `PDJ_FPS_AVION_MIN_MS` et `PDJ_FPS_AVION_MAX_MS`). */
export interface IntervalleAvion { minMs: number; maxMs: number }
const INTERVALLE_DEFAUT: IntervalleAvion = { minMs: AVION.intervalleMinMs, maxMs: AVION.intervalleMaxMs };

/**
 * Minuteur et passage en cours. `prochaineT` vaut Infinity pendant un passage et tant que le tigre largué vit : le service le ré-arme
 * (`rearmerAvion`) à la mort ou au départ du tigre.
 */
export interface EtatAvion {
  prochaineT: number;
  passage: PassageAvion | null;
  /** cachette visée par le passage en cours, null si le largage a été annulé */
  cachette: CachetteTigre | null;
  largue: boolean;
  compteur: number;
}

/** Ce que l'avion doit savoir de la salle à un tic. */
export interface ConditionsAvion {
  phaseJeu: boolean;
  /** joueurs en arène (vivants ou non) */
  enArene: number;
  /** positions (x, z) des joueurs vivants en arène */
  vivants: readonly Vec2[];
  /** un tigre sauvage est en vie */
  tigreSauvage: boolean;
}

export type EvenementAvion =
  | { type: "passage"; passage: PassageAvion }
  /** `cachette` null : plus aucune cachette assez loin des joueurs au moment du largage, pas de tigre */
  | { type: "largage"; passage: PassageAvion; cachette: CachetteTigre | null; point: Vec3 }
  | { type: "fin"; passage: PassageAvion };

/** Délai (ms) avant le prochain passage : uniforme sur [minMs, maxMs]. */
export function intervalleAvion(alea: () => number, intervalle: IntervalleAvion = INTERVALLE_DEFAUT): number {
  return intervalle.minMs + alea() * (intervalle.maxMs - intervalle.minMs);
}

export function creerAvion(maintenant: number, alea: () => number, intervalle?: IntervalleAvion): EtatAvion {
  return { prochaineT: maintenant + intervalleAvion(alea, intervalle), passage: null, cachette: null, largue: false, compteur: 0 };
}

/** Ré-arme le minuteur (tigre sauvage mort ou parti, nouveau match). Le passage en cours éventuel est oublié. */
export function rearmerAvion(e: EtatAvion, maintenant: number, alea: () => number, intervalle?: IntervalleAvion): void {
  e.passage = null;
  e.cachette = null;
  e.largue = false;
  e.prochaineT = maintenant + intervalleAvion(alea, intervalle);
}

/** Cachettes de l'anneau de jeu : à `rMin` m au moins et `rMax` m au plus du centre (rond-point, `ZONE_APPARITION` de zones.ts). */
export function cachettesDansAnneau(cachettes: readonly CachetteTigre[], anneau: { centre: Vec2; rMin: number; rMax: number }): CachetteTigre[] {
  const [cx, cz] = anneau.centre;
  return cachettes.filter((c) => {
    const d = Math.hypot(c.x - cx, c.z - cz);
    return d >= anneau.rMin && d <= anneau.rMax;
  });
}

/** Cachette tirée uniformément parmi celles à plus de 30 m de tout joueur vivant. Null s'il n'y en a aucune. */
export function choisirCachetteLargage(cachettes: readonly CachetteTigre[], vivants: readonly Vec2[], alea: () => number): CachetteTigre | null {
  const libres = cachettes.filter((c) => vivants.every(([x, z]) => Math.hypot(c.x - x, c.z - z) > AVION.distanceJoueursMinM));
  if (!libres.length) return null;
  return libres[Math.min(libres.length - 1, Math.floor(alea() * libres.length))];
}

/**
 * Trajectoire d'un passage vers `cachette` : cap tiré au hasard, droite décalée de la cachette d'au plus 90 % de `ecartMaxM`, coupée
 * aux bords de `bornes` (la zone de jeu). Le tigre quitte l'avion au point de la droite le plus proche de la cachette. Null si la droite
 * ne traverse pas la zone (cachette hors des bornes).
 */
export function tracerPassage(id: number, cachette: CachetteTigre, bornes: Boite, maintenant: number, alea: () => number): PassageAvion | null {
  const cap = alea() * 2 * Math.PI;
  const ux = Math.cos(cap), uz = Math.sin(cap);
  const decalage = (alea() * 2 - 1) * AVION.ecartMaxM * 0.9;
  // point de la droite le plus proche de la cachette (le décalage est perpendiculaire à la direction)
  const px = cachette.x - uz * decalage, pz = cachette.z + ux * decalage;
  let sMin = -Infinity, sMax = Infinity;
  const couper = (p: number, u: number, a: number, b: number): boolean => {
    if (Math.abs(u) < 1e-12) return p >= a && p <= b;
    let s0 = (a - p) / u, s1 = (b - p) / u;
    if (s0 > s1) [s0, s1] = [s1, s0];
    sMin = Math.max(sMin, s0);
    sMax = Math.min(sMax, s1);
    return true;
  };
  if (!couper(px, ux, bornes.x0, bornes.x1) || !couper(pz, uz, bornes.z0, bornes.z1)) return null;
  if (!(sMin <= 0 && sMax >= 0)) return null;
  const ms = (s: number) => (s * 1000) / AVION.vitesse;
  return {
    id,
    depart: [px + ux * sMin, pz + uz * sMin],
    arrivee: [px + ux * sMax, pz + uz * sMax],
    altitude: AVION.altitude,
    vitesse: AVION.vitesse,
    debutT: maintenant,
    finT: maintenant + ms(sMax - sMin),
    largageT: maintenant + ms(-sMin),
  };
}

/** Position de l'avion à l'instant `t` (bornée au départ et à l'arrivée). */
export function positionAvion(p: PassageAvion, t: number): Vec3 {
  const k = p.finT > p.debutT ? Math.min(1, Math.max(0, (t - p.debutT) / (p.finT - p.debutT))) : 0;
  return [p.depart[0] + (p.arrivee[0] - p.depart[0]) * k, p.altitude, p.depart[1] + (p.arrivee[1] - p.depart[1]) * k];
}

/** Distance horizontale (m) d'un point à la droite de la trajectoire. */
export function ecartTrajectoire(p: PassageAvion, x: number, z: number): number {
  const dx = p.arrivee[0] - p.depart[0], dz = p.arrivee[1] - p.depart[1];
  const l = Math.hypot(dx, dz) || 1;
  return Math.abs((x - p.depart[0]) * dz - (z - p.depart[1]) * dx) / l;
}

/**
 * Avance le minuteur et le passage en cours. Sans passage, à l'échéance : passage si la phase est « jeu », 2 joueurs au moins sont en
 * arène, aucun tigre sauvage ne vit et une cachette de l'anneau est à plus de 30 m de tout vivant, sinon l'échéance est repoussée d'un
 * intervalle entier (jamais de passage qui attendrait les joueurs). Au largage, la cachette est revérifiée (les joueurs ont bougé
 * pendant le vol) et remplacée au besoin. Après le passage, le minuteur reste à l'arrêt tant que le tigre largué vit.
 */
export function avancerAvion(
  e: EtatAvion, maintenant: number, alea: () => number, cond: ConditionsAvion, cachettes: readonly CachetteTigre[], bornes: Boite,
  intervalle?: IntervalleAvion,
): EvenementAvion[] {
  const ev: EvenementAvion[] = [];
  if (e.passage) {
    const p = e.passage;
    if (!e.largue && maintenant >= p.largageT) {
      e.largue = true;
      const proche = (c: CachetteTigre) => cond.vivants.some(([x, z]) => Math.hypot(c.x - x, c.z - z) <= AVION.distanceJoueursMinM);
      if (e.cachette && proche(e.cachette)) e.cachette = choisirCachetteLargage(cachettes, cond.vivants, alea);
      ev.push({ type: "largage", passage: p, cachette: e.cachette, point: positionAvion(p, maintenant) });
    }
    if (maintenant >= p.finT) {
      ev.push({ type: "fin", passage: p });
      const tigre = e.cachette !== null;
      e.passage = null;
      e.largue = false;
      e.cachette = null;
      // sans tigre largué, le minuteur repart tout de suite, sinon il attend la fin du tigre (`rearmerAvion`)
      e.prochaineT = tigre ? Infinity : maintenant + intervalleAvion(alea, intervalle);
    }
    return ev;
  }
  if (cond.tigreSauvage || maintenant < e.prochaineT) return ev;
  const repousser = () => { e.prochaineT = maintenant + intervalleAvion(alea, intervalle); };
  if (!cond.phaseJeu || cond.enArene < AVION.joueursMin) { repousser(); return ev; }
  const cachette = choisirCachetteLargage(cachettes, cond.vivants, alea);
  const passage = cachette ? tracerPassage(e.compteur + 1, cachette, bornes, maintenant, alea) : null;
  if (!cachette || !passage) { repousser(); return ev; }
  e.compteur++;
  e.passage = passage;
  e.cachette = cachette;
  e.largue = false;
  e.prochaineT = Infinity;
  ev.push({ type: "passage", passage });
  return ev;
}
