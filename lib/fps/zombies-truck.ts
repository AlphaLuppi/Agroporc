/**
 * Manches du Truck Muche (les chiens de BO1), règles PURES (ni horloge ni hasard global, le hasard est injecté) : points de foudre près des
 * joueurs dans les zones actives (les petits et les mini Trucks y apparaissent par un éclair, comme les chiens de BO1 sont téléportés
 * devant le joueur qu'ils visent), cadence des éclairs, souffle d'un mini Truck Muche qui saute. Le service (`match-zombies.ts`) les
 * applique, le client (`ambiance-zombies.ts`) en tire le brouillard et la foudre.
 *
 * BO1 (`_zombiemode_ai_dogs.gsc`) : `dog_spawn_fx` allume la foudre au point d'apparition, attend 1,5 s, frappe et montre le chien ; une
 * apparition toutes les 3 / 2,5 / 2 / 1,5 s (manches de chiens 1, 2, 3, 4+) moins la part déjà lâchée ; 2 chiens vivants par joueur au plus.
 * Nos joueurs vont 40 % plus vite : la foudre prévient 0,6 s avant, frappe plus souvent, et le plafond est de 4 + 3 par joueur.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Manches du Truck Muche »)
 */
import type { Vec2 } from "../agroparc3d/types";
import type { Vec3 } from "./protocole";
import { ZONES, type CarteZones, type ZoneId } from "./zombies-carte";
import { ZOMBIES, facteurDifficulte, type Difficulte } from "./zombies-vagues";

export const ECLAIRS = {
  /** premier éclair (ms) après le début de la manche : le Truck recule encore vers son quai */
  debutMs: 1_500,
  /** la foudre s'annonce (crépitement au sol) ce délai (ms) avant de frapper et de montrer l'ennemi (BO1 : 1,5 s) */
  foudreMs: 600,
  /** un éclair frappe entre ces distances (m) du joueur visé, et jamais à moins de `distanceMinAutresM` d'un autre joueur */
  distanceMinM: 6,
  distanceMaxM: 18,
  distanceMinAutresM: 4,
  /** ni sur un ennemi vivant ni sur un éclair en cours (m) */
  distanceEnnemisM: 1.6,
  /** intervalle (s) entre deux éclairs selon le numéro de la livraison (1, 2, 3, 4+), avant l'accélération en cours de manche */
  intervalles: [1.4, 1.15, 0.95, 0.8] as readonly number[],
  /** l'intervalle fond de cette part quand toute la livraison est lâchée (BO1 : moins count / max), plancher (s) */
  acceleration: 0.5,
  intervalleMinS: 0.35,
  /** le brouillard se lève ce délai (ms) après le dernier ennemi (BO1 `dog_round_aftermath` : 2 s puis `dog_stop`) */
  leveeMs: 2_000,
} as const;

/**
 * Points où la foudre peut frapper : une grille de `pas` m sur toutes les zones (intérieurs compris, contrairement aux sorties du sol),
 * gardant les cases dont les huit voisines à `marge` m sont dans la même zone (ni contre un mur ni dans un meuble).
 */
export function pointsEclair(c: CarteZones, pas = 2, marge = 1): { zone: ZoneId; p: Vec2 }[] {
  const res: { zone: ZoneId; p: Vec2 }[] = [];
  const rang = (x: number, z: number): number => {
    const i = Math.floor((x - c.x0) / c.taille), j = Math.floor((z - c.z0) / c.taille);
    return i < 0 || j < 0 || i >= c.nx || j >= c.nz ? -1 : c.zone[i + j * c.nx];
  };
  const x1 = c.x0 + c.nx * c.taille, z1 = c.z0 + c.nz * c.taille;
  for (let x = c.x0 + pas / 2; x < x1; x += pas) {
    for (let z = c.z0 + pas / 2; z < z1; z += pas) {
      const r = rang(x, z);
      if (r < 0) continue;
      let ok = true;
      for (let a = 0; a < 8 && ok; a++) {
        const ang = (a / 8) * 2 * Math.PI;
        if (rang(x + Math.cos(ang) * marge, z + Math.sin(ang) * marge) !== r) ok = false;
      }
      if (ok) res.push({ zone: ZONES[r].id, p: [x, z] });
    }
  }
  return res;
}

