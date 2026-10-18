/**
 * Version de l'affichage (accueil + « Aide-moi à choisir ») : V1 = avant la refonte (PR #32),
 * V2 = vues Jour / Semaine / La carte et arbre de décision. Choisie par le switch de la barre
 * de navigation et mémorisée dans un cookie pour que le rendu serveur serve la bonne version.
 */
export type VersionUi = "v1" | "v2";

export const VERSION_COOKIE = "pdj-ui";

/** V2 par défaut ; seule la valeur exacte « v1 » sert l'ancien affichage. */
export function lireVersion(valeur?: string | null): VersionUi {
  return valeur === "v1" ? "v1" : "v2";
}
