"use client";

import { memo } from "react";
import { formatMetres } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Lunette du sniper (§5.3) : cache noir en cercle de 39 vmin, réticule en croix, « ×4 » (`zoomX`) et distance de la cible visée
 * (`distanceVisee`, absente si −1) à droite et sous le réticule. Les blocs de coin restent à leur place, sur le noir plein.
 * En lunette le tir est exact (pas de cercle de dispersion, v3 §1). Plusieurs niveaux de zoom (v3 §1) : une pastille par niveau sous
 * le grossissement, l'actuelle pleine, et le rappel de la touche (molette ou `zoomLunette`). Décoratif, sauf la télémétrie qui est du texte.
 * (v8, zombies) Lunette thermique (Sniper en croûte, Railgun thermidor) : décor éteint dans le cercle, tigres incandescents, mention « THERMIQUE ».
 */
export interface PropsLunette {
  zoomX: number;
  /** m, −1 = rien de visé */
  distanceVisee: number;
  /** niveau de zoom courant (index) et nombre de niveaux ; moins de 2 niveaux : pas de pastilles */
  niveau?: number;
  niveaux?: number;
  /** libellé de la touche « niveau de zoom suivant » */
  toucheZoom?: string;
  /** (v8) lunette thermique */
  thermique?: boolean;
}

function LunetteBrute({ zoomX, distanceVisee, niveau = -1, niveaux = 0, toucheZoom, thermique = false }: PropsLunette) {
  return (
    <div className={`${styles.lunette} ${thermique ? styles.lunetteThermique : ""}`} data-thermique={thermique ? "oui" : undefined}>
      <i className={styles.lunetteH} aria-hidden="true" /><i className={styles.lunetteV} aria-hidden="true" />
      <div className={styles.lunetteTelemetrie}>
        {thermique && <span className={styles.lunetteMode}>THERMIQUE</span>}
        {zoomX > 0 && <span className={styles.lunetteZoom}>×{zoomX}</span>}
        {niveaux > 1 && (
          <span className={styles.lunetteNiveaux} aria-hidden="true">
            {Array.from({ length: niveaux }, (_, i) => <i key={i} data-actif={i === niveau ? "oui" : undefined} />)}
            <small>{toucheZoom && toucheZoom !== "—" ? `${toucheZoom} / molette` : "molette"}</small>
          </span>
        )}
        {distanceVisee >= 0 && <span className={styles.lunetteDistance}>{formatMetres(distanceVisee)}</span>}
      </div>
    </div>
  );
}

const Lunette = memo(LunetteBrute);
export default Lunette;
