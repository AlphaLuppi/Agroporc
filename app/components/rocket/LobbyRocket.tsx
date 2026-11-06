"use client";

import { useId, type ReactNode } from "react";
import { EQUIPES, FORMATS, LIBELLES_NIVEAU, MATCH, NIVEAUX_BOT, NOMS_EQUIPES_DEFAUT, type ConfigMatch } from "@/lib/rocket/contrat";
import {
  DESCRIPTIONS_EQUIPE, DESCRIPTIONS_FORMAT, DESCRIPTIONS_NIVEAU, LIBELLES_FORMAT, NOM_JOUEUR_MAX, REGLES_ROCKET, TEXTE_ROCKET, TITRE_REGLES_ROCKET,
  commandesRocket, libelleConfig, libelleDuree, nettoyerNomJoueur, resumeEffectifs,
} from "@/lib/rocket/lobby";
import AideLobby, { ListeCommandes, ListeRegles } from "../arene/AideLobby";
import { useDispositionRocket } from "./useDispositionRocket";
import type { PropsLobbyRocket } from "./contrats";
import PanneauReglagesRocket from "./PanneauReglagesRocket";
import styles from "./Rocket.module.css";

interface OptionRadio<T extends string | number> {
  valeur: T;
  libelle: string;
  titre?: string;
  /** équipe dont la pastille de couleur accompagne le libellé (décorative) */
  equipe?: "bleue" | "orange";
}

/** Un groupe de boutons radio NATIFS (flèches du clavier, un seul tabulable), présentés en segments de 40 px au moins. */
function GroupeRadios<T extends string | number>({ legende, nom, options, valeur, surChoix, aide }: {
  legende: string; nom: string; options: readonly OptionRadio<T>[]; valeur: T; surChoix(v: T): void; aide?: ReactNode;
}) {
  return (
    <fieldset className={styles.segments}>
      <legend>{legende}</legend>
      {options.map((o) => (
        <label key={String(o.valeur)} className={styles.segment} title={o.titre}>
          <input type="radio" name={nom} value={String(o.valeur)} checked={o.valeur === valeur} onChange={() => surChoix(o.valeur)} />
          {o.equipe && <i className={styles.pastilleEquipe} data-equipe={o.equipe} aria-hidden="true" />}
          {o.libelle}
        </label>
      ))}
      {aide}
    </fieldset>
  );
}

/**
 * Lobby de « Rocket Muche » (aside), affiché dans l'emplacement du panneau « Arène » : format (1v1 / 2v2 / 3v3), équipe, niveau des alliés
 * (hors 1v1) et des adversaires, durée, nom de joueur, réglages repliés, Aide repliée (règles et commandes du joueur) et « Lancer ». Tout est
 * en radios natives ; les phrases de présentation sont en infobulle, comme les lobbies de l'arène. Jeu local : aucun serveur.
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md § 10.
 */
