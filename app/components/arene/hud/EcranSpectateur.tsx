"use client";

import type { CSSProperties } from "react";
import { nomArme } from "@/lib/fps/armes";
import { formatMetres, libellePlaceBr } from "@/lib/fps/hud-modele";
import type { InfoTueur } from "@/lib/fps/protocole";
import { libelleCause } from "../armesInfo";
import type { DerniereMort } from "../contrats";
import styles from "./EcranSpectateur.module.css";

/**
 * Écrans de la mort définitive du Battle Royale (le serveur ne fait jamais réapparaître) :
 *  - `CarteEliminationBr` : la carte entre les bandes de la killcam (phase « carte »), sans compte à rebours de réapparition ni choix d'équipement :
 *    « Éliminé par <pseudo> » (ou la cause en toutes lettres : tempête, abandon…), l'arme et la distance, la place provisoire ;
 *  - `EcranSpectateur` (défaut) : le bandeau du spectateur, une fois la killcam passée ou sans killcam (tempête) : « Éliminé · place #12 sur 37 », la cause,
 *    le joueur suivi et les boutons Précédent / Suivant avec leurs touches RÉELLES (la souris est prise : le clavier fait le même travail), « Quitter ».
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
  joueurs: readonly { id: string; pseudo: string; couleur: string }[];
  /** touches réelles des actions de spectateur (vides si non assignées) */
  toucheSuivant: string;
  touchePrecedent: string;
  /** clics des boutons (absents : boutons non rendus, le clavier suffit) */
  surSuivant?(): void;
  surPrecedent?(): void;
  surQuitter(): void;
}

export default function EcranSpectateur({
  derniereMort, place, total, suiviId, joueurs, toucheSuivant, touchePrecedent, surSuivant, surPrecedent, surQuitter,
}: PropsEcranSpectateur) {
  const suivi = suiviId ? joueurs.find((j) => j.id === suiviId) ?? null : null;
  const cause = derniereMort ? libelleCause(derniereMort.arme, derniereMort.cause, derniereMort.par) : "";
  const parJoueur = derniereMort?.cause === "arme";
  return (
    <section className={styles.spectateur} aria-label="Spectateur">
      <div className={styles.bandeau}>
        <h2 className={styles.titreBandeau} role="status">{libellePlaceBr(place, total)}</h2>
        {derniereMort && <p className={styles.cause}>{parJoueur ? `Éliminé par ${derniereMort.par || "un joueur"} · ${cause}` : cause}</p>}
        <p className={styles.suivi}>
          {suivi
            ? <>Vous suivez <i className={styles.pastille} style={{ "--couleur": suivi.couleur } as CSSProperties} aria-hidden="true" /><b>{suivi.pseudo}</b></>
            : "Personne à suivre pour l'instant"}
        </p>
        <div className={styles.boutons}>
          {surPrecedent && (
            <button type="button" className={styles.bouton} onClick={surPrecedent}>
              Précédent {touchePrecedent && <kbd>{touchePrecedent}</kbd>}
            </button>
          )}
          {surSuivant && (
            <button type="button" className={styles.bouton} onClick={surSuivant}>
              Suivant {toucheSuivant && <kbd>{toucheSuivant}</kbd>}
            </button>
          )}
          <button type="button" className={styles.quitter} onClick={surQuitter}>Quitter</button>
        </div>
        {(!surPrecedent || !surSuivant) && (toucheSuivant || touchePrecedent) && (
          <p className={styles.aide}>
            {touchePrecedent && <><kbd>{touchePrecedent}</kbd> joueur précédent</>}
            {touchePrecedent && toucheSuivant && " · "}
            {toucheSuivant && <><kbd>{toucheSuivant}</kbd> joueur suivant</>}
          </p>
        )}
      </div>
    </section>
  );
}
