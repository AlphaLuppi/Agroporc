"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FORMATS, LIBELLES_NIVEAU, MATCH, NIVEAUX_BOT, type Format, type NiveauBot } from "@/lib/rocket/contrat";
import {
  DESCRIPTIONS_EQUIPE, DESCRIPTIONS_FORMAT, DESCRIPTIONS_NIVEAU, LIBELLES_FORMAT, NOM_JOUEUR_MAX, libelleDuree, nettoyerNomJoueur,
} from "@/lib/rocket/lobby";
import {
  codePret, ecranLobby, libelleChargement, libelleConnexion, libelleLancer, lignesParties, reessayable, saisirCode, vueSalon,
  type EquipeVue, type VueSalon,
} from "@/lib/rocket/reseau/lobby-en-ligne";
import type { PropsLobbyRocketEnLigne } from "./contrats";
import styles from "./Rocket.module.css";

interface OptionRadio<T extends string | number> {
  valeur: T;
  libelle: string;
  titre?: string;
}

/** Groupe de boutons radio NATIFS présentés en segments (flèches du clavier, un seul tabulable), cibles de 40 px au moins. */
function GroupeRadios<T extends string | number>({ legende, nom, options, valeur, surChoix }: {
  legende: string; nom: string; options: readonly OptionRadio<T>[]; valeur: T; surChoix(v: T): void;
}) {
  return (
    <fieldset className={styles.segments}>
      <legend>{legende}</legend>
      {options.map((o) => (
        <label key={String(o.valeur)} className={styles.segment} title={o.titre}>
          <input type="radio" name={nom} value={String(o.valeur)} checked={o.valeur === valeur} onChange={() => surChoix(o.valeur)} />
          {o.libelle}
        </label>
      ))}
    </fieldset>
  );
}

