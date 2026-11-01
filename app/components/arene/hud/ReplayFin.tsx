"use client";

import { COLONNES_COMPACTES, estLeader, raisonFinMatch, titreVainqueur, type LigneScore as DonneesLigne } from "@/lib/fps/classement";
import LigneScore, { CLASSE_COLONNE } from "./LigneScore";
import styles from "./FinDeMatch.module.css";
import tableau from "./TableauScores.module.css";

/**
 * Fin de match avec replay (arène) : pendant que la caméra rejoue les plus beaux moments, rien ne couvre l'image. Un bandeau en haut donne le
 * titre du moment (« Triple kill · Alice »), son détail et sa progression, le classement complet reste sur le côté (ma ligne surlignée), la
 * commande « Moment suivant » est en bas. Le voile et le podium reviennent une fois le replay fini (`FinDeMatch`).
 * Données : `hud.replayPhase` / `replayIndex` / `replayTotal` / `replayTitre` / `replayDetail` / `replayProg` (jeu-replay-fin.ts).
 */
export interface ReplayFinHud {
  phase: "attente" | "lecture";
  index: number;
  total: number;
  titre: string;
  detail: string;
  progression: number;
}

export interface PropsReplayFin {
  replay: ReplayFinHud;
  lignes: readonly DonneesLigne[];
  rangs: readonly number[];
  monId: string | null;
  objectif: number;
  /** libellé de la touche « passer » (Espace par défaut) */
  touche: string;
  surSuivant?(): void;
  /** compte à rebours jusqu'au prochain match */
  compte: React.ReactNode;
}

export default function ReplayFin({ replay, lignes, rangs, monId, objectif, touche, surSuivant, compte }: PropsReplayFin) {
  const lecture = replay.phase === "lecture";
  return (
    <section className={styles.replay} aria-label="Fin de match, replay">
      <header className={styles.replayHaut}>
        <p className={styles.replayEtiquette}>
          Match terminé <span aria-hidden="true">·</span> {titreVainqueur(lignes as DonneesLigne[])}
        </p>
        <div role="status" aria-live="polite" className={styles.replayMoment}>
          {lecture ? (
            <>
              <h2 className={styles.replayTitre}>{replay.titre}</h2>
              <p className={styles.replayDetail}>{replay.detail}</p>
            </>
          ) : (
            <h2 className={styles.replayTitre}>Replay du match</h2>
          )}
        </div>
        {lecture && (
          <>
            <ol className={styles.replayPoints} aria-label={`Moment ${replay.index} sur ${replay.total}`}>
              {Array.from({ length: replay.total }, (_, i) => (
                <li key={i} data-etat={i + 1 < replay.index ? "fait" : i + 1 === replay.index ? "courant" : "avenir"} />
              ))}
            </ol>
            <div className={styles.replayBarre} aria-hidden="true"><i style={{ width: `${Math.round(replay.progression * 100)}%` }} /></div>
          </>
        )}
      </header>

      <aside className={styles.replayCote} aria-label="Classement">
        <h3 className={styles.titreColonne}>Classement</h3>
        <p className={styles.replayRaison}>{raisonFinMatch(lignes as DonneesLigne[], objectif)}</p>
        <div className={`${tableau.defile} ${styles.replayListe}`}>
          <table className={tableau.table} data-densite="serree" data-sans-entete="oui">
            <caption className={tableau.sr}>Classement du match</caption>
            <colgroup>{COLONNES_COMPACTES.map((c) => <col key={c} className={CLASSE_COLONNE[c]} />)}</colgroup>
            <tbody>
              {lignes.map((l, k) => (
                <LigneScore
                  key={l.id}
                  ligne={l}
                  rang={rangs[k]}
                  egalite={rangs[k - 1] === rangs[k] || rangs[k + 1] === rangs[k]}
                  colonnes={COLONNES_COMPACTES}
                  moi={l.id === monId}
                  leader={estLeader(l, rangs[k])}
                />
              ))}
            </tbody>
          </table>
        </div>
      </aside>

      <footer className={styles.replayBas}>
        {lecture && (
          <button type="button" className={styles.replayBouton} onClick={surSuivant}>
            {replay.index >= replay.total ? "Terminer le replay" : "Moment suivant"} {touche && <kbd>{touche}</kbd>}
          </button>
        )}
        {compte}
      </footer>
    </section>
  );
}
