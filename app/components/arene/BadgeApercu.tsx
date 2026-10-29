"use client";

import { LEGENDE_MODE, type Bandeau } from "@/lib/fps/apercu-source";
import styles from "../Agroparc3D.module.css";

/**
 * Bandeau de l'aperçu par mode de la vue Palantir : « SIMULATION » (contour en pointillés, faux joueurs) ou « EN DIRECT » (pastille pleine,
 * vraies données du serveur), le mode et un détail. Remplace la légende du bas à gauche hors arène (la légende du mode suit). Le mode affiché est
 * celui du bandeau (`bandeau.mode`), qui change au point haut de la transition de caméra : titre, détail et légende restent d'accord.
 * Seul l'ÉTAT (simulation ou direct) et le mode sont dans la région `status` : le détail chiffré (tigres, joueurs en vie, palier de zone) change
 * plusieurs fois par seconde et saturerait la file d'annonces d'un lecteur d'écran (le panneau Arène a besoin de la sienne) ; aucune information
 * portée par la seule couleur.
 */
export default function BadgeApercu({ bandeau }: { bandeau: Bandeau }) {
  const direct = bandeau.etat === "direct";
  return (
    <div className={styles.apercu} data-etat={bandeau.etat} data-apercu="">
      <span className={styles.apercuEtat} role="status" aria-live="polite">
        <span className={styles.apercuPastille} data-etat={bandeau.etat}>{direct ? "En direct" : "Simulation"}</span>
        <span className={styles.apercuTitre}>{bandeau.titre}</span>
      </span>
      <span className={styles.apercuDetail} aria-live="off">{bandeau.detail}</span>
      {bandeau.mode !== "arene" && <span className={styles.apercuLegende}>{LEGENDE_MODE[bandeau.mode]}</span>}
    </div>
  );
}
