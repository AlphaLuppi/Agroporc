"use client";

import type { HudChat, ReglagesRocket } from "@/lib/rocket/contrat";
import { annonceLigneChat, libelleChatBloque, lignesMenuChat } from "@/lib/rocket/hud-modele";
import styles from "./Rocket.module.css";

/**
 * Réactions rapides du HUD, en bas à gauche : le menu de la catégorie ouverte (les quatre messages, chacun sur sa direction de la croix avec la
 * touche ou le bouton RÉEL du joueur), le fil des messages reçus (nom coloré par équipe, « (équipe) » devant les infos réservées à l'équipe) et
 * l'avis de chat bloqué. Le fil est un `role="log"` poli : un message lu une fois. Sans état, décoratif pour la souris.
 */
export default function ReactionsRocket({ chat, reglages, manette, disposition }: {
  chat: HudChat;
  reglages: ReglagesRocket;
  /** une manette est branchée : ses boutons s'ajoutent aux touches dans le menu */
  manette: boolean;
  disposition?: ReadonlyMap<string, string> | null;
}) {
  const lignesMenu = chat.menu ? lignesMenuChat(chat.menu, reglages.touches, manette ? reglages.liaisonsManette : null, disposition) : [];
  const bloque = libelleChatBloque(chat.bloqueS);
  return (
    <>
      {chat.menu && (
        <div className={styles.menuChat} role="group" aria-label={`Réactions rapides : ${chat.menu.titre}`} data-categorie={chat.menu.categorie}>
          <p className={styles.titreMenuChat}>{chat.menu.titre}</p>
          <ul>
            {lignesMenu.map((l) => (
              <li key={l.direction} data-direction={l.direction}>
                <span className={styles.flecheChat} aria-hidden="true">{l.fleche}</span>
                <kbd className={styles.entreeChat}>{l.entree}</kbd>
                <span>{l.texte}</span>
                {l.equipeSeule && <small className={styles.etiquetteEquipe}>équipe</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className={styles.chat} role="log" aria-live="polite" aria-label="Réactions rapides reçues">
        {chat.lignes.map((l) => (
          <li key={l.id} data-equipe={l.equipe} data-moi={l.moi ? "oui" : undefined}>
            <span className={styles.reserveLecteurs}>{annonceLigneChat(l)}</span>
            <span aria-hidden="true">
              {l.equipeSeule && <small className={styles.etiquetteEquipe}>(équipe)</small>}
              <b className={styles.nomChat}>{l.nom}</b> {l.texte}
            </span>
          </li>
        ))}
      </ul>
      {bloque && <p className={styles.chatBloque} role="status">{bloque}</p>}
    </>
  );
}
