/**
 * (v10, zombies) Coup de couteau rapide, arme à feu en main (le « melee » de Black Ops 1, touche V) : PUR, partagé client (animation, envoi
 * du `coup` à l'impact, tir bloqué jusqu'à la fin) et serveur (cadence des `coup` reçus hors du slot `couteau`).
 * Plus l'arme en main est lourde, plus le coup est lent : il faut l'écarter avant de frapper (`impactS`) et la remettre en joue (`dureeS`).
 * Une classe de poids par arme (`Record` exhaustif : une arme oubliée casse la compilation, voulu). L'épée, plus lourde que le couteau,
 * allonge le tout de `FACTEUR_EPEE`.
 * Spec : docs/superpowers/specs/2026-10-29-zombies-inventaire-design.md
 */
import { MELEE } from "./armes";
import type { ArmeFeuId, ArmeMeleeId } from "./protocole";

export type PoidsArme = "leger" | "moyen" | "lourd" | "tres_lourd";

/** Poids de chaque arme à feu : pistolets légers, mitraillettes et fusils moyens, fusils à pompe et armes encombrantes lourdes, mitrailleuses très lourdes. */
export const POIDS_ARME: Readonly<Record<ArmeFeuId, PoidsArme>> = {
  pistolet: "leger", revolver: "leger", mini_uzi: "leger", rayon: "leger", perforeuse: "leger", magnum_dore: "leger", fumigene: "leger",
  mitraillette: "moyen", fusil_assaut: "moyen", photocopieuse: "moyen", baguette: "moyen",
  pompe: "lourd", essoreuse: "lourd", sniper: "lourd", agrafeuse: "lourd", brochette: "lourd", soufflerie: "lourd", grille_pain: "lourd",
  railgun: "lourd", lance_grenades: "lourd",
  mitrailleuse: "tres_lourd", minigun: "tres_lourd", bazooka: "tres_lourd",
};

/**
 * Minutage par poids (s) : `impactS` = du début du coup au moment où la lame touche (le `coup` part alors), `dureeS` = durée totale (aucun
 * tir, recharge ni changement d'arme avant la fin ; cadence minimale entre deux coups). Le plus léger égale le couteau seul (`MELEE.couteau.cadenceS`).
 */
export const COUP_RAPIDE: Readonly<Record<PoidsArme, { impactS: number; dureeS: number }>> = {
  leger: { impactS: 0.14, dureeS: MELEE.couteau.cadenceS },
  moyen: { impactS: 0.2, dureeS: 0.65 },
  lourd: { impactS: 0.28, dureeS: 0.85 },
  tres_lourd: { impactS: 0.36, dureeS: 1.1 },
};

/** L'épée allonge le coup rapide (plus lente que le couteau, mais elle tranche jusqu'à trois tigres). */
export const FACTEUR_EPEE = 1.25;

/** Minutage du coup rapide donné avec l'arme blanche `melee`, l'arme à feu `arme` en main. */
export function minutageCoupRapide(arme: ArmeFeuId, melee: ArmeMeleeId): { impactS: number; dureeS: number } {
  const base = COUP_RAPIDE[POIDS_ARME[arme]];
  const k = melee === "epee" ? FACTEUR_EPEE : 1;
  return { impactS: base.impactS * k, dureeS: base.dureeS * k };
}
