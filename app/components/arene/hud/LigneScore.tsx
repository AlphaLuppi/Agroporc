"use client";

import { memo } from "react";
import {
  pourcentageTetes, precision, qualitePing, ratioKD, texteArmeFav, texteDegats, type ColonneScore, type LigneScore as DonneesLigne,
} from "@/lib/fps/classement";
import styles from "./TableauScores.module.css";

/**
 * Ligne du tableau des scores (§8.2) : mémoïsée (comparaison champ par champ, les lignes sont reconstruites à chaque présence),
 * pastille de couleur + pseudo en `--ag-ink` (la couleur du serveur ne sert jamais de couleur de texte), état écrit (« éliminé »,
 * « en véhicule »), étiquettes VOUS / LEADER, `aria-current="true"` sur ma ligne.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsLigneScore {
  ligne: DonneesLigne;
  rang: number;
  /** ex aequo avec la ligne voisine : « = » devant le rang */
  egalite: boolean;
  colonnes: readonly ColonneScore[];
  moi: boolean;
  leader: boolean;
}

/** Classe de colonne (largeur) pour l'en-tête et les cellules. */
export const CLASSE_COLONNE: Record<ColonneScore, string> = {
  rang: styles.cRang, agent: "", k: styles.cK, m: styles.cM, kd: styles.cKd, ser: styles.cSer,
  prec: styles.cPrec, tete: styles.cTete, deg: styles.cDeg, arme: styles.cArme, ping: styles.cPing,
};

const NBSP = " ";

function PictoVoiture() {
  return (
    <svg viewBox="0 0 16 10" aria-hidden="true" focusable="false">
      <path d="M1 8V5l2-3h8l3 3v3M1 8h14M4 8.6a1 1 0 1 0 0 .01M12 8.6a1 1 0 1 0 0 .01" />
    </svg>
  );
}

function LigneScoreImpl({ ligne: l, rang, egalite, colonnes, moi, leader }: PropsLigneScore) {
  const cellule = (c: ColonneScore) => {
    const cl = CLASSE_COLONNE[c];
    switch (c) {
      case "rang":
        return (
          <td key={c} className={`${cl} ${styles.rang}`}>
            {leader && <span className={styles.etoile} aria-hidden="true">★</span>}
            {egalite && <span aria-hidden="true">=</span>}
            {rang}
            {egalite && <span className={styles.sr}> (ex aequo)</span>}
          </td>
        );
      case "agent":
        return (
          <td key={c} className={`${cl} ${styles.gauche}`}>
            <div className={styles.agent}>
              <span className={styles.pastille} style={{ background: l.couleur }} aria-hidden="true" />
              <span className={styles.pseudo}>{l.pseudo}</span>
              {moi && <span className={`${styles.etiquette} ${styles.etiquetteMoi}`}>Vous</span>}
              {leader && <span className={`${styles.etiquette} ${styles.etiquetteLeader}`}><span aria-hidden="true">★ </span>Leader</span>}
              {!l.vivant && <span className={styles.etat}><span aria-hidden="true">✕ </span>éliminé</span>}
              {l.vehicule && <span className={styles.vehicule}><PictoVoiture />en véhicule</span>}
            </div>
          </td>
        );
      case "k": return <td key={c} className={`${cl} ${styles.valeurK}`}>{l.kills}</td>;
      case "m": return <td key={c} className={cl}>{l.morts}</td>;
      case "kd": return <td key={c} className={cl}>{ratioKD(l)}</td>;
      case "ser": return <td key={c} className={cl} title={`Série max : ${l.serieMax}`}>{l.serie}</td>;
      case "prec": return <td key={c} className={cl}>{precision(l)}</td>;
      case "tete": return <td key={c} className={cl}>{pourcentageTetes(l)}</td>;
      case "deg": return <td key={c} className={cl}>{texteDegats(l)}</td>;
      case "arme": return <td key={c} className={cl}>{texteArmeFav(l)}</td>;
      case "ping": {
        const q = qualitePing(l.ping);
        return (
          <td key={c} className={cl}>
            <span className={styles.ping} data-q={q} title={`Ping ${q}`}>
              <i className={styles.pointPing} aria-hidden="true" />{l.ping}{NBSP}ms
            </span>
          </td>
        );
      }
    }
  };
  return (
    <tr data-id={l.id} aria-current={moi ? "true" : undefined} className={`${moi ? styles.moi : ""} ${l.vivant ? "" : styles.mort}`}>
      {colonnes.map(cellule)}
    </tr>
  );
}

const memeLigne = (a: DonneesLigne, b: DonneesLigne) =>
  a === b || (
    a.id === b.id && a.pseudo === b.pseudo && a.couleur === b.couleur && a.kills === b.kills && a.morts === b.morts && a.ping === b.ping
    && a.serie === b.serie && a.serieMax === b.serieMax && a.tirs === b.tirs && a.touches === b.touches && a.tetes === b.tetes
    && a.degats === b.degats && a.armeFav === b.armeFav && a.vivant === b.vivant && a.vehicule === b.vehicule
  );

const LigneScore = memo(
  LigneScoreImpl,
  (a, b) => a.rang === b.rang && a.egalite === b.egalite && a.colonnes === b.colonnes && a.moi === b.moi && a.leader === b.leader && memeLigne(a.ligne, b.ligne),
);
export default LigneScore;
