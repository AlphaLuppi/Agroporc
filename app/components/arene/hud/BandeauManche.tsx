"use client";

import { memo } from "react";
import { libelleTigres } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Annonce d'une nouvelle manche (centre haut, quelques secondes, posée par l'orchestrateur) : « MANCHE 7 » et le nombre de tigres, ou les
 * consignes de la première manche. Visuellement imposante, mais la région vive porte déjà « Manche 7 » aux lecteurs d'écran.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« HUD et écrans »)
 */
export interface PropsBandeauManche {
  manche: number;
  /** tigres de la manche */
  restants: number;
}

function BandeauMancheBrut({ manche, restants }: PropsBandeauManche) {
  return (
    <section className={styles.bandeauManche} aria-hidden="true">
      <div className={styles.evtRayures} />
      <p className={styles.bandeauMancheTitre}>MANCHE {manche}</p>
      <p className={styles.bandeauMancheSous}>
        {manche <= 1
          ? "Survivez. Achetez des armes aux murs, ouvrez les portes."
          : restants <= 0 ? "LES TIGRES ARRIVENT" : restants === 1 ? "1 TIGRE ARRIVE" : `${libelleTigres(restants)} ARRIVENT`}
      </p>
    </section>
  );
}

const BandeauManche = memo(BandeauMancheBrut);
export default BandeauManche;
