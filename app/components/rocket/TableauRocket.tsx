import { COLONNES_STATS, classementParEquipe } from "@/lib/rocket/hud-modele";
import type { Equipe } from "@/lib/rocket/contrat";
import type { PropsTableauRocket } from "./contrats";
import styles from "./Rocket.module.css";

/**
 * Tableau des statistiques, une section par équipe (Trèfles puis Tigres), joueurs triés par points : joueur, points, buts, passes décisives,
 * arrêts, tirs cadrés, démolitions. Un vrai `<table>` : en-têtes de colonnes lus par les lecteurs d'écran, la couleur de l'équipe n'est jamais
 * le seul indice (le nom de l'équipe est écrit dans l'en-tête de chaque section).
 */
export default function TableauRocket({ lignes, nomsEquipes, equipeJoueur, legende = "Statistiques des joueurs" }: PropsTableauRocket) {
  const parEquipe = classementParEquipe(lignes);
  const ordre: Equipe[] = ["bleue", "orange"];
  return (
    <table className={styles.tableau}>
      <caption className={styles.reserveLecteurs}>{legende}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.colJoueur}>Joueur</th>
          {COLONNES_STATS.map((c) => (
            <th key={c.cle} scope="col" className={styles.colChiffre} title={c.long} aria-label={c.long}>{c.court}</th>
          ))}
        </tr>
      </thead>
      {ordre.map((e) => parEquipe[e].length > 0 && (
        <tbody key={e} data-equipe={e}>
          <tr className={styles.ligneEquipe}>
            <th scope="colgroup" colSpan={COLONNES_STATS.length + 1}>{nomsEquipes[e]}{e === equipeJoueur ? " (votre équipe)" : ""}</th>
          </tr>
          {parEquipe[e].map((l) => (
            <tr key={l.id} data-humain={l.humain ? "oui" : undefined}>
              <th scope="row" className={styles.colJoueur}>{l.nom}{l.humain ? " (vous)" : ""}</th>
              {COLONNES_STATS.map((c) => <td key={c.cle} className={styles.colChiffre}>{l.stats[c.cle]}</td>)}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
