"use client";

import { memo, useEffect, useState } from "react";
import { libelleDistanceBord, libelleZoneBr, texteHorsZone } from "@/lib/fps/hud-modele";
import type { ZoneBr } from "@/lib/fps/protocole";
import styles from "../HudArene.module.css";

/**
 * Indicateur de la tempête (haut centre, sous la barre) : « LA ZONE SE FERME DANS 0:42 » pendant l'attente, « RÉTRÉCISSEMENT » (avec le temps
 * restant) pendant que le cercle se resserre, « ZONE FERMÉE » ensuite ; la distance au bord en mètres et une flèche vers le centre du cercle
 * (`capCentre` : 0 = devant, + = à droite). Hors zone, l'alerte « HORS ZONE : −4 PV/s » s'écrit en toutes lettres, jamais la couleur seule.
 * Le décompte bat dans ce composant (tick local de 250 ms sur l'horloge serveur), jamais dans l'orchestrateur.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Interface », HUD)
 */
export interface PropsBlocZone {
  zone: ZoneBr | null;
  maintenantServeur(): number;
  /** distance signée au bord de la zone (m, > 0 dehors, < 0 dedans) */
  distanceBord: number;
  /** cap relatif vers le centre du cercle (rad, 0 = devant, + = à droite) */
  capCentre: number;
  /** la tempête me blesse */
  horsZone: boolean;
}

function BlocZoneBrut({ zone, maintenantServeur, distanceBord, capCentre, horsZone }: PropsBlocZone) {
  const [, setTick] = useState(0);
  const actif = !!zone && zone.phase !== "fermee";
  useEffect(() => {
    if (!actif) return;
    const i = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [actif]);
  if (!zone) return null;
  const l = libelleZoneBr(zone, maintenantServeur());
  return (
    <>
      <section className={`${styles.plaque} ${styles.blocZone}`} data-phase={l.phase} data-hors={horsZone ? "oui" : "non"} aria-label="Tempête">
        <p className={styles.zoneTitre}>
          <span>{l.titre}</span>
          {l.chrono && <b className={styles.zoneChrono}>{l.chrono}</b>}
        </p>
        <p className={styles.zoneBord}>
          <svg className={styles.zoneFleche} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${capCentre}rad)` }}>
            <path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="currentColor" />
          </svg>
          <span>{libelleDistanceBord(distanceBord)}</span>
          <span className={styles.zonePalier}>{l.palier}</span>
        </p>
      </section>
      {horsZone && <p className={`${styles.plaque} ${styles.horsZone}`} role="status">{texteHorsZone(zone.degats)}</p>}
    </>
  );
}

const BlocZone = memo(BlocZoneBrut);
export default BlocZone;
