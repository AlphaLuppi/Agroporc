"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { EtatConnexion } from "@/lib/fps/reseau";
import { BR } from "@/lib/fps/br-regles";
import type { EtatPartieBr, ResumeSalonBr } from "@/lib/fps/protocole";
import type { ConfigTouches } from "@/lib/fps/touches";
import { DIFFICULTES_LISTE, estDifficulte, type Difficulte } from "@/lib/fps/zombies-vagues";
import type { ReglagesHud } from "@/lib/fps/reglages-hud";
import ReglageInterface from "./hud/ReglageInterface";
import TableauStatsBr from "./hud/TableauStatsBr";
import ListeParties from "./ListeParties";
import { useDisposition } from "./ReglageTouches";
import { PSEUDO_MAX } from "./Arene";
import type { StatsBrRecues } from "./contrats";
import {
  CLE_NIVEAU_BOTS, NIVEAUX_BOTS, REGLES_BR, TEXTE_BR, TITRE_REGLES_BR, aideBots, commandesLobbyBR, creationProposee, estBot, etiquetteEtatBR, lignesParties, nomAffiche,
  partiesVisibles, pseudoCompteBr, reglageBots, situationLobbyBR, texteEffectif, texteNombreBots, type PartieListee,
} from "./lobby-modele";
import styles from "./Arene.module.css";

/**
 * Lobby de la salle Battle Royale (aside « Battle Royale », calqué sur `LobbyZombies`) : statut de la connexion, effectif X/50, message de l'hôte (ou de ce
 * qui bloque le lancement : minimum de joueurs, deux joueurs du même nom, nom à choisir pour compter ses TOP 1, départ annulé), nom de joueur, liste des
 * joueurs par ordre d'arrivée (puce de couleur, badge « hôte »), règles, palmarès « TOP 1 » repliable, commandes et « Lancer la partie » réservé à l'hôte.
 * Un arrivant en cours de partie peut la regarder en spectateur (« Regarder la partie ») ou créer la sienne (« Créer ma partie ») ; la liste des
 * parties (`parties`, plusieurs peuvent tourner en même temps) permet de passer de l'une à l'autre. Les statistiques sont demandées une seule fois, à
 * l'ouverture du lobby (`surDemanderStats`). Le choix du mode (`choixMode`) est posé par l'hôte du composant au-dessus du lobby.
 * (v11) Réglage des bots pour l'hôte : nombre (0 à `botsMax` de la partie, borné par la place et le quota de bots du serveur ; 11 par défaut seul dans le lobby,
 * sinon aucun) et niveau (difficulté, mémorisée) ; « Lancer » reste grisé, avec la raison, tant qu'il n'y a ni autre joueur ni bot. Une partie avec des bots
 * est de l'entraînement, non comptée ; les bots sont listés avec l'étiquette [BOT].
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
  /** l'hôte lance la partie ; `bots` (entier) et `difficulte` (niveau des bots) ne sont donnés que si le serveur propose des bots (`botsMax` > 0) */
  surLancer(difficulte?: Difficulte, bots?: number): void;
  surFermer(): void;
  erreur: string | null;
  tactile: boolean;
  pseudoParDefaut?: boolean;
  /** `ChoixMode` posé sous le titre */
  choixMode?: ReactNode;
  /** toutes les parties de Battle Royale du serveur (`salons.listes.br`, ou `salons.parties` d'un serveur plus ancien) et la mienne ; absent : serveur d'avant les parties multiples */
  parties?: readonly PartieListee[] | null;
  partieActuelle?: string | null;
  /** aller dans le lobby d'une autre partie */
  surRejoindrePartie?(id: string): void;
  /** regarder une partie en cours en spectateur (la mienne, ou une autre : on y va d'abord) */
  surRegarder?(id: string | null): void;
  /** créer ma partie (ou reprendre une salle vide) */
  surCreerPartie?(): void;
}

function statut(etat: EtatConnexion, monId: string | null): { texte: string; classe: string } {
  if (etat === "ouvert" && monId) return { texte: "Connecté", classe: styles.ok };
  if (etat === "ouvert" || etat === "connexion") return { texte: "Connexion…", classe: styles.attente };
  return { texte: "Serveur injoignable, nouvelle tentative…", classe: styles.ko };
}

