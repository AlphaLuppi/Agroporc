"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BR } from "@/lib/fps/br-regles";
import { formatDureePartie, formatSurvie, lignesBilanBR, resumeFinBr } from "@/lib/fps/classement";
import { formatNombre, secondesAvant } from "@/lib/fps/hud-modele";
import type { EtatPartieBr, JoueurPublic } from "@/lib/fps/protocole";
import type { StatsBrRecues } from "../contrats";
import { nomAffiche, pseudoCompteBr, TEXTE_NOM_A_CHOISIR, texteNonComptee } from "../lobby-modele";
import TableauStatsBr from "./TableauStatsBr";
import styles from "./FinDePartieBR.module.css";

/** Délai avant de donner le focus à « Rejouer » (ms) : un joueur qui martèle Espace à sa mort ne doit pas le déclencher. */
const DELAI_FOCUS_MS = 1500;

/**
 * Fin d'une partie de Battle Royale (phase `fin`, `BR.finAffichageMs` avant le retour automatique au lobby) : « TOP 1 » ou « #4 sur 12 », le vainqueur,
 * mes éliminations et la durée, le classement de la partie (place, éliminations, dégâts, survie), puis les « TOP 1 cumulés » (statistiques persistées,
 * ma ligne marquée). Une partie trop courte ou jouée par moins de deux joueurs l'écrit : « Partie trop courte : non comptée ». La souris est rendue à
 * l'arrivée de l'écran (les boutons sont sinon inatteignables sous pointer lock) ; l'orchestrateur n'ouvre pas le menu pause par-dessus.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Fin de partie », « Interface »)
 */
export interface PropsFinDePartieBR {
  partie: EtatPartieBr;
  monId: string | null;
  statsBr?: StatsBrRecues | null;
  maintenantServeur(): number;
  /** retour au lobby de la salle */
  surRejouer(): void;
  /** sort de la partie et referme le panneau */
  surQuitter(): void;
}

