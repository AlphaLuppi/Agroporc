"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import type { EtatConnexion } from "@/lib/fps/reseau";
import { JEU, type ArmeMeleeId, type ArmePrincipaleId, type ArmeSecondaireId, type InfoMatch, type JoueurPublic } from "@/lib/fps/protocole";
import type { ConfigTouches } from "@/lib/fps/touches";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import ChoixEquipement from "./ChoixEquipement";
import ReglageInterface from "./hud/ReglageInterface";
import ListeParties from "./ListeParties";
import { useDisposition } from "./ReglageTouches";
import type { EquipementChoisi } from "./contrats";
import {
  REGLES_TIR, TEXTE_ARMES_SPECIALES, TEXTE_COUTEAU, TITRE_COMMENT_CA_TIRE, commandesLobby, lignesParties, partiesVisibles, type PartieListee,
} from "./lobby-modele";
import styles from "./Arene.module.css";

export const PSEUDO_MAX = 16;

interface Props {
  etat: EtatConnexion;
  monId: string | null;
  joueurs: JoueurPublic[];
  match: InfoMatch | null;
  pseudo: string;
  surPseudo(v: string): void;
  /** équipement de la prochaine apparition (principale, secondaire et arme blanche ; les spéciales viennent d'Elsa) */
  equipement: EquipementChoisi;
  surEquipement(principale: ArmePrincipaleId, secondaire: ArmeSecondaireId, melee?: ArmeMeleeId): void;
  /** touches du joueur : l'aide des commandes en est construite (jamais « Z Q S D » écrit en dur) */
  touches: ConfigTouches;
  /** réglages de la mini-map et de l'interface (section « Interface », repliée) */
  reglagesHud: ReglagesHud;
  surReglagesHud(r: ReglagesHud): void;
  surEntrer(): void;
  surFermer(): void;
  /** message d'erreur du serveur (arène pleine, version…) */
  erreur: string | null;
  /** écran tactile sans clavier ni souris */
  tactile: boolean;
  /** aucun nom choisi jusqu'ici (« Agent ») : le champ prend le focus */
  pseudoParDefaut?: boolean;
  /** `ChoixMode` posé sous le titre (v5 : choix entre l'arène et les zombies) */
  choixMode?: ReactNode;
  /** (v11) arènes du serveur (`salons.listes.arene`) et la mienne ; absent : serveur d'avant les parties parallèles (une seule arène, pas de liste) */
  parties?: readonly PartieListee[] | null;
  partieActuelle?: string | null;
  /** aller dans une autre arène */
  surRejoindrePartie?(id: string): void;
  /** « Créer une arène » (le serveur en reprend une vide avant d'en ouvrir une de plus ; refus `limite` au plafond) */
  surCreerPartie?(): void;
  /** `rejoindre` refusé (arène pleine) : id d'une autre arène qui accueille, proposée par « Changer d'arène » */
  alternative?: string | null;
}

function statut(etat: EtatConnexion, monId: string | null): { texte: string; classe: string } {
  if (etat === "ouvert" && monId) return { texte: "Connecté", classe: styles.ok };
  if (etat === "ouvert" || etat === "connexion") return { texte: "Connexion…", classe: styles.attente };
  return { texte: "Serveur injoignable, nouvelle tentative…", classe: styles.ko };
}

