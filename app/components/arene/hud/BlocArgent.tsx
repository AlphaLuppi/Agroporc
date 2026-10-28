"use client";

import { memo } from "react";
import { formatArgent } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Argent des zombies (bas-gauche, au-dessus de la vie) : « 1 250 $ » en ambre, le dernier gain ou la dernière dépense qui monte un instant
 * à côté (« +60 $ · kill », relancé à chaque nouveau gain par sa clé `n`), et, quand un achat est refusé, le motif ÉCRIT en dessous
 * (« Argent insuffisant » : jamais la couleur seule). Ne reçoit que des scalaires.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« HUD et écrans »)
 */
export interface PropsBlocArgent {
  argent: number;
  /** libellé du gain affiché (`libelleGain`), null = aucun ; `cleGain` change à chaque nouveau gain */
  gain: string | null;
  cleGain: number;
  /** positif = recette (vert), négatif = dépense */
  gainPositif: boolean;
  /** motif écrit du dernier refus d'achat, null = aucun */
  refus: string | null;
}

function BlocArgentBrut({ argent, gain, cleGain, gainPositif, refus }: PropsBlocArgent) {
  return (
    <section className={`${styles.plaque} ${styles.argent}`} aria-label="Argent">
      <div className={styles.argentLigne}>
        <span className={styles.argentEtiquette}>ARGENT</span>
        <b className={styles.argentMontant}>{formatArgent(argent)}</b>
        {gain && <span key={cleGain} className={styles.argentGain} data-signe={gainPositif ? "plus" : "moins"}>{gain}</span>}
      </div>
      {refus && <p className={styles.argentRefus} role="status">{refus}</p>}
    </section>
  );
}

const BlocArgent = memo(BlocArgentBrut);
export default BlocArgent;
