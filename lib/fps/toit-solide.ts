/**
 * Équipements de toit SOLIDES (PUR : ni three ni DOM, partagé par le client et le serveur).
 *
 * Caissons de clim, édicules, antennes et panneaux solaires sont dessinés par `decor.ts` à partir de `placementsToit` / `placementsSolaires`
 * (tirages déterministes par (bâtiment, index dans `scene.json`)). Ce module en dérive, avec les MÊMES tirages, la boîte de collision de
 * chacun : un prisme vertical posé sur le toit (base = hauteur du bâtiment). `construireMonde` les range dans `Prisme.toit` : le client, le
 * serveur, les bots et les zombies construisent donc exactement le même monde, sans rien ajouter à la liste des prismes (index des
 * bâtiments, des pièces des zombies et du BR inchangés).
 */
import { DIMENSIONS, placementsSolaires, placementsToit, type Equipement } from "../agroparc3d/facade";
import type { Building, Vec2 } from "../agroparc3d/types";

/** Boîte de collision d'un équipement : rectangle tourné au sol, de `base` (le toit) à `haut`. */
export interface EquipementSolide {
  type: Equipement["type"];
  /** les quatre coins (x, z) du rectangle tourné, dans l'ordre du pourtour */
  anneau: Vec2[];
  x0: number; z0: number; x1: number; z1: number;
  base: number;
  haut: number;
}

/**
 * Hauteur de collision d'un panneau solaire incliné (m). Le panneau est dessiné comme une plaque inclinée autour de son centre (à 0,4 m du toit) : son
 * bord bas est à ≈ 0,06 m et son bord haut à ≈ 0,85 m. Une boîte pleine à 0,85 m laissait un joueur se poser en l'air au-dessus du bord bas et arrêtait
 * des balles rasantes sur du vide ; on prend la hauteur du CENTRE de la plaque (plus son épaisseur) : obstacle franchissable d'un saut, jamais un mur
 * invisible de près d'un mètre. Le bord haut est un peu franchissable : écart assumé de la collision au dessin.
 */
export const HAUTEUR_SOLAIRE_M = 0.4 + DIMENSIONS.solaire[1] / 2;

/** Boîte d'un équipement posé sur un toit à la hauteur `h`. Rotation autour de y comme `decor.ts` (quaternion d'axe y : x' = x cos + z sin, z' = −x sin + z cos). */
export function equipementSolide(e: Equipement, h: number): EquipementSolide {
  // un panneau incliné occupe une profondeur au sol de sz cos(incl) + sy sin(incl) et est plafonné à `HAUTEUR_SOLAIRE_M`
  const profondeur = e.incl ? e.sz * Math.cos(e.incl) + e.sy * Math.sin(e.incl) : e.sz;
  const hauteur = e.incl ? HAUTEUR_SOLAIRE_M : e.sy;
  const c = Math.cos(e.rot), s = Math.sin(e.rot);
  const anneau: Vec2[] = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => {
    const lx = (a * e.sx) / 2, lz = (b * profondeur) / 2;
    return [e.x + lx * c + lz * s, e.z - lx * s + lz * c] as Vec2;
  });
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of anneau) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { type: e.type, anneau, x0, z0, x1, z1, base: h, haut: h + hauteur };
}

/**
 * Équipements solides d'un bâtiment (index `id` de `scene.json`, la graine du tirage). Aucun pour un bâtiment de pièce (`type` autre que mur :
 * portes, fenêtres, creux des zombies et du BR), comme pour le décor.
 */
export function equipementsSolides(b: Building, id: number): EquipementSolide[] {
  if (b.type && b.type !== "mur") return [];
  const liste = [...placementsToit(b, id), ...placementsSolaires(b, id)];
  return liste.map((e) => equipementSolide(e, b.h));
}
