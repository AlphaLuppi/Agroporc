/**
 * Routage des salles du serveur (PUR, sans I/O : `serveur-fps/src/index.ts` ne fait qu'appliquer ces décisions). Le message `mode` change un
 * client de salle ; la décision est prise AVANT de quitter l'ancienne salle (sinon `Salle.connecter` renverrait `erreur{plein}`, que le serveur
 * transforme en fermeture de socket). `salons` résume les salles pour le choix du mode. Le Battle Royale a PLUSIEURS parties (une salle
 * permanente, plus celles créées par les joueurs arrivés pendant une partie en cours) : `mode{mode:"br", partie}` choisit la sienne.
 * Depuis la v11 les TROIS modes ont plusieurs parties en parallèle (`decisionPartie`, registre `lib/fps/parties.ts`).
 * Spec : docs/superpowers/specs/2026-10-27-arene-zombies-design.md (« Deux salles, un seul serveur »), 2026-10-28-battle-royale-design.md (troisième salle),
 * 2026-10-29-br-voix-parties-design.md (parties multiples du BR), 2026-10-29-pause-parties-bots-design.md (parties parallèles, lot 1)
 */
import { BR } from "./br-regles";
import {
  JEU, MODES_SALLE, PARTIE_AUTO, PARTIE_NOUVELLE, VERSION_MIN_ZOMBIES, type MessageServeur, type ModeSalle, type PhaseZombies, type ResumePartie,
  type ResumePartieBr, type ResumeSalonBr,
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

/**
 * Une partie vue par le routage. `joueurs` = membres de la table (lobby, spectateurs ET bots compris : `Salle.connecter` refuse à `joueursMax` membres, le
 * routage doit donc refuser avant, `refus{plein}` et non une fermeture de socket), `capacite` = membres au plus (`capaciteSalle(mode)` par défaut :
 * 64 connexions en arène, 8 en zombies, 50 en BR), `accueille` = le routage par DÉFAUT peut y envoyer un arrivant (`accueillante(mode, …)` par défaut),
 * `enJeu` = joueurs en arène (arène seulement). `phase` : "lobby" … pour les zombies et le BR, "arene" pour l'arène.
 */
export interface PartieRoutage {
  id: string; joueurs: number; phase: string;
  mode?: ModeSalle; capacite?: number; accueille?: boolean; enJeu?: number;
}

/**
 * La partie accueille-t-elle un arrivant routé par défaut ? Zombies et BR : au lobby. Arène : il reste de la place EN JEU (`enJeu` + `reserves`
 * places choisies mais pas encore occupées < `JEU.joueursMax`) ; le nombre de membres ne compte pas (le hall `ar1` est plein de spectateurs).
 */
export function accueillante(mode: ModeSalle, r: { phase: string; enJeu?: number; reserves?: number }): boolean {
  if (mode === "arene") return (r.enJeu ?? 0) + (r.reserves ?? 0) < JEU.joueursMax;
  return r.phase === "lobby";
}

/**
 * Une partie vue par le routage, à partir de ses compteurs (`serveur-fps/src/index.ts` ne fait que lire la salle). `membres` = `Salle.nombreJoueurs()`
 * (humains + bots) : c'est ce que la capacité limite. `reserves` : places d'arène choisies mais pas encore occupées.
 */
export function partieRoutageDe(
  mode: ModeSalle, p: { id: string; membres: number; phase: string; enJeu?: number; reserves?: number },
): PartieRoutage {
  const enJeu = mode === "arene" ? p.enJeu : undefined;
  return {
    id: p.id, mode, joueurs: p.membres, phase: p.phase, capacite: capaciteSalle(mode), ...(enJeu !== undefined ? { enJeu } : {}),
    accueille: accueillante(mode, { phase: p.phase, enJeu, reserves: mode === "arene" ? p.reserves ?? 0 : 0 }),
  };
}

/** Quota de bots restant : le total du serveur moins les bots en jeu dans TOUTES les parties de Battle Royale (permanente et créées). */
export function botsRestantsGlobal(total: number, botsParPartie: readonly number[]): number {
  return Math.max(0, total - botsParPartie.reduce((n, b) => n + b, 0));
}

const capaciteDe = (mode: ModeSalle, p: PartieRoutage): number => p.capacite ?? capaciteSalle(mode);
const accueilleDe = (mode: ModeSalle, p: PartieRoutage): boolean => p.accueille ?? accueillante(mode, p);

/**
 * Partie où envoyer un client qui demande un mode sans en nommer une. Arène : la partie qui accueille avec le plus de joueurs EN JEU (à égalité la
 * première : la permanente) ; zombies et BR : le lobby le plus peuplé (tout le monde se retrouve), à égalité le premier. Sinon : zombies et arène,
 * "nouvelle" si le serveur peut en ouvrir une (un arrivant ne tombe pas par défaut dans la partie en cours de quelqu'un d'autre) ; à défaut (et pour le
 * BR, où l'on peut regarder la partie en cours ou créer la sienne) la première qui a de la place. null : tout est plein.
 */
export function choisirPartie(mode: ModeSalle, parties: readonly PartieRoutage[], creerPossible: boolean): PartieRoutage | "nouvelle" | null {
  const libres = parties.filter((p) => p.joueurs < capaciteDe(mode, p));
  let meilleure: PartieRoutage | null = null;
  for (const p of libres) {
    if (!accueilleDe(mode, p)) continue;
    const poids = mode === "arene" ? p.enJeu ?? 0 : p.joueurs;
    const poidsMeilleure = meilleure ? (mode === "arene" ? meilleure.enJeu ?? 0 : meilleure.joueurs) : -1;
    if (poids > poidsMeilleure) meilleure = p;
  }
  if (meilleure) return meilleure;
  if (mode !== "br" && creerPossible) return "nouvelle";
  return libres[0] ?? null;
}

/** Alias de l'ancien nom (Battle Royale seulement, sans création de partie). */
export function choisirPartieBr(parties: readonly PartieRoutage[]): PartieRoutage | null {
  const c = choisirPartie("br", parties, false);
  return c === "nouvelle" ? null : c;
}

export type DecisionMode =
  /** le client est déjà dans cette salle : simple écho `mode` (`partie` : sa partie, depuis la v11 pour les trois modes) */
  | { action: "echo"; mode: ModeSalle; partie?: string }
  /** `refus{action:"mode", raison}` et le client reste où il est ; `limite` : plus de place pour une partie de plus */
  | { action: "refus"; raison: "lobby" | "plein" | "limite" }
  /** (v10) client trop ancien pour la salle demandée : `erreur{version}` (« rechargez la page ») */
  | { action: "version" }
  /**
   * `deconnecter` de l'ancienne salle, `connecter` dans la nouvelle, puis `mode` + `bienvenue`. `partie` : id de la partie
   * d'arrivée, ou `PARTIE_NOUVELLE` : le serveur crée la salle
   */
  | { action: "changer"; mode: ModeSalle; partie?: string };

/**
 * Que faire d'un `mode{mode}` reçu ? `null` : valeur inconnue, ignorée. `enJeu` : le client est en jeu dans sa salle actuelle (refus `lobby`) ;
 * `joueursCible` : membres de la salle d'arrivée (refus `plein` si elle est pleine ; ignoré quand `parties` est fourni). `version` (v10) : version du
 * protocole du client ; avant `VERSION_MIN_ZOMBIES`, la salle des zombies lui est fermée (absent = client à jour).
 * `parties` fourni (les parties du mode demandé, permanente en tête) : routage par partie, `decisionPartie`. Absent : une seule salle par mode.
 */
export function decisionMode(e: {
  mode: unknown; salleActuelle: ModeSalle; enJeu: boolean; joueursCible: number; version?: number;
  partie?: unknown; partieActuelle?: string | null; parties?: readonly PartieRoutage[]; creerPossible?: boolean;
}): DecisionMode | null {
  if (!(MODES_SALLE as readonly unknown[]).includes(e.mode)) return null;
  const mode = e.mode as ModeSalle;
  if (mode === "zombies" && e.version !== undefined && e.version < VERSION_MIN_ZOMBIES) return { action: "version" };
  if (e.parties) {
    return decisionPartie({
      mode, partie: e.partie, partieActuelle: e.partieActuelle, salleActuelle: e.salleActuelle, enJeu: e.enJeu, parties: e.parties,
      creerPossible: e.creerPossible ?? false, version: e.version,
    });
  }
  if (mode === e.salleActuelle) return { action: "echo", mode };
  if (e.enJeu) return { action: "refus", raison: "lobby" };
  if (e.joueursCible >= capaciteSalle(mode)) return { action: "refus", raison: "plein" };
  return { action: "changer", mode };
}

/**
 * Routage d'un `mode{mode, partie?}` pour les trois modes. `partie` : id d'une partie existante (on y va, `accueille` n'est pas consulté : « Rejoindre »
 * une partie de zombies en cours est permis), `PARTIE_NOUVELLE` (reprend d'abord une partie vide qui accueille, hors la sienne ; sinon crée ; sinon
 * `refus{limite}`), `PARTIE_AUTO` (arène : `choisirPartie`), ou absent / disparue (déjà dans une partie du mode : écho de la sienne ; sinon `choisirPartie`).
 * Les clients d'avant la v11 sont toujours routés vers la partie permanente (`parties[0]`) de l'arène et des zombies, où ils retrouvent leurs amis et
 * qu'ils n'ont aucune interface pour quitter ; le Battle Royale garde les parties multiples de la v9.
 */
export function decisionPartie(e: {
  mode: ModeSalle; partie?: unknown; partieActuelle?: string | null; salleActuelle: ModeSalle; enJeu: boolean;
  parties: readonly PartieRoutage[]; creerPossible: boolean; version?: number;
}): DecisionMode {
  const { mode, parties } = e;
  const dedans = e.salleActuelle === mode && !!e.partieActuelle;
  const echo: DecisionMode = { action: "echo", mode, ...(e.partieActuelle ? { partie: e.partieActuelle } : {}) };
  const ancien = e.version !== undefined && e.version < 11 && mode !== "br";
  if (ancien) {
    const permanente = parties[0];
    if (!permanente) return { action: "refus", raison: "plein" };
    if (dedans && permanente.id === e.partieActuelle) return echo;
    if (e.enJeu) return { action: "refus", raison: "lobby" };
    if (permanente.joueurs >= capaciteDe(mode, permanente)) return { action: "refus", raison: "plein" };
    return { action: "changer", mode, partie: permanente.id };
  }
  if (e.partie === PARTIE_NOUVELLE) {
    if (e.enJeu) return { action: "refus", raison: "lobby" };
    // une partie vide qui accueille fait l'affaire : pas de partie de plus
    const vide = parties.find((p) => p.joueurs === 0 && accueilleDe(mode, p) && p.id !== e.partieActuelle);
    if (vide) return { action: "changer", mode, partie: vide.id };
    if (!e.creerPossible) return { action: "refus", raison: "limite" };
    return { action: "changer", mode, partie: PARTIE_NOUVELLE };
  }
  const nommee = typeof e.partie === "string" ? parties.find((p) => p.id === e.partie) ?? null : null;
  // sans partie nommée (ou une partie disparue) : déjà dans une partie du mode, on y reste (sauf `auto`, qui réévalue) ; sinon la mieux placée
  if (!nommee && dedans && e.partie !== PARTIE_AUTO) return echo;
  let cible: PartieRoutage | null = nommee;
  if (!cible) {
    const choix = choisirPartie(mode, parties, e.creerPossible);
    if (choix === "nouvelle") {
      if (e.enJeu) return { action: "refus", raison: "lobby" };
      return { action: "changer", mode, partie: PARTIE_NOUVELLE };
    }
    cible = choix;
  }
  if (!cible) return { action: "refus", raison: "plein" };
  if (dedans && cible.id === e.partieActuelle) return echo;
  if (e.enJeu) return { action: "refus", raison: "lobby" };
  if (cible.joueurs >= capaciteDe(mode, cible)) return { action: "refus", raison: "plein" };
  return { action: "changer", mode, partie: cible.id };
}

/**
 * Message `salons` (diffusé à tous à la connexion puis au changement, ≤ 1 Hz). `br` absent : le champ est omis (un client v7 ne le voit jamais).
 * `parties` (Battle Royale, additif) : toutes les parties BR, salle permanente en tête ; omis si absent. Il ne contient JAMAIS d'autre mode (les
 * clients v10 l'interprètent comme tel). `listes` (v11, additif) : les parties de chacun des trois modes. Les champs historiques `arene`, `zombies`,
 * `br` sont les résumés des parties permanentes, calculés par l'appelant.
 */
export function messageSalons(
  arene: { joueurs: number; enJeu: number }, zombies: { phase: PhaseZombies; joueurs: number; manche: number }, br?: ResumeSalonBr | null,
  parties?: readonly ResumePartieBr[], listes?: Record<ModeSalle, readonly ResumePartie[]>,
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
  if (listes) m.listes = { arene: [...listes.arene], zombies: [...listes.zombies], br: [...listes.br] };
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
export function garderPourReprise(e: { estZombies: boolean; membre: boolean; code: number; phase: PhaseZombies | null }): boolean {
  if (!e.estZombies || !e.membre) return false;
  if (e.phase !== "pause" && e.phase !== "manche") return false;
  return !CODES_DEPART_VOLONTAIRE.includes(e.code);
}
