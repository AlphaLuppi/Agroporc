"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { DIFFICULTES, DIFFICULTES_LISTE, estDifficulte, type Difficulte } from "@/lib/fps/zombies-vagues";
import type { EtatConnexion } from "@/lib/fps/reseau";
import type { EtatPartieZombies } from "@/lib/fps/protocole";
import type { ConfigTouches } from "@/lib/fps/touches";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import ReglageInterface from "./hud/ReglageInterface";
import ListeParties from "./ListeParties";
import { useDisposition } from "./ReglageTouches";
import { PSEUDO_MAX } from "./Arene";
import AideLobby, { ListeCommandes, ListeRegles } from "./AideLobby";
import {
  REGLES_ZOMBIES, TEXTE_ZOMBIES, TITRE_REGLES_ZOMBIES, commandesLobbyZombies, creationProposee, etiquetteEtatZombies, lignesParties, partiesVisibles,
  situationLobbyZombies, texteEffectif, type PartieListee,
} from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * Lobby de la salle zombies (aside « Zombies ») : statut de la connexion, effectif X/8, liste des joueurs par ordre d'arrivée (puce de couleur,
 * badge « hôte », état), nom de joueur, règles condensées, commandes, et « Lancer la partie » réservé à l'hôte (premier arrivé du lobby).
 * Une partie déjà lancée garde le nouvel arrivant en attente jusqu'à la prochaine pause entre deux manches. Le choix du mode (`choixMode`)
 * est posé par l'hôte du composant au-dessus du lobby.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« HUD et écrans »)
 */
export interface PropsLobbyZombies {
  etat: EtatConnexion;
  monId: string | null;
  /** dernier `zombies{etat}` reçu, null avant le premier */
  partie: EtatPartieZombies | null;
  pseudo: string;
  surPseudo(v: string): void;
  touches: ConfigTouches;
  reglagesHud?: ReglagesHud;
  surReglagesHud?(r: ReglagesHud): void;
  /** l'hôte lance la partie (v7 : à la difficulté choisie) */
  surLancer(difficulte?: Difficulte): void;
  surFermer(): void;
  erreur: string | null;
  tactile: boolean;
  pseudoParDefaut?: boolean;
  /** `ChoixMode` posé sous le titre */
  choixMode?: ReactNode;
  /** (v11) parties de zombies du serveur (`salons.listes.zombies`) et la mienne ; absent : serveur d'avant les parties parallèles (une seule partie) */
  parties?: readonly PartieListee[] | null;
  partieActuelle?: string | null;
  /** aller dans une autre partie (lobby, ou en cours : on entre à la pause suivante entre deux manches) */
  surRejoindrePartie?(id: string): void;
  /** créer ma partie (le serveur en reprend une vide avant d'en ouvrir une de plus) */
  surCreerPartie?(): void;
  /** la partie où je suis est figée par un joueur (dernier `zpause`) : pastille « en pause » */
  enPause?: boolean;
}

function statut(etat: EtatConnexion, monId: string | null): { texte: string; classe: string } {
  if (etat === "ouvert" && monId) return { texte: "Connecté", classe: styles.ok };
  if (etat === "ouvert" || etat === "connexion") return { texte: "Connexion…", classe: styles.attente };
  return { texte: "Serveur injoignable", classe: styles.ko };
}

