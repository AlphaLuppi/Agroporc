/**
 * Rocket Muche EN LIGNE : logique PURE de la partie en ligne, importée par `jeu.ts` (donc dans le même morceau chargé à la demande). `jeu.ts`
 * touche three, le DOM et l'horloge, il n'est pas testable ; tout ce qui se décide pour le mode en ligne l'est ici :
 *
 *  - choix de la source de monde (locale / en ligne) et `SourceMonde` : la boucle ne parle qu'à elle ;
 *  - source en ligne = prédicteur + trames d'entrées + événements, sans three ni socket (`creerSourceEnLigne`) ;
 *  - commandes neutres quand le menu est ouvert ou que l'onglet est masqué (la partie continue pour les autres) ;
 *  - suivi des joueurs coupés (`presence`) et du vote de revanche pour le HUD réseau ;
 *  - émetteur du HUD réseau (≤ 5 Hz et à chaque changement d'état) ;
 *  - canal dégradé (latence artificielle, rafale) pour le crochet `window.__rocketReseau`.
 *
 * Aucune horloge globale, aucun hasard, aucun DOM : l'heure est un argument, les minuteurs sont injectés.
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md § 5, § 9.2, § 9.4.
 */
import { ENTREES_NULLES, type EntreesVoiture, type EvenementMatch, type MondeRocket } from "./contrat";
import {
  qualiteReseau, type EtatConnexion, type EtatMondeReseau, type HorlogeRocket, type HudReseau, type MessageServeur, type OptionsJeuRocketAvecLigne, type PredicteurRocket,
  type ResultatSnap, type SnapRocket, type TrameEntrees,
} from "./reseau/protocole";

// ============================================================================================================================
// 1. Choix de la source
// ============================================================================================================================

export type NomSource = "locale" | "ligne";
/** Source de la partie : « ligne » dès que l'interface passe `enLigne`, sinon le comportement historique (cerveaux locaux, accumulateur de pas). */
export const choisirSource = (opts: Pick<OptionsJeuRocketAvecLigne, "enLigne">): NomSource => (opts.enLigne ? "ligne" : "locale");

/** Ce que la boucle de `jeu.ts` attend d'une source de monde. Locale : `avancerAccumulateur` + `pasUnique` ; en ligne : le prédicteur. */
export interface SourceMonde {
  readonly nom: NomSource;
  /** monde de PHYSIQUE (local : le monde ; en ligne : le monde prédit, à lire seulement) */
  monde(): MondeRocket;
  /** monde à AFFICHER (rendu, caméra, sons) : en ligne, avec les corrections visuelles et la garde de phase */
  mondeAffiche(maintenantMs: number): MondeRocket;
  /** convertit `dtReelS` en pas ; `entrees` = commandes de MA voiture, déjà neutres si le menu est ouvert */
  avancer(dtReelS: number, entrees: Readonly<EntreesVoiture>, maintenantMs: number): ResultatSource;
}
export interface ResultatSource {
  pas: number;
  alpha: number;
  /** événements à jouer maintenant : locaux de MA voiture (prédits) + venus du serveur depuis le dernier appel, sans doublon */
  evenements: EvenementMatch[];
  snap: ResultatSnap | null;
}

// ============================================================================================================================
// 2. Commandes
// ============================================================================================================================

export const ENTREES_NEUTRES = (): EntreesVoiture => ENTREES_NULLES();

/**
 * État de mes commandes : le menu pause ouvert OU l'onglet masqué les rend neutres (la partie continue, la voiture roule sur son élan puis
 * s'arrête). Le masquage prime : un onglet caché ne peut de toute façon rien commander.
 */
export const etatCommandes = (menuOuvert: boolean, ongletMasque: boolean): HudReseau["commandes"] => (ongletMasque ? "masque" : menuOuvert ? "menu" : "actives");

/** Entrées réellement jouées : les commandes lues si elles sont actives, sinon des entrées neutres (jamais l'objet d'entrée lu, qui peut être réutilisé). */
export const entreesEffectives = (brutes: Readonly<EntreesVoiture>, commandes: HudReseau["commandes"]): EntreesVoiture =>
  commandes === "actives" ? { ...brutes } : ENTREES_NEUTRES();

