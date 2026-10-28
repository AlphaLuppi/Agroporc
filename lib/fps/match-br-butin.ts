/**
 * Butin du Battle Royale (PUR) : tirage et synchro des objets au sol, ramassage, lâcher, inventaires, soins et usages. Ne voit la salle que
 * par `ContexteSalle`.
 * STUB du lot A : seul le type d'options est figé ici, `creerButinBr` est remplacé par le lot C1b.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Butin, §Inventaire)
 */
import type { ButinBr, ContexteSalle } from "./match-contexte";

export interface OptionsButinBr {
  /** distance maximale de ramassage (m, `BR.rayonRamassageM` par défaut) */
  rayonRamassageM?: number;
}

export function creerButinBr(_ctx: ContexteSalle, _opts?: OptionsButinBr): ButinBr {
  throw new Error("non implémenté");
}
