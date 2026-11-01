/**
 * File d'envoi du menu de développement (PUR, horloge en paramètre) : le serveur refuse deux messages `reglesDev` d'un même joueur à moins de
 * `INTERVALLE_DEV_MS` (reconstruire les services d'événements n'est pas gratuit). Le panneau, lui, laisse cocher trois cases en une seconde : cette file
 * REGROUPE les réglages en attente (les patchs de règles et d'événements se fusionnent, le dernier gagne) et ne laisse partir qu'un message par intervalle.
 * Une action (forcer un événement, argent…) n'est jamais fusionnée : elle part seule, dans l'ordre. Le dernier message d'une rafale part toujours.
 */
import { INTERVALLE_DEV_MS } from "./regles-dev";
import type { MessageClient } from "./protocole";

export type MessageDev = Omit<Extract<MessageClient, { t: "reglesDev" }>, "t">;

/** Marge ajoutée à l'intervalle du serveur (gigue réseau : deux messages à 300 ms pile peuvent arriver à 299). */
export const MARGE_ENVOI_DEV_MS = 40;

export class FileEnvoiDev {
  private file: MessageDev[] = [];
  private dernierEnvoiT = -Infinity;

  /** Met un message en file : fusionné avec le dernier en attente si ni l'un ni l'autre ne porte d'action. */
  pousser(msg: MessageDev): void {
    const queue = this.file[this.file.length - 1];
    if (queue && queue.action === undefined && msg.action === undefined) {
      this.file[this.file.length - 1] = {
        ...(queue.regles || msg.regles ? { regles: { ...queue.regles, ...msg.regles } } : {}),
        ...(queue.evenements || msg.evenements ? { evenements: { ...queue.evenements, ...msg.evenements } } : {}),
      };
      return;
    }
    this.file.push(msg);
  }

  /** Il reste quelque chose à envoyer. */
  enAttente(): boolean { return this.file.length > 0; }

  /** Millisecondes à attendre avant le prochain envoi (0 = tout de suite ; `Infinity` si la file est vide). */
  attenteMs(maintenant: number): number {
    if (this.file.length === 0) return Infinity;
    return Math.max(0, this.dernierEnvoiT + INTERVALLE_DEV_MS + MARGE_ENVOI_DEV_MS - maintenant);
  }

  /** Le message à envoyer maintenant, ou null (file vide ou intervalle pas écoulé). Le retire de la file et date l'envoi. */
  suivant(maintenant: number): MessageDev | null {
    if (this.attenteMs(maintenant) > 0) return null;
    this.dernierEnvoiT = maintenant;
    return this.file.shift() ?? null;
  }

  /** Vide la file (fermeture du menu, partie quittée). */
  vider(): void { this.file = []; }
}