/**
 * Point de foudre (BO1 : devant le joueur visé) : un joueur tiré au hasard, puis un point des zones actives entre `distanceMinM` et
 * `distanceMaxM` m de lui, à plus de `distanceMinAutresM` m de tout joueur et de `distanceEnnemisM` m de tout ennemi ou éclair en cours ;
 * les autres joueurs sont essayés s'il n'y en a pas. Null si aucun point ne convient (le Truck lâchera l'ennemi à son quai).
 */
export function choisirPointEclair(
  points: readonly { zone: ZoneId; p: Vec2 }[], actives: ReadonlySet<ZoneId>, joueurs: readonly Vec2[], occupes: readonly Vec2[], alea: () => number,
): Vec2 | null {
  if (!joueurs.length) return null;
  const premier = Math.min(joueurs.length - 1, Math.floor(alea() * joueurs.length));
  for (let k = 0; k < joueurs.length; k++) {
    const vise = joueurs[(premier + k) % joueurs.length];
    const bons: Vec2[] = [];
    for (const { zone, p } of points) {
      if (!actives.has(zone)) continue;
      const d = Math.hypot(p[0] - vise[0], p[1] - vise[1]);
      if (d < ECLAIRS.distanceMinM || d > ECLAIRS.distanceMaxM) continue;
      if (joueurs.some((j) => Math.hypot(p[0] - j[0], p[1] - j[1]) < ECLAIRS.distanceMinAutresM)) continue;
      if (occupes.some((o) => Math.hypot(p[0] - o[0], p[1] - o[1]) < ECLAIRS.distanceEnnemisM)) continue;
      bons.push(p);
    }
    if (bons.length) return bons[Math.min(bons.length - 1, Math.floor(alea() * bons.length))];
  }
  return null;
}

/** Intervalle (ms) avant le prochain éclair : selon la livraison, de plus en plus court au fil de la manche (`fraction` déjà lâchée, 0..1). */
export function intervalleEclairMs(numeroTruck: number, fraction: number): number {
  const base = ECLAIRS.intervalles[Math.min(ECLAIRS.intervalles.length, Math.max(1, Math.floor(numeroTruck))) - 1];
  const k = 1 - ECLAIRS.acceleration * Math.min(1, Math.max(0, fraction));
  return Math.round(Math.max(ECLAIRS.intervalleMinS, base * k) * 1000);
}

/** Souffle d'un mini Truck sur un joueur à `d` m du centre (PV, 0 hors du rayon) : de 80 au centre à 15 au bord en « plat du jour ». */
export function degatsSouffleMiniJoueur(d: number, difficulte: Difficulte = "plat"): number {
  const M = ZOMBIES.miniTruck;
  if (!(d <= M.souffleM)) return 0;
  const k = Math.max(0, d) / M.souffleM;
  return Math.round((M.souffleJoueur + (M.souffleJoueurBord - M.souffleJoueur) * k) * facteurDifficulte(difficulte));
}

/** Souffle d'un mini Truck sur un tigre (petit, mini Truck…) à `d` m du centre, 0 hors du rayon. */
export function degatsSouffleMiniTigre(d: number): number {
  const M = ZOMBIES.miniTruck;
  if (!(d <= M.souffleM)) return 0;
  const k = Math.max(0, d) / M.souffleM;
  return Math.round(M.souffleTigre + (M.souffleTigreBord - M.souffleTigre) * k);
}

/** Centre du souffle d'un mini Truck dont les roues sont en `p` (le réservoir, à mi-hauteur de la caisse). */
export function centreSouffleMini(p: Vec3): Vec3 {
  return [p[0], 0.5, p[2]];
}
