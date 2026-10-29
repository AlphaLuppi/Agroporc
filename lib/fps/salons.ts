/**
 * Routage des salles du serveur (PUR, sans I/O : `serveur-fps/src/index.ts` ne fait qu'appliquer ces décisions). Le message `mode` change un
 * client de salle ; la décision est prise AVANT de quitter l'ancienne salle (sinon `Salle.connecter` renverrait `erreur{plein}`, que le serveur
 * transforme en fermeture de socket). `salons` résume les salles pour le choix du mode. Le Battle Royale a PLUSIEURS parties (une salle
 * permanente, plus celles créées par les joueurs arrivés pendant une partie en cours) : `mode{mode:"br", partie}` choisit la sienne.
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Deux salles, un seul serveur »), 2026-10-28-battle-royale-design.md (troisième salle),
 * 2026-10-29-br-voix-parties-design.md (parties multiples)
 */
import { BR } from "./br-regles";
import {
  JEU, MODES_SALLE, PARTIE_NOUVELLE, VERSION_MIN_ZOMBIES, type MessageServeur, type ModeSalle, type PhaseBr, type PhaseZombies, type ResumePartieBr,
  type ResumeSalonBr,
} from "./protocole";
import { ZOMBIES } from "./zombies-vagues";

/** Connexions (lobby compris) acceptées par la salle d'un mode. */
export function capaciteSalle(mode: ModeSalle): number {
  switch (mode) {
    case "zombies": return ZOMBIES.joueursMax;
    case "br": return BR.joueursMax;
    default: return JEU.connexionsMax;
  }
}

/**
 * Mode du client placé dans `salle`, par identité parmi `salles`. Une salle inconnue vaut "arene" (un client pas encore placé). Le mode d'un client
 * dans la salle BR n'est jamais pris pour « arène » : sinon sa demande `mode{arene}` recevrait un écho et il resterait dans la salle BR avec sa
 * place et peut-être le rôle d'hôte.
 */
export function modeDeSalle<T>(salle: T, salles: Record<ModeSalle, T | readonly T[]>): ModeSalle {
  for (const mode of MODES_SALLE) {
    const s = salles[mode];
    if (Array.isArray(s) ? (s as readonly T[]).includes(salle) : s === salle) return mode;
  }
  return "arene";
}

/** Une partie de Battle Royale vue par le routage : son id, ses membres et sa phase. */
export interface PartieRoutage { id: string; joueurs: number; phase: PhaseBr }

/**
 * Partie où envoyer un client qui demande le Battle Royale sans en nommer une : celle au lobby qui a le plus de monde (à égalité, la première
 * de la liste : la salle permanente), pour que tout le monde se retrouve ; sinon (toutes en cours ou au bilan) la première qui a de la place,
 * où le client voit la partie en cours et peut la regarder ou créer la sienne. null : tout est plein.
 */
export function choisirPartieBr(parties: readonly PartieRoutage[]): PartieRoutage | null {
  const libres = parties.filter((p) => p.joueurs < BR.joueursMax);
  let meilleure: PartieRoutage | null = null;
  for (const p of libres) if (p.phase === "lobby" && (!meilleure || p.joueurs > meilleure.joueurs)) meilleure = p;
  return meilleure ?? libres[0] ?? null;
}

export type DecisionMode =
  /** le client est déjà dans cette salle : simple écho `mode` (`partie` : sa partie de Battle Royale) */
  | { action: "echo"; mode: ModeSalle; partie?: string }
  /** `refus{action:"mode", raison}` et le client reste où il est ; `limite` : plus de place pour une partie de Battle Royale de plus */
  | { action: "refus"; raison: "lobby" | "plein" | "limite" }
  /** (v10) client trop ancien pour la salle demandée : `erreur{version}` (« rechargez la page ») */
  | { action: "version" }
  /**
   * `deconnecter` de l'ancienne salle, `connecter` dans la nouvelle, puis `mode` + `bienvenue`. `partie` (Battle Royale) : id de la partie
   * d'arrivée, ou `PARTIE_NOUVELLE` : le serveur crée la salle
   */
  | { action: "changer"; mode: ModeSalle; partie?: string };

/**
 * Que faire d'un `mode{mode}` reçu ? `null` : valeur inconnue, ignorée. `enJeu` : le client est en jeu dans sa salle actuelle (refus `lobby`) ;
 * `joueursCible` : membres de la salle d'arrivée (refus `plein` si elle est pleine). `version` (v10) : version du protocole du client ; avant
 * `VERSION_MIN_ZOMBIES`, la salle des zombies lui est fermée (absent = client à jour).
 * Battle Royale (`parties` fourni) : `partie` demandée (id d'une partie, `PARTIE_NOUVELLE`, ou absente : `choisirPartieBr`), `partieActuelle`
 * (si le client est déjà dans une partie BR), `creerPossible` (le serveur peut encore ouvrir une salle). Une demande de nouvelle partie reprend
 * d'abord une salle vide au lobby ; `joueursCible` est alors ignoré.
 */
