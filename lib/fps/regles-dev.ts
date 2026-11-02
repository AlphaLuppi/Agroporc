/**
 * Menu de développement (PUR, partagé client / serveur, aucune horloge ni aucun hasard) : règles d'une partie modifiables EN DIRECT pendant qu'on joue,
 * et actions ponctuelles (forcer un événement, donner de l'argent, passer la manche…). Le client propose (`reglesDev{regles, evenements, action}`),
 * le serveur valide et borne ICI (liste fermée, valeurs ramenées au pas et aux bornes, jamais de jet), applique, puis diffuse l'état courant et une
 * annonce à toute la partie (« Alice : gravité ×0,5 »). Les règles reviennent aux valeurs par défaut au prochain match (arène), au retour au lobby
 * (zombies, Battle Royale) et quand la partie se vide.
 *
 * Règles (toutes bornées) : multiplicateur de dégâts, de vitesse et de gravité, munitions infinies, régénération des PV et délai de réapparition
 * (arène). Les événements de l'arène (cases et fréquence) passent par `ReglagesArene` (reglages-arene.ts) : un changement en direct reconstruit les services
 * d'événements. Le mouvement est autoritaire côté client : le serveur diffuse le réglage et élargit son budget de distance (`multBudgetVitesse`).
 */
import { JEU } from "./protocole";
import type { ModeSalle } from "./protocole";
import { EVENEMENTS_ARENE, type IdEvenementArene } from "./reglages-arene";
import { GENRES_BONUS, type GenreBonus } from "./zombies-vagues";

export interface BorneDev { min: number; max: number; pas: number }

/** Bornes et pas de chaque règle numérique (l'interface s'en sert pour ses curseurs : une seule source). */
export const BORNES_DEV = {
  degats: { min: 0.25, max: 5, pas: 0.25 },
  vitesse: { min: 0.5, max: 2, pas: 0.25 },
  gravite: { min: 0.25, max: 2, pas: 0.25 },
  reapparitionMs: { min: 1000, max: 10_000, pas: 500 },
} as const satisfies Record<string, BorneDev>;

export interface ReglesDev {
  /** multiplicateur des dégâts d'arme (joueurs en arène et Battle Royale, tigres des zombies) */
  degats: number;
  /** multiplicateur de la vitesse de déplacement (marche et sprint) */
  vitesse: number;
  /** multiplicateur de la gravité (saut et chute) */
  gravite: number;
  /** aucune munition ne se décompte (chargeurs, réserve, arme spéciale) */
  munitionsInfinies: boolean;
  /** arène : régénération de 20 PV/s après 5 s sans dégât (décochée : les PV ne reviennent plus) */
  regeneration: boolean;
  /** arène : délai de réapparition après une mort (ms) */
  reapparitionMs: number;
}

/** Règles d'une partie normale (celles du jeu sans menu de développement). */
export const REGLES_DEV_DEFAUT: ReglesDev = Object.freeze({
  degats: 1, vitesse: 1, gravite: 1, munitionsInfinies: false, regeneration: true, reapparitionMs: JEU.delaiReapparitionMs,
});

/** Champs de `ReglesDev` qui ont un sens dans chaque mode (l'interface ne montre que ceux-là ; le serveur n'applique que ceux-là). */
export const CHAMPS_DEV_PAR_MODE: Record<ModeSalle, readonly (keyof ReglesDev)[]> = {
  arene: ["degats", "vitesse", "gravite", "munitionsInfinies", "regeneration", "reapparitionMs"],
  zombies: ["degats", "vitesse", "gravite", "munitionsInfinies"],
  br: ["degats", "vitesse", "gravite", "munitionsInfinies"],
};

/** Argent donné d'un coup : montants proposés et plafond accepté du serveur. */
export const MONTANTS_ARGENT_DEV = [500, 2500, 10_000] as const;
export const ARGENT_DEV_MAX = 50_000;

/** Intervalle minimal (ms) entre deux messages de développement d'un joueur : reconstruire les services d'événements n'est pas gratuit. */
export const INTERVALLE_DEV_MS = 300;

/** Action ponctuelle (impulsion, jamais mémorisée dans les règles). */
export type ActionDev =
  /** arène : avance le minuteur de l'événement à maintenant (BR : seulement la police) ; ses conditions habituelles (aucun autre événement…) restent */
  | { k: "forcer"; evenement: IdEvenementArene }
  /** zombies : donne `montant` $ à chaque joueur admis */
  | { k: "argent"; montant: number }
  /** zombies : rétablit le courant */
  | { k: "courant" }
  /** zombies : lâche un bonus aux pieds de l'auteur */
  | { k: "bonus"; genre: GenreBonus }
  /** zombies : efface les tigres de la manche et passe à la suivante (refusé pendant une manche du Truck) */
  | { k: "passerManche" }
  /** les règles et les réglages d'événements de l'arène reviennent à ceux d'origine de la partie */
  | { k: "reinitialiser" };

