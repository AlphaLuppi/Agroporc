/**
 * Avion et chute du mode Battle Royale (PUR : ni horloge ni hasard globaux, `alea` injecté, aucun import de three ni du DOM).
 * Utilisé à l'identique par le serveur (autorité, `match-br-vol.ts`) et par le client (prédiction, `jeu-br.ts`) : `pasChute` avance la
 * chute d'UN pas fixe de `CHUTE_BR.pas`, sans effet de bord. Repère de scene.json : x est, z sud, y haut ; `lacet` 0 regarde vers −z,
 * l'avant vaut (−sin lacet, −cos lacet), la droite (cos lacet, −sin lacet) ; `tangage` positif = regard vers le haut.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (Avion, Chute libre et parachute)
 */
import { resoudre, solSous, type Boite, type Monde } from "./collision";
import type { AvionBr, Vec3 } from "./protocole";

export type { AvionBr } from "./protocole";

export const AVION_BR = {
  /** altitude de l'avion (m) ; `y ≤ 400` est la borne de `Salle.recevoirEtat` */
  altitude: 350,
  /** vitesse de croisière (m/s) : le trajet de 450 à 740 m dure 15 à 25 s */
  vitesse: 30,
  /** longueur minimale du trajet dans les bornes (m) */
  longueurMinM: 450,
  /** la droite passe à un point tiré dans un disque de ce rayon autour du centre des bornes (m) */
  rayonDecalageM: 110,
  /** tirages de cap avant le repli sur l'axe long de la carte */
  tiragesMax: 20,
} as const;

export const CHUTE_BR = {
  /** pas fixe de la simulation (s) : 60 Hz */
  pas: 1 / 60,
  /** pas au plus par appel de `pasDuTemps` : le temps en retard au-delà est perdu, jamais rattrapé en rafale */
  pasMaxParAppel: 6,
  /** chute libre : vitesse verticale cible de −35 (regard à l'horizon) à −55 m/s (piqué), horizontale de 30 à 6 m/s */
  libre: { vyHorizon: -35, vyPique: -55, accV: 20, vhHorizon: 30, vhPique: 6, accH: 14, tangagePiqueRad: Math.PI / 3 },
  /** parachute : −6,5 m/s (rattrapé en `ouvertureMs` à 40 m/s²), 14 m/s horizontaux au plus */
  voile: { vy: -6.5, accV: 40, vhMax: 14, accH: 8, ouvertureMs: 1_200 },
  /** le parachute s'ouvre seul sous cette hauteur au-dessus du sol (un toit compte comme sol) */
  hauteurOuvertureAutoM: 90,
  /** une ouverture manuelle est refusée avant ce délai après le saut (le même appui qui quitte l'avion n'ouvre pas) */
  delaiOuvertureMinMs: 1_000,
  /** cylindre du joueur pour les murs, et marge de l'atterrissage sur un toit (m) */
  rayon: 0.4,
  hauteur: 1.8,
  margeAtterrissageM: 0.5,
} as const;

type Vec2 = [number, number];

/** Segment de la droite (p + s·u) à l'intérieur de `b` : bornes de s, ou null si elle ne le traverse pas. */
function couperDroite(p: Vec2, u: Vec2, b: Boite): { sMin: number; sMax: number } | null {
  let sMin = -Infinity, sMax = Infinity;
  const axe = (po: number, uo: number, a: number, c: number): boolean => {
    if (Math.abs(uo) < 1e-12) return po >= a && po <= c;
    let s0 = (a - po) / uo, s1 = (c - po) / uo;
    if (s0 > s1) [s0, s1] = [s1, s0];
    sMin = Math.max(sMin, s0);
    sMax = Math.min(sMax, s1);
    return true;
  };
  if (!axe(p[0], u[0], b.x0, b.x1) || !axe(p[1], u[1], b.z0, b.z1)) return null;
  return sMax > sMin ? { sMin, sMax } : null;
}

/**
 * Trajet de l'avion : cap uniforme, droite passant par un point du disque de 110 m autour du centre des `bornes`, coupée à leurs bords,
 * d'au moins `longueurMinM` (jusqu'à 20 tirages ; repli : axe long de la carte par le centre). `debutT` = départ (ms serveur) ; avant,
 * l'avion est immobile au point de départ. `o.dureeMs` fixe la durée du trajet (essais : la vitesse en découle), `o.altitude` l'altitude.
 */
