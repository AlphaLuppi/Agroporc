/**
 * Rocket Muche : édition des liaisons du joueur (touches du clavier et de la souris, boutons et sticks de la manette). PUR : ni DOM, ni three.
 *
 * - `assignerTouche` / `assignerManette` posent une entrée dans l'un des deux emplacements d'une action. Comme dans l'éditeur de touches de
 *   l'arène (`lib/fps/touches.ts`), une entrée prise par une AUTRE action lui est retirée et l'action dépossédée est rendue pour être signalée.
 * - Échap (clavier) et Start (`B9`, manette) restent TOUJOURS liées à la pause (cf. `reglages.ts`) : le premier emplacement de « pause » est
 *   fixe, et aucune autre action ne peut les prendre. Aucune configuration ne peut donc priver le joueur de son menu pause.
 * - Tab (classement en jeu) n'est pas assignable non plus.
 * - Libellés lisibles : touches via `libelleTouche` (disposition du clavier du joueur), manette au format Xbox.
 */
import {
  LIAISONS_DEFAUT,
  LIAISONS_MANETTE_DEFAUT,
  type EntreeManette,
  type LiaisonsManette,
  type LiaisonsTouches,
} from "./contrat";
import { libelleTouche } from "../fps/touches";

export type ActionTouche = keyof LiaisonsTouches;
export type ActionManette = keyof LiaisonsManette;
export type Emplacement = 0 | 1;

/** Nombre d'entrées par action (deux emplacements). */
export const EMPLACEMENTS = 2;
/** Touche toujours liée à la pause au clavier. */
export const TOUCHE_PAUSE = "Escape";
/** Bouton toujours lié à la pause à la manette (Start). */
export const BOUTON_PAUSE: EntreeManette = "B9";
/** Touches que le jeu lit lui-même (classement) : jamais assignables. */
export const TOUCHES_NON_ASSIGNABLES: readonly string[] = ["Tab"];

/** Bouton qui relance un match à l'écran de fin (A) : la pause ne peut pas le prendre, sinon un appui ouvrirait le menu au lieu de rejouer. */
export const BOUTON_REJOUER: EntreeManette = "B0";
/** Un bouton de la souris (`Souris0`…) : le jeu ne lit la pause qu'au clavier, une telle liaison serait inerte. */
export const estBoutonSouris = (code: string): boolean => /^Souris\d+$/.test(code);

/** Pourquoi une affectation est refusée (`null` : acceptée). */
export type RefusLiaison = "invalide" | "reservee" | "fixe" | "sansEffet" | "rejouer";

// ============================================================================================================================
// Libellés et regroupements
// ============================================================================================================================

export interface GroupeActions<A extends string> {
  titre: string;
  actions: readonly A[];
}

export const LIBELLES_ACTIONS_TOUCHES: Readonly<Record<ActionTouche, string>> = {
  accelerer: "Accélérer (en l'air : nez en bas)",
  reculer: "Freiner, reculer (en l'air : nez en haut)",
  gauche: "Tourner à gauche (en l'air : lacet)",
  droite: "Tourner à droite (en l'air : lacet)",
  saut: "Sauter, double saut, flip",
  boost: "Boost (maintenu)",
  derapage: "Dérapage ; en l'air, roulis libre",
  rouleGauche: "Roulis à gauche",
  rouleDroite: "Roulis à droite",
  balleCam: "Ball cam",
  arriere: "Vue arrière (maintenue)",
  regardLibre: "Regard libre (maintenu, puis bouger la souris)",
  klaxon: "Klaxon",
  pause: "Pause",
};
export const GROUPES_TOUCHES: readonly GroupeActions<ActionTouche>[] = [
  { titre: "Conduite", actions: ["accelerer", "reculer", "gauche", "droite"] },
  { titre: "Acrobaties", actions: ["saut", "boost", "derapage", "rouleGauche", "rouleDroite"] },
  { titre: "Caméra", actions: ["balleCam", "arriere", "regardLibre"] },
  { titre: "Divers", actions: ["klaxon", "pause"] },
];