const estObjet = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Valeur ramenée au pas puis aux bornes (deux décimales : pas de 0,25 exact, jamais de 0,30000000000000004). */
export function ramener(x: unknown, b: BorneDev, defaut: number): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return defaut;
  const v = Math.round(x / b.pas) * b.pas;
  return Math.round(Math.min(b.max, Math.max(b.min, v)) * 100) / 100;
}

/**
 * Règles valides tirées d'un patch quelconque (message d'un client) appliqué sur `base` : seules les clés connues sont lues, un champ absent ou invalide
 * garde la valeur de `base`. Ne jette jamais.
 */
export function normaliserReglesDev(patch: unknown, base: ReglesDev = REGLES_DEV_DEFAUT): ReglesDev {
  if (!estObjet(patch)) return { ...base };
  const p = patch;
  return {
    degats: "degats" in p ? ramener(p.degats, BORNES_DEV.degats, base.degats) : base.degats,
    vitesse: "vitesse" in p ? ramener(p.vitesse, BORNES_DEV.vitesse, base.vitesse) : base.vitesse,
    gravite: "gravite" in p ? ramener(p.gravite, BORNES_DEV.gravite, base.gravite) : base.gravite,
    munitionsInfinies: typeof p.munitionsInfinies === "boolean" ? p.munitionsInfinies : base.munitionsInfinies,
    regeneration: typeof p.regeneration === "boolean" ? p.regeneration : base.regeneration,
    reapparitionMs: "reapparitionMs" in p ? ramener(p.reapparitionMs, BORNES_DEV.reapparitionMs, base.reapparitionMs) : base.reapparitionMs,
  };
}

/** Les mêmes règles ? */
export function reglesDevEgales(a: ReglesDev, b: ReglesDev): boolean {
  return a.degats === b.degats && a.vitesse === b.vitesse && a.gravite === b.gravite && a.munitionsInfinies === b.munitionsInfinies
    && a.regeneration === b.regeneration && a.reapparitionMs === b.reapparitionMs;
}

export const estDefautDev = (r: ReglesDev): boolean => reglesDevEgales(r, REGLES_DEV_DEFAUT);

/** Retient les seules règles qui ont un sens dans ce mode : les autres restent à leur valeur de `base`. */
export function limiterAuMode(mode: ModeSalle, voulues: ReglesDev, base: ReglesDev = REGLES_DEV_DEFAUT): ReglesDev {
  const champs = CHAMPS_DEV_PAR_MODE[mode];
  const r = { ...base } as Record<keyof ReglesDev, number | boolean>;
  for (const c of champs) r[c] = voulues[c];
  return r as unknown as ReglesDev;
}

/** Action valide d'un message, ou null (type inconnu, événement hors liste, montant hors bornes…). */
export function normaliserActionDev(brut: unknown): ActionDev | null {
  if (!estObjet(brut)) return null;
  switch (brut.k) {
    case "forcer":
      return typeof brut.evenement === "string" && (EVENEMENTS_ARENE as readonly string[]).includes(brut.evenement)
        ? { k: "forcer", evenement: brut.evenement as IdEvenementArene } : null;
    case "argent": {
      const m = brut.montant;
      return typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= ARGENT_DEV_MAX ? { k: "argent", montant: m } : null;
    }
    case "courant": return { k: "courant" };
    case "bonus":
      return typeof brut.genre === "string" && (GENRES_BONUS as readonly string[]).includes(brut.genre) ? { k: "bonus", genre: brut.genre as GenreBonus } : null;
    case "passerManche": return { k: "passerManche" };
    case "reinitialiser": return { k: "reinitialiser" };
    default: return null;
  }
}

/** L'action a-t-elle un sens dans ce mode ? (arène : forcer ; BR : forcer la police ; zombies : argent, courant, bonus, passer la manche.) */
export function actionPermise(mode: ModeSalle, a: ActionDev): boolean {
  switch (a.k) {
    case "reinitialiser": return true;
    case "forcer": return mode === "arene" || (mode === "br" && a.evenement === "police");
    case "argent": case "courant": case "bonus": case "passerManche": return mode === "zombies";
  }
}

/**
 * Le budget de distance des états est élargi de ce facteur : le mouvement est autoritaire côté client, un joueur deux fois plus rapide parcourt deux
 * fois plus de chemin que le budget ordinaire ne le permet. Jamais en dessous de 1 (un joueur ralenti ne resserre pas l'anti-triche).
 */
export const multBudgetVitesse = (r: ReglesDev): number => Math.max(1, r.vitesse);

// ---------- qui peut régler ----------

export type RefusDev = "hote" | "lobby" | "limite" | "invalide";

