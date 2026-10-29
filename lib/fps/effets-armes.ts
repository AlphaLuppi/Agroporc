/**
 * Effets des armes du mode zombies (PUR : ni three, ni DOM, ni hasard ; partagé par le client et le serveur, testé), v8.
 *
 * Le Pack-a-Punch de BO1 ne fait pas que doubler les dégâts : il change l'arme. Les profils (`ProfilZombie` de armes.ts) décrivent les effets,
 * ce module les calcule :
 *  - ricochets : la balle rebondit sur les murs, les toits et le sol (`segmentsRicochet`) ; le client déclare la touche avec l'index du
 *    segment, le serveur rejoue EXACTEMENT les mêmes segments (même monde, même axe) avant de valider la touche ;
 *  - arc électrique : depuis le premier tigre touché, l'arc saute au plus proche tigre en vue, de proche en proche (`chaineArc`) ;
 *  - brûlure : un tigre touché par une munition incendiaire perd des PV par pas de 0,5 s (`allumer`, `ticBrulures`) ;
 *  - gel : un tigre touché qui survit ralentit quelques secondes (`geler`, `degeler`) ;
 *  - souffle en cône de la Soufflerie : `dansSouffle` (cône tronqué le long de la visée) ;
 *  - projectiles (Moutarde & Sally, Brochette) : le moteur balistique des grenades (`simulerTrajectoire` de grenades.ts, percussion) avec le
 *    profil de l'arme (`profilProjectile`), calculé une fois par le serveur au tir ; le client recalcule la même trajectoire (sans les tigres,
 *    coupée à `impactT` que le serveur diffuse) et la dessine.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (complément « armes », lot zr/armes).
 */
import { lancerRayon, normaleImpact, visible, type Monde } from "./collision";
import { positionTrajectoire, simulerTrajectoire, type OptionsTrajectoire, type ProfilGrenade, type Trajectoire } from "./grenades";
import { profilZombie, type ArcElectrique, type Brulure, type Gel, type ProjectileArme, type SouffleCone } from "./armes";
import type { ArmeFeuId, Vec3 } from "./protocole";

const EPS = 1e-3;

// ---------------------------------------------------------------------------------------------
// ricochets
// ---------------------------------------------------------------------------------------------

/** Tronçon d'une balle : origine, direction (normalisée), longueur (m) et distance déjà parcourue depuis la bouche (`debut`). */
export interface SegmentTir { o: Vec3; d: Vec3; longueur: number; debut: number }

/**
 * Tronçons d'une balle qui ricoche `rebonds` fois au plus (premier obstacle : mur ou toit d'un prisme, ou le sol y = 0) sur `portee` m en
 * tout. Le premier tronçon est le tir lui-même. Au contact, la direction est réfléchie sur la normale de la surface ; une balle qui ne
 * touche rien avant la portée s'arrête là. Déterministe : client et serveur obtiennent les mêmes tronçons avec le même monde.
 */
