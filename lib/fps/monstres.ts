/**
 * Monstres des événements de l'arène (PUR, partagé client / serveur, aucune horloge ni hasard) : le Truck Muche fou, le tigre robot
 * géant (boss) et le titan tigre piloté par le joueur qui achève le boss. Constantes, formes de touche (sphères), poursuite du Truck
 * (il conduit avec la physique des voitures, dérapage compris), déplacement et attaques du tigre, déplacement du titan.
 * Repère de protocole.ts : avant d'un cap = (−sin cap, −cos cap), droite = (cos cap, −sin cap).
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { lancerRayon, resoudre, type Monde } from "./collision";
import { OEIL_TITAN, type Vec3, type Zone } from "./protocole";
import { pasVehicule, type CommandesVehicule, type EtatVehicule } from "./vehicule";

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

export const EVENEMENTS = {
  /** délai avant le premier événement d'un match, puis entre la fin d'un événement et l'annonce du suivant (ms) */
  premierMinMs: 45_000, premierMaxMs: 70_000,
  intervalleMinMs: 70_000, intervalleMaxMs: 110_000,
  /** durée du bandeau d'annonce avant le début (ms) */
  annonceMs: 4_000,
} as const;

export const TRUCK_FOU = {
  dureeMs: 25_000,
  /** caisse dessinée et mortelle (m) : plus grande qu'une voiture */
  longueur: 6, largeur: 2.6, hauteur: 3.2,
  /** en dessous de cette vitesse (m/s), le Truck n'écrase personne */
  vitesseEcrase: 4,
  /** nouvelle cible au plus tôt après ce délai (ms) */
  changementCibleMs: 1_500,
  /** bloqué (vitesse < 3 m/s pendant `bloqueMs`) : marche arrière braquée pendant `reculMs` */
  bloqueMs: 900, reculMs: 1_100,
} as const;

export const TIGRE_ROBOT = {
  dureeMs: 150_000,
  /** marche (m/s) et rotation (rad/s) */
  vitesse: 6, rotation: 1.1,
  rayonCollision: 3,
  /** PV : base + par joueur en arène au début (plafonné à 16) */
  pvBase: 1_500, pvParJoueur: 500,
  /** s'arrête à cette distance (m) de sa cible pour frapper */
  arret: 6.5,
  patte: { portee: 9.5, cosMin: 0.35, armeMs: 650, rechargeMs: 2_200 },
  laser: { premierMs: 4_000, periodeMs: 8_000, avisMs: 1_400, rayon: 3.5, degats: 75, portee: 110 },
  /** pieds et ventre : un joueur sous le tigre qui marche est écrasé */
  rayonEcrase: 3,
} as const;

export const TITAN = {
  dureeMs: 90_000,
  pvMax: 1_500,
  /** marche du titan (m/s) ; le serveur tolère +1 m/s et 1 m de marge */
  vitesse: 10,
  rayonCollision: 2.2,
  /** le titan est un tigre réduit */
  echelle: 0.7,
  rayonEcrase: 2.4,
  canon: { cadenceS: 0.12, degats: 28, portee: 300 },
} as const;

/** Échelle de dessin et de touche du tigre (boss) et du titan. */
export const ECHELLE_TIGRE = 1;

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

const borne = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export function enrouler(a: number): number {
  const t = 2 * Math.PI;
  const r = ((a + Math.PI) % t + t) % t - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}
/** Cap (convention lacet) qui regarde de (x, z) vers (cx, cz). */
export function capVers(x: number, z: number, cx: number, cz: number): number {
  return Math.atan2(-(cx - x), -(cz - z));
}
const avant = (cap: number): [number, number] => [-Math.sin(cap), -Math.cos(cap)];
const droite = (cap: number): [number, number] => [Math.cos(cap), -Math.sin(cap)];

/** Point local (droite, haut, avant) d'une forme posée en p, orientée par `cap`, à l'échelle `echelle`. */
export function pointLocal(p: Vec3, cap: number, echelle: number, d: number, h: number, a: number): Vec3 {
  const [fx, fz] = avant(cap), [rx, rz] = droite(cap);
  return [p[0] + (rx * d + fx * a) * echelle, p[1] + h * echelle, p[2] + (rz * d + fz * a) * echelle];
}

// ---------------------------------------------------------------------------------------------
// Formes de touche
// ---------------------------------------------------------------------------------------------

/** Sphère de touche d'un tigre, en repère local (droite, haut, avant), à l'échelle 1. */
export interface SphereForme { d: number; h: number; a: number; r: number; zone: Zone }

