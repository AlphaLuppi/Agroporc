/**
 * Rocket Muche en ligne : la SALLE serveur (lot SALLE). PURE : aucune horloge globale, aucun hasard global, aucune socket. L'heure (`maintenantMs`,
 * horloge monotone) est passée à chaque appel ; le hasard vient de la graine de la salle.
 *
 * Machine d'états (spec § 6) : `salon` → `chargement` → `match` → `fin` → (`chargement` si revanche unanime | `salon`).
 *  - salon : équipes, réglages, lancement (≥ `humainsMin` humains).
 *  - chargement : `debut` envoyé, monde créé (décompte, pas encore avancé) ; le match démarre quand tous les humains connectés ont dit `pret`, ou
 *    après `chargementMaxMs` (servi par `tic`).
 *  - match : accumulateur de pas fixes à 120 Hz ; chaque pas lit l'entrée de chaque humain POUR CE TICK (ou répète la dernière, puis neutre), fait
 *    décider les bots (entrées quantifiées comme celles des humains), exécute `pasMonde`, collecte les événements ; un instantané complet tous les
 *    6 ticks (et sur événement important).
 *  - fin : `fin{resultat}`, vote de revanche (unanime → nouveau match ; refus ou `revancheMs` sans accord → salon).
 * Coupure : le joueur reste `coupe` pendant `repriseMs` (entrées neutres), puis un bot prend sa voiture. Départ volontaire : bot immédiat.
 *
 * La salle ne connaît AUCUN jeton de reprise : le module serveur (`rocket.ts`) les gère et appelle `reprendre`.
 *
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md (§ 4, § 6). Contrat : `protocole.ts`.
 */
import {
  ENTREES_NULLES, FORMATS, MATCH, NIVEAUX_BOT, NOMS_EQUIPES_DEFAUT, PAS_S, creerRng, joueursParEquipe, tirer,
} from "../contrat";
import type { Arene, Cerveau, ConfigMatch, EntreesVoiture, Equipe, EvenementMatch, MondeRocket, NiveauBot, Rng } from "../contrat";
import { creerArene } from "../arene";
import { creerCerveau } from "../bots";
import { NOMS_BOTS, pasMonde, resultatMatch } from "../match";
import { graineBot, creerMondeEnLigne } from "./monde-ligne";
import { dequantifierEntreesDans, extraireEtat, quantifierEntreesDans } from "./serialisation";
import { AVANCE_INCONNUE, RESEAU, REGLAGES_SALON_DEFAUT, echelleDuMonde } from "./protocole";
import type {
  CreerSalleRocket, EntreesQuantifiees, EtatMondeReseau, EtatSalon, JoueurSalon, MessageClient, MessageServeur, MesuresSalle, OptionsSalleRocket, PhaseSalle, RaisonRefus,
  ReglagesSalon, ResultatRejoindre, ResumeSalle, SalleRocket, SnapRocket, SortieSalle, TrameEntrees, TypeMessageClient, VoitureStatique,
} from "./protocole";

// ============================================================================================================================
// Constantes et utilitaires
// ============================================================================================================================

/** Arène partagée par toutes les salles du processus (immuable : le champ de distance est en lecture seule). Créée à la première demande. */
let areneCommune: Arene | null = null;
const arene = (): Arene => (areneCommune ??= creerArene());

/** Événements qui déclenchent un instantané hors grille (début / fin de phase, but, démolition). */
const EVENEMENTS_IMPORTANTS: ReadonlySet<EvenementMatch["t"]> = new Set(["but", "demolition", "coupDEnvoi", "prolongation", "fin"]);
/** délai minimal entre deux klaxons d'un même joueur (ms) */
const KLAXON_INTERVALLE_MS = 2000;
const EQUIPES: readonly Equipe[] = ["bleue", "orange"];

const neutre = (): EntreesQuantifiees => ({ accel: 0, direction: 0, tangage: 0, lacet: 0, roulis: 0, saut: false, boost: false, derapage: false });
function copierQ(a: EntreesQuantifiees, b: Readonly<EntreesQuantifiees>): void {
  a.accel = b.accel; a.direction = b.direction; a.tangage = b.tangage; a.lacet = b.lacet; a.roulis = b.roulis;
  a.saut = b.saut; a.boost = b.boost; a.derapage = b.derapage;
}
function viderQ(a: EntreesQuantifiees): void {
  a.accel = 0; a.direction = 0; a.tangage = 0; a.lacet = 0; a.roulis = 0; a.saut = false; a.boost = false; a.derapage = false;
}
const clamp = (x: number, min: number, max: number): number => (x < min ? min : x > max ? max : x);

// ============================================================================================================================
// Structures internes
// ============================================================================================================================

