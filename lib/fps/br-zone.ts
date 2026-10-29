/**
 * Zone (tempête) du Battle Royale (PUR : ni horloge ni hasard global, les instants et `alea` sont injectés).
 * La zone est une suite de cercles emboîtés tirés à l'avance par `genererPlanZone` ; `etatZone` en donne l'état à un instant (source unique
 * côté serveur), `zoneBrPublique` / `etatDepuisZoneBr` portent cet état dans le message et le reconstruisent à l'identique côté client.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Zone (tempête) »)
 */
import type { Boite } from "./collision";
import type { ZoneBr } from "./protocole";

export interface PalierZone { rayon: number; attenteMs: number; retreciMs: number; degatsParS: number }

/** Les six paliers (échelle de durée 1) : rayon cible, attente, rétrécissement, dégâts hors zone. Total 535 s. */
export const PALIERS_ZONE: readonly PalierZone[] = Object.freeze([
  { rayon: 250, attenteMs: 120_000, retreciMs: 60_000, degatsParS: 1 },
  { rayon: 150, attenteMs: 60_000, retreciMs: 45_000, degatsParS: 2 },
  { rayon: 85, attenteMs: 45_000, retreciMs: 40_000, degatsParS: 4 },
  { rayon: 45, attenteMs: 40_000, retreciMs: 30_000, degatsParS: 7 },
  { rayon: 20, attenteMs: 30_000, retreciMs: 25_000, degatsParS: 10 },
  { rayon: 0, attenteMs: 20_000, retreciMs: 20_000, degatsParS: 15 },
].map((p) => Object.freeze(p)));

export interface Cercle { c: [number, number]; r: number }
/** `cercles[0]` = cercle initial, `cercles[i]` = cible du palier i ; `paliers` porte déjà les durées à l'échelle choisie. */
export interface PlanZone { debutT: number; cercles: Cercle[]; paliers: readonly PalierZone[] }
export interface EtatZone {
  /** 1..nbPaliers, nbPaliers une fois la zone fermée */
  palier: number;
  phase: "attente" | "retrecit" | "fermee";
  centre: [number, number];
  rayon: number;
  /** cercle visé (null une fois fermée) */
  cible: Cercle | null;
  /** début d'attente, début du rétrécissement, fin du rétrécissement (ms serveur) */
  t0: number; t1: number; t2: number;
  degatsParS: number;
}

/** Les tirages du centre : part biaisée vers un bâtiment creux, bruit de ce bâtiment (m), tentatives du tirage uniforme. */
const PART_BIAISEE = 0.6;
const BRUIT_BATIMENT_M = 15;
const TENTATIVES = 40;
/** marge ajoutée à la demi-diagonale pour que les quatre coins soient dans la zone dès le départ */
const MARGE_INITIALE_M = 10;

/** Rayon du premier cercle : demi-diagonale des bornes + 10 m (personne n'est hors zone au départ, coins compris). */
export const rayonInitialPour = (bornes: Boite): number =>
  Math.hypot(bornes.x1 - bornes.x0, bornes.z1 - bornes.z0) / 2 + MARGE_INITIALE_M;

/** 0,6 pour 2 à 4 joueurs, 0,8 jusqu'à 10, 1,0 au-delà : la tempête presse les petites parties (attente du palier 1 ≥ 70 s dans tous les cas). */
export const echelleDureeZone = (nbAdmis: number): number => (nbAdmis <= 4 ? 0.6 : nbAdmis <= 10 ? 0.8 : 1);

const centreBornes = (b: Boite): [number, number] => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];

/** Intervalle [min, max] de l'axe rétréci de `marge` de chaque côté ; vide : réduit au milieu. */
function intervalle(min: number, max: number, marge: number): [number, number] {
  const a = min + marge;
  const b = max - marge;
  if (a <= b) return [a, b];
  const m = (min + max) / 2;
  return [m, m];
}

/**
 * Cercle suivant, de rayon `rayon` (plafonné au rayon précédent), inclus dans `precedent` (`|c1 − c0| + r1 ≤ r0`) et centré dans les `bornes`
 * rétrécies de `0,5 × r1` de chaque côté. Tirage uniforme par rejet dans le disque de rayon `r0 − r1` (40 tentatives), avec 60 % de chances d'être
 * biaisé vers le centre d'un des `centres` (bâtiments creux) à ±15 m près, ramené dans la limite d'inclusion ; repli : même centre.
 */
