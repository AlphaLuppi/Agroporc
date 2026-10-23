/**
 * Monstres des événements de l'arène (PUR, partagé client / serveur, aucune horloge ni hasard) : le Truck Muche fou, le tigre robot
 * géant (boss) et le titan tigre piloté par le joueur qui achève le boss. Constantes, formes de touche (sphères), poursuite du Truck
 * (il conduit avec la physique des voitures, dérapage compris), déplacement et attaques du tigre, déplacement du titan.
 * Repère de protocole.ts : avant d'un cap = (−sin cap, −cos cap), droite = (cos cap, −sin cap).
 * Spec : docs/superpowers/specs/2026-10-24-arene-evenements-design.md
 */
import { lancerRayon, resoudre, solSous, type Monde } from "./collision";
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
  /** au plus 5 min (jamais affiché : le bandeau montre ses PV à faire tomber), puis il quitte Agroparc */
  dureeMs: 300_000,
  /** marche (m/s) et rotation (rad/s) : il ENJAMBE les bâtiments (plus haut qu'eux), aucun contournement */
  vitesse: 8, rotation: 0.9,
  rayonCollision: 3.6,
  /** PV : base + par joueur en arène au début (plafonné à 16) */
  pvBase: 4_000, pvParJoueur: 1_500,
  /** sous cette part de PV, il enrage : attaques plus fréquentes, triple laser */
  seuilRage: 0.5,
  /** s'arrête à cette distance (m) de sa cible pour frapper */
  arret: 24,
  patte: { portee: 32, cosMin: 0.3, armeMs: 700, rechargeMs: 2_400 },
  laser: { premierMs: 4_000, avisMs: 1_400, rayon: 5, degats: 80, portee: 240, ecartTripleMs: 350 },
  /** attaques spéciales : une toutes les `periodeMs` (× `facteurRage` enragé) */
  attaques: { premierMs: 6_000, periodeMs: 6_500, facteurRage: 0.55 },
  /** saut et onde de choc : bond de `dureeMs`, à l'atterrissage tout joueur AU SOL à moins de `rayon` m prend `degats` (on l'évite en sautant) */
  saut: { dureeMs: 1_300, hauteur: 18, rayon: 32, degats: 70, portee: 60, avance: 9 },
  /** charge : il se ramasse `armeMs` puis fonce `dureeMs` en ligne droite à `vitesse` m/s et écrase tout sur son passage */
  charge: { armeMs: 800, dureeMs: 1_500, vitesse: 34, porteeMin: 30, porteeMax: 160 },
  /** pieds et ventre : un joueur sous le tigre qui marche est écrasé (m du modèle, cf. `sousLeTigre`) */
  rayonEcrase: 0.16,
} as const;

export const TITAN = {
  dureeMs: 90_000,
  pvMax: 2_500,
  /** marche du titan (m/s) */
  vitesse: 13,
  rayonCollision: 3.2,
  /** le titan est le même tigre, plus petit que le boss (m de l'arène par m du modèle : 20 m du museau au bout de la queue) */
  echelle: 18,
  rayonEcrase: 0.18,
  canon: { cadenceS: 0.12, degats: 30, portee: 320 },
  /** dash (Maj) : pointe de vitesse dans la direction des touches (ou devant), puis recharge */
  dash: { vitesse: 42, dureeMs: 320, rechargeMs: 1_600 },
  /** saut (Espace) et gravité ; il peut finir sur un toit */
  saut: { vitesse: 24, gravite: 34 },
  /** atterrissage d'au moins `chuteMin` m : tout joueur au sol à moins de `rayon` m est écrasé */
  atterrissage: { chuteMin: 3, rayon: 10 },
  /** vitesse horizontale et verticale tolérées par le serveur (m/s) */
  vitesseMaxServeur: 44, vitesseVerticaleMax: 45,
} as const;

/**
 * Échelle du tigre robot (boss) : m de l'arène par m du modèle 3D du tigre (`public/tigre/tigre.glb`, 1,104 m du museau au bout de la
 * queue). À 40 : 44 m de long, 16 m au garrot, la tête vers 21 m : il domine Agroparc et enjambe ses bâtiments.
 */
export const ECHELLE_TIGRE = 40;

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

/** Sphère de touche d'un tigre, en repère local (droite, haut, avant), en m du MODÈLE 3D (multipliées par l'échelle du monstre). */
export interface SphereForme { d: number; h: number; a: number; r: number; zone: Zone }

/**
 * Tigre robot, d'après le squelette au repos du modèle 3D (museau à +0,44 m, garrot à 0,40 m, tête à 0,54 m) : tête (zone « tete »),
 * poitrail, ventre, croupe, quatre pattes. Le titan est la même forme à `TITAN.echelle`.
 */
