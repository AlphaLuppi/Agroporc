"use client";

import { distinctions, type LigneScore } from "@/lib/fps/classement";
import styles from "./FinDeMatch.module.css";

/**
 * Distinctions de fin de match (§10) : précision, série max, têtes, avec les minimums du §8.2 (10 tirs, 5 touches), calculées côté
 * client par `classement.ts`. Sans lauréat (minimum non atteint ou statistiques absentes) : « — » et le minimum exigé.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsDistinctions {
  /** lignes triées de la fin de match */
  lignes: readonly LigneScore[];
  moiId: string | null;
}

export default function Distinctions({ lignes, moiId }: PropsDistinctions) {
  return (
    <section className={`${styles.colonne} ${styles.colonneDistinctions}`} aria-label="Distinctions">
      <h3 className={styles.titreColonne}>Distinctions</h3>
      <ul className={styles.distinctions}>
        {distinctions(lignes).map((d) => (
          <li key={d.cle}>
            <span className={styles.distinctionLibelle}>{d.libelle}</span>
            {d.id ? (
              <span className={`${styles.distinctionValeur} ${d.id === moiId ? styles.distinctionMoi : ""}`}>
                {d.pseudo} {d.valeur}{d.id === moiId && " (vous)"}
              </span>
            ) : (
              <>
                <span className={styles.distinctionValeur}>—</span>
                <span className={styles.minimum}>{d.minimum}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
