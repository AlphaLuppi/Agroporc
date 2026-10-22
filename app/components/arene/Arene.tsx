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
  /** aucun nom choisi jusqu'ici (« Agent ») : le champ prend le focus */
  pseudoParDefaut?: boolean;
}

function statut(etat: EtatConnexion, monId: string | null): { texte: string; classe: string } {
  if (etat === "ouvert" && monId) return { texte: "Connecté", classe: styles.ok };
  if (etat === "ouvert" || etat === "connexion") return { texte: "Connexion…", classe: styles.attente };
  return { texte: "Serveur injoignable, nouvelle tentative…", classe: styles.ko };
}

/** Panneau « Arène » de la vue Palantir : présence, pseudo, arme, bouton d'entrée. */
export default function Arene({ etat, monId, joueurs, match, pseudo, surPseudo, arme, surArme, surEntrer, surFermer, erreur, tactile, pseudoParDefaut = false }: Props) {
  const idPseudo = useId();
  const s = statut(etat, monId);
  const connecte = etat === "ouvert" && !!monId;
  const enJeu = joueurs.filter((j) => j.enJeu).length;
  const trie = [...joueurs].sort((a, b) => Number(b.enJeu) - Number(a.enJeu) || b.kills - a.kills || a.pseudo.localeCompare(b.pseudo, "fr"));
  // même règle que le serveur (nettoyerPseudo de lib/fps/match.ts) : 2 lettres ou chiffres au moins
  const nomTropCourt = Array.from(pseudo.replace(/[^\p{L}\p{N}]/gu, "")).length < 2;
  const monPseudo = joueurs.find((j) => j.id === monId)?.pseudo ?? null;
  const peutEntrer = connecte && !tactile && !nomTropCourt && !(erreur && joueurs.length >= JEU.joueursMax && !joueurs.some((j) => j.id === monId));

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

      <div className={styles.champ}>
        <label htmlFor={idPseudo}>Nom de joueur</label>
        <input
          id={idPseudo}
          type="text"
          value={pseudo}
          maxLength={PSEUDO_MAX}
          placeholder="Ton nom dans la partie"
          autoComplete="off"
          spellCheck={false}
          autoFocus={pseudoParDefaut}
          aria-describedby={`${idPseudo}-aide`}
          onChange={(e) => surPseudo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && peutEntrer) surEntrer(); }}
        />
        <p id={`${idPseudo}-aide`} className={styles.aidePseudo}>
          {nomTropCourt
            ? "Au moins 2 lettres ou chiffres."
            : monPseudo && monPseudo !== pseudo.trim()
              ? <>Déjà pris : vous apparaîtrez comme <b>{monPseudo}</b>.</>
              : "Affiché au-dessus de votre avatar et dans le fil des kills."}
        </p>
      </div>

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