/** Un humain présent dans la salle (connecté ou en reprise). */
interface Joueur {
  id: number;
  nom: string;
  equipe: Equipe;
  connecte: boolean;
  charge: boolean;
  /** instant de la coupure (ms) quand `connecte` est faux */
  coupeDepuisMs: number;
  /** vote de revanche (null : pas encore voté) */
  vote: boolean | null;
  /** id de sa voiture dans le match courant (−1 hors match) */
  voiture: number;
  dernierKlaxonMs: number;
  // ---- entrées reçues : anneau indexé par tick mod `tamponEntrees`, marqué du tick exact ----
  axes: Int8Array;
  boutons: Uint8Array;
  marque: Int32Array;
  /** plus grand tick d'entrée reçu (−1 : aucun) et l'entrée correspondante (« dernière entrée connue ») */
  watermark: number;
  derniere: EntreesQuantifiees;
  /** ticks consécutifs joués avec la dernière entrée connue */
  repetitions: number;
  /** pire cas de la fenêtre : minimum de (tick d'entrée − tick du monde à l'arrivée) sur les entrées vues pour la première fois ; null : aucune */
  avanceMin: number | null;
  /** ticks de la fenêtre sans entrée vraie */
  manquees: number;
}

function nouveauJoueur(id: number, nom: string, equipe: Equipe): Joueur {
  const n = RESEAU.tamponEntrees;
  return {
    id, nom, equipe, connecte: true, charge: false, coupeDepuisMs: -1, vote: null, voiture: -1, dernierKlaxonMs: -Infinity,
    axes: new Int8Array(n * 5), boutons: new Uint8Array(n), marque: new Int32Array(n).fill(-1),
    watermark: -1, derniere: neutre(), repetitions: 0, avanceMin: null, manquees: 0,
  };
}

function reinitialiserEntrees(j: Joueur): void {
  j.marque.fill(-1);
  j.watermark = -1; viderQ(j.derniere); j.repetitions = 0; j.avanceMin = null; j.manquees = 0;
}

/** Match en cours (phases chargement, match, fin). */
interface MatchSalle {
  /** numéro tel qu'envoyé (modulo 256) */
  numero: number;
  config: ConfigMatch;
  statiques: VoitureStatique[];
  monde: MondeRocket;
  /** humain qui pilote la voiture i (null : bot, ou humain remplacé) */
  pilotes: (Joueur | null)[];
  cerveaux: (Cerveau | null)[];
  /** dernière entrée APPLIQUÉE par chaque voiture (tampon réutilisé à chaque pas) et sa forme réelle pour `pasMonde` */
  appliquees: EntreesQuantifiees[];
  reelles: EntreesVoiture[];
  /** accumulateur de temps de jeu (s) et dernier instant servi (ms) */
  reste: number;
  dernierMs: number;
  /** événements en attente d'être regroupés dans un message `ev` */
  tampon: { tick: number; e: EvenementMatch }[];
  tamponImportant: boolean;
  dernierFlushMs: number;
  /** message `fin` mémorisé (renvoyé à un joueur qui reprend en phase « fin ») */
  fin: Extract<MessageServeur, { t: "fin" }> | null;
}

// ============================================================================================================================
// Implémentation
// ============================================================================================================================

class SalleImpl implements SalleRocket {
  readonly code: string;
  private phaseCourante: PhaseSalle = "salon";
  private readonly joueurs: Joueur[] = [];
  private hoteId: number;
  private reglages: ReglagesSalon;
  private readonly rng: Rng;
  private readonly opts: OptionsSalleRocket;
  private readonly fabriqueCerveau: (niveau: NiveauBot, graine: number) => Cerveau;
  private readonly humainsMin: number;
  private readonly chargementMaxMs: number;
  private readonly repriseMs: number;
  private readonly revancheMs: number;
  private numeroMatch = 0;
  private match: MatchSalle | null = null;
  private debutPhaseMs: number;
  private horloge: number;
  private activite: number;
  // compteurs cumulés sur la vie de la salle (jamais remis à zéro : `rocket.ts` calcule des différences)
  private pasTotal = 0;
  private repetees = 0;
  private tardives = 0;
  private abandonneMs = 0;

  constructor(opts: OptionsSalleRocket) {
    this.opts = opts;
    this.code = opts.code;
    this.rng = creerRng(opts.graine);
    this.reglages = { ...REGLAGES_SALON_DEFAUT(), ...opts.reglages };
    this.humainsMin = opts.humainsMin ?? 2;
    this.chargementMaxMs = opts.chargementMaxMs ?? RESEAU.chargementMaxMs;
    this.repriseMs = opts.repriseMs ?? RESEAU.repriseMs;
    this.revancheMs = opts.revancheMs ?? RESEAU.revancheMs;
    this.fabriqueCerveau = opts.creerCerveau ?? creerCerveau;
    this.horloge = this.activite = this.debutPhaseMs = opts.maintenantMs;
    this.hoteId = opts.hote.id;
    // l'équipe de l'hôte est tirée avec le générateur de la salle (aucun hasard global)
    this.joueurs.push(nouveauJoueur(opts.hote.id, opts.hote.nom, tirer(this.rng) < 0.5 ? "bleue" : "orange"));
  }

  // ---- lecture ----------------------------------------------------------------------------------------------------------

  get phase(): PhaseSalle { return this.phaseCourante; }

  private trouver(id: number): Joueur | undefined {
    for (const j of this.joueurs) if (j.id === id) return j;
    return undefined;
  }