// ============================================================================================================================
// 3. Source en ligne
// ============================================================================================================================

/** Événements qu'un onglet masqué ne doit jamais perdre (score, remise en jeu, fin) ; tous les autres (sons, particules, boost…) sont périssables. */
const EVENEMENTS_DURABLES: ReadonlySet<EvenementMatch["t"]> = new Set(["but", "demolition", "coupDEnvoi", "reapparition", "prolongation", "chronoZero", "fin", "decompte"]);
/** Nombre d'événements périssables gardés en attente quand `requestAnimationFrame` est suspendu (onglet masqué) alors que la socket continue d'en livrer. */
export const PERISSABLES_MAX = 48;

/** Borne la file d'événements : les durables sont tous gardés, seuls les `PERISSABLES_MAX` périssables les plus récents le sont ; l'ordre est conservé. */
export function bornerEvenements(liste: readonly EvenementMatch[], perissablesMax: number = PERISSABLES_MAX): EvenementMatch[] {
  let aGarder = 0;
  for (const e of liste) if (!EVENEMENTS_DURABLES.has(e.t)) aGarder++;
  if (aGarder <= perissablesMax) return liste.slice();
  let aJeter = aGarder - perissablesMax;
  const out: EvenementMatch[] = [];
  for (const e of liste) {
    if (!EVENEMENTS_DURABLES.has(e.t) && aJeter > 0) { aJeter--; continue; }
    out.push(e);
  }
  return out;
}

export interface DepsSourceEnLigne {
  predicteur: PredicteurRocket;
  /** envoie une trame d'entrées (le client réseau) */
  envoyerTrame(t: TrameEntrees): void;
}

/**
 * Source de monde d'une partie en ligne. Les instantanés (`recevoirSnap`) et les événements du serveur (`recevoirEvenements`) arrivent par
 * les écouteurs du client, à tout moment ; rien n'est simulé avant `avancer`, qui applique AU PLUS UN rollback par image (le prédicteur le garantit),
 * simule, envoie la trame d'entrées due et rend les événements à jouer.
 */
export function creerSourceEnLigne(deps: DepsSourceEnLigne): SourceMonde & {
  recevoirSnap(snap: SnapRocket, maintenantMs: number): boolean;
  recevoirEvenements(evenements: readonly { tick: number; e: EvenementMatch }[]): void;
  etatAutoritaire(): EtatMondeReseau | null;
  pret(): boolean;
} {
  const { predicteur } = deps;
  /** événements du serveur déjà filtrés (doublons, événements de ma voiture déjà joués), en attente du prochain `avancer` */
  let enAttente: EvenementMatch[] = [];
  return {
    nom: "ligne",
    monde: () => predicteur.monde,
    mondeAffiche: (t) => predicteur.mondeAffiche(t),
    avancer(dtReelS, entrees, maintenantMs) {
      const r = predicteur.avancer(dtReelS, entrees, maintenantMs);
      const trame = predicteur.trameAEnvoyer(maintenantMs);
      if (trame) deps.envoyerTrame(trame);
      const evenements = enAttente.length > 0 ? [...r.evenementsLocaux, ...enAttente] : r.evenementsLocaux;
      enAttente = [];
      return { pas: r.pas, alpha: r.alpha, evenements, snap: r.snap };
    },
    recevoirSnap: (snap, t) => predicteur.recevoirSnap(snap, t),
    recevoirEvenements(evs) {
      const aJouer = predicteur.filtrerEvenements(evs);
      if (aJouer.length > 0) {
        enAttente.push(...aJouer);
        // onglet masqué : la socket livre, la boucle d'images ne vide plus la file ; au retour, on ne rejoue que le récent et les durables
        if (enAttente.length > 2 * PERISSABLES_MAX) enAttente = bornerEvenements(enAttente);
      }
    },
    etatAutoritaire: () => predicteur.etatAutoritaire(),
    pret: () => predicteur.pret,
  };
}