export function tirerCercleSuivant(precedent: Cercle, rayon: number, bornes: Boite, alea: () => number, centres?: readonly [number, number][]): Cercle {
  const r1 = Math.max(0, Math.min(rayon, precedent.r));
  const [c0x, c0z] = precedent.c;
  const reste = precedent.r - r1;
  const [xMin, xMax] = intervalle(bornes.x0, bornes.x1, 0.5 * r1);
  const [zMin, zMax] = intervalle(bornes.z0, bornes.z1, 0.5 * r1);
  const dansRect = (x: number, z: number) => x >= xMin && x <= xMax && z >= zMin && z <= zMax;
  const cercle = (x: number, z: number): Cercle => ({ c: [x, z], r: r1 });

  // les centres atteignables : à portée du disque de tirage, bruit compris
  const portee = reste + BRUIT_BATIMENT_M * Math.SQRT2;
  const atteignables = centres ? centres.filter(([x, z]) => Math.hypot(x - c0x, z - c0z) <= portee) : [];
  if (atteignables.length > 0 && alea() < PART_BIAISEE) {
    const [bx, bz] = atteignables[Math.min(atteignables.length - 1, Math.floor(alea() * atteignables.length))];
    let x = Math.min(xMax, Math.max(xMin, bx + (alea() * 2 - 1) * BRUIT_BATIMENT_M));
    let z = Math.min(zMax, Math.max(zMin, bz + (alea() * 2 - 1) * BRUIT_BATIMENT_M));
    const d = Math.hypot(x - c0x, z - c0z);
    if (d > reste) {
      // ramené sur le bord du disque d'inclusion, vers l'ancien centre (le rectangle est convexe et contient l'ancien centre)
      const k = d > 0 ? reste / d : 0;
      x = c0x + (x - c0x) * k;
      z = c0z + (z - c0z) * k;
    }
    if (dansRect(x, z)) return cercle(x, z);
  }

  for (let i = 0; i < TENTATIVES; i++) {
    const angle = alea() * 2 * Math.PI;
    const dist = reste * Math.sqrt(alea());
    const x = c0x + Math.cos(angle) * dist;
    const z = c0z + Math.sin(angle) * dist;
    if (dansRect(x, z)) return cercle(x, z);
  }
  return cercle(c0x, c0z);
}

/** Tire tous les cercles de la partie à l'avance ; les durées des paliers sont multipliées par `echelle` (1 par défaut). */
export function genererPlanZone(o: {
  bornes: Boite; debutT: number; alea: () => number; centresBatiments?: readonly [number, number][];
  echelle?: number; paliers?: readonly PalierZone[]; rayonInitial?: number;
}): PlanZone {
  const echelle = o.echelle ?? 1;
  const paliers = (o.paliers ?? PALIERS_ZONE).map((p) => ({ ...p, attenteMs: p.attenteMs * echelle, retreciMs: p.retreciMs * echelle }));
  const cercles: Cercle[] = [{ c: centreBornes(o.bornes), r: o.rayonInitial ?? rayonInitialPour(o.bornes) }];
  for (const p of paliers) cercles.push(tirerCercleSuivant(cercles[cercles.length - 1], p.rayon, o.bornes, o.alea, o.centresBatiments));
  return { debutT: o.debutT, cercles, paliers };
}

/** Cercle courant d'un rétrécissement à l'avancement `k` (0..1) : interpolation linéaire, partagée par le serveur et le client (parité exacte). */
function interpoler(c0: readonly [number, number], r0: number, c1: readonly [number, number], r1: number, k: number): { centre: [number, number]; rayon: number } {
  return { centre: [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k], rayon: r0 + (r1 - r0) * k };
}

