"use client";

import { memo } from "react";
import { formatMetres } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Lunette du sniper (§5.3) : cache noir en cercle de 39 vmin, réticule en croix, « ×4 » (`zoomX`) et distance de la cible visée
 * (`distanceVisee`, absente si −1) à droite et sous le réticule. Les blocs de coin restent à leur place, sur le noir plein.
 * Le cercle de dispersion n'existe plus (v2 §13.1). Décoratif, sauf la télémétrie qui est du texte.
 */
export interface PropsLunette {
  zoomX: number;
  /** m, −1 = rien de visé */
  distanceVisee: number;
}

function LunetteBrute({ zoomX, distanceVisee }: PropsLunette) {
  return (
    <div className={styles.lunette}>
      <i className={styles.lunetteH} aria-hidden="true" /><i className={styles.lunetteV} aria-hidden="true" />
      <div className={styles.lunetteTelemetrie}>
        {zoomX > 0 && <span className={styles.lunetteZoom}>×{zoomX}</span>}
        {distanceVisee >= 0 && <span className={styles.lunetteDistance}>{formatMetres(distanceVisee)}</span>}
      </div>
    </div>
  );
}

const Lunette = memo(LunetteBrute);
export default Lunette;