export default function FinDePartieBR({ partie, monId, statsBr = null, maintenantServeur, surRejouer, surQuitter }: PropsFinDePartieBR) {
  const [, setTick] = useState(0);
  const lignes = useMemo(() => lignesBilanBR(partie.bilan, monId), [partie.bilan, monId]);
  const resume = useMemo(() => resumeFinBr(partie.bilan, monId), [partie.bilan, monId]);
  const moi = lignes.find((l) => l.moi) ?? null;
  const dureeMs = partie.bilan?.dureeMs ?? 0;
  // (v11) une partie avec des bots est de l'entraînement : jamais comptée, et le dit autrement qu'une partie trop courte
  const avecBots = useMemo(() => lignes.some((l) => l.bot), [lignes]);

  // la souris est rendue (sinon « Rejouer » et « Quitter » ne se cliquent pas)
  useEffect(() => {
    try { document.exitPointerLock?.(); } catch { /* pas de verrou à lever */ }
  }, []);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, []);
  const boutonRejouer = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => boutonRejouer.current?.focus({ preventScroll: true }), DELAI_FOCUS_MS);
    return () => clearTimeout(t);
  }, []);

  const secondes = secondesAvant(partie.finT, maintenantServeur());
  const part = Math.max(0, Math.min(1, 1 - (partie.finT - maintenantServeur()) / BR.finAffichageMs));

  return (
    <section className={styles.fin} aria-label="Fin de partie">
      <div className={styles.contenu}>
        <header className={styles.entete}>
          <h2 className={styles.titre} data-top1={resume.top1 ? "oui" : "non"}>{resume.titre}</h2>
          <p className={styles.sousTitre}>{resume.sousTitre}</p>
          {moi && (
            <p className={styles.moi}>
              Vos éliminations : <b>{formatNombre(moi.kills)}</b>
              <span aria-hidden="true"> · </span>survie : <b>{formatSurvie(moi.survieS)}</b>
            </p>
          )}
          {dureeMs > 0 && <p className={styles.duree}>Durée de la partie : {formatDureePartie(dureeMs)}</p>}
          {(partie.nonComptee || avecBots) && <p className={styles.nonComptee} role="status">{texteNonComptee(avecBots)}</p>}
          {moi && !pseudoCompteBr(moi.pseudo) && <p className={styles.nonComptee}>{TEXTE_NOM_A_CHOISIR}</p>}
        </header>

        <table className={styles.table}>
          <caption className={styles.sr}>Classement de la partie</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.placeCol}>Place</th>
              <th scope="col" className={styles.joueurCol}>Joueur</th>
              <th scope="col">Éliminations</th>
              <th scope="col">Dégâts</th>
              <th scope="col">Survie</th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && <tr><td colSpan={5} className={styles.vide}>Personne n&apos;a joué.</td></tr>}
            {lignes.map((l) => (
              <tr key={l.id} data-moi={l.moi ? "oui" : "non"} data-top1={l.vainqueur ? "oui" : "non"}>
                <td className={styles.placeCol}>{l.vainqueur ? "TOP 1" : `#${l.place}`}</td>
                <th scope="row" className={styles.joueurCol}>
                  <i className={styles.pastille} style={{ background: l.couleur }} aria-hidden="true" />
                  <span className={styles.pseudo}>{nomAffiche(l)}</span>{l.moi && <em> (vous)</em>}
                </th>
                <td>{formatNombre(l.kills)}</td>
                <td>{formatNombre(l.degats)}</td>
                <td>{formatSurvie(l.survieS)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className={styles.palmares} aria-label="TOP 1 cumulés">
          <h3 className={styles.palmaresTitre}>TOP 1 cumulés</h3>
          <TableauStatsBr lignes={statsBr?.lignes ?? null} moi={statsBr?.moi ?? null} />
        </section>

        <footer className={styles.pied}>
          <p className={styles.compte}>Retour automatique au lobby dans <b>{secondes}</b>{" "}s</p>
          <div className={styles.barre} aria-hidden="true"><i style={{ width: `${Math.round(part * 100)}%` }} /></div>
          <div className={styles.boutons}>
            <button ref={boutonRejouer} type="button" className={styles.rejouer} onClick={surRejouer}>Rejouer</button>
            <button type="button" className={styles.quitter} onClick={surQuitter}>Quitter</button>
          </div>
          <p className={styles.aide}>Rejouer : retour au lobby pour relancer une partie.</p>
        </footer>
      </div>
    </section>
  );
}

/**
 * Tableau des scores de la partie (Tab maintenu) : les joueurs de la salle par éliminations décroissantes, le mien marqué. Remplace le tableau de l'arène
 * (« premier à 30 kills » n'a pas de sens ici) ; la présence ne dit pas qui est en vie, le compte des vivants vient de `br{etat}`.
 */
export interface PropsTableauPartieBr {
  joueurs: readonly JoueurPublic[];
  monId: string | null;
  vivants: number;
  total: number;
}

export function TableauPartieBr({ joueurs, monId, vivants, total }: PropsTableauPartieBr) {
  const lignes = useMemo(
    () => joueurs.filter((j) => j.enJeu).sort((a, b) => b.kills - a.kills || a.pseudo.localeCompare(b.pseudo, "fr")),
    [joueurs],
  );
  return (
    <section className={styles.tableauJeu} aria-label="Tableau des scores">
      <div className={styles.contenu}>
        <h2 className={styles.titreJeu}>Battle Royale · {vivants} en vie sur {total}</h2>
        <table className={styles.table}>
          <caption className={styles.sr}>Tableau des scores de la partie de Battle Royale</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.joueurCol}>Joueur</th>
              <th scope="col">Éliminations</th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && <tr><td colSpan={2} className={styles.vide}>Personne n&apos;est en jeu.</td></tr>}
            {lignes.map((l) => (
              <tr key={l.id} data-moi={l.id === monId ? "oui" : "non"}>
                <th scope="row" className={styles.joueurCol}>
                  <i className={styles.pastille} style={{ background: l.couleur }} aria-hidden="true" />
                  <span className={styles.pseudo}>{nomAffiche(l)}</span>{l.id === monId && <em> (vous)</em>}
                </th>
                <td>{formatNombre(l.kills)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