export const FORME_TIGRE: readonly SphereForme[] = [
  { d: 0, h: 0.47, a: 0.37, r: 0.1, zone: "tete" },
  { d: 0, h: 0.35, a: 0.17, r: 0.12, zone: "corps" },
  { d: 0, h: 0.33, a: -0.03, r: 0.12, zone: "corps" },
  { d: 0, h: 0.33, a: -0.21, r: 0.11, zone: "corps" },
  { d: -0.09, h: 0.14, a: 0.15, r: 0.055, zone: "corps" },
  { d: 0.09, h: 0.14, a: 0.15, r: 0.055, zone: "corps" },
  { d: -0.09, h: 0.15, a: -0.28, r: 0.06, zone: "corps" },
  { d: 0.09, h: 0.15, a: -0.28, r: 0.06, zone: "corps" },
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
    const ecart = 0.03 * echelle;
    if (s.zone === "tete" ? t < meilleur + ecart : t < meilleur - (zone === "tete" ? ecart : 0)) { meilleur = t; zone = s.zone; }
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

/**
 * `detour` : cap de contournement retenu tant qu'il reste dégagé (évite d'hésiter entre les deux côtés d'un bâtiment).
 * Titan seulement : `vy` vitesse verticale, `auSol`, `dash` (s de dash restantes), `recharge` (s avant le prochain dash).
 */
export interface EtatMarcheur { p: Vec3; cap: number; v: number; detour?: number; vy?: number; auSol?: boolean; dash?: number; recharge?: number }

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
 * Un pas du tigre géant : il pivote vers sa cible (rotation bornée), avance d'autant moins qu'il est de travers, s'arrête à `arret` m
 * pour frapper. Plus haut que les bâtiments, il les ENJAMBE (aucune collision, seulement les bornes de l'arène). `vitesse` / `rotation`
 * remplacent la marche (bond du saut). Sans cible, il reste sur place.
 */
export function pasTigre(
  e: EtatMarcheur, cible: Vec3 | null, dt: number, monde: Monde, _vers?: Vec3 | null,
  vitesse: number = TIGRE_ROBOT.vitesse, rotation: number = TIGRE_ROBOT.rotation,
): EtatMarcheur {
  if (!cible || !(dt > 0)) return { p: [e.p[0], e.p[1], e.p[2]], cap: e.cap, v: 0 };
  const T = TIGRE_ROBOT;
  const dist = Math.hypot(cible[0] - e.p[0], cible[2] - e.p[2]);
  const ecart = enrouler(capVers(e.p[0], e.p[2], cible[0], cible[2]) - e.cap);
  const cap = enrouler(e.cap + borne(ecart, -rotation * dt, rotation * dt));
  const alignement = Math.max(0, Math.cos(ecart));
  const v = dist > T.arret ? vitesse * alignement * alignement : 0;
  const [fx, fz] = avant(cap);
  return { p: borner(monde, e.p[0] + fx * v * dt, e.p[1], e.p[2] + fz * v * dt), cap, v };
}

/** Avance en ligne droite (charge du tigre) à `vitesse` m/s le long de son cap, dans les bornes. */
export function foncer(e: EtatMarcheur, vitesse: number, dt: number, monde: Monde): EtatMarcheur {
  const [fx, fz] = avant(e.cap);
  return { p: borner(monde, e.p[0] + fx * vitesse * dt, e.p[1], e.p[2] + fz * vitesse * dt), cap: e.cap, v: vitesse };
}

/** Hauteur du bond du tigre (m) au temps `k` ∈ [0, 1] du saut : parabole. */
export function hauteurSaut(k: number): number {
  const x = borne(k, 0, 1);
  return 4 * TIGRE_ROBOT.saut.hauteur * x * (1 - x);
}

function borner(monde: Monde, x: number, y: number, z: number): Vec3 {
  const b = monde.bornes, m = 10;
  return [borne(x, b.x0 + m, b.x1 - m), y, borne(z, b.z0 + m, b.z1 - m)];
}

/** Bout du museau au sol (point de départ du coup de patte). */
export function museau(e: EtatMarcheur, echelle: number = ECHELLE_TIGRE): Vec3 {
  return pointLocal(e.p, e.cap, echelle, 0, 0, 0.44);
}
/** Yeux du tigre (origine du laser). */
export function yeuxTigre(e: EtatMarcheur, echelle: number = ECHELLE_TIGRE): Vec3 {
  return pointLocal(e.p, e.cap, echelle, 0, 0.5, 0.4);
}

/** Le joueur est-il dans le balayage du coup de patte (devant le tigre, à portée) ? */
export function dansCoupDePatte(e: EtatMarcheur, p: Vec3): boolean {
  const T = TIGRE_ROBOT.patte;
  const dx = p[0] - e.p[0], dz = p[2] - e.p[2];
  const dist = Math.hypot(dx, dz);
  if (dist > T.portee || p[1] - e.p[1] > 0.3 * ECHELLE_TIGRE) return false;
  if (dist < 1e-6) return true;
  const [fx, fz] = avant(e.cap);
  return (dx * fx + dz * fz) / dist >= T.cosMin;
}

/** Le joueur est-il sous le corps du tigre (écrasé s'il marche) ? */
export function sousLeTigre(e: EtatMarcheur, p: Vec3, echelle: number = ECHELLE_TIGRE, rayon: number = TIGRE_ROBOT.rayonEcrase): boolean {
  // pieds du joueur entre le sol sous le monstre et son ventre (il saute ou il est sur un toit : épargné)
  if (p[1] - e.p[1] > 0.25 * echelle || p[1] < e.p[1] - 1.5) return false;
  const [fx, fz] = avant(e.cap);
  // deux disques sous le corps (pattes avant et arrière), en m du modèle
  for (const a of [0.13, -0.22]) {
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

/**
 * Entrées du pilote : avant/arrière, gauche/droite (−1..1), lacet de la vue (le titan regarde où regarde le pilote), et deux impulsions
 * (front montant) : `dash` (Maj) et `saut` (Espace).
 */
export interface EntreesTitan { avant: number; droite: number; lacet: number; dash?: boolean; saut?: boolean }

/**
 * Un pas du titan (client du pilote) : marche dans le repère de la vue, dash (pointe de vitesse dans la direction des touches, sinon
 * devant), saut avec gravité ; il glisse le long des murs, se pose sur un toit (`solSous`) et retombe dans le vide en quittant le toit.
 */
export function pasTitan(e: EtatMarcheur, en: EntreesTitan, dt: number, monde: Monde): EtatMarcheur {
  const T = TITAN;
  const cap = enrouler(en.lacet);
  if (!(dt > 0)) return { ...e, p: [e.p[0], e.p[1], e.p[2]], cap, v: 0 };
  let ax = borne(Number.isFinite(en.avant) ? en.avant : 0, -1, 1), dr = borne(Number.isFinite(en.droite) ? en.droite : 0, -1, 1);
  const n = Math.hypot(ax, dr);
  if (n > 1) { ax /= n; dr /= n; }
  const [fx, fz] = avant(cap), [rx, rz] = droite(cap);
  let dash = Math.max(0, (e.dash ?? 0) - dt);
  let recharge = Math.max(0, (e.recharge ?? 0) - dt);
  if (en.dash && recharge <= 0) { dash = T.dash.dureeMs / 1000; recharge = T.dash.rechargeMs / 1000; }
  let vx = (fx * ax + rx * dr) * T.vitesse, vz = (fz * ax + rz * dr) * T.vitesse;
  if (dash > 0) {
    // dash : dans la direction des touches, sinon droit devant
    const dx = n > 0.01 ? fx * ax + rx * dr : fx, dz = n > 0.01 ? fz * ax + rz * dr : fz;
    const l = Math.hypot(dx, dz) || 1;
    vx = (dx / l) * T.dash.vitesse; vz = (dz / l) * T.dash.vitesse;
  }
  let vy = e.vy ?? 0;
  let auSol = e.auSol ?? true;
  if (en.saut && auSol) { vy = T.saut.vitesse; auSol = false; }
  vy -= T.saut.gravite * dt;
  let y = e.p[1] + vy * dt;
  const r = resoudre(monde, [e.p[0] + vx * dt, Math.max(0, e.p[1]), e.p[2] + vz * dt], T.rayonCollision, 8);
  const sol = solSous(monde, r.p[0], r.p[2], Math.max(e.p[1], y) + 0.01, 0.6);
  if (y <= sol) { y = sol; vy = 0; auSol = true; } else auSol = false;
  const v = Math.hypot(r.p[0] - e.p[0], r.p[2] - e.p[2]) / dt;
  return { p: [r.p[0], y, r.p[2]], cap, v: ax < 0 && dash <= 0 ? -v : v, vy, auSol, dash, recharge };
}

/** Œil du pilote (canon et caméra). */
export function oeilTitan(p: Vec3): Vec3 {
  return [p[0], p[1] + OEIL_TITAN, p[2]];
}
