/**
 * Suspension d'une partie de zombies par un joueur (« pause » du menu, v11) : horloge virtuelle PURE, sans horloge réelle propre (tout instant
 * lui est passé en paramètre).
 *
 * `Salle` convertit l'horloge réelle du serveur en horloge virtuelle `tJeu = reel − decalage` AVANT de la transmettre à quoi que ce soit : tant que
 * la suspension dure, l'horloge virtuelle vaut une constante `V`, et au retour elle repart de `V` (le décalage a grossi de la durée de la pause).
 * Rien dans le jeu ne sait qu'il a été figé (spec 2026-10-29-pause-parties-bots-design.md, §1.1).
 *
 * Vocabulaire : « suspension » (jamais « pause », déjà prise par `PhaseZombies` : la pause entre deux manches) ; « levée » = fin de la suspension ;
 * « compte à rebours » = les `compteMs` qui précèdent la levée (le jeu est encore figé, les joueurs reprennent la souris).
 *
 * Abus (seulement quand plusieurs humains sont admis ; un seul admis est exempté de tout) : délai entre deux suspensions d'un même joueur,
 * durée maximale d'une suspension, pause cumulée maximale par partie, annulation du compte à rebours une seule fois par suspension.
 */
import type { MessageClient } from "./protocole";

/**
 * LISTE BLANCHE des messages du client qui agissent encore salle suspendue (`true`) ; tout le reste est jeté. Une liste blanche et non noire : un message
 * ajouté un jour ferait tourner un service sans horloge, le `satisfies` oblige à choisir pour chaque nouveau type. `rejoindre` passe (un chargement qui
 * finit), `pauseZ` est traité à part. Exception hors liste, dans `Salle.recevoir` : les ARRÊTS de maintien (`reanimer{cible:null}`, `reparer{fenetre:null}`),
 * que le client envoie en relâchant E à la réception de `zpause{actif:true}` (salle déjà suspendue) ; ils ne font que relâcher, sans horloge.
 */
export const PASSE_EN_SUSPENSION = {
  pseudo: true, quitter: true, ping: true, vueScores: true, voixActif: true, voix: true, rejoindre: true, pauseZ: true,
  bonjour: false, arme: false, equiper: false, main: false, etat: false, tir: false, coup: false, mode: false, regarder: false, lancerPartie: false,
  acheter: false, reparer: false, reanimer: false, monter: false, descendre: false, siege: false, conduite: false, pilotage: false, canon: false,
  invoquer: false, lancerFrappe: false, lancerFumigene: false, lancerGrenade: false, monterBus: false, sauter: false, chute: false, ramasser: false,
  lacher: false, utiliser: false, statsBr: false,
} as const satisfies Record<MessageClient["t"], boolean>;

export interface OptionsSuspension {
  /** durée maximale d'une suspension (ms) : au-delà, levée automatique avec compte à rebours non annulable */
  maxMs: number;
  /** compte à rebours qui précède la levée quand plusieurs humains sont admis (ms ; 0 = levée immédiate) */
  compteMs: number;
  /** délai entre deux suspensions (ou annulations) d'un même joueur (ms), compté depuis sa dernière action ou la levée de sa suspension */
  cooldownMs: number;
  /** pause cumulée maximale par partie (ms), suspension en cours comprise */
  totalMs: number;
}

export const SUSPENSION_DEFAUT: OptionsSuspension = { maxMs: 300_000, compteMs: 3_000, cooldownMs: 10_000, totalMs: 900_000 };

export interface EtatSuspension {
  /** id du joueur qui a suspendu (il peut être parti : la suspension reste) */
  par: string;
  pseudo: string;
  /** instant RÉEL du début */
  debutReel: number;
  /** instant RÉEL de la fin du compte à rebours, null = pas de compte à rebours en cours */
  compteFinReel: number | null;
}

/** Ce que renvoie `tic` à un instant précis (null le reste du temps) : `leve` = la suspension est finie, `auto` / `force` = un compte à rebours non annulable démarre. */
export type EvenementSuspension = "leve" | "auto" | "force" | null;

export class Suspension {
  readonly options: OptionsSuspension;
  /** ms réelles écoulées pendant les suspensions TERMINÉES depuis la création : `virtuel = reel − decalage` */
  private decalage = 0;
  /** horloge virtuelle gelée pendant la suspension */
  private v = 0;
  private etat: EtatSuspension | null = null;
  /** le compte à rebours en cours ne peut plus être annulé (levée automatique : durée maximale ou pause cumulée) */
  private compteForce = false;
  /** le compte à rebours de la suspension en cours a déjà été annulé une fois */
  private annule = false;
  /** pause cumulée des suspensions terminées de la partie (ms réelles) */
  private cumule = 0;
  /** dernier instant réel d'action de chaque joueur (suspension, annulation, levée de sa suspension) */
  private readonly dernier = new Map<string, number>();

