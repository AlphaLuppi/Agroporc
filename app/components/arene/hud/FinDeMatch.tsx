"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COLONNES_COMPACTES, bilanJoueur, construireLignes, distinctionsGagnees, estLeader, podium, raisonFinMatch, rangs, titreVainqueur,
} from "@/lib/fps/classement";
import { JEU, type InfoMatch, type JoueurPublic, type LigneClassement, type LigneStats } from "@/lib/fps/protocole";
import ChoixEquipement from "../ChoixEquipement";
import type { EquipementChoisi } from "../contrats";
import CarteBilan from "./CarteBilan";
import Distinctions from "./Distinctions";
import LigneScore, { CLASSE_COLONNE } from "./LigneScore";
import Podium from "./Podium";
import TableauScores from "./TableauScores";
import styles from "./FinDeMatch.module.css";
import tableau from "./TableauScores.module.css";

/**
 * Fin de match (§10) : « MATCH TERMINÉ » et sa raison, podium, trois colonnes (« Ton match », classement de la 4e place à la fin avec
 * ma ligne épinglée, distinctions), compte à rebours jusqu'au prochain match et choix d'équipement compact. Le voile est sous les coins
 * du HUD (la mini-map reste nette). `tableauOuvert` (Tab maintenu) remplace tout par le tableau complet.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsFinDeMatch {
  joueurs: JoueurPublic[];
  stats: ReadonlyMap<string, LigneStats>;
  classement: LigneClassement[] | null;
  monId: string | null;
  match: InfoMatch | null;
  maintenantServeur(): number;
  equipement: EquipementChoisi;
  surEquipement(principale: EquipementChoisi["principale"], secondaire: EquipementChoisi["secondaire"], melee?: EquipementChoisi["melee"]): void;
  /** Tab maintenu : le tableau complet se pose à la place du podium */
  tableauOuvert?: boolean;
  /** libellé de la touche des scores pour le tableau complet */
  toucheScores?: string;
  /** « 1 : arme principale suivante · 2 : … » : la souris est prise, les boutons du sélecteur ne sont pas cliquables (vide : rien) */
  aideEquipement?: string;
}

/** Compte à rebours qui avance seul : « Prochain match dans 9 s » et sa barre (`match.prochain`, `JEU.entracteMs`). */
function CompteARebours({ match, maintenantServeur }: { match: InfoMatch | null; maintenantServeur(): number }) {
  const [, setTic] = useState(0);
  const prochain = match?.prochain ?? null;
  useEffect(() => {
    if (prochain === null) return;
    const i = setInterval(() => setTic((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [prochain]);
  if (prochain === null) return <p className={styles.compte}>Prochain match imminent</p>;
  const ms = Math.max(0, prochain - maintenantServeur());
  const part = Math.min(1, Math.max(0, 1 - ms / JEU.entracteMs));
  return (
    <>
      <p className={styles.compte}>Prochain match dans <b>{Math.ceil(ms / 1000)}</b>{" "}s</p>
      <div className={styles.barre} aria-hidden="true"><i style={{ width: `${Math.round(part * 100)}%` }} /></div>
    </>
  );
}

export default function FinDeMatch({
  joueurs, stats, classement, monId, match, maintenantServeur, equipement, surEquipement, tableauOuvert, toucheScores, aideEquipement,
}: PropsFinDeMatch) {
  const lignes = useMemo(() => construireLignes(joueurs, stats, classement), [joueurs, stats, classement]);
  const r = useMemo(() => rangs(lignes), [lignes]);
  const objectif = match?.objectif ?? JEU.objectifKills;
  const places = useMemo(() => podium(lignes), [lignes]);
  const bilan = bilanJoueur(lignes, monId);
  const suite = lignes.slice(3);

  if (tableauOuvert) {
    return (
      <div className={styles.fin}>
        <TableauScores
          joueurs={joueurs} stats={stats} classement={classement} monId={monId} match={match} maintenantServeur={maintenantServeur}
          toucheScores={toucheScores}
        />
      </div>
    );
  }

  return (
    <section className={styles.fin} aria-label="Fin de match">
      <div className={styles.contenu}>
        <header className={styles.entete}>
          <h2 className={styles.titre}>Match terminé</h2>
          <p className={styles.raison}>
            {titreVainqueur(lignes)} <span aria-hidden="true">·</span> {raisonFinMatch(lignes, objectif)}
          </p>
        </header>

        <Podium places={places} moiId={monId} />

        <div className={styles.colonnes}>
          <CarteBilan bilan={bilan} gagnees={distinctionsGagnees(lignes, monId)} />

          <section className={styles.colonne} aria-label="Classement">
            <h3 className={styles.titreColonne}>Classement</h3>
            {suite.length === 0 ? (
              <p className={styles.vide}>Pas d&apos;autres joueurs.</p>
            ) : (
              <div className={`${tableau.defile} ${styles.listeClassement}`}>
                <table className={tableau.table} data-densite="serree" data-sans-entete="oui">
                  <caption className={tableau.sr}>Classement à partir de la 4e place</caption>
                  <colgroup>{COLONNES_COMPACTES.map((c) => <col key={c} className={CLASSE_COLONNE[c]} />)}</colgroup>
                  <tbody>
                    {suite.map((l, i) => {
                      const k = i + 3;
                      return (
                        <LigneScore
                          key={l.id}
                          ligne={l}
                          rang={r[k]}
                          egalite={r[k - 1] === r[k] || r[k + 1] === r[k]}
                          colonnes={COLONNES_COMPACTES}
                          moi={l.id === monId}
                          leader={estLeader(l, r[k])}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <Distinctions lignes={lignes} moiId={monId} />
        </div>

        <footer className={styles.pied}>
          <CompteARebours match={match} maintenantServeur={maintenantServeur} />
          <div className={styles.equipement}>
            {aideEquipement && <p className={styles.equipementAide}>{aideEquipement}</p>}
            <ChoixEquipement
              principale={equipement.principale}
              secondaire={equipement.secondaire}
              melee={equipement.melee}
              surChanger={surEquipement}
              variante="compact"
              idGroupe="fin"
            />
          </div>
        </footer>
      </div>
    </section>
  );
}