  private places(): number { return joueursParEquipe(this.reglages.format); }
  private compteEquipe(e: Equipe): number {
    let n = 0;
    for (const j of this.joueurs) if (j.equipe === e) n++;
    return n;
  }

  humains(): number { return this.joueurs.length; }
  vide(): boolean { return this.joueurs.length === 0; }
  enMatch(): boolean { return this.phaseCourante === "chargement" || this.phaseCourante === "match"; }
  aEcheance(): boolean { return this.phaseCourante !== "salon" && this.joueurs.length > 0; }
  activiteMs(): number { return this.activite; }
  monde(): Readonly<MondeRocket> | null { return this.match ? this.match.monde : null; }

  mesures(): MesuresSalle {
    return {
      phase: this.phaseCourante, humains: this.joueurs.length, pas: this.pasTotal, entreesRepetees: this.repetees, entreesTardives: this.tardives,
      tempsAbandonneMs: this.abandonneMs,
    };
  }

  resume(): ResumeSalle {
    const hote = this.trouver(this.hoteId);
    return {
      code: this.code, hote: hote ? hote.nom : "", format: this.reglages.format, dureeS: this.reglages.dureeS, niveauBots: this.reglages.niveauBots,
      humains: this.joueurs.length, places: 2 * this.places(),
    };
  }

  etat(): EtatSalon {
    const lancable = this.phaseCourante === "salon" && this.joueurs.length >= this.humainsMin;
    const joueurs: JoueurSalon[] = this.joueurs.map((j) => ({ id: j.id, nom: j.nom, equipe: j.equipe, hote: j.id === this.hoteId, connecte: j.connecte, charge: j.charge }));
    const e: EtatSalon = {
      code: this.code, phase: this.phaseCourante, reglages: { ...this.reglages }, joueurs, placesParEquipe: this.places(), lancable,
    };
    if (!lancable) {
      e.raisonNonLancable = this.phaseCourante !== "salon" ? "Une partie est en cours" : `Il faut ${this.humainsMin} joueurs pour lancer`;
    }
    if (this.phaseCourante === "fin") {
      const votes: Record<number, boolean> = {};
      for (const j of this.joueurs) if (j.vote !== null) votes[j.id] = j.vote;
      e.revanche = { votes, restantMs: Math.max(0, this.revancheMs - (this.horloge - this.debutPhaseMs)) };
    }
    return e;
  }

  // ---- messages ---------------------------------------------------------------------------------------------------------

  private salon(): SortieSalle { return { a: "tous", msg: { t: "salon", salon: this.etat() } }; }
  private refus(id: number, action: TypeMessageClient, raison: RaisonRefus): SortieSalle[] { return [{ a: id, msg: { t: "refus", action, raison } }]; }

  private msgDebut(j: Joueur): SortieSalle {
    const m = this.match!;
    return {
      a: j.id,
      msg: {
        t: "debut", config: { ...m.config, nomsEquipes: { ...m.config.nomsEquipes } }, voitures: m.statiques.map((s) => ({ ...s })), moi: j.voiture,
        numero: m.numero,
      },
    };
  }

  // ---- entrée / sortie des joueurs --------------------------------------------------------------------------------------

  rejoindre(joueur: { id: number; nom: string; equipe?: Equipe }, maintenantMs: number): ResultatRejoindre {
    this.horloge = this.activite = maintenantMs;
    if (this.phaseCourante !== "salon") return { ok: false, raison: "en-cours" };
    if (this.trouver(joueur.id)) return { ok: false, raison: "deja-dans-salle" };
    const cap = this.places();
    if (this.joueurs.length >= 2 * cap) return { ok: false, raison: "pleine" };
    let equipe: Equipe | null = null;
    if (joueur.equipe && this.compteEquipe(joueur.equipe) < cap) equipe = joueur.equipe;
    if (!equipe) {
      // la moins remplie ; à égalité, l'opposée de l'hôte (en 1v1 : l'adversaire de l'hôte)
      const b = this.compteEquipe("bleue"), o = this.compteEquipe("orange");
      const hote = this.trouver(this.hoteId);
      const oppose: Equipe = hote && hote.equipe === "bleue" ? "orange" : "bleue";
      const choix: Equipe = b < o ? "bleue" : o < b ? "orange" : oppose;
      equipe = this.compteEquipe(choix) < cap ? choix : choix === "bleue" ? "orange" : "bleue";
    }
    this.joueurs.push(nouveauJoueur(joueur.id, joueur.nom, equipe));
    return { ok: true, sorties: [this.salon()] };
  }

