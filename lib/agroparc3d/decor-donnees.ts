/**
 * Données dérivées du décor (PUR, sans three ni DOM) : `deriverDecor` appelle les modules de placement (voirie, puis parkings, végétation,
 * mobilier) et rend un objet unique que les modules three (`decor-sol.ts`, `decor-vegetation.ts`, `decor-mobilier.ts`) transforment en géométries.
 * Déterministe : aucun `Math.random`, le même `SceneData` donne toujours le même décor. Aucune collision n'en dépend.
 * Spec : docs/superpowers/specs/2026-10-29-da-palantir-design.md (D2).
 */
import type { Boite } from "./geo";
import { placesParking } from "./parkings";
import { arbustes, classerArbres, haies, pelouses, type ArbreClasse } from "./vegetation";
import { deriverVoirie, type Voirie } from "./voirie";
import type { SceneData, Vec2 } from "./types";

export interface OptionsDerivation {
  /** ambiance du mode : les zombies n'ont ni mobilier, ni haies, ni pelouses, ni arbustes, ni places de parking dans leur boîte */
  ambiance?: "complete" | "zombies";
  /** "basse" : sans taches de lumière, haies ni arbustes, sans styles de façade coûteux */
  qualite?: "haute" | "basse";
  /** boîtes où rien du décor secondaire n'est posé (carte des zombies) */
  exclure?: readonly Boite[];
  /** positions à dégager (cachettes du tigre) : aucun mobilier, arbuste ni haie à moins de 3 m */
  eviter?: readonly Vec2[];
}

export interface DecorDerive {
  voirie: Voirie;
  /** séparateurs de places de parking (segments) */
  places: number[];
  /** un élément par arbre de `scene.trees`, même ordre, même position */
  arbres: ArbreClasse[];
  /** tronçons de haie [x, z, ux, uz, …] */
  haies: number[];
  /** triangles de pelouse [x, z, …] */
  pelouses: number[];
  /** arbustes [x, z, …] */
  arbustes: number[];
}

export function deriverDecor(data: SceneData, opts: OptionsDerivation = {}): DecorDerive {
  const veg = { qualite: opts.qualite, exclure: opts.exclure, eviter: opts.eviter };
  return {
    voirie: deriverVoirie(data), places: placesParking(data, opts.exclure),
    arbres: classerArbres(data), haies: haies(data, veg), pelouses: pelouses(data, veg), arbustes: arbustes(data, veg),
  };
}