/** Tigre robot : tête (zone « tete »), trois sphères de corps, quatre pattes. Le titan est la même forme à `TITAN.echelle`. */
export const FORME_TIGRE: readonly SphereForme[] = [
  { d: 0, h: 5.4, a: 5.6, r: 1.7, zone: "tete" },
  { d: 0, h: 4.6, a: 2.4, r: 2.4, zone: "corps" },
  { d: 0, h: 4.5, a: -0.4, r: 2.5, zone: "corps" },
  { d: 0, h: 4.4, a: -3.2, r: 2.3, zone: "corps" },
  { d: -1.4, h: 1.6, a: 3, r: 1.1, zone: "corps" },
  { d: 1.4, h: 1.6, a: 3, r: 1.1, zone: "corps" },
  { d: -1.4, h: 1.6, a: -3.4, r: 1.1, zone: "corps" },
  { d: 1.4, h: 1.6, a: -3.4, r: 1.1, zone: "corps" },
];

/** Plus petit t ≥ 0 où le rayon (o, d normalisé) entre dans la sphère, Infinity sinon. */
function rayonSphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const wx = o[0] - c[0], wy = o[1] - c[1], wz = o[2] - c[2];
  const b = wx * d[0] + wy * d[1] + wz * d[2];
  const cc = wx * wx + wy * wy + wz * wz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? 0 : Infinity;
}

/**
 * Le rayon (o, d normalisé) touche-t-il le tigre posé en (p, cap) à l'échelle `echelle`, avant `portee` et avant tout bâtiment
 * (si `monde`) ? `marge` agrandit chaque sphère (tolérance du serveur : retard et mouvement du monstre). La tête prime si elle est touchée.
 */
export function toucheTigre(
  o: Vec3, d: Vec3, portee: number, p: Vec3, cap: number, echelle: number, monde: Monde | null, marge = 0,
): { distance: number; zone: Zone } | null {
  let meilleur = Infinity;
  let zone: Zone = "corps";
  for (const s of FORME_TIGRE) {
    const c = pointLocal(p, cap, echelle, s.d, s.h, s.a);
    const t = rayonSphere(o, d, c, s.r * echelle + marge);
    if (t === Infinity || t > portee) continue;
    // la tête l'emporte sur une sphère de corps à peine plus proche (elle dépasse du cou)
    if (s.zone === "tete" ? t < meilleur + 0.6 : t < meilleur - (zone === "tete" ? 0.6 : 0)) { meilleur = t; zone = s.zone; }
  }
  if (meilleur === Infinity) return null;
  if (monde && lancerRayon(monde, o, d, meilleur) < meilleur - 0.05) return null;
  return { distance: meilleur, zone };
}

// ---------------------------------------------------------------------------------------------
// Truck Muche fou
// ---------------------------------------------------------------------------------------------

/**
 * Commandes de poursuite : braque vers la cible, freine à main (dérapage) quand elle est franchement de côté à pleine vitesse ;
 * en marche arrière (débloquage), braque à l'envers pour se dégager du mur.
 */
export function commandesPoursuite(e: EtatVehicule, cible: Vec3 | null, recul: boolean): CommandesVehicule {
  if (!cible) return { accel: 0.6, direction: 0, frein: false };
  const ecart = enrouler(capVers(e.p[0], e.p[2], cible[0], cible[2]) - e.cap);
  // ecart > 0 : la cible est à gauche ; direction +1 = droite
  const sens = ecart > 0 ? -1 : 1;
  const force = borne(Math.abs(ecart) * 2.2, 0, 1);
  if (recul) return { accel: -1, direction: -sens * force, frein: false };
  return { accel: 1, direction: sens * force, frein: Math.abs(ecart) > 0.9 && e.v > 11 };
}

/** Un pas du Truck (physique des voitures) ; un bâtiment entre lui et sa cible : il vise un point dégagé à côté (contournement). */
export function pasTruck(e: EtatVehicule, cible: Vec3 | null, recul: boolean, dt: number, monde: Monde): EtatVehicule {
  let vise = cible;
  if (cible && !recul) {
    const dist = Math.hypot(cible[0] - e.p[0], cible[2] - e.p[2]);
    const voulu = capVers(e.p[0], e.p[2], cible[0], cible[2]);
    const cap = capContournement(monde, e.p, voulu, Math.min(dist, 18), TRUCK_FOU.largeur / 2);
    if (cap !== voulu) { const [fx, fz] = avant(cap); vise = [e.p[0] + fx * 20, 0, e.p[2] + fz * 20]; }
  }
  return pasVehicule(e, commandesPoursuite(e, vise, recul), dt, monde).etat;
}

