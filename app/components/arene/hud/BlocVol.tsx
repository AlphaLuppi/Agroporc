"use client";

import { memo } from "react";
import { formatMetres, formatVitesse } from "@/lib/fps/hud-modele";
import type { HudEtat } from "@/lib/fps/jeu-types";
import styles from "../HudArene.module.css";

/**
 * Vol du Battle Royale (centre, y = 62 %, comme les invites) : dans l'avion « [Espace] Sauter de l'avion », en chute libre « [Espace] Ouvrir le
 * parachute » avec l'altitude au-dessus du sol et la vitesse de chute, sous voile « PARACHUTE OUVERT », puis « Atterrissage… » le temps que le serveur
 * confirme. La touche est celle RÉELLEMENT assignée au saut (« touche non assignée » sinon). Rien au sol. Scalaires uniquement.
 */
export interface PropsBlocVol {
  phaseVol: NonNullable<HudEtat["phaseVol"]>;
  /** hauteur au-dessus du sol (m) et vitesse de chute (m/s) */
  altitude: number;
  vitesseChute: number;
  /** libellé de la touche de saut (vide = non assignée) */
  toucheSaut: string;
}

function BlocVolBrut({ phaseVol, altitude, vitesseChute, toucheSaut }: PropsBlocVol) {
  if (phaseVol === "" || phaseVol === "sol") return null;
  const action = phaseVol === "avion" ? "Sauter de l'avion" : phaseVol === "libre" ? "Ouvrir le parachute" : "";
  const etat = phaseVol === "voile" ? "PARACHUTE OUVERT" : phaseVol === "attenteAtterri" ? "Atterrissage…" : "";
  return (
    <section className={styles.blocVol} aria-label="Vol">
      {phaseVol !== "avion" && (
        <p className={`${styles.plaque} ${styles.volTele}`}>
          <span>ALTITUDE <b>{formatMetres(altitude)}</b></span>
          <span>CHUTE <b>{formatVitesse(vitesseChute)}</b></span>
        </p>
      )}
      {action && (
        <p className={`${styles.plaque} ${styles.invite} ${styles.volInvite}`}>
          {toucheSaut && <kbd>{toucheSaut}</kbd>} {action}
          {!toucheSaut && <span className={styles.inviteSansTouche}> (touche non assignée)</span>}
        </p>
      )}
      {etat && <p className={`${styles.plaque} ${styles.invite} ${styles.volInvite}`} role="status">{etat}</p>}
    </section>
  );
}

const BlocVol = memo(BlocVolBrut);
export default BlocVol;
