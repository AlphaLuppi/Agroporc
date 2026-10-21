/**
 * Part du budget mensuel de la carte restaurant (Edenred, rechargée à 172 € par mois)
 * que représente un plat. Pur, utilisable côté client comme serveur.
 */

/** Montant rechargé chaque mois sur la carte Edenred. */
export const BUDGET_EDENRED_MOIS = 172;

/** « 11.9€ », « 11,90 € » → 11.9 ; `null` si la chaîne n'est pas un prix simple (ou ≤ 0). */
export function prixEnEuros(prix?: string | null): number | null {
  if (!prix) return null;
  const m = prix.replace(",", ".").match(/^\s*(\d+(?:\.\d+)?)\s*€?\s*$/);
  if (!m) return null;
  const euros = parseFloat(m[1]);
  return euros > 0 ? euros : null;
}

/** Part du budget mensuel en pourcentage (11,90 € → 6,92), `null` sans prix exploitable. */
export function partBudget(euros: number | null, budget = BUDGET_EDENRED_MOIS): number | null {
  if (euros == null || !(euros > 0) || !(budget > 0)) return null;
  return (euros / budget) * 100;
}

/** « 6,9 % » (une décimale, virgule, espace insécable) ; chaîne vide sans prix exploitable. */
export function fmtPartBudget(prix?: string | null): string {
  return fmtPourcent(partBudget(prixEnEuros(prix)));
}

export function fmtPourcent(part: number | null): string {
  if (part == null) return "";
  return `${part.toFixed(1).replace(".", ",")} %`;
}

/** Nombre de plats à ce prix que finance un mois de carte (172 € / 11,90 € → 14). */
export function repasParMois(prix?: string | null, budget = BUDGET_EDENRED_MOIS): number | null {
  const euros = prixEnEuros(prix);
  return euros == null ? null : Math.floor(budget / euros);
}

/** Infobulle commune : « 6,9 % des 172 € mensuels de la carte Edenred ». */
export function titreBudget(prix?: string | null): string | undefined {
  const part = fmtPartBudget(prix);
  return part ? `${part} des ${BUDGET_EDENRED_MOIS} € mensuels de la carte Edenred` : undefined;
}
