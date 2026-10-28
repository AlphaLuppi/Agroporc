/**
 * Vol du Battle Royale (PUR) : avion, saut, éjection forcée, chute simulée en temps réel à partir des dernières entrées du client,
 * atterrissage et invulnérabilité. Ne voit la salle que par `ContexteSalle`.
 * STUB du lot A : seul le type d'options est figé ici, `creerVolBr` est remplacé par le lot C1b.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Avion, §Chute libre et parachute)
 */
import type { ContexteSalle, VolBr } from "./match-contexte";

export interface OptionsVolBr {
  /** invulnérabilité après l'atterrissage (ms, `BR.protectionAtterrissageMs` par défaut) */
  protectionAtterrissageMs?: number;
}

export function creerVolBr(_ctx: ContexteSalle, _opts?: OptionsVolBr): VolBr {
  throw new Error("non implémenté");
}
