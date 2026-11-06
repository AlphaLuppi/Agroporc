/**
 * Rocket Muche : accumulateur de pas fixes (PUR, testé). `jeu.ts` y verse le temps réel écoulé entre deux images et en tire un nombre
 * entier de pas physiques de `PAS_S` (120 Hz) plus la fraction restante `alpha` pour interpoler l'affichage entre deux pas.
 *
 * Si la machine ne suit pas, au plus `PAS_MAX_PAR_IMAGE` pas sont faits : le reste du temps est PERDU (la partie ralentit plutôt que de
 * s'emballer en « spirale de la mort »).
 */
import { PAS_MAX_PAR_IMAGE, PAS_S } from "./contrat";

export interface Accumulateur {
  /** temps de jeu versé et pas encore consommé (s), toujours dans [0, PAS_S[ entre deux appels */
  reste: number;
}
export const creerAccumulateur = (): Accumulateur => ({ reste: 0 });

/** Image plus longue que cela (onglet en arrière-plan, point d'arrêt) : ramenée à ce plafond (s) avant l'accumulation. */
export const IMAGE_MAX_S = 0.1;

/**
 * Verse `dtReel` secondes de temps réel (multipliées par `echelle` : 0,5 pendant la célébration d'un but) et rend le nombre de pas à
 * faire et la fraction d'interpolation `alpha` ∈ [0, 1[.
 */
export function avancerAccumulateur(acc: Accumulateur, dtReel: number, echelle = 1, pasMax: number = PAS_MAX_PAR_IMAGE): { pas: number; alpha: number } {
  const dt = Math.min(Math.max(Number.isFinite(dtReel) ? dtReel : 0, 0), IMAGE_MAX_S);
  acc.reste += dt * Math.max(echelle, 0);
  let pas = Math.floor(acc.reste / PAS_S + 1e-9);
  acc.reste -= pas * PAS_S;
  if (pas > pasMax) {
    // retard : on garde `pasMax` pas et on jette le surplus
    pas = pasMax;
    acc.reste = 0;
  }
  if (acc.reste < 0) acc.reste = 0;
  return { pas, alpha: Math.min(acc.reste / PAS_S, 1) };
}
