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

/**
 * (v8) Codes de fermeture d'un départ volontaire : 1000 (le client ferme la vue, `CODE_DEPART_VOLONTAIRE` de reseau.ts), 1001 (onglet fermé, page
 * rechargée), 1005 (fermeture sans code, demandée par le client). Une coupure réseau donne 1006 (ou la coupure par `terminate()` du ping).
 */
export const CODES_DEPART_VOLONTAIRE: readonly number[] = [1000, 1001, 1005];

/**
 * (v8) Une connexion fermée doit-elle être gardée `REPRISE_MS` pour une reprise ? Seulement un membre de la salle des zombies dont la partie est
 * en cours (pause ou manche : il y a quelque chose à reprendre) et dont la fermeture n'est pas un départ volontaire. Au lobby, un fantôme
 * resterait hôte (lui seul lance la partie) et compterait dans les salons ; après un départ volontaire, le client n'a plus de session.
 */
export function garderPourReprise(e: { salleZombies: boolean; membre: boolean; code: number; phase: PhaseZombies | null }): boolean {
  if (!e.salleZombies || !e.membre) return false;
  if (e.phase !== "pause" && e.phase !== "manche") return false;
  return !CODES_DEPART_VOLONTAIRE.includes(e.code);
}
