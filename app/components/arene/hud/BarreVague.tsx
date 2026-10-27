"use client";

import { memo, useEffect, useState } from "react";
import type { PhaseZombies } from "@/lib/fps/protocole";
import { libelleVague, secondesAvant } from "@/lib/fps/hud-modele";
import styles from "../HudArene.module.css";

/**
 * Barre de vague des zombies (haut centre, à la place de `BarreMatch`) : « MANCHE 7 » en grand, puis « 12 TIGRES » restants à tuer, ou, pendant
 * la pause entre deux manches, le décompte « PAUSE · DÉPART DANS 7 s » (le serveur a déjà passé `manche` au numéro de la manche à venir).
 * Le décompte bat dans ce composant seul (tick local de 250 ms, horloge serveur), jamais dans l'orchestrateur.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« HUD et écrans »)
 */
export interface PropsBarreVague {
  phase: PhaseZombies;
  manche: number;
  /** tigres restants à tuer (pas encore apparus compris) */
  restants: number;
  /** fin de la pause (horodatage serveur, ms) */
  finT: number;
  maintenantServeur(): number;
}

function BarreVagueBrute({ phase, manche, restants, finT, maintenantServeur }: PropsBarreVague) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "pause") return;
    const i = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [phase]);
  const secondes = phase === "pause" ? secondesAvant(finT, maintenantServeur()) : 0;
  const l = libelleVague(phase, manche, restants, secondes);
  return (
    <section className={`${styles.plaque} ${styles.vague}`} data-pause={l.pause ? "oui" : "non"} aria-label="Vague">
      <b className={styles.vagueTitre}>{l.titre}</b>
      <span className={styles.vagueDetail} data-etat={phase === "manche" && restants <= 3 && restants > 0 ? "fin" : "normal"}>{l.detail}</span>
    </section>
  );
}

const BarreVague = memo(BarreVagueBrute);
export default BarreVague;