export function decisionMode(e: {
  mode: unknown; salleActuelle: ModeSalle; enJeu: boolean; joueursCible: number; version?: number;
  partie?: unknown; partieActuelle?: string | null; parties?: readonly PartieRoutage[]; creerPossible?: boolean;
}): DecisionMode | null {
  if (!(MODES_SALLE as readonly unknown[]).includes(e.mode)) return null;
  const mode = e.mode as ModeSalle;
  if (mode === "zombies" && e.version !== undefined && e.version < VERSION_MIN_ZOMBIES) return { action: "version" };
  if (mode === "br" && e.parties) return decisionPartieBr(e, e.parties);
  if (mode === e.salleActuelle) return { action: "echo", mode };
  if (e.enJeu) return { action: "refus", raison: "lobby" };
  if (e.joueursCible >= capaciteSalle(mode)) return { action: "refus", raison: "plein" };
  return { action: "changer", mode };
}

function decisionPartieBr(
  e: { salleActuelle: ModeSalle; enJeu: boolean; partie?: unknown; partieActuelle?: string | null; creerPossible?: boolean },
  parties: readonly PartieRoutage[],
): DecisionMode {
  const dansBr = e.salleActuelle === "br" && !!e.partieActuelle;
  const echo: DecisionMode = { action: "echo", mode: "br", ...(e.partieActuelle ? { partie: e.partieActuelle } : {}) };
  if (e.partie === PARTIE_NOUVELLE) {
    if (e.enJeu) return { action: "refus", raison: "lobby" };
    // une salle vide au lobby fait l'affaire : pas de salle de plus
    const vide = parties.find((p) => p.joueurs === 0 && p.phase === "lobby" && p.id !== e.partieActuelle);
    if (vide) return { action: "changer", mode: "br", partie: vide.id };
    if (!e.creerPossible) return { action: "refus", raison: "limite" };
    return { action: "changer", mode: "br", partie: PARTIE_NOUVELLE };
  }
  const nommee = typeof e.partie === "string" ? parties.find((p) => p.id === e.partie) ?? null : null;
  // sans partie nommée (ou une partie disparue) : déjà dans une partie, on y reste ; sinon celle où les autres attendent
  if (!nommee && dansBr) return echo;
  const cible = nommee ?? choisirPartieBr(parties);
  if (!cible) return { action: "refus", raison: "plein" };
  if (dansBr && cible.id === e.partieActuelle) return echo;
  if (e.enJeu) return { action: "refus", raison: "lobby" };
  if (cible.joueurs >= BR.joueursMax) return { action: "refus", raison: "plein" };
  return { action: "changer", mode: "br", partie: cible.id };
}

/** Une partie de Battle Royale vue par le choix de l'aperçu : id, phase, survivants. */
export interface PartieApercu { id: string; phase: PhaseBr; vivants: number }

/**
 * (aperçu de la vue Palantir) Partie de Battle Royale dont un client montre le direct : la sienne si elle est en vol ou en jeu, sinon la partie
 * en vol / en jeu aux plus de survivants (égalité : la première de la liste), sinon null (le client affiche alors la simulation).
 */
export function partieApercuBr(parties: readonly PartieApercu[], miennePartie: string): string | null {
  const enCours = (p: PartieApercu): boolean => p.phase === "vol" || p.phase === "jeu";
  const mienne = parties.find((p) => p.id === miennePartie);
  if (mienne && enCours(mienne)) return mienne.id;
  let meilleure: PartieApercu | null = null;
  for (const p of parties) if (enCours(p) && (!meilleure || p.vivants > meilleure.vivants)) meilleure = p;
  return meilleure ? meilleure.id : null;
}

/**
 * Message `salons` (diffusé à tous à la connexion puis au changement, ≤ 1 Hz). `br` absent : le champ est omis (un client v7 ne le voit jamais).
 * `parties` (Battle Royale, additif) : toutes les parties, salle permanente en tête ; omis si absent.
 */
export function messageSalons(
  arene: { joueurs: number; enJeu: number }, zombies: { phase: PhaseZombies; joueurs: number; manche: number }, br?: ResumeSalonBr | null,
  parties?: readonly ResumePartieBr[],
): Extract<MessageServeur, { t: "salons" }> {
  const m: Extract<MessageServeur, { t: "salons" }> = {
    t: "salons", arene: { joueurs: arene.joueurs, enJeu: arene.enJeu }, zombies: { phase: zombies.phase, joueurs: zombies.joueurs, manche: zombies.manche },
  };
  if (br) {
    m.br = { phase: br.phase, joueurs: br.joueurs, vivants: br.vivants };
    if (br.palier !== undefined) m.br.palier = br.palier;
  }
  if (parties) {
    m.parties = parties.map((p) => ({
      id: p.id, phase: p.phase, joueurs: p.joueurs, vivants: p.vivants, ...(p.palier !== undefined ? { palier: p.palier } : {}), ...(p.hote ? { hote: p.hote } : {}),
    }));
  }
  return m;
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
