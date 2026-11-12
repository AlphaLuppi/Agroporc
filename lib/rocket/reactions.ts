/**
 * Rocket Muche : réactions rapides, façon « Quick Chat » de Rocket League. PUR : ni DOM, ni three, ni horloge (l'heure est passée en argument,
 * en millisecondes), ni hasard. Partagé par le client (menu, affichage), les bots et le serveur (validation, anti-spam).
 *
 * - Catalogue : 4 catégories (la croix directionnelle) × 4 messages = 16 réactions, drôles, au thème du site (tigres, trèfle, Truck Muche,
 *   Elsa, plats du jour, Sportif / Goulaf…), courtes (`TEXTE_MAX` caractères : elles tiennent dans une bulle), jamais méchantes. Chaque
 *   réaction a un identifiant STABLE (c'est lui qui circule sur le réseau, jamais le texte). Les « Infos » sont réservées à l'équipe, comme
 *   dans Rocket League ; les autres sont vues de tous.
 * - Menu : machine d'états `fermé → catégorie ouverte → message choisi | expiration`. Un appui sur une direction ouvre la catégorie
 *   correspondante ; un second appui (sur la direction du message voulu) l'envoie ; sans second appui le menu se referme après `MENU_REACTIONS.expirationMs`.
 * - Anti-spam : `creerAntiSpam`, la MÊME logique côté client et côté serveur (`ANTI_SPAM`) : quatre messages dans la fenêtre, le cinquième bloque le chat quelques secondes.
 * - Affichage : durée de vie des bulles et fondu (`opaciteBulle`), visibilité d'une réaction selon l'équipe (`reactionVisible`).
 * Spec : docs/superpowers/specs/2026-11-08-rocket-en-ligne-design.md (réactions rapides, additif : `VERSION_ROCKET` reste 2).
 */
import type { DirectionChat, Equipe } from "./contrat";

export type { DirectionChat } from "./contrat";

// ============================================================================================================================
// Catalogue
// ============================================================================================================================

export type CategorieReaction = "infos" | "compliments" | "reactions" | "excuses";

export interface Reaction {
  /** identifiant stable (minuscules, chiffres, tirets) : c'est lui qui circule sur le réseau */
  id: string;
  texte: string;
  /** vue de l'équipe de l'émetteur seulement (« Infos » comme dans Rocket League) */
  equipeSeule: boolean;
  categorie: CategorieReaction;
  /** place dans le menu de sa catégorie */
  direction: DirectionChat;
}

export interface CategorieMenu {
  id: CategorieReaction;
  /** direction de la croix qui ouvre la catégorie */
  direction: DirectionChat;
  titre: string;
  /** les quatre messages, dans l'ordre `DIRECTIONS_CHAT` */
  reactions: readonly Reaction[];
}

/** Ordre des directions : haut, gauche, droite, bas (l'ordre des catégories et des messages). */
export const DIRECTIONS_CHAT: readonly DirectionChat[] = ["haut", "gauche", "droite", "bas"];
/** Longueur maximale d'un texte (une bulle, une ligne du fil). */
export const TEXTE_MAX = 32;

function categorie(id: CategorieReaction, direction: DirectionChat, titre: string, equipeSeule: boolean, textes: readonly [string, string, string, string], ids: readonly [string, string, string, string]): CategorieMenu {
  return {
    id, direction, titre,
    reactions: DIRECTIONS_CHAT.map((d, i) => ({ id: ids[i], texte: textes[i], equipeSeule, categorie: id, direction: d })),
  };
}