export function tracerVolBr(bornes: Boite, alea: () => number, debutT: number, o: { altitude?: number; dureeMs?: number } = {}): AvionBr {
  const cx = (bornes.x0 + bornes.x1) / 2, cz = (bornes.z0 + bornes.z1) / 2;
  let depart: Vec2 | null = null, arrivee: Vec2 | null = null;
  for (let i = 0; i < AVION_BR.tiragesMax && !depart; i++) {
    const cap = alea() * 2 * Math.PI;
    const r = AVION_BR.rayonDecalageM * Math.sqrt(alea()), a = alea() * 2 * Math.PI;
    const p: Vec2 = [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    const u: Vec2 = [Math.cos(cap), Math.sin(cap)];
    const seg = couperDroite(p, u, bornes);
    if (seg && seg.sMax - seg.sMin >= AVION_BR.longueurMinM) {
      depart = [p[0] + u[0] * seg.sMin, p[1] + u[1] * seg.sMin];
      arrivee = [p[0] + u[0] * seg.sMax, p[1] + u[1] * seg.sMax];
    }
  }
  if (!depart || !arrivee) {
    // repli : l'axe long de la carte, par le centre
    if (bornes.x1 - bornes.x0 >= bornes.z1 - bornes.z0) { depart = [bornes.x0, cz]; arrivee = [bornes.x1, cz]; }
    else { depart = [cx, bornes.z0]; arrivee = [cx, bornes.z1]; }
  }
  const longueur = Math.hypot(arrivee[0] - depart[0], arrivee[1] - depart[1]);
  const vitesse = o.dureeMs !== undefined && o.dureeMs > 0 && longueur > 0 ? longueur / (o.dureeMs / 1000) : AVION_BR.vitesse;
  return {
    depart, arrivee, altitude: o.altitude ?? AVION_BR.altitude, vitesse,
    debutT, finT: debutT + (longueur / vitesse) * 1000,
  };
}

/** Position de l'avion à l'instant `t` (ms serveur) : à l'arrêt au départ avant `debutT`, à l'arrivée après `finT`. */
export function positionAvionBr(a: AvionBr, t: number): Vec3 {
  const k = a.finT > a.debutT ? Math.min(1, Math.max(0, (t - a.debutT) / (a.finT - a.debutT))) : 0;
  return [a.depart[0] + (a.arrivee[0] - a.depart[0]) * k, a.altitude, a.depart[1] + (a.arrivee[1] - a.depart[1]) * k];
}

/** Lacet de l'avion (convention du jeu : 0 regarde vers −z, l'avant est (−sin, −cos)). */
export function capAvionBr(a: AvionBr): number {
  return Math.atan2(-(a.arrivee[0] - a.depart[0]), -(a.arrivee[1] - a.depart[1]));
}

/** Vitesse de croisière de l'avion (m/s) : celle d'un joueur qui saute en vol. */
export function vitesseAvionBr(a: AvionBr): Vec3 {
  const dx = a.arrivee[0] - a.depart[0], dz = a.arrivee[1] - a.depart[1];
  const l = Math.hypot(dx, dz);
  return l > 0 ? [(dx / l) * a.vitesse, 0, (dz / l) * a.vitesse] : [0, 0, 0];
}

export interface EtatChute {
  p: Vec3; v: Vec3;
  /** parachute ouvert (ne se referme pas) */
  voile: boolean;
  /** secondes depuis l'ouverture du parachute (animation de la voile), 0 tant qu'il est fermé */
  tVoile: number;
  /** secondes depuis le saut */
  tLibre: number;
  atterri: boolean;
}

/** Entrées d'un pas : regard, déplacement (`avance`, `lateral` dans [−1, 1]) et demande d'ouverture du parachute. */
export interface EntreesChute { lacet: number; tangage: number; avance: number; lateral: number; ouvrir: boolean }

const cm = (x: number): number => Math.round(x * 100) / 100;

/** État au saut : position et vitesse arrondies au centimètre, pour que client et serveur partent de la même valeur. */
export function etatChuteInitial(p: Vec3, v: Vec3): EtatChute {
  return { p: [cm(p[0]), cm(p[1]), cm(p[2])], v: [cm(v[0]), cm(v[1]), cm(v[2])], voile: false, tVoile: 0, tLibre: 0, atterri: false };
}

/** Hauteur des pieds au-dessus du sol (m) : un toit sous le point compte comme sol. */
export function hauteurAuSol(monde: Monde, p: Vec3): number {
  return p[1] - solSous(monde, p[0], p[2], p[1], CHUTE_BR.margeAtterrissageM);
}

const fini = (x: number): number => (Number.isFinite(x) ? x : 0);
const borne = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** Rapproche `v` de `cible` d'au plus `max`. */
function approcher(v: number, cible: number, max: number): number {
  const d = cible - v;
  return Math.abs(d) <= max ? cible : v + Math.sign(d) * max;
}

/**
 * UN pas fixe (`CHUTE_BR.pas`). Horizontal : la vitesse se rapproche de (avance · avant + lateral · droite) normalisé × vhMax ; vertical :
 * de la vitesse cible du piqué (−35 à −55 m/s selon le tangage) ou de la voile (−6,5 m/s). L'ouverture est manuelle (`ouvrir`, refusée
 * avant `delaiOuvertureMinMs`) ou automatique sous `hauteurOuvertureAutoM`. Les murs passent par `resoudre` ; l'atterrissage est balayé
 * (sol, ou toit dont la hauteur est sous les pieds du pas précédent à `margeAtterrissageM` près : à 55 m/s un pas fait près d'un mètre).
 * Aucun dégât de chute : le joueur touche, `atterri` devient vrai, `p[1]` est le sol et la vitesse est nulle.
 */
export function pasChute(e: EtatChute, en: EntreesChute, monde: Monde): EtatChute {
  if (e.atterri) return { ...e, p: [...e.p], v: [0, 0, 0] };
  const dt = CHUTE_BR.pas;
  const L = CHUTE_BR.libre, V = CHUTE_BR.voile;

  // ouverture du parachute : jamais refermé
  let voile = e.voile;
  let tVoile = e.tVoile;
  if (!voile) {
    const manuelle = en.ouvrir && e.tLibre + 1e-9 >= CHUTE_BR.delaiOuvertureMinMs / 1000;
    if (manuelle || hauteurAuSol(monde, e.p) < CHUTE_BR.hauteurOuvertureAutoM) { voile = true; tVoile = 0; }
  }

  // vitesses cibles
  let vyCible: number, vhMax: number, accV: number, accH: number;
  if (voile) { vyCible = V.vy; vhMax = V.vhMax; accV = V.accV; accH = V.accH; }
  else {
    const t = borne(-fini(en.tangage) / L.tangagePiqueRad, 0, 1);
    vyCible = L.vyHorizon + (L.vyPique - L.vyHorizon) * t;
    vhMax = L.vhHorizon + (L.vhPique - L.vhHorizon) * t;
    accV = L.accV; accH = L.accH;
  }
  const lacet = fini(en.lacet), avance = borne(fini(en.avance), -1, 1), lateral = borne(fini(en.lateral), -1, 1);
  const sl = Math.sin(lacet), cl = Math.cos(lacet);
  let wx = -sl * avance + cl * lateral, wz = -cl * avance - sl * lateral;
  const n = Math.hypot(wx, wz);
  if (n > 1) { wx /= n; wz /= n; }
  const cibleX = wx * vhMax, cibleZ = wz * vhMax;

  // vitesse : le vecteur horizontal se rapproche de sa cible (accélération bornée en norme), le vertical aussi
  const dx = cibleX - e.v[0], dz = cibleZ - e.v[2];
  const dn = Math.hypot(dx, dz), pasH = accH * dt;
  let vx: number, vz: number;
  if (dn <= pasH) { vx = cibleX; vz = cibleZ; } else { vx = e.v[0] + (dx / dn) * pasH; vz = e.v[2] + (dz / dn) * pasH; }
  let vy = approcher(e.v[1], vyCible, accV * dt);

  // murs : horizontal d'abord, à la hauteur du pas précédent
  const yAvant = e.p[1];
  const r = resoudre(monde, [e.p[0] + vx * dt, yAvant, e.p[2] + vz * dt], CHUTE_BR.rayon, CHUTE_BR.hauteur);
  for (const c of r.contacts) {
    const vn = vx * c.nx + vz * c.nz;
    if (vn < 0) { vx -= vn * c.nx; vz -= vn * c.nz; }
  }
  const x = r.p[0], z = r.p[2];

  // vertical et atterrissage (balayé : le sol ou le toit atteint pendant le pas)
  const y = yAvant + vy * dt;
  const sol = solSous(monde, x, z, yAvant, CHUTE_BR.margeAtterrissageM);
  if (y <= sol) {
    return { p: [x, sol, z], v: [0, 0, 0], voile, tVoile: voile ? tVoile + dt : 0, tLibre: e.tLibre + dt, atterri: true };
  }
  return { p: [x, y, z], v: [vx, vy, vz], voile, tVoile: voile ? tVoile + dt : 0, tLibre: e.tLibre + dt, atterri: false };
}

/**
 * Temps écoulé -> nombre de pas fixes. `dtMs` s'ajoute au `reste` (ms) ; au plus `pasMaxParAppel` pas : au-delà, le temps en retard est
 * perdu (le reste ne garde que la fraction de pas), jamais rattrapé en rafale.
 */
export function pasDuTemps(dtMs: number, reste: number): { pas: number; reste: number } {
  const unPas = CHUTE_BR.pas * 1000;
  const total = Math.max(0, fini(reste)) + Math.max(0, fini(dtMs));
  const entiers = Math.floor(total / unPas + 1e-9);
  if (entiers > CHUTE_BR.pasMaxParAppel) return { pas: CHUTE_BR.pasMaxParAppel, reste: Math.max(0, total - entiers * unPas) };
  return { pas: entiers, reste: Math.max(0, total - entiers * unPas) };
}
