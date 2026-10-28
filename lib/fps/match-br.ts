/**
 * Service principal du Battle Royale (PUR : l'horloge `maintenant` est passée à chaque appel, le hasard est injecté par `alea` ; ne voit la
 * salle que par `ContexteSalle`). Machine d'états lobby → décompte → vol → jeu → fin, hôte, admission, zone, places, éliminations, bilan,
 * statistiques ; compose `VolBr` (match-br-vol.ts) et `ButinBr` (match-br-butin.ts).
 * STUB du lot A : seuls les types d'options sont figés ici, `creerServiceBr` est remplacé par le lot C1a.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md
 */
import type { SceneData } from "../agroparc3d/types";
import type { ContexteSalle, ServiceBr } from "./match-contexte";

/** Persistance des statistiques (implémentée par serveur-fps) ; remplacée par `PersistanceBr` de br-stats.ts (lot B5) au lot C1a. */
export interface PersistanceStatsBr {
  lire(): unknown;
  enregistrer(partie: unknown): unknown;
}

export interface OptionsServiceBr {
  alea: () => number;
  /** pour `pointsButin` / les centres de la zone (le monde est `ctx.monde`, issu de `construireMondeBr`) */
  scene: SceneData;
  /** absent : statistiques en mémoire seulement */
  stats?: PersistanceStatsBr;
  joueursMin?: number; decompteMaxMs?: number; decompteMinMs?: number; finAffichageMs?: number;
  /** essais : durée du trajet de l'avion (la vitesse en découle) */
  dureeVolMs?: number;
  altitude?: number; echelleZone?: number; nbObjets?: number;
  /** essais : durée minimale (ms) pour qu'une partie compte dans les statistiques (`BR.partieValideMinMs` par défaut) */
  partieValideMinMs?: number;
}

export function creerServiceBr(_ctx: ContexteSalle, _opts: OptionsServiceBr): ServiceBr {
  throw new Error("non implémenté");
}