  retirer(idJoueur: number, maintenantMs: number, coupure: boolean): SortieSalle[] {
    this.horloge = this.activite = maintenantMs;
    const j = this.trouver(idJoueur);
    if (!j) return [];
    const out: SortieSalle[] = [];
    const phase = this.phaseCourante;
    if (phase === "salon") {
      this.supprimer(j);
      this.transfererHote();
      if (this.joueurs.length > 0) out.push(this.salon());
      return out;
    }
    if (coupure && j.connecte) {
      j.connecte = false;
      j.coupeDepuisMs = maintenantMs;
      out.push({ a: "tous", msg: { t: "presence", joueur: j.id, etat: "coupe", restantMs: this.repriseMs } });
      out.push(this.salon());
      if (phase === "chargement") this.verifierChargementComplet(maintenantMs, out);
      return out;
    }
    if (coupure) return out; // déjà coupé
    // départ volontaire
    if (phase === "fin") {
      this.supprimer(j);
      out.push({ a: "tous", msg: { t: "presence", joueur: j.id, etat: "parti" } });
      this.transfererHote();
      if (this.joueurs.length > 0) {
        out.push(this.salon());
        this.verifierRevancheUnanime(maintenantMs, out);
      }
      return out;
    }
    this.remplacerParBot(j, out);
    if (phase === "chargement") this.verifierChargementComplet(maintenantMs, out);
    return out;
  }

  reprendre(idJoueur: number, maintenantMs: number): SortieSalle[] {
    this.horloge = this.activite = maintenantMs;
    const j = this.trouver(idJoueur);
    if (!j) return [];
    const etaitCoupe = !j.connecte;
    j.connecte = true;
    j.coupeDepuisMs = -1;
    reinitialiserEntrees(j);
    j.charge = false;
    const out: SortieSalle[] = [];
    if (etaitCoupe) out.push({ a: "tous", msg: { t: "presence", joueur: j.id, etat: "revenu" } });
    out.push(this.salon());
    const m = this.match;
    if (!m) return out;
    out.push(this.msgDebut(j));
    if (this.phaseCourante === "match") out.push({ a: j.id, snap: this.construireSnap(j, extraireEtat(m.monde)) });
    else if (this.phaseCourante === "fin" && m.fin) out.push({ a: j.id, msg: m.fin });
    return out;
  }

  /** Retire le joueur de la liste (et de sa voiture) sans rien annoncer. */
  private supprimer(j: Joueur): void {
    const i = this.joueurs.indexOf(j);
    if (i >= 0) this.joueurs.splice(i, 1);
    const m = this.match;
    if (m && j.voiture >= 0 && m.pilotes[j.voiture] === j) m.pilotes[j.voiture] = null;
  }

  /** Un bot prend la voiture du joueur (match ou chargement) : même état physique, nom et statistiques conservés. */
  private remplacerParBot(j: Joueur, out: SortieSalle[]): void {
    const m = this.match;
    if (m && j.voiture >= 0) {
      m.pilotes[j.voiture] = null;
      m.cerveaux[j.voiture] = this.fabriqueCerveau(this.reglages.niveauBots, graineBot(m.config.graine, j.voiture));
    }
    this.supprimer(j);
    out.push({ a: "tous", msg: { t: "presence", joueur: j.id, etat: "bot" } });
    this.transfererHote();
    if (this.joueurs.length > 0) out.push(this.salon());
  }

  /** Si l'hôte est parti : le plus ancien joueur connecté (à défaut le plus ancien tout court) le devient. */
  private transfererHote(): void {
    if (this.joueurs.some((j) => j.id === this.hoteId)) return;
    const prochain = this.joueurs.find((j) => j.connecte) ?? this.joueurs[0];
    if (prochain) this.hoteId = prochain.id;
  }

  // ---- messages texte ---------------------------------------------------------------------------------------------------

  recevoir(idJoueur: number, msg: MessageClient, maintenantMs: number): SortieSalle[] {
    this.horloge = maintenantMs;
    const j = this.trouver(idJoueur);
    if (!j) return [];
    switch (msg.t) {
      case "ping": return [{ a: idJoueur, msg: { t: "pong", c: msg.c, tick: this.tickFractionnaire(maintenantMs), ralenti: this.ralenti() } }];
      case "quitter": {
        this.activite = maintenantMs;
        const out = this.retirer(idJoueur, maintenantMs, false);
        out.push({ a: idJoueur, msg: { t: "salon", salon: null, raison: "quitte" } });
        return out;
      }
      case "equipe": return this.changerEquipe(j, msg.equipe, maintenantMs);
      case "reglages": return this.changerReglages(j, msg.reglages, maintenantMs);
      case "lancer": return this.lancer(j, maintenantMs);
      case "pret": return this.pret(j, maintenantMs);
      case "klaxon": return this.klaxon(j, maintenantMs);
      case "revanche": return this.revanche(j, msg.oui, maintenantMs);
      case "retourSalon": return this.retourSalon(j, maintenantMs);
      case "dev": return this.dev(j, msg, maintenantMs);
      default: return []; // bonjour, lister, creer, rejoindre : affaires du module serveur
    }
  }

  private changerEquipe(j: Joueur, equipe: Equipe, ms: number): SortieSalle[] {
    if (this.phaseCourante !== "salon") return this.refus(j.id, "equipe", "phase");
    if (equipe !== "bleue" && equipe !== "orange") return this.refus(j.id, "equipe", "invalide");
    if (j.equipe === equipe) return [];
    if (this.compteEquipe(equipe) >= this.places()) return this.refus(j.id, "equipe", "equipe-pleine");
    this.activite = ms;
    j.equipe = equipe;
    return [this.salon()];
  }