export const LIBELLES_ACTIONS_MANETTE: Readonly<Record<ActionManette, string>> = {
  accelerer: "Accélérer",
  reculer: "Freiner, reculer",
  gauche: "Volant à gauche (en l'air : lacet)",
  droite: "Volant à droite (en l'air : lacet)",
  tangageHaut: "Nez en haut (en l'air)",
  tangageBas: "Nez en bas (en l'air)",
  saut: "Sauter, double saut, flip",
  boost: "Boost (maintenu)",
  derapage: "Dérapage ; en l'air, roulis libre",
  rouleGauche: "Roulis à gauche",
  rouleDroite: "Roulis à droite",
  balleCam: "Ball cam",
  arriere: "Vue arrière (maintenue)",
  klaxon: "Klaxon",
  pause: "Pause",
  regardGauche: "Regard libre : à gauche",
  regardDroite: "Regard libre : à droite",
  regardHaut: "Regard libre : en haut",
  regardBas: "Regard libre : en bas",
};
export const GROUPES_MANETTE: readonly GroupeActions<ActionManette>[] = [
  { titre: "Conduite", actions: ["accelerer", "reculer", "gauche", "droite"] },
  { titre: "En l'air", actions: ["tangageHaut", "tangageBas", "saut", "boost", "derapage", "rouleGauche", "rouleDroite"] },
  { titre: "Caméra", actions: ["balleCam", "arriere", "regardGauche", "regardDroite", "regardHaut", "regardBas"] },
  { titre: "Divers", actions: ["klaxon", "pause"] },
];

export const ACTIONS_TOUCHES: readonly ActionTouche[] = GROUPES_TOUCHES.flatMap((g) => g.actions);
export const ACTIONS_MANETTE: readonly ActionManette[] = GROUPES_MANETTE.flatMap((g) => g.actions);

// ============================================================================================================================
// Entrées de manette : syntaxe, libellés
// ============================================================================================================================

export type EntreeManetteLue = { type: "bouton"; index: number } | { type: "axe"; index: number; signe: 1 | -1 };

/** Boutons au plus (mapping standard : 17) et axes au plus (mapping standard : 4) acceptés dans une liaison. */
const BOUTONS_MAX = 32;
const AXES_MAX = 16;

/** Décode `B7`, `A0-`, `A1+` ; `null` si ce n'est pas une entrée plausible. */
export function lireEntreeManette(code: unknown): EntreeManetteLue | null {
  if (typeof code !== "string") return null;
  let m = /^B(\d{1,2})$/.exec(code);
  if (m) {
    const index = Number(m[1]);
    return index < BOUTONS_MAX && String(index) === m[1] ? { type: "bouton", index } : null;
  }
  m = /^A(\d{1,2})([+-])$/.exec(code);
  if (m) {
    const index = Number(m[1]);
    return index < AXES_MAX && String(index) === m[1] ? { type: "axe", index, signe: m[2] === "+" ? 1 : -1 } : null;
  }
  return null;
}
export const entreeManetteValide = (code: unknown): code is EntreeManette => lireEntreeManette(code) !== null;
export const codeBouton = (index: number): EntreeManette => `B${index}`;
export const codeAxe = (index: number, signe: 1 | -1): EntreeManette => `A${index}${signe === 1 ? "+" : "-"}`;

const NOMS_BOUTONS: Readonly<Record<number, string>> = {
  0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT", 8: "Retour", 9: "Start", 10: "L3", 11: "R3",
  12: "Croix ↑", 13: "Croix ↓", 14: "Croix ←", 15: "Croix →", 16: "Guide",
};
/** Sens des demi-axes du mapping standard : 0/2 horizontaux (- gauche, + droite), 1/3 verticaux (- haut, + bas). */
const FLECHES_AXES: Readonly<Record<number, readonly [string, string]>> = { 0: ["←", "→"], 1: ["↑", "↓"], 2: ["←", "→"], 3: ["↑", "↓"] };

/**
 * Libellé d'une entrée de manette au format Xbox (« A », « RT », « Stick gauche ← »). `court` : « Stick G ← » pour les aides serrées.
 * PlayStation : A = ✕, B = ○, X = □, Y = △, LB/RB = L1/R1, LT/RT = L2/R2, Start = Options, Retour = Create/Share.
 */
export function libelleEntreeManette(code: string | null, court = false): string {
  if (code === null) return "—";
  const e = lireEntreeManette(code);
  if (!e) return code;
  if (e.type === "bouton") return NOMS_BOUTONS[e.index] ?? `Bouton ${e.index}`;
  const fleches = FLECHES_AXES[e.index];
  if (!fleches) return `Axe ${e.index} ${e.signe === 1 ? "+" : "−"}`;
  const stick = e.index < 2 ? (court ? "Stick G" : "Stick gauche") : court ? "Stick D" : "Stick droit";
  return `${stick} ${fleches[e.signe === 1 ? 1 : 0]}`;
}

