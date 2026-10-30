/**
 * Sol libre d'une carte pour les simulations de l'aperçu (vue Palantir) : où un faux joueur peut poser le pied. PUR.
 * Une grille de cellules de `pas` mètres indexe, pour chaque cellule, les bâtiments PLEINS et les plans d'eau qui la recouvrent ; `libre(x, z)`
 * est exact (aucun point libre n'est dans un bâtiment plein ni dans l'eau). Ne bloquent pas : les bâtiments creusés (`creux`) et leurs pièces
 * (`coque`, `cloison`, `meuble`, `fenetre`, `champ`) : on marche dedans, les cloisons ne sont pas modélisées (aperçu, pas gameplay).
 * Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import { dedans } from "../agroparc3d/cachettes";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import type { Boite } from "./collision";

/** Types de pièces qui n'empêchent pas de marcher (intérieurs creusés, passe-tigres, mobilier). */
const SANS_OBSTACLE: ReadonlySet<string> = new Set(["creux", "coque", "cloison", "meuble", "fenetre", "champ"]);

export interface SolLibre {
  /** pas de la grille (m) */
  readonly pas: number;
  readonly bornes: Boite;
  /** (x, z) est dans les bornes, hors de tout bâtiment plein et de l'eau */
  libre(x: number, z: number): boolean;
  /** tire un point libre dans l'anneau [rMin, rMax] autour de `centre` (40 essais, repli sur le point libre le plus proche de `centre`) */
  pointLibre(alea: () => number, centre: Vec2, rMin: number, rMax: number, sortie?: Vec2): Vec2;
  /** déplacement de (dx, dz) depuis (x, z) qui glisse le long d'un obstacle et ne traverse jamais un mur ; écrit dans `sortie` */
  deplacer(x: number, z: number, dx: number, dz: number, sortie: Vec2): Vec2;
}

interface Obstacle { anneau: Vec2[]; trous: Vec2[][]; x0: number; z0: number; x1: number; z1: number }

function obstacleDe(anneau: Vec2[], trous: Vec2[][] = []): Obstacle {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of anneau) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { anneau, trous, x0, z0, x1, z1 };
}
const dansObstacle = (o: Obstacle, x: number, z: number): boolean =>
  x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && dedans(x, z, o.anneau) && !o.trous.some((t) => dedans(x, z, t));

/** Construit le sol libre d'une scène dans `bornes` (une instance par carte, ≈ 20 000 cellules à 4 m, quelques ms). */
export function creerSolLibre(
  data: Pick<SceneData, "buildings" | "water">, bornes: Boite, pas = 4,
): SolLibre {
  const nx = Math.max(1, Math.ceil((bornes.x1 - bornes.x0) / pas)), nz = Math.max(1, Math.ceil((bornes.z1 - bornes.z0) / pas));
  const obstacles: Obstacle[] = [];
  const pleins = data.buildings.filter((b: Building) => !SANS_OBSTACLE.has(b.type ?? ""));
  for (const b of pleins) obstacles.push(obstacleDe(b.r, b.holes));
  for (const w of data.water) obstacles.push(obstacleDe(w));
  // index : pour chaque cellule, les obstacles dont la boîte la recouvre
  const cellules: (Obstacle[] | undefined)[] = new Array(nx * nz);
  for (const o of obstacles) {
    const i0 = Math.max(0, Math.floor((o.x0 - bornes.x0) / pas)), i1 = Math.min(nx - 1, Math.floor((o.x1 - bornes.x0) / pas));
    const j0 = Math.max(0, Math.floor((o.z0 - bornes.z0) / pas)), j1 = Math.min(nz - 1, Math.floor((o.z1 - bornes.z0) / pas));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (cellules[j * nx + i] ??= []).push(o);
  }

  const libre = (x: number, z: number): boolean => {
    if (!(x >= bornes.x0 && x < bornes.x1 && z >= bornes.z0 && z < bornes.z1)) return false;
    const liste = cellules[Math.floor((z - bornes.z0) / pas) * nx + Math.floor((x - bornes.x0) / pas)];
    if (!liste) return true;
    for (const o of liste) if (dansObstacle(o, x, z)) return false;
    return true;
  };

  return {
    pas, bornes, libre,
    pointLibre(alea, centre, rMin, rMax, sortie = [0, 0]) {
      for (let k = 0; k < 40; k++) {
        const a = alea() * 2 * Math.PI, r = rMin + alea() * (rMax - rMin);
        const x = centre[0] + Math.cos(a) * r, z = centre[1] + Math.sin(a) * r;
        if (libre(x, z)) { sortie[0] = x; sortie[1] = z; return sortie; }
      }
      // repli : le point libre le plus proche du centre, en spirale
      for (let r = 0; r <= Math.max(bornes.x1 - bornes.x0, bornes.z1 - bornes.z0); r += pas) {
        const n = Math.max(1, Math.round((2 * Math.PI * r) / pas));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 2 * Math.PI;
          const x = centre[0] + Math.cos(a) * r, z = centre[1] + Math.sin(a) * r;
          if (libre(x, z)) { sortie[0] = x; sortie[1] = z; return sortie; }
        }
      }
      sortie[0] = centre[0]; sortie[1] = centre[1];
      return sortie;
    },
    deplacer(x, z, dx, dz, sortie) {
      // le pas est découpé : jamais plus de la moitié d'une cellule d'un coup, donc jamais à travers un mur plus épais qu'un demi-mètre
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (pas / 2)));
      const sx = dx / n, sz = dz / n;
      let cx = x, cz = z;
      for (let k = 0; k < n; k++) {
        if (libre(cx + sx, cz + sz)) { cx += sx; cz += sz; }
        else if (libre(cx + sx, cz)) cx += sx;
        else if (libre(cx, cz + sz)) cz += sz;
        else break;
      }
      sortie[0] = cx; sortie[1] = cz;
      return sortie;
    },
  };
}
