"use client";

import { useId, useRef } from "react";
import { equipeMiseEnAvant, ligneMvp, titreResultat } from "@/lib/rocket/hud-modele";
import type { PropsFinRocket } from "./contrats";
import TableauRocket from "./TableauRocket";
import { usePiegeFocus } from "./usePiegeFocus";
import styles from "./Rocket.module.css";

/**
 * Écran de fin de match (dialogue modal) : issue du point de vue du joueur, score, prolongation éventuelle, meilleur joueur (MVP), tableau
 * complet, « Rejouer » (même configuration, graine neuve) et « Quitter » (retour au lobby). Le résultat est aussi annoncé par la région
 * `aria-live` du HUD.
 */
export default function FinRocket({ resultat, nomsEquipes, surRejouer, surQuitter, moi, enLigne }: PropsFinRocket) {
  const idTitre = useId();
  const racine = useRef<HTMLDivElement>(null);
  const rejouer = useRef<HTMLButtonElement>(null);
  usePiegeFocus(racine, rejouer);
  const t = titreResultat(resultat, nomsEquipes);
  const mvp = ligneMvp(resultat);
  const equipe = equipeMiseEnAvant(resultat);

  return (
    <div className={styles.voile}>
      <div ref={racine} className={`${styles.dialogue} ${styles.dialogueFin}`} role="dialog" aria-modal="true" aria-labelledby={idTitre} data-equipe={equipe} data-issue={t.issue}>
        <p className={styles.sur}>Match terminé</p>
        <h2 id={idTitre} className={styles.titreFin}>{t.titre}</h2>
        <p className={styles.scoreFin}>
          <span data-equipe="bleue"><b>{resultat.score.bleue}</b> {nomsEquipes.bleue}</span>
          <span aria-hidden="true" className={styles.tiret}>-</span>
          <span data-equipe="orange"><b>{resultat.score.orange}</b> {nomsEquipes.orange}</span>
        </p>
        {resultat.prolongation && <p className={styles.prolongFin}>Décidé en prolongation</p>}
        {mvp && (
          <p className={styles.mvp} data-equipe={mvp.equipe}>
            <span className={styles.mvpEtiquette}>Meilleur joueur</span>
            <b>{mvp.nom}</b>
            <span>{mvp.stats.points} points</span>
          </p>
        )}
        <div className={styles.defilement}>
          <TableauRocket lignes={resultat.classement} nomsEquipes={nomsEquipes} equipeJoueur={resultat.equipeJoueur} legende="Statistiques de fin de match" moi={moi} />
        </div>
        {enLigne && (
          <p className={styles.statutRevanche} role="status">
            {enLigne.aVote
              ? `Revanche demandée : ${enLigne.oui}/${enLigne.attendus} joueurs${enLigne.restantS > 0 ? `, ${enLigne.restantS} s pour décider` : ""}.`
              : enLigne.oui > 0
                ? `${enLigne.oui}/${enLigne.attendus} joueurs veulent une revanche${enLigne.restantS > 0 ? `, ${enLigne.restantS} s pour décider` : ""}.`
                : ""}
          </p>
        )}
        <div className={styles.boutons}>
          {enLigne ? (
            <button ref={rejouer} type="button" className={styles.boutonPrincipal} aria-pressed={enLigne.aVote} onClick={surRejouer}>
              Revanche<span className={styles.compteRevanche}>{enLigne.oui > 0 ? ` ${enLigne.oui}/${enLigne.attendus}` : ""}</span>
            </button>
          ) : (
            <button ref={rejouer} type="button" className={styles.boutonPrincipal} onClick={surRejouer}>Rejouer</button>
          )}
          {enLigne?.hote && <button type="button" className={styles.boutonSecondaire} onClick={enLigne.surRetourSalon}>Retour au salon</button>}
          <button type="button" className={styles.boutonSecondaire} onClick={surQuitter}>Quitter</button>
        </div>
      </div>
    </div>
  );
}
