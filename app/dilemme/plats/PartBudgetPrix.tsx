import { fmtPartBudget, prixEnEuros, titreBudget } from "@/lib/budget";
import styles from "../dilemme.module.css";

/** Prix d'un plat (« 11,90 € ») suivi de sa part du budget Edenred, rien sans prix. Sans état, rendu serveur. */
export default function PartBudgetPrix({ prix }: { prix: string | null }) {
  if (!prix) return null;
  const euros = prixEnEuros(prix);
  const part = fmtPartBudget(prix);
  const titre = titreBudget(prix);
  return (
    <p className={styles.carteMeta}>
      {euros == null ? prix : `${euros.toFixed(2).replace(".", ",")} €`}
      {part && (
        <span className={styles.budget} title={titre} aria-label={titre}>
          {" "}({part})
        </span>
      )}
    </p>
  );
}