  private changerReglages(j: Joueur, r: Partial<ReglagesSalon>, ms: number): SortieSalle[] {
    if (j.id !== this.hoteId) return this.refus(j.id, "reglages", "hote");
    if (this.phaseCourante !== "salon") return this.refus(j.id, "reglages", "phase");
    const n: ReglagesSalon = { ...this.reglages };
    if (r.format !== undefined) {
      if (!FORMATS.includes(r.format)) return this.refus(j.id, "reglages", "invalide");
      const cap = joueursParEquipe(r.format);
      if (this.compteEquipe("bleue") > cap || this.compteEquipe("orange") > cap) return this.refus(j.id, "reglages", "format");
      n.format = r.format;
    }
    if (r.dureeS !== undefined) {
      if (!MATCH.dureesPermisesS.includes(r.dureeS)) return this.refus(j.id, "reglages", "invalide");
      n.dureeS = r.dureeS;
    }
    if (r.niveauBots !== undefined) {
      if (!NIVEAUX_BOT.includes(r.niveauBots)) return this.refus(j.id, "reglages", "invalide");
      n.niveauBots = r.niveauBots;
    }
    if (r.visible !== undefined) {
      if (typeof r.visible !== "boolean") return this.refus(j.id, "reglages", "invalide");
      n.visible = r.visible;
    }
    this.activite = ms;
    if (n.format === this.reglages.format && n.dureeS === this.reglages.dureeS && n.niveauBots === this.reglages.niveauBots && n.visible === this.reglages.visible) return [];
    this.reglages = n;
    return [this.salon()];
  }

  private lancer(j: Joueur, ms: number): SortieSalle[] {
    if (j.id !== this.hoteId) return this.refus(j.id, "lancer", "hote");
    if (this.phaseCourante !== "salon") return this.refus(j.id, "lancer", "phase");
    if (this.joueurs.length < this.humainsMin) return this.refus(j.id, "lancer", "joueurs");
    this.activite = ms;
    const out: SortieSalle[] = [];
    this.demarrerChargement(ms, out);
    return out;
  }

  private pret(j: Joueur, ms: number): SortieSalle[] {
    if (this.phaseCourante !== "chargement" || j.charge) return [];
    this.activite = ms;
    j.charge = true;
    const out: SortieSalle[] = [this.salon()];
    this.verifierChargementComplet(ms, out);
    return out;
  }

  private klaxon(j: Joueur, ms: number): SortieSalle[] {
    const m = this.match;
    if (this.phaseCourante !== "match" || !m || j.voiture < 0) return [];
    if (ms - j.dernierKlaxonMs < KLAXON_INTERVALLE_MS) return [];
    if (m.monde.voitures[j.voiture].demolie) return [];
    j.dernierKlaxonMs = ms;
    m.tampon.push({ tick: m.monde.tick, e: { t: "klaxon", idVoiture: j.voiture } });
    return [];
  }

  private revanche(j: Joueur, oui: boolean, ms: number): SortieSalle[] {
    if (this.phaseCourante !== "fin") return [];
    this.activite = ms;
    if (!oui) {
      const out: SortieSalle[] = [];
      this.retournerAuSalon(out);
      return out;
    }
    j.vote = true;
    const out: SortieSalle[] = [this.salon()];
    this.verifierRevancheUnanime(ms, out);
    return out;
  }

  private retourSalon(j: Joueur, ms: number): SortieSalle[] {
    if (j.id !== this.hoteId) return this.refus(j.id, "retourSalon", "hote");
    if (this.phaseCourante !== "fin") return this.refus(j.id, "retourSalon", "phase");
    this.activite = ms;
    const out: SortieSalle[] = [];
    this.retournerAuSalon(out);
    return out;
  }

  private dev(j: Joueur, msg: Extract<MessageClient, { t: "dev" }>, ms: number): SortieSalle[] {
    if (!this.opts.dev) return this.refus(j.id, "dev", "dev");
    const m = this.match;
    if (this.phaseCourante !== "match" || !m) return this.refus(j.id, "dev", "phase");
    this.activite = ms;
    const fini = (x: number): boolean => typeof x === "number" && Number.isFinite(x);
    if (msg.action === "balle") {
      const ok = [...msg.p, ...msg.v].every(fini);
      if (!ok) return this.refus(j.id, "dev", "invalide");
      m.monde.balle.p[0] = msg.p[0]; m.monde.balle.p[1] = msg.p[1]; m.monde.balle.p[2] = msg.p[2];
      m.monde.balle.v[0] = msg.v[0]; m.monde.balle.v[1] = msg.v[1]; m.monde.balle.v[2] = msg.v[2];
      return [];
    }
    if (msg.action === "chrono") {
      if (!fini(msg.tempsRestant)) return this.refus(j.id, "dev", "invalide");
      m.monde.tempsRestant = Math.max(0, msg.tempsRestant);
      return [];
    }
    return this.refus(j.id, "dev", "invalide");
  }