// ============================================================================================================================
// 4. Joueurs coupés et revanche (HUD réseau)
// ============================================================================================================================

export interface SuiviPresence {
  /** prend en compte un message `presence` ; rend vrai si la liste des absents a changé */
  appliquer(m: Extract<MessageServeur, { t: "presence" }>, maintenantMs: number): boolean;
  /** absents à l'instant `maintenantMs` : le compte à rebours de chacun a avancé depuis le message (jamais négatif) */
  absents(maintenantMs: number): HudReseau["absents"];
  reinitialiser(): void;
}

/**
 * Suit les joueurs coupés : `presence{etat:"coupe", restantMs}` ouvre un compte à rebours LOCAL (le serveur n'envoie qu'un message), « revenu »,
 * « bot » et « parti » le ferment. `nomDe` donne le nom d'un joueur d'après son id de joueur (voitures du message `debut`).
 */
export function creerSuiviPresence(nomDe: (joueur: number) => string): SuiviPresence {
  const coupes = new Map<number, { restantMs: number; recuA: number }>();
  return {
    appliquer(m, maintenantMs) {
      if (m.etat === "coupe") {
        const avant = coupes.get(m.joueur);
        coupes.set(m.joueur, { restantMs: Math.max(0, m.restantMs ?? 0), recuA: maintenantMs });
        return !avant;
      }
      return coupes.delete(m.joueur);
    },
    absents(maintenantMs) {
      return Array.from(coupes, ([joueur, c]) => ({ joueur, nom: nomDe(joueur), restantMs: Math.max(0, c.restantMs - (maintenantMs - c.recuA)) }))
        .sort((a, b) => a.joueur - b.joueur);
    },
    reinitialiser() { coupes.clear(); },
  };
}

export interface SuiviRevanche {
  /** état du salon reçu : ouvre ou ferme la fenêtre de vote selon la phase */
  appliquer(salon: { phase: string; revanche?: { votes: Record<number, boolean>; restantMs: number } } | null, maintenantMs: number): void;
  /** vote en cours (compte à rebours avancé depuis le message) ou null hors phase « fin » */
  revanche(maintenantMs: number): HudReseau["revanche"];
  reinitialiser(): void;
}
export function creerSuiviRevanche(): SuiviRevanche {
  let courant: { votes: Record<number, boolean>; restantMs: number; recuA: number } | null = null;
  return {
    appliquer(salon, maintenantMs) {
      courant = salon && salon.phase === "fin" && salon.revanche ? { votes: { ...salon.revanche.votes }, restantMs: salon.revanche.restantMs, recuA: maintenantMs } : null;
    },
    revanche(maintenantMs) {
      return courant ? { votes: { ...courant.votes }, restantMs: Math.max(0, courant.restantMs - (maintenantMs - courant.recuA)) } : null;
    },
    reinitialiser() { courant = null; },
  };
}

/** Assemble l'état réseau du HUD. `rttMs` et `gigueMs` viennent de l'horloge filtrée. */
export function construireHudReseau(e: {
  etat: EtatConnexion;
  horloge: Pick<HorlogeRocket, "rttMs" | "gigueMs">;
  commandes: HudReseau["commandes"];
  absents: HudReseau["absents"];
  revanche: HudReseau["revanche"];
}): HudReseau {
  const rttMs = e.horloge.rttMs();
  const gigueMs = e.horloge.gigueMs();
  return { etat: e.etat, rttMs, gigueMs, qualite: qualiteReseau(rttMs, gigueMs), commandes: e.commandes, absents: e.absents, revanche: e.revanche };
}

/** Intervalle minimal entre deux envois du HUD réseau quand seuls les chiffres du ping bougent (≤ 5 Hz). */
export const ECART_HUD_RESEAU_MS = 200;