  constructor(o: Partial<OptionsSuspension> = {}) {
    this.options = { ...SUSPENSION_DEFAUT, ...o };
  }

  /** Horloge virtuelle : `reel − décalage`, gelée à `V` pendant une suspension. */
  virtuel(reel: number): number {
    return this.etat ? this.v : reel - this.decalage;
  }

  get active(): EtatSuspension | null {
    return this.etat;
  }

  /** Pause cumulée de la partie (ms), suspension en cours comprise. */
  totalSuspenduMs(reel: number = this.etat?.debutReel ?? 0): number {
    return this.cumule + (this.etat ? Math.max(0, reel - this.etat.debutReel) : 0);
  }

  /** Un joueur peut-il suspendre (ou annuler le compte à rebours) maintenant ? Seul admis (`admisCount` ≤ 1) : toujours, aucune limite. */
  peutSuspendre(par: string, reel: number, admisCount: number): "ok" | "limite" {
    if (admisCount <= 1) return "ok";
    const avant = this.dernier.get(par);
    if (avant !== undefined && reel - avant < this.options.cooldownMs) return "limite";
    if (this.totalSuspenduMs(reel) >= this.options.totalMs) return "limite";
    return "ok";
  }

  /**
   * Suspend la partie. Renvoie `{ v }` (l'horloge virtuelle gelée) quand l'état change : nouvelle suspension, ou annulation du compte à rebours
   * en cours (une seule fois par suspension, jamais s'il est forcé) ; null si déjà suspendue (idempotent). L'appelant a vérifié `peutSuspendre`.
   */
  suspendre(par: string, pseudo: string, reel: number, admisCount: number): { v: number } | null {
    if (this.etat) {
      if (this.etat.compteFinReel === null || this.compteForce || this.annule) return null;
      this.etat.compteFinReel = null;
      this.annule = true;
      if (admisCount > 1) this.dernier.set(par, reel);
      return { v: this.v };
    }
    this.v = reel - this.decalage;
    this.etat = { par, pseudo, debutReel: reel, compteFinReel: null };
    this.compteForce = false;
    this.annule = false;
    if (admisCount > 1) this.dernier.set(par, reel);
    return { v: this.v };
  }

  /**
   * Demande de levée par un joueur. `immediate` : levée faite (seul admis, ou compte à rebours de 0) ; `compte` : compte à rebours démarré ;
   * `rien` : pas suspendue, ou compte à rebours déjà en cours.
   */
  demanderLevee(reel: number, admisCount: number): "immediate" | "compte" | "rien" {
    const e = this.etat;
    if (!e || e.compteFinReel !== null) return "rien";
    if (admisCount <= 1 || this.options.compteMs <= 0) {
      this.lever(reel);
      return "immediate";
    }
    e.compteFinReel = reel + this.options.compteMs;
    return "compte";
  }

  /**
   * À appeler à chaque tic RÉEL : fin du compte à rebours (`leve`), durée maximale d'une suspension ou pause cumulée atteinte (compte à rebours
   * non annulable : `auto` / `force`, ou `leve` d'emblée s'il n'y a pas de compte à rebours). Un seul admis en est exempté (`admisCount` ≤ 1).
   */
  tic(reel: number, admisCount: number = 2): EvenementSuspension {
    const e = this.etat;
    if (!e) return null;
    if (e.compteFinReel !== null) {
      if (reel < e.compteFinReel) return null;
      this.lever(reel);
      return "leve";
    }
    if (admisCount <= 1) return null;
    const trop = reel - e.debutReel >= this.options.maxMs ? "auto" : this.totalSuspenduMs(reel) >= this.options.totalMs ? "force" : null;
    if (!trop) return null;
    if (this.options.compteMs <= 0) {
      this.lever(reel);
      return "leve";
    }
    e.compteFinReel = reel + this.options.compteMs;
    this.compteForce = true;
    return trop;
  }

  /** Levée d'office (fin de partie, plus personne) ou terme d'une demande : le décalage grossit de la durée réelle, l'horloge repart de `V`. */
  lever(reel: number): void {
    const e = this.etat;
    if (!e) return;
    const duree = Math.max(0, reel - e.debutReel);
    this.decalage += duree;
    this.cumule += duree;
    this.dernier.set(e.par, reel);
    this.etat = null;
    this.compteForce = false;
    this.annule = false;
  }

  /** Nouvelle partie (lancement, retour au lobby) : pause cumulée et délais remis à zéro ; le décalage d'horloge survit (l'horloge reste continue). */
  reinitialiserPartie(): void {
    this.cumule = 0;
    this.dernier.clear();
  }
}
