/**
 * Routage des deux salles du serveur (PUR, sans I/O : `serveur-fps/src/index.ts` ne fait qu'appliquer ces décisions). Le message `mode` change un
 * client de salle ; la décision est prise AVANT de quitter l'ancienne salle (sinon `Salle.connecter` renverrait `erreur{plein}`, que le serveur
 * transforme en fermeture de socket). `salons` résume les deux salles pour le choix du mode.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Deux salles, un seul serveur »)
 */
import { JEU, MODES_SALLE, type MessageServeur, type ModeSalle, type PhaseZombies } from "./protocole";
import { ZOMBIES } from "./zombies-vagues";

/** Connexions (lobby compris) acceptées par la salle d'un mode. */
export const capaciteSalle = (mode: ModeSalle): number => (mode === "zombies" ? ZOMBIES.joueursMax : JEU.connexionsMax);

export type DecisionMode =
  /** le client est déjà dans cette salle : simple écho `mode` */
  | { action: "echo"; mode: ModeSalle }
  /** `refus{action:"mode", raison}` et le client reste où il est */
  | { action: "refus"; raison: "lobby" | "plein" }
  /** `deconnecter` de l'ancienne salle, `connecter` dans la nouvelle, puis `mode` + `bienvenue` */
  | { action: "changer"; mode: ModeSalle };

/**
 * Que faire d'un `mode{mode}` reçu ? `null` : valeur inconnue, ignorée. `enJeu` : le client est en jeu dans sa salle actuelle (refus `lobby`) ;
 * `joueursCible` : membres de la salle d'arrivée (refus `plein` si elle est pleine).
 */
export function decisionMode(e: { mode: unknown; salleActuelle: ModeSalle; enJeu: boolean; joueursCible: number }): DecisionMode | null {
  if (!(MODES_SALLE as readonly unknown[]).includes(e.mode)) return null;
  const mode = e.mode as ModeSalle;
  if (mode === e.salleActuelle) return { action: "echo", mode };
  if (e.enJeu) return { action: "refus", raison: "lobby" };
  if (e.joueursCible >= capaciteSalle(mode)) return { action: "refus", raison: "plein" };
  return { action: "changer", mode };
}

/** Message `salons` (diffusé à tous à la connexion puis au changement, ≤ 1 Hz). */
export function messageSalons(
  arene: { joueurs: number; enJeu: number }, zombies: { phase: PhaseZombies; joueurs: number; manche: number },
): Extract<MessageServeur, { t: "salons" }> {
  return { t: "salons", arene: { joueurs: arene.joueurs, enJeu: arene.enJeu }, zombies: { phase: zombies.phase, joueurs: zombies.joueurs, manche: zombies.manche } };
}