/** Panneau « Arène » de la vue Palantir : présence, pseudo, équipement (principale + secondaire), règles de tir, réglages d'interface, bouton d'entrée. */
export default function Arene({
  etat, monId, joueurs, match, pseudo, surPseudo, equipement, surEquipement, touches, reglagesHud, surReglagesHud, surEntrer, surFermer, erreur, tactile, pseudoParDefaut = false, choixMode,
  parties = null, partieActuelle = null, surRejoindrePartie, surCreerPartie, alternative = null,
}: Props) {
  const idPseudo = useId();
  const disposition = useDisposition();
  const s = statut(etat, monId);
  const connecte = etat === "ouvert" && !!monId;
  const enJeu = joueurs.filter((j) => j.enJeu).length;
  const trie = [...joueurs].sort((a, b) => Number(b.enJeu) - Number(a.enJeu) || b.kills - a.kills || a.pseudo.localeCompare(b.pseudo, "fr"));
  // même règle que le serveur (nettoyerPseudo de lib/fps/match.ts) : 2 lettres ou chiffres au moins
  const nomTropCourt = Array.from(pseudo.replace(/[^\p{L}\p{N}]/gu, "")).length < 2;
  const monPseudo = joueurs.find((j) => j.id === monId)?.pseudo ?? null;
  // l'arène est pleine quand 16 AGENTS sont en jeu (les spectateurs de la vue 3D n'occupent aucune place)
  const arenePleine = enJeu >= JEU.joueursMax && !joueurs.some((j) => j.id === monId && j.enJeu);
  // serveur à parties parallèles (`parties` fourni) : l'arène où l'on atterrit (le hall `ar1`) peut être pleine alors qu'une autre accueille ; Entrer envoie
  // `mode{arene, partie:"auto"}` et le serveur décide (autre arène, nouvelle arène, ou `refus{mode}` avec son message). Le blocage ne vaut que sans `parties`.
  const peutEntrer = connecte && !tactile && !nomTropCourt && (!arenePleine || !!parties);
  const lignes = parties ? lignesParties("arene", parties, partieActuelle) : [];
  const montrerParties = partiesVisibles("arene", { connecte, tactile, nbLignes: lignes.length, enCours: false });
  const titreAlternative = alternative ? lignes.find((l) => l.id === alternative)?.titre ?? "une autre arène" : null;

  return (
    <aside className={styles.arene} aria-label="Arène">
      <p className={`${styles.entete}`}>
        <span className={styles.eyebrow}>Chacun pour soi</span>
        <button type="button" className={styles.fermer} onClick={surFermer}>Fermer</button>
      </p>
      <h2 className={styles.titre}>Arène</h2>
      {choixMode}
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
      {alternative && surRejoindrePartie && (
        <div className={styles.actionsPartie}>
          <button type="button" className={styles.boutonSecondaire} onClick={() => surRejoindrePartie(alternative)} aria-label={`Changer d'arène : ${titreAlternative}`}>
            Changer d&apos;arène
          </button>
        </div>
      )}
      {montrerParties && (
        <ListeParties
          mode="arene"
          lignes={lignes.map((l) => (l.action === "rejoindre" && !surRejoindrePartie ? { ...l, action: null } : l))}
          surRejoindre={(id) => surRejoindrePartie?.(id)}
          surCreer={surCreerPartie}
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

      <ChoixEquipement principale={equipement.principale} secondaire={equipement.secondaire} melee={equipement.melee} surChanger={surEquipement} variante="lobby" idGroupe="lobby" />
      <p className={styles.note}>{TEXTE_COUTEAU}</p>
      <p className={styles.note}>{TEXTE_ARMES_SPECIALES}</p>

      <section className={styles.tir} aria-labelledby={`${idPseudo}-tir`}>
        <h3 id={`${idPseudo}-tir`}>{TITRE_COMMENT_CA_TIRE}</h3>
        <ul>
          {REGLES_TIR.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <ReglageInterface reglages={reglagesHud} surReglages={surReglagesHud} replie />

      {tactile ? (
        <p className={styles.tactile}>L&apos;arène se joue au clavier et à la souris.</p>
      ) : (
        <>
          <dl className={styles.commandes} aria-label="Commandes">
            {commandesLobby(touches, disposition).map((c) => (
              <div key={c.libelle}>
                <dt><kbd>{c.touches}</kbd></dt>
                <dd>{c.libelle}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.astuce}>Toutes les touches se changent en partie : Échap puis « Touches ».</p>
          {/* collé en bas du panneau : l'entrée reste atteignable malgré la longueur du lobby */}
          <div className={styles.pied}>
            <button type="button" className={styles.entrer} disabled={!peutEntrer} onClick={surEntrer}>
              Entrer dans l&apos;arène
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
