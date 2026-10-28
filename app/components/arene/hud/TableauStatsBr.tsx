"use client";

import { useMemo } from "react";
import { lignesPalmaresBr } from "@/lib/fps/classement";
import { formatNombre } from "@/lib/fps/hud-modele";
import type { LigneStatsBr } from "@/lib/fps/protocole";
import styles from "./TableauStatsBr.module.css";

/**
 * Palmarès du Battle Royale (« TOP 1 cumulés ») : joueur, TOP 1, parties, kills et meilleure place, dans l'ordre du serveur (TOP 1, kills,
 * parties, pseudo). Ma ligne est marquée `data-moi` ; si je ne suis pas dans le top, elle est ajoutée sous la liste sans rang. Partagé par le lobby
 * (section repliable) et l'écran de fin de partie. Tant que les statistiques n'ont pas été reçues (`lignes` null), un message le dit.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Statistiques persistées », « Interface »)
 */
export interface PropsTableauStatsBr {
  /** null : pas encore reçu */
  lignes: readonly LigneStatsBr[] | null;
  moi?: LigneStatsBr | null;
  /** légende lue par les lecteurs d'écran (« TOP 1 cumulés ») */
  legende?: string;
}

export default function TableauStatsBr({ lignes, moi = null, legende = "TOP 1 cumulés" }: PropsTableauStatsBr) {
  const rows = useMemo(() => (lignes ? lignesPalmaresBr(lignes, moi) : []), [lignes, moi]);
  if (!lignes) return <p className={styles.vide} role="status">Palmarès en cours de chargement…</p>;
  if (rows.length === 0) return <p className={styles.vide}>Aucun TOP 1 pour l&apos;instant : la première partie comptée ouvre le palmarès.</p>;
  return (
    <table className={styles.table}>
      <caption className={styles.sr}>{legende}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.rang}><span className={styles.sr}>Rang</span></th>
          <th scope="col" className={styles.joueur}>Joueur</th>
          <th scope="col">TOP 1</th>
          <th scope="col">Parties</th>
          <th scope="col">Kills</th>
          <th scope="col">Meilleure place</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.cle} data-moi={l.moi ? "oui" : "non"}>
            <td className={styles.rang}>{l.rang ?? ""}</td>
            <th scope="row" className={styles.joueur}>
              <span className={styles.pseudo}>{l.pseudo}</span>{l.moi && <em> (vous)</em>}
            </th>
            <td className={styles.top1}>{formatNombre(l.top1)}</td>
            <td>{formatNombre(l.parties)}</td>
            <td>{formatNombre(l.kills)}</td>
            <td>{l.meilleure}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