/** Clé des champs qui déclenchent un envoi IMMÉDIAT quand ils changent (états, qualité, commandes, absents à la seconde, votes). */
function cleStructure(h: HudReseau): string {
  return JSON.stringify([
    h.etat, h.qualite, h.commandes, h.absents.map((a) => [a.joueur, Math.ceil(a.restantMs / 1000)]),
    h.revanche ? [Object.entries(h.revanche.votes), Math.ceil(h.revanche.restantMs / 1000)] : null,
  ]);
}
/**
 * Émetteur du HUD réseau : le premier état part tout de suite, puis un changement d'état (connexion, qualité, commandes, absents, revanche) part
 * immédiatement, et un simple changement du ping au plus tous les `ECART_HUD_RESEAU_MS` (5 Hz). `pousser` est appelé à chaque image.
 */
export function creerEmetteurHudReseau(emettre: (h: HudReseau) => void) {
  let derniereCle: string | null = null;
  let dernierRtt = -1;
  let dernierT = -Infinity;
  return {
    pousser(h: HudReseau, maintenantMs: number): boolean {
      const cle = cleStructure(h);
      const structurel = cle !== derniereCle;
      const ping = Math.round(h.rttMs) !== dernierRtt;
      if (!structurel && !(ping && maintenantMs - dernierT >= ECART_HUD_RESEAU_MS)) return false;
      derniereCle = cle;
      dernierRtt = Math.round(h.rttMs);
      dernierT = maintenantMs;
      emettre(h);
      return true;
    },
    reinitialiser() { derniereCle = null; dernierRtt = -1; dernierT = -Infinity; },
  };
}

// ============================================================================================================================
// 5. Canal dégradé (essais : latence, rafale)
// ============================================================================================================================

export interface CanalDegrade {
  /** retarde les envois (sortant) et les réceptions (entrant) de `sortantMs` / `entrantMs` ; (0, 0) l'annule */
  latence(sortantMs: number, entrantMs?: number): void;
  /** retient tout ce qui arrive pendant `ms` puis le délivre d'un coup, dans l'ordre (rafale TCP) */
  retenir(ms: number): void;
  /** passe un envoi par le canal */
  sortir(f: () => void): void;
  /** passe une réception par le canal */
  entrer(f: () => void): void;
  /** annule les livraisons en attente (fermeture) */
  vider(): void;
}
export interface DepsCanalDegrade {
  maintenant(): number;
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
/**
 * Latence artificielle pour `window.__rocketReseau.latence/retenir` : chaque sens garde l'ordre d'arrivée (une socket TCP ne réordonne pas) :
 * l'échéance d'une livraison n'est jamais antérieure à celle de la précédente. Sans réglage ni livraison en attente, `sortir` et `entrer`
 * exécutent aussitôt (aucun coût hors essais).
 */
export function creerCanalDegrade(deps: DepsCanalDegrade): CanalDegrade {
  let sortantMs = 0;
  let entrantMs = 0;
  /** rafale : rien n'est livré en entrée avant cet instant */
  let retenuJusqua = 0;
  let derniereSortie = 0;
  let derniereEntree = 0;
  const attentes = new Set<unknown>();
  const livrer = (f: () => void, echeance: number, maintenant: number): void => {
    const id = deps.setTimeout(() => { attentes.delete(id); f(); }, Math.max(0, echeance - maintenant));
    attentes.add(id);
  };
  return {
    latence(s, e = s) { sortantMs = Math.max(0, s); entrantMs = Math.max(0, e); },
    retenir(ms) { retenuJusqua = Math.max(retenuJusqua, deps.maintenant() + Math.max(0, ms)); },
    sortir(f) {
      const t = deps.maintenant();
      const echeance = Math.max(t + sortantMs, derniereSortie);
      if (echeance <= t) { f(); return; }
      derniereSortie = echeance;
      livrer(f, echeance, t);
    },
    entrer(f) {
      const t = deps.maintenant();
      const echeance = Math.max(t + entrantMs, retenuJusqua, derniereEntree);
      if (echeance <= t) { f(); return; }
      derniereEntree = echeance;
      livrer(f, echeance, t);
    },
    vider() {
      for (const id of attentes) deps.clearTimeout(id);
      attentes.clear();
      retenuJusqua = 0;
      derniereEntree = 0;
      derniereSortie = 0;
    },
  };
}
