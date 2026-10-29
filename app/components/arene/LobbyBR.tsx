"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import type { EtatConnexion } from "@/lib/fps/reseau";
import type { EtatPartieBr, ResumeSalonBr } from "@/lib/fps/protocole";
import type { ConfigTouches } from "@/lib/fps/touches";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import ReglageInterface from "./hud/ReglageInterface";
import TableauStatsBr from "./hud/TableauStatsBr";
import { useDisposition } from "./ReglageTouches";
import { PSEUDO_MAX } from "./Arene";
import type { StatsBrRecues } from "./contrats";
import {
  REGLES_BR, TEXTE_BR, TITRE_REGLES_BR, commandesLobbyBR, etiquetteEtatBR, pseudoCompteBr, situationLobbyBR, texteEffectif,
} from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * Lobby de la salle Battle Royale (aside « Battle Royale », calqué sur `LobbyZombies`) : statut de la connexion, effectif X/50, message de l'hôte (ou de ce
 * qui bloque le lancement : minimum de joueurs, deux joueurs du même nom, nom à choisir pour compter ses TOP 1, départ annulé), nom de joueur, liste des
 * joueurs par ordre d'arrivée (puce de couleur, badge « hôte »), règles, palmarès « TOP 1 » repliable, commandes et « Lancer la partie » réservé à l'hôte.
 * Un arrivant en cours de partie reste en attente : « Partie en cours : 12 en vie · zone palier 3/6 — rejoignez à la suivante. ». Pas de chat vocal dans
 * ce mode. Les statistiques sont demandées une seule fois, à l'ouverture du lobby (`surDemanderStats`). Le choix du mode (`choixMode`) est posé par l'hôte
 * du composant au-dessus du lobby.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (« Interface »)
 */
export interface PropsLobbyBR {
  etat: EtatConnexion;
  monId: string | null;
  /** dernier `br{etat}` reçu, null avant le premier */
  partie: EtatPartieBr | null;
  /** résumé de la salle BR du message `salons` (compteurs d'une partie en cours quand `br{etat}` n'est pas encore arrivé) */
  salonBr?: ResumeSalonBr | null;
  /** statistiques persistées (message `statsBr`), null/absent avant la première réponse */
  statsBr?: StatsBrRecues | null;
  /** demande les statistiques au serveur (appelée une fois à l'ouverture du lobby) */
  surDemanderStats?(): void;
  pseudo: string;
  surPseudo(v: string): void;
  touches: ConfigTouches;
  reglagesHud?: ReglagesHud;
  surReglagesHud?(r: ReglagesHud): void;
  /** l'hôte lance la partie */
  surLancer(): void;
  surFermer(): void;
  erreur: string | null;
  tactile: boolean;
  pseudoParDefaut?: boolean;
  /** `ChoixMode` posé sous le titre */
  choixMode?: ReactNode;
}

function statut(etat: EtatConnexion, monId: string | null): { texte: string; classe: string } {
  if (etat === "ouvert" && monId) return { texte: "Connecté", classe: styles.ok };
  if (etat === "ouvert" || etat === "connexion") return { texte: "Connexion…", classe: styles.attente };
  return { texte: "Serveur injoignable, nouvelle tentative…", classe: styles.ko };
}