  // ---- pong -------------------------------------------------------------------------------------------------------------

  private ralenti(): boolean {
    const m = this.match;
    return !!m && this.phaseCourante === "match" && echelleDuMonde(m.monde.phase) !== 1;
  }

  /** `monde.tick` + fraction du pas en cours (−1 hors phase « match » : aucun tick ne court). */
  private tickFractionnaire(ms: number): number {
    const m = this.match;
    if (!m || this.phaseCourante !== "match") return -1;
    const dt = Math.max(0, ms - m.dernierMs) / 1000;
    return m.monde.tick + clamp((m.reste + dt * echelleDuMonde(m.monde.phase)) / PAS_S, 0, 1);
  }

  // ---- trames d'entrées -------------------------------------------------------------------------------------------------

  recevoirEntrees(idJoueur: number, trame: TrameEntrees, maintenantMs: number): SortieSalle[] {
    const m = this.match;
    const j = this.trouver(idJoueur);
    this.horloge = maintenantMs;
    if (!m || !j || this.phaseCourante !== "match" || !j.connecte || j.voiture < 0 || m.pilotes[j.voiture] !== j) return [];
    if (trame.numero !== m.numero || trame.entrees.length > RESEAU.entreesMaxParTrame) return [];
    const tick = m.monde.tick;
    const n = RESEAU.tamponEntrees;
    for (let i = 0; i < trame.entrees.length; i++) {
      const k = trame.tickDebut + i;
      if (!Number.isInteger(k) || k < 0) continue;
      if (k > tick + RESEAU.avanceMaxEntreesTicks) continue; // client déréglé ou tricheur
      const q = trame.entrees[i];
      // vue pour la première fois : au-delà du plus grand tick reçu, ou un trou encore à venir que cette copie comble
      const premiere = k > j.watermark || (k >= tick && j.marque[k % n] !== k);
      if (k < tick) {
        if (!premiere) continue;
        this.tardives++;
        j.avanceMin = Math.min(j.avanceMin ?? 127, Math.max(-127, k - tick));
      } else {
        if (j.marque[k % n] === k) continue;
        const s = k % n;
        j.axes[s * 5] = q.accel; j.axes[s * 5 + 1] = q.direction; j.axes[s * 5 + 2] = q.tangage; j.axes[s * 5 + 3] = q.lacet; j.axes[s * 5 + 4] = q.roulis;
        j.boutons[s] = (q.saut ? 1 : 0) | (q.boost ? 2 : 0) | (q.derapage ? 4 : 0);
        j.marque[s] = k;
        if (premiere) j.avanceMin = Math.min(j.avanceMin ?? 127, Math.min(127, k - tick));
      }
      if (k > j.watermark) {
        // l'entrée la plus récente connue, même arrivée en retard, est celle que la salle répète ensuite
        j.watermark = k;
        copierQ(j.derniere, q);
        j.repetitions = 0;
      }
    }
    return [];
  }

  // ---- chargement -------------------------------------------------------------------------------------------------------

  /** Crée le monde du match (répartition des équipes, bots, graine dérivée de la salle) et envoie `debut` à chaque humain. */
  private demarrerChargement(ms: number, out: SortieSalle[]): void {
    const cap = this.places();
    this.numeroMatch = (this.numeroMatch + 1) & 255;
    const graine = (tirer(this.rng) * 4294967296) >>> 0;
    const config: ConfigMatch = {
      format: this.reglages.format, equipeJoueur: "bleue", niveauAllies: this.reglages.niveauBots, niveauAdversaires: this.reglages.niveauBots,
      dureeS: this.opts.dureeForceeS ?? this.reglages.dureeS, graine, nomsEquipes: { ...NOMS_EQUIPES_DEFAUT }, nomJoueur: "",
    };
    const statiques: VoitureStatique[] = [];
    const pilotes: (Joueur | null)[] = [];
    let nBot = 0;
    for (const j of this.joueurs) { j.voiture = -1; j.charge = false; j.vote = null; reinitialiserEntrees(j); }
    for (const equipe of EQUIPES) {
      const humains = this.joueurs.filter((j) => j.equipe === equipe);
      for (let slot = 0; slot < cap; slot++) {
        const h = humains[slot] ?? null;
        const id = statiques.length;
        if (h) h.voiture = id;
        statiques.push({ id, equipe, slot, humain: !!h, nom: h ? h.nom : NOMS_BOTS[nBot++ % NOMS_BOTS.length], joueur: h ? h.id : null });
        pilotes.push(h);
      }
    }
    const monde = creerMondeEnLigne(config, statiques, -1, arene());
    const cerveaux = statiques.map((s) => (s.joueur === null ? this.fabriqueCerveau(this.reglages.niveauBots, graineBot(graine, s.id)) : null));
    this.match = {
      numero: this.numeroMatch, config, statiques, monde, pilotes, cerveaux,
      appliquees: statiques.map(neutre), reelles: statiques.map(() => ENTREES_NULLES()), reste: 0, dernierMs: ms, tampon: [], tamponImportant: false,
      dernierFlushMs: ms, fin: null,
    };
    this.phaseCourante = "chargement";
    this.debutPhaseMs = ms;
    for (const j of this.joueurs) if (j.connecte) out.push(this.msgDebut(j));
    out.push(this.salon());
    // un humain déjà coupé ne bloque pas le départ (cas d'une revanche lancée avec un absent : impossible, mais le test est gratuit)
    this.verifierChargementComplet(ms, out);
  }