/** État de la zone à l'instant `t` (ms serveur) : avant `debutT`, attente du palier 1 ; après le dernier palier, zone fermée. */
export function etatZone(plan: PlanZone, t: number): EtatZone {
  const { paliers, cercles } = plan;
  let t0 = plan.debutT;
  for (let i = 0; i < paliers.length; i++) {
    const p = paliers[i];
    const t1 = t0 + p.attenteMs;
    const t2 = t1 + p.retreciMs;
    const depart = cercles[i];
    const cible = cercles[i + 1];
    if (t < t1) {
      return { palier: i + 1, phase: "attente", centre: [depart.c[0], depart.c[1]], rayon: depart.r, cible, t0, t1, t2, degatsParS: p.degatsParS };
    }
    if (t < t2) {
      const { centre, rayon } = interpoler(depart.c, depart.r, cible.c, cible.r, (t - t1) / (t2 - t1));
      return { palier: i + 1, phase: "retrecit", centre, rayon, cible, t0, t1, t2, degatsParS: p.degatsParS };
    }
    t0 = t2;
  }
  const dernier = cercles[cercles.length - 1];
  return {
    palier: paliers.length, phase: "fermee", centre: [dernier.c[0], dernier.c[1]], rayon: dernier.r, cible: null,
    t0, t1: t0, t2: t0, degatsParS: paliers.length > 0 ? paliers[paliers.length - 1].degatsParS : 0,
  };
}

/** Vrai si (x, z) est strictement hors du cercle courant (le bord est dedans). */
export const horsZone = (e: EtatZone, x: number, z: number): boolean => Math.hypot(x - e.centre[0], z - e.centre[1]) > e.rayon;

/** Distance au bord du cercle courant : > 0 dehors, < 0 dedans (m). */
export const distanceAuBord = (e: EtatZone, x: number, z: number): number => Math.hypot(x - e.centre[0], z - e.centre[1]) - e.rayon;

/** Message `ZoneBr` à l'instant `t` : cercle en cours au début du palier (`c0`/`r0`) et cercle visé (`c1`/`r1`). Fermée : les deux cercles sont confondus. */
export function zoneBrPublique(plan: PlanZone, t: number): ZoneBr {
  const e = etatZone(plan, t);
  const nbPaliers = plan.paliers.length;
  if (e.phase === "fermee" || !e.cible) {
    return {
      palier: e.palier, nbPaliers, phase: "fermee", t0: e.t0, t1: e.t1, t2: e.t2,
      c0: [e.centre[0], e.centre[1]], r0: e.rayon, c1: [e.centre[0], e.centre[1]], r1: e.rayon, degats: e.degatsParS,
    };
  }
  const depart = plan.cercles[e.palier - 1];
  return {
    palier: e.palier, nbPaliers, phase: e.phase, t0: e.t0, t1: e.t1, t2: e.t2,
    c0: [depart.c[0], depart.c[1]], r0: depart.r, c1: [e.cible.c[0], e.cible.c[1]], r1: e.cible.r, degats: e.degatsParS,
  };
}

/**
 * État reconstruit côté client à l'instant `t` à partir du message (identique à `etatZone(plan, t)` tant que `t` reste dans le palier du message).
 * La phase se lit sur `t` et non sur `z.phase` : le message date de quelques instants. Passé `t2` sans nouveau message, le dernier état connu
 * est tenu (cercle visé atteint, attente, `cible` nulle).
 */
export function etatDepuisZoneBr(z: ZoneBr, t: number): EtatZone {
  if (z.phase === "fermee") {
    return { palier: z.palier, phase: "fermee", centre: [z.c1[0], z.c1[1]], rayon: z.r1, cible: null, t0: z.t0, t1: z.t1, t2: z.t2, degatsParS: z.degats };
  }
  const base = { palier: z.palier, t0: z.t0, t1: z.t1, t2: z.t2, degatsParS: z.degats };
  const cible: Cercle = { c: [z.c1[0], z.c1[1]], r: z.r1 };
  if (t < z.t1) return { ...base, phase: "attente", centre: [z.c0[0], z.c0[1]], rayon: z.r0, cible };
  if (t < z.t2) {
    const { centre, rayon } = interpoler(z.c0, z.r0, z.c1, z.r1, (t - z.t1) / (z.t2 - z.t1));
    return { ...base, phase: "retrecit", centre, rayon, cible };
  }
  return { ...base, phase: "attente", centre: [z.c1[0], z.c1[1]], rayon: z.r1, cible: null };
}
