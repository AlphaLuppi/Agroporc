"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { STATS } from "@/lib/fps/armes";
import type { ArmeFeuId } from "@/lib/fps/protocole";
import { stockageNavigateur } from "@/lib/fps/touches";
import {
  ARMES_A_VISEUR, EVENEMENT_VISEURS, LIBELLES_VISEURS, avecChoix, ecrireViseurs, lireViseurs, viseurChoisi, viseursDisponibles,
  type ViseurId, type ViseursChoisis,
} from "@/lib/fps/viseurs";
import styles from "./SelecteurViseur.module.css";

/**
 * Viseurs choisis (mémorisés dans `localStorage`, relus par le jeu en cours grâce à l'événement `pdj-fps-viseurs`) : lecture au montage
 * (jamais pendant le rendu serveur), synchronisation entre les sélecteurs affichés en même temps.
 */
function useViseurs(): [ViseursChoisis, (arme: ArmeFeuId, id: ViseurId) => void] {
  const [choix, setChoix] = useState<ViseursChoisis>({});
  useEffect(() => {
    setChoix(lireViseurs(stockageNavigateur()));
    const relire = () => setChoix(lireViseurs(stockageNavigateur()));
    window.addEventListener(EVENEMENT_VISEURS, relire);
    return () => window.removeEventListener(EVENEMENT_VISEURS, relire);
  }, []);
  const poser = useCallback((arme: ArmeFeuId, id: ViseurId) => {
    const stockage = stockageNavigateur();
    const suivant = avecChoix(lireViseurs(stockage), arme, id);
    ecrireViseurs(suivant, stockage);
    setChoix(suivant);
    window.dispatchEvent(new Event(EVENEMENT_VISEURS));
  }, []);
  return [choix, poser];
}

/**
 * Viseur de l'arme `arme` : une rangée de petits boutons (aucun, point rouge, holo, lunette ×2 / ×4 selon l'arme). Rien n'est affiché pour une
 * arme qui n'a pas de choix (le sniper garde sa lunette). Composant autonome : il lit et écrit lui-même le choix, sans props de l'équipement.
 * Spec : lib/fps/viseurs.ts.
 */
export default function SelecteurViseur({ arme, idGroupe, sansTitre = false }: { arme: ArmeFeuId; idGroupe: string; sansTitre?: boolean }) {
  const [choix, poser] = useViseurs();
  const id = useId();
  const dispo = viseursDisponibles(arme);
  if (dispo.length === 0) return null;
  const courant = viseurChoisi(choix, arme);
  const idTitre = `${id}-${idGroupe}-${arme}`;
  return (
    <div className={styles.viseur} role="group" aria-labelledby={idTitre}>
      <span id={idTitre} className={sansTitre ? styles.cache : styles.titre}>{sansTitre ? `Viseur, ${STATS[arme].nom}` : "Viseur"}</span>
      <span className={styles.boutons}>
        {dispo.map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.bouton} ${courant === v ? styles.choisi : ""}`}
            aria-pressed={courant === v}
            onClick={() => poser(arme, v)}
          >
            {LIBELLES_VISEURS[v]}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Tous les viseurs, arme par arme, repliés (Battle Royale : les armes se ramassent, on les règle d'avance depuis le menu pause). */
export function ListeViseurs({ idGroupe }: { idGroupe: string }) {
  return (
    <details className={styles.liste}>
      <summary>Viseurs des armes</summary>
      {ARMES_A_VISEUR.map((a) => (
        <div key={a} className={styles.ligneArme}>
          <span className={styles.nomArme}>{STATS[a].nom}</span>
          <SelecteurViseur arme={a} idGroupe={idGroupe} sansTitre />
        </div>
      ))}
    </details>
  );
}