export default function LobbyBR({
  etat, monId, partie, salonBr = null, statsBr = null, surDemanderStats, pseudo, surPseudo, touches, reglagesHud, surReglagesHud, surLancer, surFermer, erreur, tactile,
  pseudoParDefaut = false, choixMode, parties = null, partieActuelle = null, surRejoindrePartie, surRegarder, surCreerPartie,
}: PropsLobbyBR) {
  const idPseudo = useId();
  const disposition = useDisposition();
  const s = statut(etat, monId);
  const connecte = etat === "ouvert" && !!monId;
  const joueurs = partie?.joueurs ?? [];
  // (v11) bots : plafonds publiés par le serveur pour ma partie (sinon ceux de n'importe quelle partie : ce sont des réglages du serveur), choix de l'hôte
  const mienne = parties?.find((p) => p.id === partieActuelle) ?? null;
  const botsMax = mienne?.botsMax ?? parties?.find((p) => p.botsMax !== undefined)?.botsMax;
  const botsRestants = mienne?.botsRestants ?? parties?.find((p) => p.botsRestants !== undefined)?.botsRestants;
  const [botsChoisis, setBotsChoisis] = useState<number | null>(null);
  const [niveau, setNiveau] = useState<Difficulte>(() => {
    try { const v = localStorage.getItem(CLE_NIVEAU_BOTS); return estDifficulte(v) ? v : "plat"; } catch { return "plat"; }
  });
  const choisirNiveau = (d: Difficulte) => {
    setNiveau(d);
    try { localStorage.setItem(CLE_NIVEAU_BOTS, d); } catch { /* stockage indisponible */ }
  };
  const humains = joueurs.filter((j) => !estBot(j)).length;
  const reglage = reglageBots({ botsMax, botsRestants, humains, capacite: partie?.capacite ?? BR.joueursMax, choisi: botsChoisis });
  const sit = situationLobbyBR(partie, monId, connecte, salonBr, reglage);
  // même règle que le serveur (nettoyerPseudo) : 2 lettres ou chiffres au moins
  const nomTropCourt = Array.from(pseudo.replace(/[^\p{L}\p{N}]/gu, "")).length < 2;
  const listeConnue = !partie || partie.joueurs !== undefined;
  const monPseudo = joueurs.find((j) => j.id === monId)?.pseudo ?? null;
  const peutLancer = sit.peutLancer && !tactile && !nomTropCourt;
  const lancer = () => {
    if (!reglage.disponible) surLancer();
    else if (reglage.valeur > 0) surLancer(niveau, reglage.valeur);
    else surLancer(undefined, 0);
  };
  const montrerBots = sit.hote && !sit.enCours && reglage.disponible && !tactile && connecte;
  const idBots = `${idPseudo}-bots`;
  const lignes = (parties ? lignesParties("br", parties, partieActuelle) : [])
    .map((l) => (l.action === "rejoindre" && !surRejoindrePartie ? { ...l, action: null } : l));
  // la liste ne sert que s'il y a un choix à faire : plusieurs parties, ou la mienne déjà lancée
  const montrerParties = partiesVisibles("br", { connecte, tactile, nbLignes: lignes.length, enCours: sit.enCours });
  // « Créer ma partie » : déjà dans les actions ci-dessus quand la mienne est lancée ; sinon dans la liste, sauf seul dans mon lobby
  const creerDansListe = !sit.enCours && !!surCreerPartie && creationProposee("br", lignes);

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
      {/* serveur d'avant les parties multiples (`parties` absent) : ni regarder ni créer */}
      {connecte && !tactile && sit.enCours && parties && (
        <div className={styles.actionsPartie}>
          {sit.peutRegarder && surRegarder && (
            <button type="button" className={styles.boutonSecondaire} onClick={() => surRegarder(null)}>Regarder la partie</button>
          )}
          {surCreerPartie && <button type="button" className={styles.boutonSecondaire} onClick={surCreerPartie}>Créer ma partie</button>}
        </div>
      )}
      {montrerParties && (
        <ListeParties
          mode="br"
          lignes={lignes}
          surRejoindre={(id) => surRejoindrePartie?.(id)}
          surRegarder={surRegarder}
          surCreer={creerDansListe ? surCreerPartie : undefined}
          idTitre={`${idPseudo}-parties`}
          peutRegarderLaMienne={sit.peutRegarder}
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
          onKeyDown={(e) => { if (e.key === "Enter" && peutLancer) lancer(); }}
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
              <span className={styles.nom}>{nomAffiche(j)}{j.id === monId && <em> (vous)</em>}</span>
              {partie?.hote === j.id && <span className={styles.badgeHote}>hôte</span>}
              {etiquette && <span className={j.admis ? styles.enJeu : styles.spectateur}>{etiquette}</span>}
            </li>
          );
        })}
      </ul>
      )}

      {montrerBots && (
        <fieldset className={styles.reglageBots} aria-describedby={`${idBots}-aide`}>
          <legend>Bots</legend>
          <div className={styles.ligneBots}>
            <label htmlFor={idBots}>Nombre de bots</label>
            <input
              id={idBots}
              type="range"
              min={0}
              max={reglage.plafond}
              step={1}
              value={reglage.valeur}
              disabled={reglage.plafond === 0}
              aria-valuetext={texteNombreBots(reglage.valeur)}
              onChange={(e) => setBotsChoisis(Number(e.target.value))}
            />
            <output htmlFor={idBots}>{reglage.valeur}</output>
          </div>
          <div id={`${idBots}-aide`}>
            {aideBots(reglage, botsRestants).map((t) => <p key={t} className={styles.aidePseudo}>{t}</p>)}
          </div>
          {reglage.valeur > 0 && (
            <div className={styles.niveauBots} role="radiogroup" aria-label="Niveau des bots">
              {DIFFICULTES_LISTE.map((d) => (
                <label key={d} className={styles.aidePseudo}>
                  <input type="radio" name={`${idBots}-niveau`} value={d} checked={niveau === d} onChange={() => choisirNiveau(d)} />{" "}
                  <b>{NIVEAUX_BOTS[d].nom}</b> : {NIVEAUX_BOTS[d].description}
                </label>
              ))}
            </div>
          )}
        </fieldset>
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
          <p className={styles.astuce}>
            Toutes les touches se changent en partie : Échap puis « Touches ». Chat vocal (Échap, puis « Chat vocal ») : en vie, vous entendez les joueurs proches ;
            éliminé ou spectateur, vous parlez avec les autres spectateurs, que les joueurs en vie n&apos;entendent pas.
          </p>
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
