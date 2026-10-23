"use client";

import { memo } from "react";
import styles from "../HudArene.module.css";

/**
 * Icône du sort d'invocation (bas-gauche, au-dessus du bloc vie) : affichée seulement quand une charge est disponible, c'est-à-dire après avoir
 * abattu le tigre sauvage. Empreinte de patte, nom du sort et touche réelle du joueur (action « invoquer », G par défaut). La région vive
 * annonce le gain du sort (annonce « Sort d'invocation gagné »), ce bloc n'est pas `aria-live`.
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Sort d'invocation)
 */
export interface PropsIconeSort {
  /** libellé de la touche « invoquer », vide si aucune touche */
  touche: string;
}

function IconeSortBrute({ touche }: PropsIconeSort) {
  return (
    <section className={`${styles.plaque} ${styles.sort}`} aria-label="Sort d'invocation disponible">
      <svg className={styles.sortPatte} viewBox="0 0 32 32" aria-hidden="true">
        <ellipse cx="16" cy="21" rx="7.5" ry="6.5" />
        <ellipse cx="6.5" cy="12.5" rx="3" ry="3.8" />
        <ellipse cx="12.5" cy="7.5" rx="3" ry="3.8" />
        <ellipse cx="19.5" cy="7.5" rx="3" ry="3.8" />
        <ellipse cx="25.5" cy="12.5" rx="3" ry="3.8" />
      </svg>
      <span className={styles.sortTexte}>
        <b className={styles.label}>Tigre allié</b>
        <span className={styles.sortDetail}>30 s · invoquer</span>
      </span>
      {touche ? <kbd>{touche}</kbd> : <span className={styles.sortSansTouche}>sans touche</span>}
    </section>
  );
}

const IconeSort = memo(IconeSortBrute);
export default IconeSort;
