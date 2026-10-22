"use client";

import { useId, type CSSProperties } from "react";
import type { EtatConnexion } from "@/lib/fps/reseau";
import { ARMES, JEU, type ArmeId, type InfoMatch, type JoueurPublic } from "@/lib/fps/protocole";
import { INFOS_ARMES, LIBELLES_BARRES } from "./armesInfo";
import styles from "./Arene.module.css";

export const PSEUDO_MAX = 16;

interface Props {
  etat: EtatConnexion;
  monId: string | null;
  joueurs: JoueurPublic[];
  match: InfoMatch | null;
  pseudo: string;
  surPseudo(v: string): void;
  arme: ArmeId;
  surArme(a: ArmeId): void;
  surEntrer(): void;
  surFermer(): void;
  /** message d'erreur du serveur (arène pleine, version…) */
  erreur: string | null;
  /** écran tactile sans clavier ni souris */
  tactile: boolean;
}

function statut(etat: EtatConnexion, monId: string | null): { texte: string; classe: string } {
  if (etat === "ouvert" && monId) return { texte: "Connecté", classe: styles.ok };
  if (etat === "ouvert" || etat === "connexion") return { texte: "Connexion…", classe: styles.attente };
  return { texte: "Serveur injoignable, nouvelle tentative…", classe: styles.ko };
}

/** Panneau « Arène » de la vue Palantir : présence, pseudo, arme, bouton d'entrée. */
export default function Arene({ etat, monId, joueurs, match, pseudo, surPseudo, arme, surArme, surEntrer, surFermer, erreur, tactile }: Props) {
  const idPseudo = useId();
  const s = statut(etat, monId);
  const connecte = etat === "ouvert" && !!monId;
  const enJeu = joueurs.filter((j) => j.enJeu).length;
  const trie = [...joueurs].sort((a, b) => Number(b.enJeu) - Number(a.enJeu) || b.kills - a.kills || a.pseudo.localeCompare(b.pseudo, "fr"));
  const peutEntrer = connecte && !tactile && !(erreur && joueurs.length >= JEU.joueursMax && !joueurs.some((j) => j.id === monId));

  return (
    <aside className={styles.arene} aria-label="Arène">
      <p className={`${styles.entete}`}>
        <span className={styles.eyebrow}>Chacun pour soi</span>
        <button type="button" className={styles.fermer} onClick={surFermer}>Fermer</button>
      </p>
      <h2 className={styles.titre}>Arène</h2>
      <p className={styles.statut} role="status" aria-live="polite">
        <i className={`${styles.pastille} ${s.classe}`} aria-hidden="true" />
        <span>
          {s.texte}
          {connecte && <> · <b>{joueurs.length}</b> {joueurs.length > 1 ? "agents en ligne" : "agent en ligne"}{enJeu > 0 && <> · {enJeu} en jeu</>}</>}
        </span>
      </p>
      {match && (
        <p className={styles.match}>
          Match n°{match.numero} · premier à <b>{match.objectif}</b> kills ou {Math.round(JEU.dureeMatchMs / 60000)} min
          {match.phase === "entracte" && " · entracte, un nouveau match arrive"}
        </p>
      )}
      {erreur && <p className={styles.erreur} role="alert">{erreur}</p>}

      <ul className={styles.liste} aria-label="Agents en ligne">
        {trie.length === 0 && <li className={styles.vide}>Personne pour l&apos;instant.</li>}
        {trie.map((j) => (
          <li key={j.id}>
            <i className={styles.puce} style={{ "--couleur": j.couleur } as CSSProperties} aria-hidden="true" />
            <span className={styles.nom}>{j.pseudo}{j.id === monId && <em> (vous)</em>}</span>
            {j.enJeu ? <span className={styles.enJeu}>en jeu</span> : <span className={styles.spectateur}>spectateur</span>}
            <span className={styles.kd} title="Kills / morts">{j.kills}/{j.morts}</span>
          </li>
        ))}
      </ul>

      <div className={styles.champ}>
        <label htmlFor={idPseudo}>Votre pseudo</label>
        <input
          id={idPseudo}
          type="text"
          value={pseudo}
          maxLength={PSEUDO_MAX}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => surPseudo(e.target.value)}
        />
      </div>

      <fieldset className={styles.armes}>
        <legend>Arme</legend>
        <div className={styles.grille}>
        {ARMES.map((id) => {
          const info = INFOS_ARMES[id];
          return (
            <label key={id} className={`${styles.carte} ${arme === id ? styles.carteChoisie : ""}`}>
              <input type="radio" name="arme-arene" value={id} checked={arme === id} onChange={() => surArme(id)} />
              <span className={styles.carteNom}>{info.nom}</span>
              <span className={styles.carteDesc}>{info.description}</span>
              <span className={styles.barres}>
                {LIBELLES_BARRES.map((b) => (
                  <span key={b.cle} className={styles.barre} role="img" aria-label={`${b.nom} ${Math.round(info.barres[b.cle] * 10)} sur 10`}>
                    <span>{b.nom}</span>
                    <i><i style={{ width: `${Math.max(4, info.barres[b.cle] * 100)}%` }} /></i>
                  </span>
                ))}
              </span>
            </label>
          );
        })}
        </div>
      </fieldset>

      {tactile ? (
        <p className={styles.tactile}>L&apos;arène se joue au clavier et à la souris.</p>
      ) : (
        <>
          <button type="button" className={styles.entrer} disabled={!peutEntrer} onClick={surEntrer}>
            Entrer dans l&apos;arène
          </button>
          <p className={styles.astuce}>
            <b>Z Q S D</b> ou <b>W A S D</b> pour bouger, <b>Espace</b> pour sauter : contre un mur, vous courez dessus et rebondissez de mur en mur.
          </p>
        </>
      )}
    </aside>
  );
}