export const CATEGORIES: readonly CategorieMenu[] = [
  categorie("infos", "haut", "Infos", true,
    ["J'ai la balle !", "Je défends, va au Truck !", "Oh Elsa, prépare-moi ça !", "Boost vide, un café svp !"],
    ["balle", "defense", "passe", "boost"]),
  categorie("compliments", "gauche", "Compliments", false,
    ["Quel tir de tigre !", "Note Goulaf : 10/10 !", "Sportif ET Goulaf : bravo !", "Ce but, c'est le plat du jour !"],
    ["tir-tigre", "goulaf", "sportif-goulaf", "plat-du-jour"]),
  categorie("reactions", "droite", "Réactions", false,
    ["Tié un tigre ?!", "Ça sent le trèfle à 4 feuilles", "En marche ! Mais vers où ?", "RRRROAAAR !"],
    ["tie-un-tigre", "trefle", "en-marche", "rugissement"]),
  categorie("excuses", "bas", "Excuses", false,
    ["Pardon, digestion difficile", "Oups, la myrtille !", "Désolé, pause gourmande !", "Pardon, mon Edenred est à sec"],
    ["digestion", "myrtille", "pause-gourmande", "edenred"]),
];

/** Les seize réactions, dans l'ordre du catalogue. */
export const REACTIONS: readonly Reaction[] = CATEGORIES.flatMap((c) => c.reactions);

const PAR_ID: ReadonlyMap<string, Reaction> = new Map(REACTIONS.map((r) => [r.id, r]));

/** Réaction d'un identifiant, ou `undefined` s'il est inconnu (jamais d'exception : l'identifiant vient du réseau). */
export const reactionParId = (id: unknown): Reaction | undefined => (typeof id === "string" ? PAR_ID.get(id) : undefined);
export const reactionValide = (id: unknown): id is string => reactionParId(id) !== undefined;
/** Forme d'un identifiant (validation légère avant la recherche, pour borner ce que le serveur accepte). */
export const FORME_ID_REACTION = /^[a-z0-9-]{1,24}$/;

export const categorieParId = (id: CategorieReaction): CategorieMenu => CATEGORIES.find((c) => c.id === id) as CategorieMenu;
export const categorieDeDirection = (d: DirectionChat): CategorieMenu => CATEGORIES.find((c) => c.direction === d) as CategorieMenu;

// ============================================================================================================================
// Menu (machine d'états)
// ============================================================================================================================

export const MENU_REACTIONS = {
  /** délai sans second appui au bout duquel le menu se referme (ms) */
  expirationMs: 2000,
} as const;

export type EtatMenuReactions = { ouvert: false } | { ouvert: true; categorie: CategorieReaction; depuisMs: number };

export const MENU_FERME: EtatMenuReactions = { ouvert: false };

/** Le menu ouvert a-t-il dépassé son délai à `maintenantMs` ? */
const perime = (e: EtatMenuReactions, maintenantMs: number): boolean => e.ouvert && maintenantMs - e.depuisMs >= MENU_REACTIONS.expirationMs;

/** Referme le menu s'il a expiré (sinon rend l'état tel quel, même objet). À appeler à chaque image. */
export function expirerMenu(e: EtatMenuReactions, maintenantMs: number): EtatMenuReactions {
  return perime(e, maintenantMs) ? MENU_FERME : e;
}

export interface ResultatAppui {
  etat: EtatMenuReactions;
  /** identifiant de la réaction choisie, ou `null` (ouverture, rien) */
  envoi: string | null;
}

/**
 * Un appui sur `direction`. Menu fermé (ou expiré) : ouvre la catégorie de cette direction. Menu ouvert : choisit le message de cette direction
 * dans la catégorie ouverte et referme. Pure ; ne vérifie PAS l'anti-spam (c'est l'appelant qui décide d'envoyer).
 */
export function appuyerMenu(e: EtatMenuReactions, direction: DirectionChat, maintenantMs: number): ResultatAppui {
  const etat = expirerMenu(e, maintenantMs);
  if (!etat.ouvert) return { etat: { ouvert: true, categorie: categorieDeDirection(direction).id, depuisMs: maintenantMs }, envoi: null };
  const reaction = categorieParId(etat.categorie).reactions.find((r) => r.direction === direction);
  return { etat: MENU_FERME, envoi: reaction ? reaction.id : null };
}

/** Annule le menu (pause, fin de partie, nouvelle manche). */
export const fermerMenu = (): EtatMenuReactions => MENU_FERME;

