"use client";

import { memo } from "react";
import { KILLS_PAR_FRAPPE, killsAvantFrappe, texteFrappe } from "@/lib/fps/ciblage-frappe";
import styles from "./BlocTactique.module.css";

/**
 * Équipement tactique de l'arène (bas-gauche) : la frappe aérienne (prête ou progression de la série, avec SA touche réelle) et le fumigène (prêt ou
 * décompte du délai). Lot tactique : avant, aucune de ces récompenses n'était annoncée correctement (la frappe se devinait d'après la série de la
 * présence et restait « disponible » après usage, le fumigène n'avait ni état ni retour). Ne reçoit que des scalaires.
 */
export interface PropsBlocTactique {
  /** frappe aérienne en poche (message `frappe{disponible}` du serveur) */
  frappeDispo: boolean;
  /** kills d'affilée sans mourir */
  serie: number;
  toucheFrappe: string;
  /** la touche vient d'être pressée sans frappe : le rappel « encore n kills » s'affiche en plus */
  frappeRefusee: boolean;
  /** secondes avant le prochain fumigène (0 = prêt) */
  fumigeneS: number;
  toucheFumigene: string;
}

function BlocTactiqueBrut({ frappeDispo, serie, toucheFrappe, frappeRefusee, fumigeneS, toucheFumigene }: PropsBlocTactique) {
  const fait = KILLS_PAR_FRAPPE - killsAvantFrappe(serie);
  return (
    <section className={styles.bloc} aria-label="Équipement tactique">
      <ul className={styles.liste}>
        <li className={styles.ligne} data-etat={frappeDispo ? "pret" : "attente"} data-alerte={frappeRefusee ? "oui" : "non"}>
          <span className={styles.touche}>{toucheFrappe ? `[${toucheFrappe}]` : ""}</span>
          <span className={styles.nom}>FRAPPE AÉRIENNE</span>
          <b className={styles.etat}>{frappeDispo ? "PRÊTE" : `${fait}/${KILLS_PAR_FRAPPE}`}</b>
          <span className={styles.srSeul}>{texteFrappe(frappeDispo, serie, toucheFrappe)}</span>
        </li>
        <li className={styles.ligne} data-etat={fumigeneS <= 0 ? "pret" : "attente"}>
          <span className={styles.touche}>{toucheFumigene ? `[${toucheFumigene}]` : ""}</span>
          <span className={styles.nom}>FUMIGÈNE</span>
          <b className={styles.etat}>{fumigeneS <= 0 ? "PRÊT" : `${fumigeneS} s`}</b>
        </li>
      </ul>
      {frappeRefusee && !frappeDispo && (
        <p className={styles.rappel} role="status">{texteFrappe(false, serie, toucheFrappe)}</p>
      )}
    </section>
  );
}

const BlocTactique = memo(BlocTactiqueBrut);
export default BlocTactique;