export default function LobbyZombies({
  etat, monId, partie, pseudo, surPseudo, touches, reglagesHud, surReglagesHud, surLancer, surFermer, erreur, tactile, pseudoParDefaut = false, choixMode,
  parties = null, partieActuelle = null, surRejoindrePartie, surCreerPartie, enPause = false,
}: PropsLobbyZombies) {
  const idPseudo = useId();
  const disposition = useDisposition();
  const s = statut(etat, monId);
  const connecte = etat === "ouvert" && !!monId;
  const sit = situationLobbyZombies(partie, monId, connecte);
  // même règle que le serveur (nettoyerPseudo) : 2 lettres ou chiffres au moins
  const nomTropCourt = Array.from(pseudo.replace(/[^\p{L}\p{N}]/gu, "")).length < 2;
  const monPseudo = partie?.joueurs.find((j) => j.id === monId)?.pseudo ?? null;
  const peutLancer = sit.peutLancer && !tactile && !nomTropCourt;
  const joueurs = partie?.joueurs ?? [];
  // (v7) difficulté choisie par l'hôte, mémorisée pour la partie suivante
  const [difficulte, setDifficulte] = useState<Difficulte>(() => {
    try { const v = localStorage.getItem("pdj-fps-zombies-difficulte"); return estDifficulte(v) ? v : "plat"; } catch { return "plat"; }
  });
  const choisirDifficulte = (d: Difficulte) => {
    setDifficulte(d);
    try { localStorage.setItem("pdj-fps-zombies-difficulte", d); } catch { /* stockage indisponible */ }
  };
  const lancer = () => surLancer(difficulte);
  const lignes = parties ? lignesParties("zombies", parties, partieActuelle) : [];
  const creationZ = !!surCreerPartie && creationProposee("zombies", lignes);
  const montrerParties = partiesVisibles("zombies", { connecte, tactile, nbLignes: lignes.length, enCours: sit.enCours, creation: creationZ });
  const enPauseIci = enPause || lignes.some((l) => l.ici && l.enPause);

  return (
    <aside className={styles.arene} aria-label="Zombies">
      <p className={styles.entete}>
        <span className={styles.eyebrow}>Coopératif</span>
        <button type="button" className={styles.fermer} onClick={surFermer}>Fermer</button>
      </p>
      <h2 className={styles.titre}>Zombies tigres</h2>
      {choixMode}
      <p className={styles.statut} role="status" aria-live="polite">
        <i className={`${styles.pastille} ${s.classe}`} aria-hidden="true" />
        <span>
          {s.texte}
          {connecte && partie && <> · <b>{sit.joueurs}</b>/{sit.capacite} joueurs</>}
        </span>
        {enPauseIci && <span className={styles.badgePause}>en pause</span>}
      </p>
      <p className={`${styles.match} ${sit.enCours ? styles.enCours : ""}`} role="status">{sit.message}</p>
      {erreur && <p className={styles.erreur} role="alert">{erreur}</p>}
      {montrerParties && (
        <ListeParties
          mode="zombies"
          lignes={lignes.map((l) => (l.action === "rejoindre" && !surRejoindrePartie ? { ...l, action: null } : l))}
          surRejoindre={(id) => surRejoindrePartie?.(id)}
          surCreer={creationZ ? surCreerPartie : undefined}
          idTitre={`${idPseudo}-parties`}
        />
      )}

      <div className={styles.champ}>
        <label htmlFor={idPseudo}>Nom de joueur</label>
        <input
          id={idPseudo}
          type="text"
          value={pseudo}
          maxLength={PSEUDO_MAX}
          placeholder="Votre nom"
          autoComplete="off"
          spellCheck={false}
          autoFocus={pseudoParDefaut}
          aria-describedby={nomTropCourt || (monPseudo && monPseudo !== pseudo.trim()) ? `${idPseudo}-aide` : undefined}
          onChange={(e) => surPseudo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && peutLancer) lancer(); }}
        />
        {(nomTropCourt || (monPseudo && monPseudo !== pseudo.trim())) && (
          <p id={`${idPseudo}-aide`} className={styles.aidePseudo}>
            {nomTropCourt ? "Au moins 2 lettres ou chiffres." : <>Déjà pris : vous serez <b>{monPseudo}</b>.</>}
          </p>
        )}
      </div>

      <ul className={styles.liste} aria-label={`Joueurs de la partie, ${texteEffectif(joueurs.length, sit.capacite)}`}>
        {joueurs.length === 0 && <li className={styles.vide}>Personne pour l&apos;instant.</li>}
        {joueurs.map((j) => (
          <li key={j.id}>
            <i className={styles.puce} style={{ "--couleur": j.couleur } as CSSProperties} aria-hidden="true" />
            <span className={styles.nom}>{j.pseudo}{j.id === monId && <em> (vous)</em>}</span>
            {partie?.hote === j.id && <span className={styles.badgeHote}>hôte</span>}
            <span className={j.etat === "attente" ? styles.spectateur : styles.enJeu}>{etiquetteEtatZombies(j.etat)}</span>
          </li>
        ))}
      </ul>

      {sit.peutLancer && (
        <fieldset className={styles.segmentsNiveau} aria-describedby={`${idPseudo}-difficulte-aide`}>
          <legend>Difficulté</legend>
          {DIFFICULTES_LISTE.map((d) => (
            <label key={d} className={styles.segmentNiveau} title={DIFFICULTES[d].description}>
              <input type="radio" name={`${idPseudo}-difficulte`} value={d} checked={difficulte === d} onChange={() => choisirDifficulte(d)} />
              {DIFFICULTES[d].nom}
            </label>
          ))}
          <p id={`${idPseudo}-difficulte-aide`} className={styles.aidePseudo}>{DIFFICULTES[difficulte].description}</p>
        </fieldset>
      )}

      {reglagesHud && surReglagesHud && <ReglageInterface reglages={reglagesHud} surReglages={surReglagesHud} replie />}

      {tactile ? (
        <p className={styles.tactile}>Les zombies se jouent au clavier et à la souris.</p>
      ) : (
        <>
          <AideLobby>
            <p>{TEXTE_ZOMBIES}</p>
            <ListeRegles titre={TITRE_REGLES_ZOMBIES} regles={REGLES_ZOMBIES} />
            <ListeCommandes commandes={commandesLobbyZombies(touches, disposition)} />
            <p>Touches modifiables en partie : Échap, puis « Touches ».</p>
          </AideLobby>
          <div className={styles.pied}>
            <button type="button" className={styles.entrer} disabled={!peutLancer} onClick={lancer}>
              Lancer la partie
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