/** Indication pour les joueurs PlayStation (les libellés sont ceux d'une manette Xbox). */
export const AIDE_PLAYSTATION = "A = ✕, B = ○, X = □, Y = △, LB / RB = L1 / R1, LT / RT = L2 / R2, Start = Options";

// ============================================================================================================================
// Affectation
// ============================================================================================================================

export interface ResultatAffectation<L> {
  liaisons: L;
  /** actions qui ont perdu l'entrée au profit de l'action modifiée */
  depossedees: string[];
  /** `null` : acceptée ; sinon rien n'a changé */
  refus: RefusLiaison | null;
}

/** Deux actions se disputent-elles une touche ? Toujours, sauf soi-même. */
export const conflitTouches = (a: ActionTouche, b: ActionTouche): boolean => a !== b;

/**
 * Deux actions de manette se disputent-elles une entrée ? Toujours, sauf soi-même et les couples gaz ↔ tangage : comme W au clavier (gaz au
 * sol, nez en bas en l'air), le gaz partage son entrée avec « nez en bas » et la marche arrière avec « nez en haut » (la voiture n'utilise
 * que celui qui convient, sol ou air).
 */
export function conflitManette(a: ActionManette, b: ActionManette): boolean {
  if (a === b) return false;
  const paire = (x: ActionManette, y: ActionManette) => (a === x && b === y) || (a === y && b === x);
  return !(paire("accelerer", "tangageBas") || paire("reculer", "tangageHaut"));
}

/**
 * Pose `code` (ou vide l'emplacement si `null`) dans `slot` de `action`. Générique : sert au clavier et à la manette.
 * Le résultat est COMPACT (pas de trou) : vider le premier emplacement fait remonter le second.
 */
function affecter<A extends string>(
  liaisons: Readonly<Record<A, readonly string[]>>,
  actions: readonly A[],
  action: A,
  slot: Emplacement,
  code: string | null,
  enConflit: (a: A, b: A) => boolean,
): { liaisons: Record<A, readonly string[]>; depossedees: A[] } {
  const res = {} as Record<A, readonly string[]>;
  const depossedees: A[] = [];
  for (const a of actions) {
    let codes: string[] = [...liaisons[a]];
    if (a === action) {
      if (code === null) codes.splice(slot, 1);
      else {
        const autre = codes.findIndex((c, i) => c === code && i !== slot);
        const precedent = codes[slot];
        if (autre >= 0 && precedent === undefined) { /* déjà là, seul : rien à déplacer (le résultat est compact) */ }
        else if (autre >= 0) {
          // la même entrée dans l'autre emplacement de l'action : les deux s'échangent, elle ne se double pas
          codes[autre] = precedent;
          codes[slot] = code;
        } else codes[Math.min(slot, codes.length)] = code;
        codes = codes.slice(0, EMPLACEMENTS);
      }
    } else if (code !== null && enConflit(a, action) && codes.includes(code)) {
      codes = codes.filter((c) => c !== code);
      depossedees.push(a);
    }
    res[a] = codes;
  }
  return { liaisons: res, depossedees };
}

const CODE_TOUCHE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

/**
 * Affecte une touche ou un bouton de souris. Refus (rien ne change) : code absurde (`invalide`), Échap ou Tab (`reservee`), premier
 * emplacement de « pause » (`fixe` : c'est Échap), bouton de souris pour la « pause » (`sansEffet` : le jeu ne la lit qu'au clavier). `code` `null` vide l'emplacement.
 */
export function assignerTouche(
  l: Readonly<LiaisonsTouches>,
  action: ActionTouche,
  slot: Emplacement,
  code: string | null,
): ResultatAffectation<LiaisonsTouches> {
  const refuse = (refus: RefusLiaison): ResultatAffectation<LiaisonsTouches> => ({ liaisons: l, depossedees: [], refus });
  if (action === "pause" && slot === 0) return refuse("fixe");
  if (code !== null) {
    if (!CODE_TOUCHE.test(code)) return refuse("invalide");
    if (code === TOUCHE_PAUSE || TOUCHES_NON_ASSIGNABLES.includes(code)) return refuse("reservee");
    if (action === "pause" && estBoutonSouris(code)) return refuse("sansEffet");
  }
  const r = affecter(l, ACTIONS_TOUCHES, action, slot, code, conflitTouches);
  return { liaisons: r.liaisons as unknown as LiaisonsTouches, depossedees: r.depossedees, refus: null };
}