export function segmentsRicochet(monde: Monde, o: Vec3, d: Vec3, portee: number, rebonds: number): SegmentTir[] {
  const l0 = Math.hypot(d[0], d[1], d[2]) || 1;
  let dir: Vec3 = [d[0] / l0, d[1] / l0, d[2] / l0];
  let p: Vec3 = [o[0], o[1], o[2]];
  let reste = Math.max(0, portee);
  let parcouru = 0;
  const res: SegmentTir[] = [];
  const n = Math.max(0, Math.min(3, Math.floor(rebonds)));
  for (let k = 0; k <= n && reste > EPS; k++) {
    let s = lancerRayon(monde, p, dir, reste);
    let normale: Vec3 | null = null;
    if (dir[1] < -1e-6 && p[1] > 0) {
      const sSol = p[1] / -dir[1];
      if (sSol < s && sSol <= reste) { s = sSol; normale = [0, 1, 0]; }
    }
    if (!(s <= reste)) {
      res.push({ o: p, d: dir, longueur: reste, debut: parcouru });
      break;
    }
    res.push({ o: p, d: dir, longueur: s, debut: parcouru });
    const c: Vec3 = [p[0] + dir[0] * s, p[1] + dir[1] * s, p[2] + dir[2] * s];
    normale ??= normaleImpact(monde, c, p);
    const vn = dir[0] * normale[0] + dir[1] * normale[1] + dir[2] * normale[2];
    dir = [dir[0] - 2 * vn * normale[0], dir[1] - 2 * vn * normale[1], dir[2] - 2 * vn * normale[2]];
    const ln = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir = [dir[0] / ln, dir[1] / ln, dir[2] / ln];
    p = [c[0] + normale[0] * 0.02, Math.max(0.02, c[1] + normale[1] * 0.02), c[2] + normale[2] * 0.02];
    parcouru += s;
    reste -= s;
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// arc électrique
// ---------------------------------------------------------------------------------------------

export interface CibleArc { id: number; p: Vec3 }

/** Hauteur (m) des points d'accroche de l'arc sur un tigre (son dos) et de la ligne de vue entre deux tigres. */
export const HAUTEUR_ARC_M = 0.8;

/**
 * Chaîne de l'arc électrique : `depart` puis, de proche en proche, le tigre le plus proche du dernier atteint (pas encore dans la chaîne,
 * à moins de `arc.rayon` m, en vue à `HAUTEUR_ARC_M` si `monde` est donné), `arc.sauts` fois au plus. Égalités départagées par l'id.
 */
export function chaineArc(depart: CibleArc, candidats: readonly CibleArc[], arc: Pick<ArcElectrique, "sauts" | "rayon">, monde?: Monde): CibleArc[] {
  const chaine: CibleArc[] = [depart];
  const pris = new Set<number>([depart.id]);
  let dernier = depart;
  for (let s = 0; s < arc.sauts; s++) {
    let meilleur: CibleArc | null = null;
    let dMeilleur = Infinity;
    for (const c of candidats) {
      if (pris.has(c.id)) continue;
      const d = Math.hypot(c.p[0] - dernier.p[0], c.p[2] - dernier.p[2]);
      if (d > arc.rayon || d > dMeilleur || (d === dMeilleur && meilleur && c.id > meilleur.id)) continue;
      if (monde && !visible(monde, [dernier.p[0], HAUTEUR_ARC_M, dernier.p[2]], [c.p[0], HAUTEUR_ARC_M, c.p[2]])) continue;
      meilleur = c;
      dMeilleur = d;
    }
    if (!meilleur) break;
    chaine.push(meilleur);
    pris.add(meilleur.id);
    dernier = meilleur;
  }
  return chaine;
}

// ---------------------------------------------------------------------------------------------
// brûlure, gel
// ---------------------------------------------------------------------------------------------

/** Un tigre en feu : fin, prochain pas de dégâts (ms serveur), PV par seconde, joueur crédité. */
export interface EtatBrulure { finT: number; prochainT: number; dps: number; par: string }
/** Pas des dégâts de brûlure (ms). */
export const PAS_BRULURE_MS = 500;

/** Allume (ou ravive) la brûlure du tigre `id` : la fin est repoussée, le plus fort `dps` l'emporte, le dernier tireur est crédité. */
export function allumer(brulures: Map<number, EtatBrulure>, id: number, b: Brulure, par: string, t: number): void {
  const fin = t + b.dureeS * 1000;
  const e = brulures.get(id);
  if (e) { e.finT = Math.max(e.finT, fin); e.dps = Math.max(e.dps, b.dps); e.par = par; return; }
  brulures.set(id, { finT: fin, prochainT: t + PAS_BRULURE_MS, dps: b.dps, par });
}

/**
 * Pas de brûlure échus à l'instant `t` : un pas de `dps × 0,5 s` par tranche de 0,5 s écoulée (un tic en retard rattrape ses pas), tant que
 * la brûlure n'est pas finie ; les tigres disparus (`vivant` faux) et les brûlures finies sont oubliés.
 */
export function ticBrulures(brulures: Map<number, EtatBrulure>, t: number, vivant: (id: number) => boolean): { id: number; degats: number; par: string }[] {
  const res: { id: number; degats: number; par: string }[] = [];
  for (const [id, e] of brulures) {
    if (!vivant(id)) { brulures.delete(id); continue; }
    let degats = 0;
    while (e.prochainT <= t && e.prochainT <= e.finT) { degats += (e.dps * PAS_BRULURE_MS) / 1000; e.prochainT += PAS_BRULURE_MS; }
    if (degats > 0) res.push({ id, degats: Math.round(degats), par: e.par });
    if (e.prochainT > e.finT) brulures.delete(id);
  }
  return res;
}

/** Un tigre gelé : fin (ms serveur), vitesse avant le gel et vitesse imposée (pour ne pas écraser un autre changement d'allure). */
export interface EtatGel { finT: number; vitesseAvant: number; vitesseGel: number }

/** Gèle (ou prolonge) : renvoie la vitesse à imposer, ou null s'il est déjà gelé (seule la fin est repoussée). */
export function geler(gels: Map<number, EtatGel>, id: number, vitesse: number, g: Gel, t: number): number | null {
  const e = gels.get(id);
  if (e) { e.finT = Math.max(e.finT, t + g.dureeS * 1000); return null; }
  const vitesseGel = vitesse * g.facteur;
  gels.set(id, { finT: t + g.dureeS * 1000, vitesseAvant: vitesse, vitesseGel });
  return vitesseGel;
}

/**
 * Gels finis à `t` : id et vitesse à rendre (seulement si la vitesse du tigre est toujours celle du gel : un autre effet, le dernier tigre
 * qui sprinte par exemple, a la priorité). Les tigres disparus sont oubliés.
 */
export function degeler(gels: Map<number, EtatGel>, t: number, vitesseDe: (id: number) => number | undefined): { id: number; vitesse: number }[] {
  const res: { id: number; vitesse: number }[] = [];
  for (const [id, e] of gels) {
    const v = vitesseDe(id);
    if (v === undefined) { gels.delete(id); continue; }
    if (t < e.finT) continue;
    gels.delete(id);
    if (Math.abs(v - e.vitesseGel) < 1e-6) res.push({ id, vitesse: e.vitesseAvant });
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// souffle en cône (Soufflerie)
// ---------------------------------------------------------------------------------------------

/**
 * Le point `p` est-il dans le souffle tiré de `o` vers `d` (normalisée) ? Renvoie la distance le long de l'axe (m), ou null : derrière,
 * au-delà de la portée, ou hors du cône tronqué (rayon `rayonDebut` à l'œil, `rayonFin` à la portée).
 */
export function dansSouffle(o: Vec3, d: Vec3, p: Vec3, s: SouffleCone): number | null {
  const vx = p[0] - o[0], vy = p[1] - o[1], vz = p[2] - o[2];
  const a = vx * d[0] + vy * d[1] + vz * d[2];
  if (a < 0 || a > s.portee) return null;
  const rx = vx - a * d[0], ry = vy - a * d[1], rz = vz - a * d[2];
  const r = Math.hypot(rx, ry, rz);
  const rMax = s.rayonDebut + ((s.rayonFin - s.rayonDebut) * a) / s.portee;
  return r <= rMax ? a : null;
}

// ---------------------------------------------------------------------------------------------
// projectiles
// ---------------------------------------------------------------------------------------------

/** Profil balistique (grenades.ts) d'un projectile d'arme : à percussion, sans rebond, sans coup de pouce vers le haut. */
export function profilProjectile(p: ProjectileArme): ProfilGrenade {
  return {
    vitesse: p.vitesse, bonusHaut: 0, gravite: p.gravite, rebond: 0, frottement: 0, roulement: 0, rayonObjet: p.rayonObjet, vitesseArret: 0,
    mecheMs: p.delaiMs, cuisson: false, percussion: true, rayonM: 0, degatsCentre: 0, degatsBord: 0, degatsLanceurMax: 0,
    attractionM: p.attractionM ?? 0, volMaxMs: p.vieMs,
  };
}

/** Projectile de l'arme (amélioré ou non), undefined si elle tire des balles. */
export const projectileDe = (arme: ArmeFeuId, ameliore: boolean): ProjectileArme | undefined => profilZombie(arme, ameliore).projectile;

/** Un projectile tiré : trajectoire, impact (ms serveur : contact ou fin du vol), explosion (impact + délai de l'arme). */
export interface TirProjectile {
  arme: ArmeFeuId;
  ameliore: boolean;
  o: Vec3;
  v: Vec3;
  t0: number;
  impactT: number;
  explosionT: number;
  traj: Trajectoire;
  /** a touché quelque chose (mur, sol, tigre) avant la fin du vol */
  contact: boolean;
}

/** Vitesse de départ d'un projectile de l'arme le long de `d`. */
export function vitesseProjectile(p: ProjectileArme, d: Vec3): Vec3 {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [(d[0] / l) * p.vitesse, (d[1] / l) * p.vitesse, (d[2] / l) * p.vitesse];
}

/**
 * Tir d'un projectile depuis `o` le long de `d` à l'instant `t0` (null pour une arme à balles). Le serveur passe `opts.arret` (les tigres) ;
 * le client ne le connaît pas et recalcule la trajectoire avec `trajectoireProjectile`, coupée à l'`impactT` du serveur.
 */
export function preparerProjectile(
  monde: Monde, arme: ArmeFeuId, ameliore: boolean, o: Vec3, d: Vec3, t0: number, opts: OptionsTrajectoire = {},
): TirProjectile | null {
  const p = projectileDe(arme, ameliore);
  if (!p) return null;
  const v = vitesseProjectile(p, d);
  const traj = simulerTrajectoire(monde, profilProjectile(p), o, v, p.vieMs, opts);
  const impactMs = Math.min(traj.arretMs, p.vieMs);
  return { arme, ameliore, o, v, t0, impactT: t0 + impactMs, explosionT: t0 + impactMs + p.delaiMs, traj, contact: traj.contact };
}

/** Trajectoire d'un projectile diffusé par le serveur (`projectile{arme, ameliore, o, v}`), sans les tigres : identique jusqu'à l'impact. */
export function trajectoireProjectile(monde: Monde, m: { arme: ArmeFeuId; ameliore?: boolean; o: Vec3; v: Vec3 }, opts: OptionsTrajectoire = {}): Trajectoire | null {
  const p = projectileDe(m.arme, m.ameliore === true);
  if (!p) return null;
  return simulerTrajectoire(monde, profilProjectile(p), m.o, m.v, p.vieMs, { plafond: opts.plafond });
}

/**
 * Position du projectile à l'instant serveur `t` : il vole jusqu'à `impactT`, puis reste planté là. `impact` (le point d'arrêt diffusé par le
 * serveur) corrige le dernier pas d'intégration : un arrêt sur un tigre tombe au milieu d'un pas, que le client ne peut pas recalculer.
 */
export function positionProjectile(traj: Trajectoire, t0: number, impactT: number, t: number, impact?: Vec3): Vec3 {
  if (impact && t >= impactT) return [impact[0], impact[1], impact[2]];
  return positionTrajectoire(traj, Math.min(t, impactT) - t0);
}

/** Point d'arrêt d'un tir (dernier point de sa trajectoire). */
export function pointImpact(tir: TirProjectile): Vec3 {
  const P = tir.traj.points, n = P.length;
  return [P[n - 3], P[n - 2], P[n - 1]];
}

/**
 * Fraction [0, 1] du segment a → b où il entre dans la sphère (c, r), null s'il la manque (arrêt des projectiles sur un tigre, serveur).
 * Un segment qui part de l'intérieur touche à 0.
 */
export function fractionSphere(a: Vec3, b: Vec3, c: Vec3, r: number): number | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const fx = a[0] - c[0], fy = a[1] - c[1], fz = a[2] - c[2];
  const A = dx * dx + dy * dy + dz * dz;
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C <= 0) return 0;
  if (A < 1e-12) return null;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const k = (-B - Math.sqrt(disc)) / (2 * A);
  return k >= 0 && k <= 1 ? k : null;
}