/** Le joueur (pieds en p, cylindre de rayon `rayon`) est-il sous la caisse du Truck lancé ? */
export function ecraseParTruck(e: EtatVehicule, p: Vec3, rayon: number, marge = 0.2): boolean {
  if (Math.abs(e.v) < TRUCK_FOU.vitesseEcrase && Math.abs(e.vl ?? 0) < TRUCK_FOU.vitesseEcrase) return false;
  if (p[1] >= TRUCK_FOU.hauteur) return false;
  const [fx, fz] = avant(e.cap);
  const dx = p[0] - e.p[0], dz = p[2] - e.p[2];
  const lon = Math.abs(dx * fx + dz * fz), lat = Math.abs(-dx * fz + dz * fx);
  const ex = Math.max(0, lon - TRUCK_FOU.longueur / 2 - marge), ez = Math.max(0, lat - TRUCK_FOU.largeur / 2 - marge);
  return ex * ex + ez * ez <= rayon * rayon;
}

// ---------------------------------------------------------------------------------------------
// Tigre robot (boss)
// ---------------------------------------------------------------------------------------------

/** `detour` : cap de contournement retenu tant qu'il reste dégagé (évite d'hésiter entre les deux côtés d'un bâtiment). */
export interface EtatMarcheur { p: Vec3; cap: number; v: number; detour?: number }

/**
 * Contournement par « moustaches » : si le chemin vers `capVoulu` est barré par un bâtiment avant `portee` m (trois rayons, au centre et sur
 * les flancs à `demiLargeur`), renvoie le cap dégagé le plus proche (pas de 22,5°, jusqu'à ±135°), en gardant d'abord `prefere` s'il est libre.
 */
export function capContournement(monde: Monde, p: Vec3, capVoulu: number, portee: number, demiLargeur: number, prefere?: number): number {
  const libre = (cap: number) => {
    const [fx, fz] = avant(cap), [rx, rz] = droite(cap);
    for (const k of [0, -1, 1]) {
      const o: Vec3 = [p[0] + rx * demiLargeur * k, 1, p[2] + rz * demiLargeur * k];
      if (lancerRayon(monde, o, [fx, 0, fz], portee) !== Infinity) return false;
    }
    return true;
  };
  if (libre(capVoulu)) return capVoulu;
  if (prefere !== undefined && Math.abs(enrouler(prefere - capVoulu)) < 2.4 && libre(prefere)) return prefere;
  for (let k = 1; k <= 6; k++) {
    for (const sgn of [1, -1]) {
      const c = enrouler(capVoulu + sgn * k * (Math.PI / 8));
      if (libre(c)) return c;
    }
  }
  return capVoulu;
}

/**
 * Un pas du tigre : il pivote vers sa cible (vitesse de rotation bornée), avance d'autant moins qu'il est de travers, s'arrête à
 * `arret` m pour frapper, glisse le long des bâtiments. Sans cible, il reste sur place.
 */
export function pasTigre(e: EtatMarcheur, cible: Vec3 | null, dt: number, monde: Monde, vers?: Vec3 | null): EtatMarcheur {
  if (!cible || !(dt > 0)) return { p: [e.p[0], e.p[1], e.p[2]], cap: e.cap, v: 0 };
  const T = TIGRE_ROBOT;
  const dist = Math.hypot(cible[0] - e.p[0], cible[2] - e.p[2]);
  // `vers` : point du chemin calculé (navigation.ts) ; sinon droit sur la cible
  const but = vers ?? cible;
  const voulu = capVers(e.p[0], e.p[2], but[0], but[2]);
  // un bâtiment barre encore le chemin : il le contourne par le côté dégagé le plus proche
  const capCible = capContournement(monde, e.p, voulu, Math.min(Math.hypot(but[0] - e.p[0], but[2] - e.p[2]), 16), T.rayonCollision, e.detour);
  const detour = capCible !== voulu ? capCible : undefined;
  const ecart = enrouler(capCible - e.cap);
  const cap = enrouler(e.cap + borne(ecart, -T.rotation * dt, T.rotation * dt));
  const alignement = Math.max(0, Math.cos(ecart));
  const vVoulue = dist > T.arret || detour !== undefined || (vers && vers !== cible) ? T.vitesse * alignement * alignement : 0;
  const [fx, fz] = avant(cap);
  const r = resoudre(monde, [e.p[0] + fx * vVoulue * dt, 0, e.p[2] + fz * vVoulue * dt], T.rayonCollision, 8);
  // vitesse RÉELLE (contre un mur, il piétine : les pattes ralentissent)
  const v = Math.hypot(r.p[0] - e.p[0], r.p[2] - e.p[2]) / dt;
  return { p: [r.p[0], e.p[1], r.p[2]], cap, v, ...(detour !== undefined ? { detour } : {}) };
}