/**
 * Qui peut modifier les règles : dans le hall partagé (`ar1`, `hallLibre`) tout joueur EN JEU ; dans une partie créée (arène, zombies, Battle Royale), son
 * hôte (le premier humain arrivé, `estHote`). Un membre qui n'est pas en jeu n'a pas de menu (zombies et BR : le lobby n'a pas de partie à régler),
 * sauf l'hôte, qui peut préparer les règles avant de lancer.
 */
export function autoriseDev(o: { hallLibre: boolean; estHote: boolean; enJeu: boolean }): true | RefusDev {
  if (o.hallLibre) return o.enJeu ? true : "lobby";
  return o.estHote ? true : "hote";
}

// ---------- libellés ----------

/** Multiplicateur à la française : « ×0,5 », « ×2 ». */
export const libelleMult = (x: number): string => `×${String(x).replace(".", ",")}`;

const LIBELLES_FREQ = { calme: "calme", normal: "normal", chaos: "chaos" } as const;

/** Libellés d'événement pour les annonces (« police », « Truck Muche fou »…). */
export const NOMS_EVENEMENT_DEV: Record<IdEvenementArene, string> = {
  elsa: "Elsa", avion: "l'avion", bus: "le bus C3", truck: "le Truck Muche fou", tigre: "le tigre géant", police: "la police",
};

export const NOMS_BONUS_DEV: Record<GenreBonus, string> = {
  munitions: "munitions max", instakill: "insta-kill", double: "double points", nuke: "nuke", menuisier: "menuisier", soldes: "happy hour",
};

/** Libellés des règles modifiées entre deux états (annonce « Alice : gravité ×0,5, munitions infinies »), dans l'ordre d'affichage. */
export function differencesDev(avant: ReglesDev, apres: ReglesDev): string[] {
  const l: string[] = [];
  if (avant.degats !== apres.degats) l.push(`dégâts ${libelleMult(apres.degats)}`);
  if (avant.vitesse !== apres.vitesse) l.push(`vitesse ${libelleMult(apres.vitesse)}`);
  if (avant.gravite !== apres.gravite) l.push(`gravité ${libelleMult(apres.gravite)}`);
  if (avant.munitionsInfinies !== apres.munitionsInfinies) l.push(apres.munitionsInfinies ? "munitions infinies" : "munitions normales");
  if (avant.regeneration !== apres.regeneration) l.push(apres.regeneration ? "régénération rétablie" : "plus de régénération");
  if (avant.reapparitionMs !== apres.reapparitionMs) l.push(`réapparition ${String(apres.reapparitionMs / 1000).replace(".", ",")} s`);
  return l;
}

/** Libellé d'un changement d'événements d'arène (cases cochées ou décochées, fréquence). */
export function differencesEvenements(
  avant: { evenements: readonly IdEvenementArene[]; frequence: keyof typeof LIBELLES_FREQ },
  apres: { evenements: readonly IdEvenementArene[]; frequence: keyof typeof LIBELLES_FREQ },
): string[] {
  const l: string[] = [];
  for (const e of EVENEMENTS_ARENE) {
    const a = avant.evenements.includes(e), b = apres.evenements.includes(e);
    if (a !== b) l.push(`${b ? "avec" : "sans"} ${NOMS_EVENEMENT_DEV[e]}`);
  }
  if (avant.frequence !== apres.frequence) l.push(`événements ${LIBELLES_FREQ[apres.frequence]}`);
  return l;
}

/** Libellé d'une action pour l'annonce. */
export function libelleAction(a: ActionDev): string {
  switch (a.k) {
    case "forcer": return `événement forcé : ${NOMS_EVENEMENT_DEV[a.evenement]}`;
    case "argent": return `+${a.montant} $ pour tous`;
    case "courant": return "courant rétabli";
    case "bonus": return `bonus : ${NOMS_BONUS_DEV[a.genre]}`;
    case "passerManche": return "manche passée";
    case "reinitialiser": return "règles par défaut";
  }
}

/** Texte de l'annonce faite à toute la partie : « Alice : gravité ×0,5, munitions infinies ». Vide s'il n'y a rien à dire. */
export function annonceDev(pseudo: string, changements: readonly string[]): string {
  return changements.length ? `${pseudo} : ${changements.join(", ")}` : "";
}

/** Texte d'un refus (menu de développement). */
export function texteRefusDev(raison: string): string {
  switch (raison) {
    case "hote": return "Seul l'hôte de la partie peut régler les règles.";
    case "lobby": return "Les règles se règlent une fois en partie.";
    case "limite": return "Trop vite : réessayez dans un instant.";
    case "mode": return "Ce réglage n'existe pas dans ce mode.";
    case "invalide": return "Impossible maintenant (événement absent, déjà en cours ou retenu par un autre ; police : il faut quelqu'un à viser ; zombies : pas en manche…).";
    default: return "Réglage refusé.";
  }
}
