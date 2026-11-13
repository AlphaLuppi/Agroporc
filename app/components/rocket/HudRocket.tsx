"use client";

import { useEffect, useRef, useState } from "react";
import type { BanniereHud, HudRocket as EtatHud } from "@/lib/rocket/contrat";
import {
  GRADUATIONS_BOOST, annonceBut, annonceFin, chronoUrgent, graduationsAllumees, libelleChrono, resultatPourEquipe, vitesseAffichee,
} from "@/lib/rocket/hud-modele";
import { resumeRevanche } from "@/lib/rocket/reseau/lobby-en-ligne";
import { COMMANDES_BREVES, commandesRocket } from "@/lib/rocket/lobby";
import { useDispositionRocket } from "./useDispositionRocket";
import type { PropsHudRocket } from "./contrats";
import FinRocket from "./FinRocket";
import HudReseauRocket from "./HudReseauRocket";
import ListeCommandesRocket from "./ListeCommandesRocket";
import ReactionsRocket from "./ReactionsRocket";
import MenuPauseRocket from "./MenuPauseRocket";
import TableauRocket from "./TableauRocket";
import styles from "./Rocket.module.css";

/** Graduations de la jauge : 100 traits sur un anneau complet, du haut dans le sens horaire (calculées une fois). */
const TRAITS = Array.from({ length: GRADUATIONS_BOOST }, (_, i) => {
  const a = (i / GRADUATIONS_BOOST) * 2 * Math.PI;
  const s = Math.sin(a), c = -Math.cos(a);
  const r0 = i % 10 === 0 ? 38 : 41, r1 = 49;
  return { x1: +(60 + s * r0).toFixed(2), y1: +(60 + c * r0).toFixed(2), x2: +(60 + s * r1).toFixed(2), y2: +(60 + c * r1).toFixed(2) };
});

/** Jauge de boost circulaire : `role="meter"`, anneau de 100 graduations remplies selon le boost, chiffre au centre. */
export function JaugeBoost({ boost, equipe }: { boost: number; equipe: "bleue" | "orange" }) {
  const n = graduationsAllumees(boost);
  const valeur = Math.round(Math.min(100, Math.max(0, Number.isFinite(boost) ? boost : 0)));
  return (
    <div className={styles.jauge} role="meter" aria-label="Boost" aria-valuemin={0} aria-valuemax={100} aria-valuenow={valeur} aria-valuetext={`${valeur} sur 100`} data-equipe={equipe} data-vide={valeur === 0 ? "oui" : undefined}>
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        {TRAITS.map((t, i) => <line key={i} {...t} className={i < n ? styles.traitPlein : styles.traitVide} />)}
      </svg>
      <b className={styles.valeurJauge}>{valeur}</b>
    </div>
  );
}

/**
 * Annonces vocales (`aria-live="polite"`) : un but, la fin du match. Le minuteur et le score affichés ne sont PAS dans une région vivante
 * (ils changent à chaque seconde) ; seul ce texte-ci, lu une fois par évènement.
 */