  private verifierChargementComplet(ms: number, out: SortieSalle[]): void {
    if (this.phaseCourante !== "chargement") return;
    let connectes = 0;
    for (const j of this.joueurs) {
      if (!j.connecte) continue;
      connectes++;
      if (!j.charge) return;
    }
    if (connectes === 0) return;
    this.lancerMatch(ms, out);
  }

  /** Le décompte de 3 s commence : accumulateur à zéro, instantané initial (le client attend le premier pour caler son horloge). */
  private lancerMatch(ms: number, out: SortieSalle[]): void {
    const m = this.match!;
    this.phaseCourante = "match";
    this.debutPhaseMs = ms;
    m.dernierMs = ms;
    m.reste = 0;
    m.dernierFlushMs = ms;
    out.push(this.salon());
    this.emettreSnaps(out);
  }

  // ---- fin et revanche --------------------------------------------------------------------------------------------------

  private verifierRevancheUnanime(ms: number, out: SortieSalle[]): void {
    if (this.phaseCourante !== "fin" || this.joueurs.length === 0) return;
    // un humain coupé compte non : il bloque jusqu'à son retour, son remplacement ou l'expiration du vote
    if (!this.joueurs.every((j) => j.connecte && j.vote === true)) return;
    this.demarrerChargement(ms, out);
  }

  private retournerAuSalon(out: SortieSalle[]): void {
    for (const j of this.joueurs.filter((x) => !x.connecte)) {
      this.supprimer(j);
      out.push({ a: "tous", msg: { t: "presence", joueur: j.id, etat: "parti" } });
    }
    this.transfererHote();
    this.phaseCourante = "salon";
    this.debutPhaseMs = this.horloge;
    this.match = null;
    for (const j of this.joueurs) { j.vote = null; j.charge = false; j.voiture = -1; }
    if (this.joueurs.length > 0) out.push(this.salon());
  }

  private terminerMatch(ms: number, out: SortieSalle[]): void {
    const m = this.match!;
    this.viderTampon(ms, out);
    m.fin = { t: "fin", tick: m.monde.tick, resultat: resultatMatch(m.monde) };
    this.phaseCourante = "fin";
    this.debutPhaseMs = ms;
    for (const j of this.joueurs) j.vote = null;
    out.push({ a: "tous", msg: m.fin });
    out.push(this.salon());
  }

  // ---- le tic -----------------------------------------------------------------------------------------------------------

  tic(maintenantMs: number, budgetPas: number = Infinity): SortieSalle[] {
    this.horloge = maintenantMs;
    const out: SortieSalle[] = [];
    if (this.phaseCourante === "salon") return out;
    this.expirer(maintenantMs, out);
    if (this.phaseCourante === "match") this.avancerMatch(maintenantMs, budgetPas, out);
    return out;
  }

  /** Échéances qui n'existent que dans `tic` : fin de la reprise d'un joueur coupé, fin du chargement, fin du vote de revanche. */
  private expirer(ms: number, out: SortieSalle[]): void {
    let changement = false;
    for (const j of this.joueurs.slice()) {
      if (j.connecte || ms - j.coupeDepuisMs < this.repriseMs) continue;
      changement = true;
      if (this.phaseCourante === "fin") {
        this.supprimer(j);
        out.push({ a: "tous", msg: { t: "presence", joueur: j.id, etat: "parti" } });
        this.transfererHote();
        if (this.joueurs.length > 0) out.push(this.salon());
      } else {
        this.remplacerParBot(j, out);
      }
    }
    if (changement) {
      if (this.phaseCourante === "chargement") this.verifierChargementComplet(ms, out);
      else if (this.phaseCourante === "fin") this.verifierRevancheUnanime(ms, out);
    }
    if (this.phaseCourante === "chargement" && ms - this.debutPhaseMs >= this.chargementMaxMs) this.lancerMatch(ms, out);
    else if (this.phaseCourante === "fin" && ms - this.debutPhaseMs >= this.revancheMs) this.retournerAuSalon(out);
  }

