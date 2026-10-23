"use client";

import { memo, type RefObject } from "react";
import type { InfoVehicule, JoueurPublic } from "@/lib/fps/protocole";
import styles from "../HudArene.module.css";

/**
 * Bloc véhicule (bas centre, 420×150u, §5.4) : vitesse en km/h (`HudLive.vitesseKmh`, écrite hors React), rôle écrit (CONDUCTEUR / PASSAGER),
 * vue de dessus 2×2 des sièges (0 avant-gauche = conducteur, 1 avant-droit, 2 et 3 arrière, comme `SIEGES_LOCAUX` de `vehicule.ts`),
 * chaque cellule = pastille + pseudo (« libre » si vide), mon siège cadré en ambre avec « (vous) » pour les lecteurs d'écran, et le rappel
 * des touches réellement assignées.
 */
export interface PropsBlocVehicule {
  /** siège occupé 0..3 */
  siege: number;
  vehiculeId: number;
  sieges: readonly InfoVehicule[];
  joueurs: readonly JoueurPublic[];
  monId: string | null;
  toucheInteragir: string;
  toucheSiege: string;
  refKmh: RefObject<HTMLElement | null>;
}

const NOMBRE_SIEGES = 4;

function BlocVehiculeBrut({ siege, vehiculeId, sieges, joueurs, monId, toucheInteragir, toucheSiege, refKmh }: PropsBlocVehicule) {
  const v = sieges.find((x) => x.id === vehiculeId);
  const conducteur = siege === 0;
  return (
    <section className={`${styles.plaque} ${styles.vehicule}`} aria-label="Véhicule">
      <div className={styles.vehiculeVitesse}>
        <b ref={refKmh as RefObject<HTMLElement>} className={styles.kmh}>0</b>
        <span className={styles.kmhUnite}>km/h</span>
      </div>
      <p className={styles.vehiculeRole}>
        {conducteur ? "CONDUCTEUR" : "PASSAGER"} <span>place {siege + 1}/{NOMBRE_SIEGES}</span>
      </p>
      <ul className={styles.sieges} aria-label="Places">
        {Array.from({ length: NOMBRE_SIEGES }, (_, i) => {
          const occupant = v?.sieges[i] ?? null;
          const j = occupant ? joueurs.find((x) => x.id === occupant) : undefined;
          const moi = occupant !== null && occupant === monId;
          return (
            <li key={i} className={`${styles.siege} ${moi ? styles.siegeMoi : ""}`} aria-current={moi ? "true" : undefined}>
              <span className={styles.siegeNum}>{i + 1}</span>
              {occupant ? (
                <>
                  <i className={styles.pastille} style={{ background: j?.couleur }} aria-hidden="true" />
                  <b>{moi ? "VOUS" : (j?.pseudo ?? "Agent")}</b>
                  {moi && <span className={styles.srSeul}> (vous)</span>}
                </>
              ) : (
                <span className={styles.siegeLibre}>libre</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.vehiculeTouches}>
        {toucheSiege && <><kbd>{toucheSiege}</kbd> place</>}
        {toucheSiege && toucheInteragir && "   "}
        {toucheInteragir && <><kbd>{toucheInteragir}</kbd> descendre</>}
      </p>
    </section>
  );
}

const BlocVehicule = memo(BlocVehiculeBrut);
export default BlocVehicule;
