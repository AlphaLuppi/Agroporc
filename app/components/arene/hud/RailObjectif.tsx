"use client";

import type { CSSProperties } from "react";
import { estLeader, positionsRail, rangs, type LigneScore } from "@/lib/fps/classement";
import styles from "./TableauScores.module.css";

/**
 * Rail de course à l'objectif (§8.2) : un jeton par joueur sur 0 → objectif (initiale sur plaque, couleur du serveur en liseré),
 * ▼ pour moi, ★ pour le leader, glissement de 300 ms (désactivé en mouvement réduit). Les jetons proches se répartissent sur
 * plusieurs voies. Décoratif (`aria-hidden`) : toute l'information est dans le tableau.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsRailObjectif {
  /** lignes triées (sortie de `construireLignes`) */
  lignes: readonly LigneScore[];
  objectif: number;
  moiId: string | null;
}

export default function RailObjectif({ lignes, objectif, moiId }: PropsRailObjectif) {
  const positions = positionsRail(lignes, objectif);
  const r = rangs(lignes);
  const voies = positions.reduce((m, p) => Math.max(m, p.voie + 1), 1);
  return (
    <div className={styles.rail} aria-hidden="true" style={{ "--voies": voies } as CSSProperties}>
      <div className={styles.piste} />
      <span className={`${styles.borne} ${styles.borneDebut}`}>0</span>
      <span className={`${styles.borne} ${styles.borneFin}`}>{objectif}</span>
      {lignes.map((l, i) => {
        const p = positions[i];
        const moi = l.id === moiId;
        const leader = estLeader(l, r[i]);
        return (
          <span
            key={l.id}
            className={`${styles.jeton} ${moi ? styles.jetonMoi : ""}`}
            style={{ "--p": p.position, "--voie": p.voie, "--jeton-couleur": l.couleur } as CSSProperties}
          >
            {moi && <span className={styles.repere}>▼</span>}
            {leader && <span className={styles.repere}>★</span>}
            {l.pseudo.trim().charAt(0) || "?"}
          </span>
        );
      })}
    </div>
  );
}