export default function LobbyBR({
  etat, monId, partie, salonBr = null, statsBr = null, surDemanderStats, pseudo, surPseudo, touches, reglagesHud, surReglagesHud, surLancer, surFermer, erreur, tactile,
  pseudoParDefaut = false, choixMode,
}: PropsLobbyBR) {
  const idPseudo = useId();
  const disposition = useDisposition();
  const s = statut(etat, monId);
  const connecte = etat === "ouvert" && !!monId;
  const sit = situationLobbyBR(partie, monId, connecte, salonBr);
  // même règle que le serveur (nettoyerPseudo) : 2 lettres ou chiffres au moins
  const nomTropCourt = Array.from(pseudo.replace(/[^\p{L}\p{N}]/gu, "")).length < 2;
  const joueurs = partie?.joueurs ?? [];
  const listeConnue = !partie || partie.joueurs !== undefined;
  const monPseudo = joueurs.find((j) => j.id === monId)?.pseudo ?? null;
  const peutLancer = sit.peutLancer && !tactile && !nomTropCourt;

  // les statistiques ne sont demandées qu'à l'ouverture du lobby (une fois), jamais au chargement du site
  const demandees = useRef(false);
  const demanderRef = useRef(surDemanderStats);
  demanderRef.current = surDemanderStats;
  useEffect(() => {
    if (demandees.current || !connecte) return;
    demandees.current = true;
    demanderRef.current?.();
  }, [connecte]);

  return (
    <aside className={styles.arene} aria-label="Battle Royale">
      <p className={styles.entete}>
        <span className={styles.eyebrow}>Chacun pour soi</span>
        <button type="button" className={styles.fermer} onClick={surFermer}>Fermer</button>
      </p>
      <h2 className={styles.titre}>Battle Royale</h2>
      {choixMode}
      <p className={styles.statut} role="status" aria-live="polite">
        <i className={`${styles.pastille} ${s.classe}`} aria-hidden="true" />
        <span>
          {s.texte}
          {connecte && partie && <> · <b>{sit.joueurs}</b>/{sit.capacite} joueurs</>}
        </span>
      </p>
      <p className={styles.match}>{TEXTE_BR}</p>
      <p className={`${styles.match} ${sit.enCours ? styles.enCours : ""}`} role="status">{sit.message}</p>
      {sit.avis.map((a) => <p key={a} className={styles.avis}>{a}</p>)}
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
          onKeyDown={(e) => { if (e.key === "Enter" && peutLancer) surLancer(); }}
        />
        <p id={`${idPseudo}-aide`} className={styles.aidePseudo}>
          {nomTropCourt
            ? "Au moins 2 lettres ou chiffres."
            : monPseudo && monPseudo !== pseudo.trim()
              ? <>Déjà pris : vous apparaîtrez comme <b>{monPseudo}</b>.</>
              : monPseudo && !pseudoCompteBr(monPseudo)
                ? "Vos statistiques sont rattachées au nom de joueur : « Agent » ne compte pas."
                : "Vos TOP 1 sont comptés sous ce nom : gardez-le d'une partie à l'autre."}
        </p>
      </div>

      {/* en vol et en jeu le serveur n'envoie plus la liste : le statut ci-dessus donne l'effectif, pas de liste vide trompeuse */}
      {listeConnue && (
      <ul className={styles.liste} aria-label={`Joueurs de la partie, ${texteEffectif(sit.joueurs, sit.capacite)}`}>
        {joueurs.length === 0 && <li className={styles.vide}>Personne pour l&apos;instant.</li>}
        {joueurs.map((j) => {
          const etiquette = partie ? etiquetteEtatBR(j, partie.phase) : "";
          return (
            <li key={j.id}>
              <i className={styles.puce} style={{ "--couleur": j.couleur } as CSSProperties} aria-hidden="true" />
              <span className={styles.nom}>{j.pseudo}{j.id === monId && <em> (vous)</em>}</span>
              {partie?.hote === j.id && <span className={styles.badgeHote}>hôte</span>}
              {etiquette && <span className={j.admis ? styles.enJeu : styles.spectateur}>{etiquette}</span>}
            </li>
          );
        })}
      </ul>
      )}

      <section className={styles.tir} aria-labelledby={`${idPseudo}-regles`}>
        <h3 id={`${idPseudo}-regles`}>{TITRE_REGLES_BR}</h3>
        <ul>
          {REGLES_BR.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <details className={styles.palmares}>
        <summary>Palmarès · TOP 1</summary>
        <div className={styles.palmaresCorps}>
          <p className={styles.palmaresAide}>Les TOP 1 sont rattachés au nom de joueur. Ma ligne est surlignée.</p>
          <TableauStatsBr lignes={statsBr?.lignes ?? null} moi={statsBr?.moi ?? null} />
        </div>
      </details>

      {reglagesHud && surReglagesHud && <ReglageInterface reglages={reglagesHud} surReglages={surReglagesHud} replie />}

      {tactile ? (
        <p className={styles.tactile}>Le Battle Royale se joue au clavier et à la souris.</p>
      ) : (
        <>
          <dl className={styles.commandes} aria-label="Commandes">
            {commandesLobbyBR(touches, disposition).filter((c) => c.touches).map((c) => (
              <div key={c.libelle}>
                <dt><kbd>{c.touches}</kbd></dt>
                <dd>{c.libelle}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.astuce}>Toutes les touches se changent en partie : Échap puis « Touches ». Le chat vocal est désactivé dans ce mode.</p>
          <div className={styles.pied}>
            <button type="button" className={styles.entrer} disabled={!peutLancer} onClick={surLancer}>
              Lancer la partie
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
