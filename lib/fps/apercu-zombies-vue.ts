/**
 * Aides de la vue d'en haut des zombies (aperçu Palantir) : quel bâtiment abrite les survivants, quelles fenêtres sont attaquées, quel
 * bâtiment une fenêtre ferme. PUR. Spec : docs/superpowers/specs/2026-10-29-apercus-modes-design.md
 */
import { dedans } from "../agroparc3d/cachettes";
import type { SceneData } from "../agroparc3d/types";
import type { TigreAerien } from "./apercu-source";
import type { Fenetre } from "./zombies-carte";

/** Distance (m) sous laquelle un tigre arrachant des planches compte comme attaquant la fenêtre. */
export const PORTEE_ATTAQUE_FENETRE_M = 7;

const contient = (data: Pick<SceneData, "buildings">, i: number, x: number, z: number): boolean => {
  const b = data.buildings[i];
  return !!b && dedans(x, z, b.r) && !(b.holes ?? []).some((h) => dedans(x, z, h));
};

/** Index (dans `data.buildings`) du bâtiment creux qui contient le plus de survivants, null s'ils sont tous dehors. `creux` : index des bâtiments creux. */
export function batimentDesJoueurs(
  data: Pick<SceneData, "buildings">, creux: readonly number[], positions: readonly (readonly [number, number, number])[],
): number | null {
  let meilleur: number | null = null, n = 0;
  for (const i of creux) {
    let c = 0;
    for (const p of positions) if (contient(data, i, p[0], p[2])) c++;
    if (c > n) { n = c; meilleur = i; }
  }
  return meilleur;
}

/** Indices des fenêtres dont un tigre arrache les planches (mode `fenetre`, à moins de 7 m du milieu). */
export function fenetresAttaquees(tigres: readonly TigreAerien[], fenetres: readonly Fenetre[], sortie: number[] = []): number[] {
  sortie.length = 0;
  for (const t of tigres) {
    if (t.mode !== "fenetre") continue;
    let best = -1, bd = PORTEE_ATTAQUE_FENETRE_M;
    fenetres.forEach((f, i) => { const d = Math.hypot(f.milieu[0] - t.x, f.milieu[1] - t.z); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && !sortie.includes(best)) sortie.push(best);
  }
  return sortie;
}

/**
 * Pour chaque fenêtre, l'index du bâtiment creux qu'elle ferme (sa position `dedans` y est), null si elle donne sur une cour.
 */
export function batimentDeFenetre(data: Pick<SceneData, "buildings">, creux: readonly number[], fenetres: readonly Fenetre[]): (number | null)[] {
  return fenetres.map((f) => creux.find((i) => contient(data, i, f.dedans[0], f.dedans[1])) ?? null);
}
