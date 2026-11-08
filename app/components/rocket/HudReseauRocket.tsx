"use client";

import { FORMES_QUALITE, libelleAbsent, libelleCommandes, libellePastilleReseau } from "@/lib/rocket/hud-modele";
import type { HudReseau } from "@/lib/rocket/reseau/protocole";
import type { PropsHudReseauRocket } from "./contrats";
import styles from "./Rocket.module.css";

/** État affiché tant que le jeu n'a pas encore envoyé de mesure (la pastille existe dès le début de la partie). */
const ETAT_INITIAL: HudReseau = { etat: "connexion", rttMs: 0, gigueMs: 0, qualite: "bonne", commandes: "actives", absents: [], revanche: null };

/**
 * Pastille réseau d'une partie en ligne (haut à droite) : ping en ms et qualité, « Commandes suspendues » (menu ouvert, onglet masqué),
 * « Reconnexion… » après une coupure, et un bandeau par joueur coupé (« Léa : connexion perdue, reprise possible dans 14 s »).
 *
 * L'état ne tient jamais à la couleur seule : chaque qualité a sa forme (●●● / ●●○ / ●○○) et son texte. La pastille elle-même n'est PAS dans une
 * région vivante (le ping change plusieurs fois par seconde) ; seuls les messages d'événement (commandes suspendues, absents) sont annoncés,
 * en `aria-live="polite"`. Contrat des essais de bout en bout : `[data-rocket-reseau]` avec `data-ping`, `data-etat`, `data-commandes`.
 */
export default function HudReseauRocket({ reseau }: PropsHudReseauRocket) {
  const h = reseau ?? ETAT_INITIAL;
  const suspendues = libelleCommandes(h.commandes);
  const connecte = h.etat === "ouverte";
  return (
    <div className={styles.reseau} data-rocket-reseau="" data-ping={Math.round(h.rttMs)} data-etat={h.etat} data-commandes={h.commandes} data-qualite={connecte ? h.qualite : undefined}>
      <p className={styles.pastilleReseau} data-qualite={connecte ? h.qualite : "aucune"}>
        <span className={styles.formeReseau} aria-hidden="true">{connecte ? FORMES_QUALITE[h.qualite] : "○○○"}</span>
        <span>{libellePastilleReseau(h)}</span>
      </p>
      <div className={styles.messagesReseau} role="status" aria-live="polite">
        {suspendues && <p className={styles.alerteReseau}>{suspendues}</p>}
        {/* le compte à rebours change chaque seconde : il est visible mais muet (aria-hidden), seule la coupure est annoncée */}
        {h.absents.map((a) => (
          <p key={a.joueur} className={styles.alerteReseau} data-absent={a.joueur} title={libelleAbsent(a)}>
            <span>{a.nom} : connexion perdue</span>
            <span aria-hidden="true">, reprise possible dans {Math.max(0, Math.ceil(a.restantMs / 1000))} s</span>
          </p>
        ))}
      </div>
    </div>
  );
}