/** Copie `texte` dans le presse-papiers ; repli sur une zone de texte temporaire quand l'API asynchrone est refusée (page non sécurisée). */
async function copier(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texte); return true; }
  } catch { /* repli ci-dessous */ }
  try {
    const zone = document.createElement("textarea");
    zone.value = texte;
    zone.setAttribute("readonly", "");
    zone.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(zone);
    zone.select();
    const ok = document.execCommand("copy");
    zone.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Colonne d'une équipe : ses joueurs (`[data-rocket-joueur]`), ses places libres (tenues par des bots), « Passer dans cette équipe ». */
function ColonneEquipe({ e, moi, surChoisir }: { e: EquipeVue; moi: number | null; surChoisir(): void }) {
  const idTitre = useId();
  const libres = Array.from({ length: e.libres }, (_, i) => i);
  return (
    <section className={styles.colonneEquipe} data-equipe={e.equipe} aria-labelledby={idTitre} title={DESCRIPTIONS_EQUIPE[e.equipe]}>
      <h4 id={idTitre} className={styles.titreEquipe}>
        <i className={styles.pastilleEquipe} data-equipe={e.equipe} aria-hidden="true" />
        {e.nom}
      </h4>
      <ul className={styles.joueursEquipe}>
        {e.joueurs.map((j) => (
          <li key={j.id} data-rocket-joueur="" data-joueur={j.id} data-connecte={j.connecte ? "oui" : "non"}>
            <span className={styles.nomJoueur}>{j.nom}</span>
            {j.id === moi && <span className={styles.etiquette}>vous</span>}
            {j.hote && <span className={styles.etiquette}>hôte</span>}
            {!j.connecte && <span className={styles.etiquette} data-etat="alerte">déconnecté</span>}
          </li>
        ))}
        {libres.map((i) => <li key={`libre-${i}`} className={styles.placeLibre}>Place libre · bot</li>)}
      </ul>
      {e.peutRejoindre && (
        <button type="button" className={styles.boutonDiscret} onClick={surChoisir}>
          Passer dans cette équipe<span className={styles.reserveLecteurs}> : {e.nom}</span>
        </button>
      )}
    </section>
  );
}

/** Réglages de l'hôte : format, niveau des bots, durée, visibilité dans la liste. */
function ReglagesHote({ vue, idBase, surRegler }: { vue: VueSalon; idBase: string; surRegler(patch: Partial<{ format: Format; dureeS: number; niveauBots: NiveauBot; visible: boolean }>): void }) {
  const r = vue.reglages;
  return (
    <>
      <GroupeRadios
        legende="Format"
        nom={`${idBase}-format`}
        options={FORMATS.map((f) => ({ valeur: f, libelle: LIBELLES_FORMAT[f], titre: DESCRIPTIONS_FORMAT[f] }))}
        valeur={r.format}
        surChoix={(format) => surRegler({ format })}
      />
      <GroupeRadios
        legende="Niveau des bots"
        nom={`${idBase}-niveau`}
        options={NIVEAUX_BOT.map((n) => ({ valeur: n, libelle: LIBELLES_NIVEAU[n], titre: DESCRIPTIONS_NIVEAU[n] }))}
        valeur={r.niveauBots}
        surChoix={(niveauBots) => surRegler({ niveauBots })}
      />
      <GroupeRadios
        legende="Durée"
        nom={`${idBase}-duree`}
        options={MATCH.dureesPermisesS.map((d) => ({ valeur: d, libelle: libelleDuree(d) }))}
        valeur={r.dureeS}
        surChoix={(dureeS) => surRegler({ dureeS })}
      />
      <label className={styles.caseAcocher}>
        <input type="checkbox" checked={r.visible} onChange={(e) => surRegler({ visible: e.target.checked })} />
        <span>Visible dans la liste des parties ouvertes</span>
      </label>
    </>
  );
}

/**
 * Lobby « En ligne » de Rocket Muche (aside), affiché à la place du lobby hors ligne quand le mode « En ligne » est choisi.
 *
 *  - sans salon : nom, « Créer une partie », champ « Code de la partie » + « Rejoindre », liste « Parties ouvertes » (rafraîchie par le hook,
 *    clés stables, jamais dans une région vivante, jamais de vol de focus) ;
 *  - dans un salon : code en grand (`[data-rocket-code]`, copiable), deux colonnes d'équipes (`[data-rocket-joueur]`), réglages de l'hôte en
 *    radios natives, « Lancer la partie » (hôte, grisé avec sa raison), « Quitter le salon » ;
 *  - chargement : « Chargement… 1/2 prêts ».
 *
 * Tout le modèle est dans `lib/rocket/reseau/lobby-en-ligne.ts` ; ici seulement du rendu. Contrat DOM des essais : spec § 9.3.
 */
export default function LobbyRocketEnLigne({
  etat, actions, nom, surNom, reglages, surReglages, surFermer, tactile, manette, erreur = null, pseudoParDefaut = false, surPrechargement,
}: PropsLobbyRocketEnLigne) {
  const id = useId();
  const [codeSaisi, setCodeSaisi] = useState("");
  const [copie, setCopie] = useState<"ok" | "echec" | null>(null);
  const minuteurCopie = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (minuteurCopie.current) clearTimeout(minuteurCopie.current); }, []);

  const ecran = ecranLobby(etat);
  // un changement d'écran (accueil, salon, chargement) démonte le bouton cliqué : le focus tomberait sur <body>, derrière le dialogue
  // modal ; il est rendu au titre, qui l'annonce aux lecteurs d'écran. Un focus déjà ailleurs (la radio du mode, un champ) n'est jamais volé.
  const asideRef = useRef<HTMLElement>(null);
  const titreRef = useRef<HTMLHeadingElement>(null);
  const ecranPrecedent = useRef(ecran);
  useEffect(() => {
    if (ecranPrecedent.current === ecran) return;
    ecranPrecedent.current = ecran;
    const actif = document.activeElement;
    if (!actif || actif === document.body) titreRef.current?.focus({ preventScroll: true });
  }, [ecran]);
  const conn = libelleConnexion(etat.connexion, etat.fermeture);
  const bloqueTactile = tactile && !manette;
  const vue = etat.salon ? vueSalon(etat.salon, etat.joueur) : null;
  const occupe = etat.attente !== null;
  const code = codePret(codeSaisi);
  const nomPropre = nettoyerNomJoueur(nom);

  const rejoindreParCode = () => { if (code && !bloqueTactile && !occupe) actions.rejoindre(code); };
  const copierCode = async () => {
    if (!vue) return;
    const ok = await copier(vue.code);
    setCopie(ok ? "ok" : "echec");
    if (minuteurCopie.current) clearTimeout(minuteurCopie.current);
    minuteurCopie.current = setTimeout(() => setCopie(null), 3000);
  };

  const corps: ReactNode = (() => {
    if (ecran === "connexion") {
      return (
        <div className={styles.pied2}>
          {reessayable(etat.connexion) && <button type="button" className={styles.boutonPrincipal} onClick={actions.reessayer}>Réessayer</button>}
        </div>
      );
    }
    if (ecran === "accueil") {
      const parties = lignesParties(etat.parties ?? []);
      return (
        <>
          <div className={styles.champ}>
            <label htmlFor={`${id}-nom`}>Nom de joueur</label>
            <input
              id={`${id}-nom`}
              type="text"
              value={nom}
              maxLength={NOM_JOUEUR_MAX}
              placeholder="Votre nom"
              autoComplete="off"
              spellCheck={false}
              autoFocus={pseudoParDefaut}
              onChange={(e) => surNom(e.target.value)}
              onBlur={() => { if (nom !== nomPropre) surNom(nomPropre); }}
            />
          </div>

          <button
            type="button"
            className={`${styles.lancer} ${styles.creer}`}
            disabled={bloqueTactile || occupe}
            onClick={() => actions.creer(reglages)}
            onPointerEnter={surPrechargement}
            onFocus={surPrechargement}
          >
            Créer une partie
          </button>

          <form
            className={styles.formCode}
            onSubmit={(e) => { e.preventDefault(); rejoindreParCode(); }}
            onPointerEnter={surPrechargement}
          >
            <div className={styles.champ}>
              <label htmlFor={`${id}-code`}>Code de la partie</label>
              <div className={styles.ligneCode}>
                <input
                  id={`${id}-code`}
                  type="text"
                  value={codeSaisi}
                  maxLength={4}
                  placeholder="BCDF"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-describedby={`${id}-aide-code`}
                  onChange={(e) => setCodeSaisi(saisirCode(e.target.value))}
                />
                <button type="submit" className={styles.boutonSecondaire} disabled={!code || bloqueTactile || occupe}>Rejoindre</button>
              </div>
              <span id={`${id}-aide-code`} className={styles.aideCode}>Quatre consonnes, sans voyelle, communiquées par l&apos;hôte.</span>
            </div>
          </form>

          <section className={styles.listeParties} aria-labelledby={`${id}-liste`}>
            <div className={styles.enteteListe}>
              <h3 id={`${id}-liste`} className={styles.sousTitre}>Parties ouvertes</h3>
              <button type="button" className={styles.boutonDiscret} onClick={actions.actualiser}>Actualiser</button>
            </div>
            {parties.length === 0 ? (
              <p className={styles.vide}>{etat.parties === null ? "Recherche des parties…" : "Aucune partie ouverte pour le moment. Créez la vôtre."}</p>
            ) : (
              <ul className={styles.partiesOuvertes}>
                {parties.map((p) => (
                  <li key={p.cle} data-rocket-partie={p.code}>
                    <span className={styles.codePartie}>{p.code}</span>
                    <span className={styles.detailPartie}>
                      <b>{p.hote}</b>
                      <span>{p.description} · {p.occupation}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.boutonSecondaire}
                      aria-label={p.libelleBouton}
                      disabled={p.complete || bloqueTactile || occupe}
                      onClick={() => actions.rejoindre(p.code)}
                      onPointerEnter={surPrechargement}
                      onFocus={surPrechargement}
                    >
                      Rejoindre
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      );
    }
    if (!vue) return null;
    if (ecran === "chargement" && vue.chargement) {
      return (
        <>
          <p className={styles.codeSalon}>Partie <strong data-rocket-code="">{vue.code}</strong></p>
          <p className={styles.chargementLigne} role="status">{libelleChargement(vue.chargement)}</p>
          <p className={styles.resume}>{vue.resume} · {vue.description}</p>
          <div className={styles.pied2}>
            <button type="button" className={styles.boutonDanger} onClick={actions.quitter}>Quitter</button>
          </div>
        </>
      );
    }
    const enSalon = vue.phase === "salon";
    return (
      <>
        <div className={styles.blocCode}>
          <p className={styles.sur}>Code de la partie</p>
          <p className={styles.codeSalon}>
            <strong data-rocket-code="">{vue.code}</strong>
            <span className={styles.reserveLecteurs}>, épelé : {vue.codeEpele}</span>
          </p>
          <button type="button" className={styles.boutonDiscret} onClick={copierCode}>Copier le code</button>
          <p className={styles.reserveLecteurs} role="status">{copie === "ok" ? "Code copié" : copie === "echec" ? "Copie impossible" : ""}</p>
          {copie && <span className={styles.copie} aria-hidden="true">{copie === "ok" ? "Copié" : "Copie impossible"}</span>}
        </div>

        {!enSalon && <p className={styles.chargementLigne} role="status">Partie en cours, connexion au match…</p>}

        <div className={styles.equipes}>
          {vue.equipes.map((e) => (
            <ColonneEquipe key={e.equipe} e={e} moi={etat.joueur} surChoisir={() => actions.choisirEquipe(e.equipe)} />
          ))}
        </div>

        {enSalon && (
          vue.estHote ? (
            <ReglagesHote
              vue={vue}
              idBase={id}
              surRegler={(patch) => { actions.regler(patch); surReglages({ ...vue.reglages, ...patch }); }}
            />
          ) : (
            <p className={styles.resume}>Réglages choisis par l&apos;hôte : {vue.description}</p>
          )
        )}

        <p className={styles.resume}>{vue.resume}</p>
        {vue.noteBots && <p className={styles.noteBots}>{vue.noteBots}</p>}

        {enSalon && (
          <div className={`${styles.pied2} ${styles.piedCollant}`}>
            {vue.estHote ? (
              <>
                <button type="button" className={styles.lancer} disabled={!vue.lancable || bloqueTactile} aria-describedby={vue.raisonNonLancable ? `${id}-raison` : undefined} onClick={actions.lancer}>
                  {libelleLancer(vue)}
                </button>
                {vue.raisonNonLancable && <p id={`${id}-raison`} className={styles.raison}>{vue.raisonNonLancable}</p>}
              </>
            ) : (
              <p className={styles.attenteHote} role="status">{libelleLancer(vue)}…</p>
            )}
            <button type="button" className={styles.boutonDanger} onClick={actions.quitter}>Quitter le salon</button>
          </div>
        )}
      </>
    );
  })();

  return (
    <aside ref={asideRef} className={styles.lobby} aria-label="Rocket Muche en ligne">
      <p className={styles.entete}>
        <span className={styles.sur}>Football en voitures</span>
        <button type="button" className={styles.fermer} onClick={surFermer}>Fermer</button>
      </p>
      <h2 ref={titreRef} tabIndex={-1} className={styles.titre} style={{ outline: "none" }}>Rocket Muche</h2>
      <p className={styles.statut} role="status">
        <i className={styles.pastille} data-etat={conn.gravite === "ok" ? "ok" : conn.gravite === "erreur" ? "erreur" : undefined} aria-hidden="true" />
        <span>En ligne · {conn.texte}</span>
      </p>
      {etat.message && (
        <p className={etat.message.genre === "erreur" ? styles.erreur : styles.info} role={etat.message.genre === "erreur" ? "alert" : "status"}>{etat.message.texte}</p>
      )}
      {erreur && <p className={styles.erreur} role="alert">{erreur}</p>}
      {bloqueTactile && (
        <p className={styles.tactile} role="note">Rocket Muche se joue au clavier ou à la manette : branchez une manette pour jouer sur cet appareil.</p>
      )}
      {corps}
    </aside>
  );
}