  private avancerMatch(ms: number, budgetPas: number, out: SortieSalle[]): void {
    const m = this.match!;
    const monde = m.monde;
    const dtS = Math.max(0, ms - m.dernierMs) / 1000;
    m.dernierMs = Math.max(m.dernierMs, ms); // une horloge qui reculerait ne rejoue jamais le même temps
    m.reste += dtS * echelleDuMonde(monde.phase);
    if (m.reste > RESEAU.imageMaxServeurS) {
      // calage de plus de `imageMaxServeurS` : le surplus est abandonné ET compté
      this.abandonneMs += (m.reste - RESEAU.imageMaxServeurS) * 1000;
      m.reste = RESEAU.imageMaxServeurS;
    }
    const dus = Math.floor(m.reste / PAS_S + 1e-9);
    const pas = Math.max(0, Math.min(dus, RESEAU.pasMaxRattrapageServeur, Math.floor(budgetPas)));
    let executes = 0;
    for (; executes < pas; executes++) {
      this.executerPas(pas - executes - 1, out);
      if (monde.phase === "fini") { executes++; break; }
    }
    m.reste = Math.max(0, m.reste - executes * PAS_S);
    this.pasTotal += executes;
    if (monde.phase === "fini") { this.terminerMatch(ms, out); return; }
    if (m.tampon.length > 0 && (m.tamponImportant || ms - m.dernierFlushMs >= RESEAU.flushEvenementsMs)) this.viderTampon(ms, out);
  }

  /** Un pas physique : entrées de chaque voiture pour le tick courant, `pasMonde`, événements, instantané éventuel. `restants` : pas encore à exécuter après celui-ci. */
  private executerPas(restants: number, out: SortieSalle[]): void {
    const m = this.match!;
    const monde = m.monde;
    const tick = monde.tick;
    const n = monde.voitures.length;
    const slot = tick % RESEAU.tamponEntrees;
    for (let i = 0; i < n; i++) {
      const q = m.appliquees[i];
      const j = m.pilotes[i];
      if (j) {
        if (!j.connecte) viderQ(q); // coupé : entrées neutres, la voiture roule sur son élan
        else if (j.marque[slot] === tick) {
          q.accel = j.axes[slot * 5]; q.direction = j.axes[slot * 5 + 1]; q.tangage = j.axes[slot * 5 + 2]; q.lacet = j.axes[slot * 5 + 3]; q.roulis = j.axes[slot * 5 + 4];
          const b = j.boutons[slot];
          q.saut = (b & 1) !== 0; q.boost = (b & 2) !== 0; q.derapage = (b & 4) !== 0;
          j.repetitions = 0;
        } else if (j.watermark >= 0) {
          // entrée manquante : la dernière connue est répétée `repetitionMaxTicks` fois, puis des entrées neutres
          if (j.repetitions < RESEAU.repetitionMaxTicks) { copierQ(q, j.derniere); j.repetitions++; this.repetees++; } else viderQ(q);
          if (j.manquees < 255) j.manquees++;
        } else {
          viderQ(q); // rien reçu de ce joueur depuis le début (ou depuis sa reprise) : pas de retour d'adaptation
        }
      } else {
        const c = m.cerveaux[i];
        if (c) quantifierEntreesDans(q, c.decider(monde, monde.voitures[i], PAS_S)); else viderQ(q);
      }
      dequantifierEntreesDans(m.reelles[i], q);
    }
    const evs = pasMonde(monde, m.reelles);
    let important = false;
    for (const e of evs) {
      m.tampon.push({ tick, e });
      if (EVENEMENTS_IMPORTANTS.has(e.t)) important = true;
    }
    if (important) m.tamponImportant = true;
    // instantané : sur la grille de 6 ticks (en rattrapage, seulement ceux des 6 derniers pas) ou hors grille sur événement important
    if (important || (monde.tick % RESEAU.cadenceSnapTicks === 0 && restants < RESEAU.cadenceSnapTicks)) this.emettreSnaps(out);
  }

  private viderTampon(ms: number, out: SortieSalle[]): void {
    const m = this.match!;
    m.dernierFlushMs = ms;
    m.tamponImportant = false;
    if (m.tampon.length === 0) return;
    out.push({ a: "tous", msg: { t: "ev", evenements: m.tampon } });
    m.tampon = [];
  }

  // ---- instantanés ------------------------------------------------------------------------------------------------------

  private construireSnap(j: Joueur, etat: EtatMondeReseau): SnapRocket {
    const m = this.match!;
    const s = {
      tick: m.monde.tick, ralenti: echelleDuMonde(m.monde.phase) !== 1, numero: m.numero, nbVoitures: m.monde.voitures.length,
      entreesRecuesJusqua: j.watermark, avance: j.avanceMin === null ? AVANCE_INCONNUE : j.avanceMin, manquees: j.manquees,
      entrees: m.appliquees.map((q) => ({ ...q })), etat,
    };
    j.avanceMin = null;
    j.manquees = 0;
    return s;
  }

  /** Un instantané par humain connecté ; l'état (copie profonde) est extrait une seule fois et partagé (il n'est plus jamais modifié). */
  private emettreSnaps(out: SortieSalle[]): void {
    const m = this.match!;
    let etat: EtatMondeReseau | null = null;
    for (const j of this.joueurs) {
      if (!j.connecte || j.voiture < 0) continue;
      etat ??= extraireEtat(m.monde);
      out.push({ a: j.id, snap: this.construireSnap(j, etat) });
    }
  }
}

/** Crée une salle Rocket : l'hôte y est déjà présent (équipe tirée avec la graine de la salle). */
export const creerSalleRocket: CreerSalleRocket = (opts: OptionsSalleRocket): SalleRocket => new SalleImpl(opts);
