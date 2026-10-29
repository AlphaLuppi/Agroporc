"use client";

import { LEGENDE_MODE, type Bandeau } from "@/lib/fps/apercu-source";
import type { ModeSalle } from "@/lib/fps/protocole";
import styles from "../Agroparc3D.module.css";

/**
 * Bandeau de l'aperçu par mode de la vue Palantir : « SIMULATION » (contour en pointillés, faux joueurs) ou « EN DIRECT » (pastille pleine,
 * vraies données du serveur), le mode et un détail. Remplace la légende du bas à gauche hors arène (la légende du mode suit). `role="status"` :
 * le texte n'est mis à jour qu'à 2 Hz au plus et seulement s'il change ; aucune information portée par la seule couleur.
 */
export default function BadgeApercu({ bandeau, mode }: { bandeau: Bandeau; mode: ModeSalle }) {
  const direct = bandeau.etat === "direct";
  return (
    <div className={styles.apercu} role="status" aria-live="polite" data-etat={bandeau.etat}>
      <span className={styles.apercuPastille} data-etat={bandeau.etat}>{direct ? "En direct" : "Simulation"}</span>
      <span className={styles.apercuTitre}>{bandeau.titre}</span>
      <span className={styles.apercuDetail}>{bandeau.detail}</span>
      {mode !== "arene" && <span className={styles.apercuLegende}>{LEGENDE_MODE[mode]}</span>}
    </div>
  );
}
