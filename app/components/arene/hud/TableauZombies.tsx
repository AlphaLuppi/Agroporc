"use client";

import { useMemo } from "react";
import type { EtatPartieZombies } from "@/lib/fps/protocole";
import { lignesBilanZombies, totauxBilanZombies } from "@/lib/fps/classement";
import { formatArgent, formatNombre } from "@/lib/fps/hud-modele";
import { etiquetteEtatZombies } from "../lobby-modele";
import styles from "./FinDePartieZombies.module.css";

/**
 * Tableau des scores des zombies (Tab maintenu) : la manche, puis pour chaque joueur son état, ses tigres tués, son argent gagné et ses relèves.
 * Remplace le tableau de l'arène (« premier à 30 kills » n'a pas de sens en coopératif).
 */
export interface PropsTableauZombies {
  partie: EtatPartieZombies;
  monId: string | null;
}

export default function TableauZombies({ partie, monId }: PropsTableauZombies) {
  const lignes = useMemo(() => lignesBilanZombies(partie.joueurs, monId), [partie.joueurs, monId]);
  const totaux = useMemo(() => totauxBilanZombies(lignes), [lignes]);
  const etat = (id: string) => etiquetteEtatZombies(partie.joueurs.find((j) => j.id === id)?.etat ?? "attente");
  return (
    <section className={styles.tableauJeu} aria-label="Tableau des scores">
      <div className={styles.contenu}>
        <h2 className={styles.titreJeu}>Zombies tigres · manche {partie.manche}</h2>
        <table className={styles.table}>
          <caption className={styles.sr}>Tableau des scores de la partie de zombies</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.joueurCol}>Joueur</th>
              <th scope="col">État</th>
              <th scope="col">Tigres tués</th>
              <th scope="col">Argent gagné</th>
              <th scope="col">Relèves</th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && <tr><td colSpan={5} className={styles.vide}>Personne n&apos;a encore joué.</td></tr>}
            {lignes.map((l) => (
              <tr key={l.id} data-moi={l.moi ? "oui" : "non"}>
                <th scope="row" className={styles.joueurCol}>
                  <i className={styles.pastille} style={{ background: l.couleur }} aria-hidden="true" />
                  <span className={styles.pseudo}>{l.pseudo}</span>{l.moi && <em> (vous)</em>}
                </th>
                <td>{etat(l.id)}</td>
                <td>{formatNombre(l.kills)}</td>
                <td>{formatArgent(l.gagne)}</td>
                <td>{formatNombre(l.reanimations)}</td>
              </tr>
            ))}
          </tbody>
          {lignes.length > 1 && (
            <tfoot>
              <tr>
                <th scope="row" className={styles.joueurCol}>Équipe</th>
                <td />
                <td>{formatNombre(totaux.kills)}</td>
                <td>{formatArgent(totaux.gagne)}</td>
                <td>{formatNombre(totaux.reanimations)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