/**
 * Affecte une entrée de manette. Refus : code absurde (`invalide`), Start pour une autre action que la pause (`reservee`), premier
 * emplacement de « pause » (`fixe` : c'est Start), A pour la « pause » (`rejouer` : A relance le match à l'écran de fin). `code` `null` vide l'emplacement.
 */
export function assignerManette(
  l: Readonly<LiaisonsManette>,
  action: ActionManette,
  slot: Emplacement,
  code: EntreeManette | null,
): ResultatAffectation<LiaisonsManette> {
  const refuse = (refus: RefusLiaison): ResultatAffectation<LiaisonsManette> => ({ liaisons: l, depossedees: [], refus });
  if (action === "pause" && slot === 0) return refuse("fixe");
  if (code !== null) {
    if (!entreeManetteValide(code)) return refuse("invalide");
    if (code === BOUTON_PAUSE) return refuse("reservee");
    if (action === "pause" && code === BOUTON_REJOUER) return refuse("rejouer");
  }
  const r = affecter(l, ACTIONS_MANETTE, action, slot, code, conflitManette);
  return { liaisons: r.liaisons as unknown as LiaisonsManette, depossedees: r.depossedees, refus: null };
}

const memes = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((c, i) => c === b[i]);
export const touchesParDefaut = (): LiaisonsTouches => ({ ...LIAISONS_DEFAUT });
export const manetteParDefaut = (): LiaisonsManette => ({ ...LIAISONS_MANETTE_DEFAUT });
export const touchesSontParDefaut = (l: Readonly<LiaisonsTouches>): boolean => ACTIONS_TOUCHES.every((a) => memes(l[a], LIAISONS_DEFAUT[a]));
export const manetteEstParDefaut = (l: Readonly<LiaisonsManette>): boolean => ACTIONS_MANETTE.every((a) => memes(l[a], LIAISONS_MANETTE_DEFAUT[a]));

/** Une entrée de manette est-elle liée à une action ? (Retour = quitter ne sert que tant que personne ne l'a prise.) */
export function entreeManetteLiee(l: Readonly<LiaisonsManette>, code: EntreeManette): boolean {
  return ACTIONS_MANETTE.some((a) => l[a].includes(code));
}

/** Actions sans aucune entrée (le menu les signale : la voiture ne peut pas rouler sans gaz, par exemple). */
export const actionsSansTouche = (l: Readonly<LiaisonsTouches>): ActionTouche[] => ACTIONS_TOUCHES.filter((a) => l[a].length === 0);
export const actionsSansEntreeManette = (l: Readonly<LiaisonsManette>): ActionManette[] => ACTIONS_MANETTE.filter((a) => l[a].length === 0);

/** Phrase qui dit ce que l'affectation a retiré (« « Q » a été retirée de « Roulis à gauche ». »). `null` si rien. */
export function phraseDepossession(entree: string, depossedees: readonly string[], libelles: Readonly<Record<string, string>>): string | null {
  if (depossedees.length === 0) return null;
  const noms = depossedees.map((a) => `« ${libelles[a] ?? a} »`).join(", ");
  return `« ${entree} » a été retirée de ${noms}.`;
}

/**
 * Phrase d'un refus d'affectation, à lire dans la zone d'état des réglages. `entree` est le libellé de ce que le joueur a pressé.
 * `pause` : on cherchait à changer le premier emplacement de « Pause », qui est fixe.
 */
export function messageRefus(refus: RefusLiaison, mode: "clavier" | "manette", entree: string): string {
  if (refus === "reservee") {
    if (mode === "manette") return "Start est réservé à la pause : choisis un autre bouton.";
    return entree === "Tab" ? "Tab affiche le classement en jeu : choisis une autre touche." : "Échap est réservée à la pause : choisis une autre touche.";
  }
  if (refus === "sansEffet") return "La pause se déclenche au clavier : choisis une touche plutôt qu'un bouton de la souris.";
  if (refus === "rejouer") return "A relance le match à l'écran de fin : choisis un autre bouton pour la pause.";
  if (refus === "fixe") return mode === "manette" ? "Start ouvre toujours la pause." : "Échap ouvre toujours la pause.";
  return mode === "manette" ? "Entrée de manette non reconnue." : "Touche non reconnue.";
}

/** Libellé d'une touche ou d'un bouton de souris : celui de l'arène (disposition du clavier du joueur) plus « Échap », que ce dernier écrit « Escape ». */
export const libelleToucheRocket = (code: string | null, disposition?: ReadonlyMap<string, string> | null): string =>
  code === TOUCHE_PAUSE ? "Échap" : libelleTouche(code, disposition);
