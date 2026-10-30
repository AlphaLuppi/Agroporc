"use client";

import type { CSSProperties } from "react";
import { nomArme } from "@/lib/fps/armes";
import { formatMetres, libellePlaceBr } from "@/lib/fps/hud-modele";
import type { InfoTueur } from "@/lib/fps/protocole";
import { nomAffiche } from "@/lib/fps/classement";
import { libelleCause } from "../armesInfo";
import type { DerniereMort } from "../contrats";
import styles from "./EcranSpectateur.module.css";

/**
 * Écrans de la mort définitive du Battle Royale (le serveur ne fait jamais réapparaître) :
 *  - `CarteEliminationBr` : la carte entre les bandes de la killcam (phase « carte »), sans compte à rebours de réapparition ni choix d'équipement :
 *    « Éliminé par <pseudo> » (ou la cause en toutes lettres : tempête, abandon…), l'arme et la distance, la place provisoire ;
 *  - `EcranSpectateur` (défaut) : le bandeau du spectateur, une fois la killcam passée ou sans killcam (tempête) : « Éliminé · place #12 sur 37 » (« Spectateur »
 *    pour qui est venu regarder la partie en cours), la cause,
 *    le joueur suivi et le rappel des commandes avec leurs touches RÉELLES. Aucun bouton : la souris reste prise par le jeu (pointer lock) tant que le
 *    joueur n'a pas appuyé sur Échap, et Échap ouvre le menu pause, qui remplace ce bandeau (c'est là que se trouve « Quitter »). Les flèches changent de
 *    cible, le clic de tir passe au suivant.
 *    Le HUD de combat reste caché ; la mini-carte, la grande carte (M), les scores (Tab) et le menu pause (Échap) restent accessibles.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Éliminations, +50 PV, spectateur »)
 */
export interface PropsCarteEliminationBr {
  derniereMort: DerniereMort | null;
  killcamInfo: InfoTueur | null;
  /** place provisoire (vivants restants + 1 à ma mort) et nombre de partants */
  place: number | null;
  total: number;
}

export function CarteEliminationBr({ derniereMort, killcamInfo, place, total }: PropsCarteEliminationBr) {
  const parJoueur = derniereMort?.cause === "arme" && (killcamInfo !== null || derniereMort.par !== "");
  const pseudo = killcamInfo?.pseudo ?? derniereMort?.par ?? "";
  const couleur = killcamInfo?.couleur ?? derniereMort?.parCouleur;
  const arme = killcamInfo?.arme ?? derniereMort?.arme;
  return (
    <section className={styles.carte} aria-label="Élimination">
      {parJoueur ? (
        <h2 className={styles.titre} role="status">
          <small>Éliminé par</small>
          <span className={styles.tueur}>
            {couleur && <span className={styles.pastille} style={{ background: couleur }} aria-hidden="true" />}
            <span className={styles.pseudo}>{pseudo}</span>
          </span>
        </h2>
      ) : (
        <h2 className={styles.titre} role="status">{derniereMort ? libelleCause(derniereMort.arme, derniereMort.cause, derniereMort.par) : "Éliminé"}</h2>
      )}
      {parJoueur && arme && (
        <p className={styles.detail}>{nomArme(arme)}{killcamInfo ? ` · ${formatMetres(killcamInfo.distance)}` : ""}</p>
      )}
      <p className={styles.place}>{libellePlaceBr(place, total)}</p>
    </section>
  );
}

export interface PropsEcranSpectateur {
  derniereMort: DerniereMort | null;
  place: number | null;
  total: number;
  /** joueur suivi (id) et la liste de présence pour son nom ; null = personne à suivre */
  suiviId: string | null;
  joueurs: readonly { id: string; pseudo: string; couleur: string; bot?: boolean }[];
  /** touches réelles des actions de spectateur (vides si non assignées) */
  toucheSuivant: string;
  touchePrecedent: string;
  /** ligne du chat vocal avec son tueur (lien de killcam en cours), "" = rien */
  voix?: string;
  /** spectateur venu regarder la partie en cours (ni éliminé, ni place) */
  externe?: boolean;
}

export default function EcranSpectateur({
  derniereMort, place, total, suiviId, joueurs, toucheSuivant, touchePrecedent, voix = "", externe = false,
}: PropsEcranSpectateur) {
  const suivi = suiviId ? joueurs.find((j) => j.id === suiviId) ?? null : null;
  const cause = derniereMort ? libelleCause(derniereMort.arme, derniereMort.cause, derniereMort.par) : "";
  const parJoueur = derniereMort?.cause === "arme";
  return (
    <section className={styles.spectateur} aria-label="Spectateur">
      <div className={styles.bandeau}>
        <h2 className={styles.titreBandeau} role="status">{externe ? "Spectateur" : libellePlaceBr(place, total)}</h2>
        {derniereMort && <p className={styles.cause}>{parJoueur ? `Éliminé par ${derniereMort.par || "un joueur"} · ${cause}` : cause}</p>}
        <p className={styles.suivi}>
          {suivi
            ? <>Vous suivez <i className={styles.pastille} style={{ "--couleur": suivi.couleur } as CSSProperties} aria-hidden="true" /><b>{nomAffiche(suivi)}</b></>
            : "Personne à suivre pour l'instant"}
        </p>
        {voix && <p className={styles.suivi}>{voix}</p>}
        <p className={styles.aide}>
          {touchePrecedent && <><kbd>{touchePrecedent}</kbd> joueur précédent · </>}
          {toucheSuivant && <><kbd>{toucheSuivant}</kbd> joueur suivant · </>}
          <kbd>Clic</kbd> joueur suivant · <kbd>Échap</kbd> menu (Quitter)
        </p>
      </div>
    </section>
  );
}
