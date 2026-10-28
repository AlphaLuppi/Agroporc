"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EtatPartieZombies } from "@/lib/fps/protocole";
import { stockageNavigateur } from "@/lib/fps/touches";
import { lignesBilanZombies, totauxBilanZombies, formatDureePartie } from "@/lib/fps/classement";
import { evaluerRecordZombies, formatArgent, formatNombre, lireRecordZombies, majRecordZombies, secondesAvant, type RecordZombies } from "@/lib/fps/hud-modele";
import { ZOMBIES } from "@/lib/fps/zombies-vagues";
import styles from "./FinDePartieZombies.module.css";

/** Délai avant de donner le focus à « Rejouer » (ms). */
const DELAI_FOCUS_MS = 1500;

/**
 * Fin d'une partie de zombies (phase `fin`, `ZOMBIES.finAffichageMs` avant le retour automatique au lobby) : « PARTIE PERDUE », la manche
 * atteinte, le record local (`pdj-fps-zombies-record`, mis à jour ici une seule fois), la durée, le tableau par joueur (tigres tués, argent
 * gagné, relèves) et deux boutons : « Rejouer » (retour au lobby) et « Quitter ». La souris est rendue à l'arrivée de l'écran (les boutons
 * sont sinon inatteignables sous pointer lock) ; l'orchestrateur n'ouvre pas le menu pause par-dessus.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« HUD et écrans »)
 */
export interface PropsFinDePartieZombies {
  partie: EtatPartieZombies;
  monId: string | null;
  maintenantServeur(): number;
  /** retour au lobby de la salle */
  surRejouer(): void;
  /** sort de la partie et referme le panneau */
  surQuitter(): void;
  /** record AVANT cette partie ; absent = lu dans le navigateur au montage */
  recordAvant?: RecordZombies;
}

export default function FinDePartieZombies({ partie, monId, maintenantServeur, surRejouer, surQuitter, recordAvant }: PropsFinDePartieZombies) {
  const [, setTick] = useState(0);
  const [avant] = useState<RecordZombies>(() => recordAvant ?? lireRecordZombies(stockageNavigateur()));
  const lignes = useMemo(() => lignesBilanZombies(partie.joueurs, monId), [partie.joueurs, monId]);
  const totaux = useMemo(() => totauxBilanZombies(lignes), [lignes]);
  const manche = partie.bilan?.manche ?? partie.manche;
  const dureeMs = partie.bilan?.dureeMs ?? 0;
  const { record, battu } = evaluerRecordZombies(avant, manche, totaux.kills);

  // record enregistré une seule fois par partie, la souris rendue (sinon « Rejouer » et « Quitter » ne se cliquent pas)
  useEffect(() => {
    majRecordZombies(stockageNavigateur(), manche, totaux.kills);
    try { document.exitPointerLock?.(); } catch { /* pas de verrou à lever */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, []);
  // Focus sur « Rejouer » après un court délai seulement : un joueur qui martèle Espace (saut, frein à main) ou Entrée au moment de la défaite
  // activerait sinon le bouton avant d'avoir vu le bilan.
  const boutonRejouer = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => boutonRejouer.current?.focus({ preventScroll: true }), DELAI_FOCUS_MS);
    return () => clearTimeout(t);
  }, []);

  const secondes = secondesAvant(partie.finT, maintenantServeur());
  const part = Math.max(0, Math.min(1, 1 - (partie.finT - maintenantServeur()) / ZOMBIES.finAffichageMs));

  return (
    <section className={styles.fin} aria-label="Fin de partie">
      <div className={styles.contenu}>
        <header className={styles.entete}>
          <h2 className={styles.titre}>Partie perdue</h2>
          <p className={styles.manche}>Manche atteinte : <b>{manche}</b></p>
          <p className={styles.record} data-battu={battu ? "oui" : "non"}>
            {battu ? <>NOUVEAU RECORD <span aria-hidden="true">·</span> manche {record.manche}</>
              : record.manche > 0 ? <>Record : manche {record.manche}</>
              : <>Pas encore de record : abattez au moins un tigre</>}
          </p>
          {dureeMs > 0 && <p className={styles.duree}>Durée de la partie : {formatDureePartie(dureeMs)}</p>}
        </header>

        <table className={styles.table}>
          <caption className={styles.sr}>Bilan par joueur</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.joueurCol}>Joueur</th>
              <th scope="col">Tigres tués</th>
              <th scope="col">Argent gagné</th>
              <th scope="col">Relèves</th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && <tr><td colSpan={4} className={styles.vide}>Personne n&apos;a joué.</td></tr>}
            {lignes.map((l) => (
              <tr key={l.id} data-moi={l.moi ? "oui" : "non"}>
                <th scope="row" className={styles.joueurCol}>
                  <i className={styles.pastille} style={{ background: l.couleur }} aria-hidden="true" />
                  <span className={styles.pseudo}>{l.pseudo}</span>{l.moi && <em> (vous)</em>}
                </th>
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
                <td>{formatNombre(totaux.kills)}</td>
                <td>{formatArgent(totaux.gagne)}</td>
                <td>{formatNombre(totaux.reanimations)}</td>
              </tr>
            </tfoot>
          )}
        </table>

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