/** Bout du museau au sol (point de départ du coup de patte). */
export function museau(e: EtatMarcheur, echelle: number = ECHELLE_TIGRE): Vec3 {
  return pointLocal(e.p, e.cap, echelle, 0, 0, 5.6);
}
/** Yeux du tigre (origine du laser). */
export function yeuxTigre(e: EtatMarcheur, echelle: number = ECHELLE_TIGRE): Vec3 {
  return pointLocal(e.p, e.cap, echelle, 0, 5.6, 6.6);
}

/** Le joueur est-il dans le balayage du coup de patte (devant le tigre, à portée) ? */
export function dansCoupDePatte(e: EtatMarcheur, p: Vec3): boolean {
  const T = TIGRE_ROBOT.patte;
  const dx = p[0] - e.p[0], dz = p[2] - e.p[2];
  const dist = Math.hypot(dx, dz);
  if (dist > T.portee || p[1] > 6) return false;
  if (dist < 1e-6) return true;
  const [fx, fz] = avant(e.cap);
  return (dx * fx + dz * fz) / dist >= T.cosMin;
}

/** Le joueur est-il sous le corps du tigre (écrasé s'il marche) ? */
export function sousLeTigre(e: EtatMarcheur, p: Vec3, echelle: number = ECHELLE_TIGRE, rayon: number = TIGRE_ROBOT.rayonEcrase): boolean {
  if (p[1] > 2.5 * echelle) return false;
  const [fx, fz] = avant(e.cap);
  // deux disques le long du corps (avant et arrière)
  for (const a of [2.4, -2.6]) {
    const cx = e.p[0] + fx * a * echelle, cz = e.p[2] + fz * a * echelle;
    if (Math.hypot(p[0] - cx, p[2] - cz) <= rayon * echelle) return true;
  }
  return false;
}

/** PV du tigre selon le nombre de joueurs en arène. */
export function pvTigre(joueurs: number): number {
  return TIGRE_ROBOT.pvBase + TIGRE_ROBOT.pvParJoueur * borne(Math.round(joueurs), 1, 16);
}

// ---------------------------------------------------------------------------------------------
// Titan tigre (piloté)
// ---------------------------------------------------------------------------------------------

/** Entrées du pilote : avant/arrière, gauche/droite (−1..1) et lacet de la vue (le titan regarde où regarde le pilote). */
export interface EntreesTitan { avant: number; droite: number; lacet: number }

/** Un pas du titan (client du pilote) : se déplace dans le repère de la vue, glisse le long des bâtiments. */
export function pasTitan(e: EtatMarcheur, en: EntreesTitan, dt: number, monde: Monde): EtatMarcheur {
  const cap = enrouler(en.lacet);
  if (!(dt > 0)) return { p: [e.p[0], e.p[1], e.p[2]], cap, v: 0 };
  let ax = borne(Number.isFinite(en.avant) ? en.avant : 0, -1, 1), dr = borne(Number.isFinite(en.droite) ? en.droite : 0, -1, 1);
  const n = Math.hypot(ax, dr);
  if (n > 1) { ax /= n; dr /= n; }
  const [fx, fz] = avant(cap), [rx, rz] = droite(cap);
  const vx = (fx * ax + rx * dr) * TITAN.vitesse, vz = (fz * ax + rz * dr) * TITAN.vitesse;
  const r = resoudre(monde, [e.p[0] + vx * dt, 0, e.p[2] + vz * dt], TITAN.rayonCollision, 8);
  const v = Math.hypot(r.p[0] - e.p[0], r.p[2] - e.p[2]) / dt;
  return { p: [r.p[0], e.p[1], r.p[2]], cap, v: ax < 0 ? -v : v };
}

/** Œil du pilote (canon et caméra). */
export function oeilTitan(p: Vec3): Vec3 {
  return [p[0], p[1] + OEIL_TITAN, p[2]];
}
