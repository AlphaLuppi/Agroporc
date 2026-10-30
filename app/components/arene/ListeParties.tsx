"use client";

import type { ModeSalle } from "@/lib/fps/protocole";
import { libelleCreation, type LigneParties } from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * Liste « Parties » des lobbies (arène, zombies, Battle Royale) : une ligne par partie du serveur (la mienne marquée « vous »), avec son état et le bouton
 * qui convient (« Rejoindre », « Regarder » pour une partie de Battle Royale en cours), puis « Créer ma partie » (« Créer une arène » en arène). Sans état ni
 * réseau : les lignes viennent de `lignesParties` (`lobby-modele.ts`, pur, testé) et les actions sont des rappels de l'hôte. Les boutons font 40 px de haut
 * au moins sur mobile, tokens `--ag-*` seulement.
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (lot 5a)
 */
export interface PropsListeParties {
  mode: ModeSalle;
  lignes: readonly LigneParties[];
  /** aller dans une partie (lobby ou en cours) */
  surRejoindre(id: string): void;
  /** regarder une partie de Battle Royale en cours (`null` : la mienne) */
  surRegarder?(id: string | null): void;
  /** créer ma partie ; absent : pas de bouton (déjà proposé ailleurs, ou création impossible) */
  surCreer?(): void;
  /** `id` de l'élément qui sert d'étiquette à la section (unique dans la page) */
  idTitre: string;
  /** les regarder n'est possible que si la partie en cours me le permet (Battle Royale : pas admis) */
  peutRegarderLaMienne?: boolean;
}

export default function ListeParties({ mode, lignes, surRejoindre, surRegarder, surCreer, idTitre, peutRegarderLaMienne = true }: PropsListeParties) {
  return (
    <section className={styles.parties} aria-labelledby={idTitre}>
      <h3 id={idTitre}>Parties</h3>
      <ul className={styles.liste}>
        {lignes.map((l) => (
          <li key={l.id}>
            <span className={styles.nom}>{l.titre}{l.ici && <em> (vous)</em>}</span>
            {l.enPause && <span className={styles.badgePause}>en pause</span>}
            <span className={styles.partieEtat}>{l.etat}</span>
            {l.action === "rejoindre" && (
              <button type="button" className={styles.boutonSecondaire} onClick={() => surRejoindre(l.id)} aria-label={`Rejoindre ${l.designation}`}>
                Rejoindre
              </button>
            )}
            {l.action === "regarder" && surRegarder && (!l.ici || peutRegarderLaMienne) && (
              <button type="button" className={styles.boutonSecondaire} onClick={() => surRegarder(l.ici ? null : l.id)} aria-label={`Regarder ${l.designation}`}>
                Regarder
              </button>
            )}
          </li>
        ))}
      </ul>
      {surCreer && (
        <div className={styles.actionsPartie}>
          <button type="button" className={styles.boutonSecondaire} onClick={surCreer}>{libelleCreation(mode)}</button>
        </div>
      )}
    </section>
  );
}
