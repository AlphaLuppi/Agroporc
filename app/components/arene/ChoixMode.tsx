"use client";

import { useEffect, useId, useRef } from "react";
import type { ModeSalle } from "@/lib/fps/protocole";
import type { Salons } from "./contrats";
import { CARTES_MODE, TEXTE_MODE_INDISPONIBLE, compteurMode } from "./lobby-modele";
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
  /** modes qu'on ne peut pas choisir sur cet appareil (zombies sur un écran tactile : clavier et souris requis) */
  indisponibles?: readonly ModeSalle[];
}

/**
 * Le lobby du mode confirmé remplace l'autre (`Arene` ↔ `LobbyZombies`), donc ce groupe est démonté puis remonté à chaque changement
 * confirmé par le serveur : un joueur au clavier (flèches) perdrait le focus à chaque bascule. On note l'instant du dernier choix et le
 * groupe remonté dans les secondes qui suivent redonne le focus à sa radio cochée.
 */
const DELAI_FOCUS_MS = 4000;
let dernierChoixT = 0;

export default function ChoixMode({ mode, salons = null, surChoisir, desactive = false, indisponibles = [] }: PropsChoixMode) {
  const id = useId();
  const groupe = useRef<HTMLFieldSetElement | null>(null);
  useEffect(() => {
    if (Date.now() - dernierChoixT > DELAI_FOCUS_MS) return;
    dernierChoixT = 0;
    groupe.current?.querySelector<HTMLInputElement>("input:checked")?.focus({ preventScroll: true });
  }, []);
  return (
    <fieldset ref={groupe} className={styles.modes} role="radiogroup" disabled={desactive}>
      <legend>Mode de jeu</legend>
      <div className={styles.modesGrille}>
        {CARTES_MODE.map((c) => {
          const coche = c.mode === mode;
          const ferme = indisponibles.includes(c.mode);
          return (
            <label key={c.mode} className={`${styles.carteMode} ${coche ? styles.carteModeChoisie : ""} ${ferme ? styles.carteModeFermee : ""}`}>
              <input
                type="radio"
                name={`${id}-mode`}
                value={c.mode}
                checked={coche}
                disabled={ferme}
                aria-labelledby={`${id}-${c.mode}-nom`}
                aria-describedby={`${id}-${c.mode}-desc ${id}-${c.mode}-nb`}
                onChange={() => { dernierChoixT = Date.now(); surChoisir(c.mode); }}
              />
              <span id={`${id}-${c.mode}-nom`} className={styles.carteModeNom}>{c.titre}</span>
              <span id={`${id}-${c.mode}-nb`} className={styles.carteModeCompteur}>{ferme ? TEXTE_MODE_INDISPONIBLE : compteurMode(c.mode, salons)}</span>
              <span id={`${id}-${c.mode}-desc`} className={styles.carteModeDesc}>{c.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