// ============================================================================================================================
// Anti-spam
// ============================================================================================================================

export const ANTI_SPAM = {
  /** messages acceptés dans la fenêtre ; le suivant bloque le chat */
  messages: 4,
  /** fenêtre glissante (ms) */
  fenetreMs: 5000,
  /** durée du blocage (ms) */
  blocageMs: 4000,
} as const;

export interface AntiSpam {
  /** tente un envoi à `maintenantMs` : `true` accepté (compté), `false` refusé (bloqué, ou ce message déclenche le blocage) */
  essayer(maintenantMs: number): boolean;
  /** millisecondes de blocage restantes à `maintenantMs` (0 : libre) */
  bloqueMs(maintenantMs: number): number;
  reinitialiser(): void;
}

/** Un limiteur par émetteur. Même logique pour le client, les bots et le serveur ; aucune horloge globale. */
export function creerAntiSpam(regles: { messages: number; fenetreMs: number; blocageMs: number } = ANTI_SPAM): AntiSpam {
  let instants: number[] = [];
  let bloqueJusqua = -Infinity;
  return {
    essayer(t) {
      if (t < bloqueJusqua) return false;
      instants = instants.filter((x) => t - x < regles.fenetreMs);
      if (instants.length >= regles.messages) {
        bloqueJusqua = t + regles.blocageMs;
        instants = [];
        return false;
      }
      instants.push(t);
      return true;
    },
    bloqueMs: (t) => Math.max(0, bloqueJusqua - t),
    reinitialiser() { instants = []; bloqueJusqua = -Infinity; },
  };
}

// ============================================================================================================================
// Affichage
// ============================================================================================================================

/** Durée de vie d'une bulle au-dessus de la voiture (s). */
export const BULLE_DUREE_S = 3;
/** Durée d'une ligne du fil des réactions (s) et nombre de lignes visibles. */
export const CHAT_LIGNE_DUREE_S = 6;
export const CHAT_LIGNES_MAX = 4;
const BULLE_ENTREE_S = 0.15;
const BULLE_SORTIE_S = 0.5;

/** Opacité 0..1 d'une bulle de `age` secondes : apparition rapide, plein, fondu final. 0 hors de `BULLE_DUREE_S`. Sans mouvement : plein ou rien. */
export function opaciteBulle(age: number, mouvementReduit = false): number {
  if (!(age >= 0) || age >= BULLE_DUREE_S) return 0;
  if (mouvementReduit) return 1;
  if (age < BULLE_ENTREE_S) return age / BULLE_ENTREE_S;
  if (age > BULLE_DUREE_S - BULLE_SORTIE_S) return (BULLE_DUREE_S - age) / BULLE_SORTIE_S;
  return 1;
}

/**
 * Une réaction doit-elle être montrée à celui qui la reçoit ? Les siennes, oui. Une réaction « équipe seulement » d'un adversaire, jamais
 * (le serveur ne la relaie même pas). Les autres des adversaires dépendent du réglage `afficherAdversaires`.
 */
export function reactionVisible(
  reaction: Readonly<Pick<Reaction, "equipeSeule">>,
  emetteur: { equipe: Equipe; moi: boolean },
  monEquipe: Equipe,
  afficherAdversaires: boolean,
): boolean {
  if (emetteur.moi) return true;
  if (emetteur.equipe === monEquipe) return true;
  if (reaction.equipeSeule) return false;
  return afficherAdversaires;
}

/** Ligne du fil : « (équipe) Alice : J'ai la balle ! » sous forme de morceaux (le nom reste coloré par l'équipe dans l'interface). */
export function libelleLigneChat(l: { nom: string; texte: string; equipeSeule: boolean }): string {
  return `${l.equipeSeule ? "(équipe) " : ""}${l.nom} : ${l.texte}`;
}

/** Secondes de blocage à afficher (arrondies au-dessus), 0 si libre. */
export const secondesBlocage = (bloqueMs: number): number => (bloqueMs > 0 ? Math.ceil(bloqueMs / 1000) : 0);