export default function LobbyRocket({ config, surConfig, reglages, surReglages, surLancer, surFermer, tactile, manette, erreur = null, pseudoParDefaut = false, surPrechargement }: PropsLobbyRocket) {
  const id = useId();
  const disposition = useDispositionRocket();
  const bloqueTactile = tactile && !manette;
  const change = (patch: Partial<ConfigMatch>) => surConfig({ ...config, ...patch });
  const lancer = () => { if (!bloqueTactile) surLancer(); };

  return (
    <aside className={styles.lobby} aria-label="Rocket Muche">
      <p className={styles.entete}>
        <span className={styles.sur}>Football en voitures</span>
        <button type="button" className={styles.fermer} onClick={surFermer}>Fermer</button>
      </p>
      <h2 className={styles.titre} title={TEXTE_ROCKET}>Rocket Muche</h2>
      <p className={styles.statut} role="status">
        <i className={styles.pastille} data-etat={manette ? "ok" : undefined} aria-hidden="true" />
        <span>Hors ligne, contre des bots · {resumeEffectifs(config.format)}{manette ? " · manette connectée" : ""}</span>
      </p>
      {erreur && <p className={styles.erreur} role="alert">{erreur}</p>}
      {bloqueTactile && (
        <p className={styles.tactile} role="note">Rocket Muche se joue au clavier ou à la manette : branchez une manette pour jouer sur cet appareil.</p>
      )}

      <div className={styles.champ}>
        <label htmlFor={`${id}-nom`}>Nom de joueur</label>
        <input
          id={`${id}-nom`}
          type="text"
          value={config.nomJoueur}
          maxLength={NOM_JOUEUR_MAX}
          placeholder="Votre nom"
          autoComplete="off"
          spellCheck={false}
          autoFocus={pseudoParDefaut}
          onChange={(e) => change({ nomJoueur: e.target.value })}
          onBlur={() => { if (config.nomJoueur !== nettoyerNomJoueur(config.nomJoueur)) change({ nomJoueur: nettoyerNomJoueur(config.nomJoueur) }); }}
          onKeyDown={(e) => { if (e.key === "Enter") lancer(); }}
        />
      </div>

      <GroupeRadios
        legende="Format"
        nom={`${id}-format`}
        options={FORMATS.map((f) => ({ valeur: f, libelle: LIBELLES_FORMAT[f], titre: DESCRIPTIONS_FORMAT[f] }))}
        valeur={config.format}
        surChoix={(format) => change({ format })}
      />
      <GroupeRadios
        legende="Votre équipe"
        nom={`${id}-equipe`}
        options={EQUIPES.map((e) => ({ valeur: e, libelle: NOMS_EQUIPES_DEFAUT[e], titre: DESCRIPTIONS_EQUIPE[e], equipe: e }))}
        valeur={config.equipeJoueur}
        surChoix={(equipeJoueur) => change({ equipeJoueur })}
      />
      {config.format !== "1v1" && (
        <GroupeRadios
          legende="Niveau de vos coéquipiers"
          nom={`${id}-allies`}
          options={NIVEAUX_BOT.map((n) => ({ valeur: n, libelle: LIBELLES_NIVEAU[n], titre: DESCRIPTIONS_NIVEAU[n] }))}
          valeur={config.niveauAllies}
          surChoix={(niveauAllies) => change({ niveauAllies })}
        />
      )}
      <GroupeRadios
        legende={config.format === "1v1" ? "Niveau de l'adversaire" : "Niveau des adversaires"}
        nom={`${id}-adversaires`}
        options={NIVEAUX_BOT.map((n) => ({ valeur: n, libelle: LIBELLES_NIVEAU[n], titre: DESCRIPTIONS_NIVEAU[n] }))}
        valeur={config.niveauAdversaires}
        surChoix={(niveauAdversaires) => change({ niveauAdversaires })}
      />
      <GroupeRadios
        legende="Durée"
        nom={`${id}-duree`}
        options={MATCH.dureesPermisesS.map((d) => ({ valeur: d, libelle: libelleDuree(d) }))}
        valeur={config.dureeS}
        surChoix={(dureeS) => change({ dureeS })}
      />

      <details className={styles.repli}>
        <summary>Réglages</summary>
        <div className={styles.corpsRepli}>
          <PanneauReglagesRocket reglages={reglages} surReglages={surReglages} />
        </div>
      </details>

      <AideLobby>
        <p>{TEXTE_ROCKET}</p>
        <ListeRegles titre={TITRE_REGLES_ROCKET} regles={REGLES_ROCKET} />
        <ListeCommandes commandes={commandesRocket(reglages.touches, disposition)} />
      </AideLobby>

      <div className={styles.pied}>
        <button
          type="button"
          className={styles.lancer}
          disabled={bloqueTactile}
          title={libelleConfig(config)}
          onClick={lancer}
          onPointerEnter={surPrechargement}
          onFocus={surPrechargement}
        >
          Lancer<span> · {libelleConfig(config)}</span>
        </button>
      </div>
    </aside>
  );
}
