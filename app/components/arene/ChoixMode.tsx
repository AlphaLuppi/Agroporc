"use client";

import { useId } from "react";
import type { ModeSalle } from "@/lib/fps/protocole";
import type { Salons } from "./contrats";
import { CARTES_MODE, compteurMode } from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * Choix du mode de jeu en tête du panneau « Arène » de la vue Palantir : deux cartes radio natives (flèches du clavier, un seul arrêt de
 * tabulation), chacune avec le nombre de joueurs de sa salle (message `salons`, tiret tant qu'il n'est pas arrivé). Le mode coché est celui
 * qui est DEMANDÉ : il revient en arrière si le serveur refuse le changement. Le lobby du mode confirmé s'affiche dessous.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« HUD et écrans »)
 */
export interface PropsChoixMode {
  /** mode coché */
  mode: ModeSalle;
  salons?: Salons | null;
  surChoisir(mode: ModeSalle): void;
  /** changement impossible (connexion perdue) */
  desactive?: boolean;
}

export default function ChoixMode({ mode, salons = null, surChoisir, desactive = false }: PropsChoixMode) {
  const id = useId();
  return (
    <fieldset className={styles.modes} role="radiogroup" disabled={desactive}>
      <legend>Mode de jeu</legend>
      <div className={styles.modesGrille}>
        {CARTES_MODE.map((c) => {
          const coche = c.mode === mode;
          return (
            <label key={c.mode} className={`${styles.carteMode} ${coche ? styles.carteModeChoisie : ""}`}>
              <input
                type="radio"
                name={`${id}-mode`}
                value={c.mode}
                checked={coche}
                aria-labelledby={`${id}-${c.mode}-nom`}
                aria-describedby={`${id}-${c.mode}-desc ${id}-${c.mode}-nb`}
                onChange={() => surChoisir(c.mode)}
              />
              <span id={`${id}-${c.mode}-nom`} className={styles.carteModeNom}>{c.titre}</span>
              <span id={`${id}-${c.mode}-nb`} className={styles.carteModeCompteur}>{compteurMode(c.mode, salons)}</span>
              <span id={`${id}-${c.mode}-desc`} className={styles.carteModeDesc}>{c.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