function useAnnonce(hud: EtatHud | null): string {
  const [texte, setTexte] = useState("");
  const prec = useRef<{ score: { bleue: number; orange: number }; fini: boolean } | null>(null);
  const bleue = hud?.score.bleue, orange = hud?.score.orange, fini = !!hud?.resultat;
  useEffect(() => {
    if (!hud) return;
    const avant = prec.current;
    prec.current = { score: { bleue: hud.score.bleue, orange: hud.score.orange }, fini: !!hud.resultat };
    if (hud.resultat && !avant?.fini) { setTexte(annonceFin(hud.resultat, hud.nomsEquipes)); return; }
    const but = avant ? annonceBut(avant.score, hud.score, hud.nomsEquipes) : null;
    if (but) setTexte(but);
    // le HUD change à chaque image : seuls les scores et la fin du match déclenchent une annonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleue, orange, fini]);
  return texte;
}

/** Bannière de l'action (compte à rebours, but, démolition…) : le décompte du HUD sert de repli quand le jeu n'a pas envoyé de bannière. */
function banniereAffichee(hud: EtatHud): BanniereHud | null {
  if (hud.banniere) return hud.banniere;
  if (hud.decompte !== null && hud.phase === "decompte") return { id: -hud.decompte, texte: String(hud.decompte), dureeS: 1 };
  return null;
}

/**
 * HUD d'une partie de Rocket Muche, façon Rocket League. Haut centre : score bleu | minuteur | score orange ; bas droite : jauge de boost et
 * vitesse ; centre : bannière ; bas gauche : fil des évènements ; en bas : ball cam, manette, aide des touches (8 premières secondes) ;
 * Tab : tableau ; démolie : décompte de réapparition. Le menu pause et l'écran de fin sont des dialogues modaux montés par-dessus.
 * Tout est décoratif pour la souris (`pointer-events: none`) sauf les boutons et les dialogues.
 * En ligne (`enLigne`, `moi`) : pastille réseau, « (vous)» par l'id de ma voiture, menu pause qui ne gèle rien, revanche à la fin.
 */
export default function HudRocketUi({ hud, reglages, surReglages, surReprendre, surRecommencer, surQuitter, surQuitterVue, surPause, moi, enLigne }: PropsHudRocket) {
  const annonce = useAnnonce(hud);
  const disposition = useDispositionRocket();

  if (!hud) {
    return (
      <div className={styles.hud}>
        <p className={styles.chargement} role="status">Chargement du stade…</p>
      </div>
    );
  }

  const noms = hud.nomsEquipes;
  const banniere = banniereAffichee(hud);
  const urgent = chronoUrgent(hud);
  const enPartie = hud.phase !== "fini" && !hud.resultat;
  const afficherTableau = hud.classement.length > 0 && !hud.resultat && !hud.enPause;
  const aide = hud.aide && !hud.enPause && !hud.resultat;
  const revanche = enLigne ? resumeRevanche(enLigne.reseau?.revanche, enLigne.humains, moi ?? null) : null;

  return (
    <div className={styles.hud} data-phase={hud.phase}>
      <p className={styles.reserveLecteurs} role="status" aria-live="polite" aria-atomic="true">{annonce}</p>

      <div className={styles.tableauScore} role="group" aria-label="Score">
        <div className={styles.scoreEquipe} data-equipe="bleue">
          <b className={styles.points}>{hud.score.bleue}</b>
          <span className={styles.nomEquipe}>{noms.bleue}</span>
        </div>
        <div className={styles.chrono} data-urgent={urgent ? "oui" : undefined} data-prolongation={hud.prolongation ? "oui" : undefined} role="timer" aria-label="Temps restant">
          {libelleChrono(hud)}
        </div>
        <div className={styles.scoreEquipe} data-equipe="orange">
          <b className={styles.points}>{hud.score.orange}</b>
          <span className={styles.nomEquipe}>{noms.orange}</span>
        </div>
      </div>

      {enLigne && <HudReseauRocket reseau={enLigne.reseau} />}

      {surPause && enPartie && !hud.enPause && (
        <button type="button" className={styles.boutonPause} onClick={surPause}>Pause</button>
      )}

      {banniere && (
        <div key={banniere.id} className={styles.banniere} data-equipe={banniere.equipe ?? undefined} data-decompte={/^\d$/.test(banniere.texte) ? "oui" : undefined} aria-hidden="true">
          <span className={styles.texteBanniere}>{banniere.texte}</span>
          {banniere.sousTexte && <span className={styles.sousBanniere}>{banniere.sousTexte}</span>}
        </div>
      )}

      {hud.rejeu && (
        <p className={styles.rejeu} data-equipe={hud.rejeu.equipe} role="status">
          <b>Rejeu</b>
          {hud.rejeu.buteur && <span>vu de {hud.rejeu.buteur}</span>}
          <span className={styles.rejeuPasser}>{hud.manette ? "A" : "Espace"} : passer</span>
        </p>
      )}

      {hud.demolie && !hud.rejeu && (
        <p className={styles.demolie}>Démolie · réapparition dans {Math.max(1, Math.ceil(hud.reapparitionDans))} s</p>
      )}

      <div className={styles.zoneGauche}>
        {hud.chat && !hud.resultat && <ReactionsRocket chat={hud.chat} reglages={reglages} manette={hud.manette} disposition={disposition} />}
        <ul className={styles.fil} aria-label="Évènements du match">
          {hud.fil.slice(-6).map((l) => <li key={l.id} data-equipe={l.equipe ?? undefined}>{l.texte}</li>)}
        </ul>
      </div>

      <div className={styles.indicateurs}>
        <span className={styles.indicateur} data-etat={hud.balleCam ? "balle" : "voiture"}>
          Caméra <b>{hud.balleCam ? "BALLE" : "VOITURE"}</b>
        </span>
        {hud.manette && <span className={styles.indicateur}>Manette connectée</span>}
      </div>

      <div className={styles.cadran}>
        <p className={styles.vitesse} data-supersonique={hud.supersonique ? "oui" : undefined}>
          <b>{vitesseAffichee(hud.vitesseKmh)}</b> km/h{hud.supersonique && <span className={styles.supersonique}> · supersonique</span>}
        </p>
        <JaugeBoost boost={hud.boost} equipe={hud.equipeJoueur} />
      </div>

      {aide && (
        <aside className={styles.aideBreve} aria-label="Aide des touches">
          <ListeCommandesRocket commandes={commandesRocket(reglages.touches, disposition, hud.manette ? reglages.liaisonsManette : null).filter((c) => COMMANDES_BREVES.includes(c.id))} />
        </aside>
      )}

      {afficherTableau && (
        <div className={styles.tableauJeu}>
          <TableauRocket lignes={hud.classement} nomsEquipes={noms} equipeJoueur={hud.equipeJoueur} legende="Classement des joueurs" moi={moi} />
        </div>
      )}

      {hud.enPause && !hud.resultat && (
        <MenuPauseRocket
          reglages={reglages}
          surReglages={surReglages}
          surReprendre={surReprendre}
          surRecommencer={surRecommencer}
          surQuitter={surQuitter}
          surQuitterVue={surQuitterVue}
          manette={hud.manette}
          enLigne={!!enLigne}
          etatConnexion={enLigne?.reseau?.etat}
        />
      )}
      {hud.resultat && (
        <FinRocket
          // le serveur envoie son résultat brut : chaque client le relit pour SON équipe
          resultat={enLigne ? resultatPourEquipe(hud.resultat, hud.equipeJoueur) : hud.resultat}
          nomsEquipes={noms}
          surRejouer={surRecommencer}
          surQuitter={surQuitter}
          moi={moi}
          enLigne={enLigne && revanche ? { oui: revanche.oui, attendus: revanche.attendus, aVote: revanche.aVote, restantS: revanche.restantS, hote: enLigne.hote, surRetourSalon: enLigne.surRetourSalon } : undefined}
        />
      )}
    </div>
  );
}
