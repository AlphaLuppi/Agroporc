/**
 * Réglages d'une arène (PUR, partagé client / serveur, aucun accès à l'horloge ni au hasard) : quels événements la partie peut déclencher et à quel
 * rythme. Fixés par le créateur à la création de l'arène (« Créer une arène »), validés par le serveur sur une liste fermée, portés par la partie
 * (`Partie.config`) et diffusés dans `salons.listes` (`ResumePartie.reglages`) ; ils ne changent plus jusqu'à sa fermeture. La partie permanente `ar1`
 * (le hall) a les réglages par défaut du serveur (tous les événements, fréquence « Normal », `PDJ_FPS_EVT_ACTIFS` / `PDJ_FPS_EVT_FREQUENCE`).
 * Spec : docs/superpowers/specs/2026-10-30-arene-police-evenements-design.md (§3)
 */

/** Événements que le joueur peut cocher ; l'ordre est canonique (celui de l'interface et de `normaliserReglages`). */
export const EVENEMENTS_ARENE = ["elsa", "avion", "bus", "truck", "tigre", "police"] as const;
export type IdEvenementArene = (typeof EVENEMENTS_ARENE)[number];

/** Rythme des événements : « Chaos » est la cadence historique de la v3 ; « Normal » espace les événements, « Calme » davantage. */
export const FREQUENCES = ["calme", "normal", "chaos"] as const;
export type FrequenceEvenements = (typeof FREQUENCES)[number];

export interface ReglagesArene {
  evenements: readonly IdEvenementArene[];
  frequence: FrequenceEvenements;
}

/** Réglages par défaut : tous les événements, fréquence Normal. */
export const REGLAGES_DEFAUT: ReglagesArene = Object.freeze({ evenements: Object.freeze([...EVENEMENTS_ARENE]) as readonly IdEvenementArene[], frequence: "normal" });

/** Au plus ce nombre d'éléments d'un tableau d'événements est examiné (un client qui enverrait mille éléments n'alourdit pas la validation). */
export const EVENEMENTS_EXAMINES_MAX = 16;

const estEvenement = (x: unknown): x is IdEvenementArene => typeof x === "string" && (EVENEMENTS_ARENE as readonly string[]).includes(x);
const estFrequence = (x: unknown): x is FrequenceEvenements => typeof x === "string" && (FREQUENCES as readonly string[]).includes(x);

/**
 * Réglages valides tirés d'une valeur quelconque (message d'un client, `localStorage`, variable d'environnement) ; ne jette jamais.
 * Non-objet : défaut ; `evenements` absent ou qui n'est pas un tableau : TOUS (anciens clients) ; tableau : ses éléments qui sont des identifiants
 * connus, dédoublonnés, rangés dans l'ordre canonique, au plus `EVENEMENTS_EXAMINES_MAX` éléments examinés ; `[]` est valide (« aucun événement ») ;
 * `frequence` hors liste : « normal ».
 */
export function normaliserReglages(brut: unknown): ReglagesArene {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return { evenements: [...REGLAGES_DEFAUT.evenements], frequence: REGLAGES_DEFAUT.frequence };
  const { evenements, frequence } = brut as { evenements?: unknown; frequence?: unknown };
  const liste: readonly IdEvenementArene[] = Array.isArray(evenements)
    ? (() => {
      const voulus = new Set<IdEvenementArene>();
      for (const e of evenements.slice(0, EVENEMENTS_EXAMINES_MAX)) if (estEvenement(e)) voulus.add(e);
      return EVENEMENTS_ARENE.filter((e) => voulus.has(e));
    })()
    : [...EVENEMENTS_ARENE];
  return { evenements: liste, frequence: estFrequence(frequence) ? frequence : "normal" };
}

/** Mêmes événements (dans l'ordre canonique, donc égaux comme ensembles) et même fréquence. */
export function reglagesEgaux(a: ReglagesArene, b: ReglagesArene): boolean {
  if (a.frequence !== b.frequence || a.evenements.length !== b.evenements.length) return false;
  return a.evenements.every((e, i) => e === b.evenements[i]);
}

/** Les réglages par défaut (tous les événements, « Normal »). */
export function estParDefaut(r: ReglagesArene): boolean {
  return reglagesEgaux(r, REGLAGES_DEFAUT);
}

/** Libellés français de l'interface et de la liste des parties. `aide` précise ce qu'un événement entraîne. */
export const LIBELLES_EVENEMENTS: Record<IdEvenementArene, { nom: string; aide: string }> = {
  elsa: { nom: "Elsa", aide: "Elsa (soin et arme spéciale)" },
  avion: { nom: "Avion", aide: "Avion et tigres largués (donne le sort d'invocation)" },
  bus: { nom: "Bus C3", aide: "Bus C3 (écrase à pied, largue des armes uniques)" },
  truck: { nom: "Truck Muche fou", aide: "Truck Muche fou" },
  tigre: { nom: "Tigre géant", aide: "Tigre robot géant (et titan)" },
  police: { nom: "Police", aide: "Descente de police" },
};

/** Libellés de la fréquence (interface et résumé). */
export const LIBELLES_FREQUENCES: Record<FrequenceEvenements, string> = { calme: "Calme", normal: "Normal", chaos: "Chaos" };

/** Noms qui complètent « Sans … » dans le résumé d'une arène à qui il manque quelques événements. */
const SANS: Record<IdEvenementArene, string> = {
  elsa: "sans Elsa", avion: "sans avion", bus: "sans bus C3", truck: "sans Truck fou", tigre: "sans tigre géant", police: "sans police",
};

/**
 * Résumé d'une ligne : « Tous les événements · Normal », « Aucun événement », « Sans tigre géant, sans police · Calme » ; avec au plus trois événements
 * absents, ce sont eux qui sont nommés, sinon ce sont ceux qui restent (« Elsa, avion · Chaos »). « Aucun événement » ne dit pas la fréquence (elle ne sert à rien).
 */
export function libelleReglages(r: ReglagesArene): string {
  const f = LIBELLES_FREQUENCES[r.frequence];
  if (r.evenements.length === 0) return "Aucun événement";
  if (r.evenements.length === EVENEMENTS_ARENE.length) return `Tous les événements · ${f}`;
  const absents = EVENEMENTS_ARENE.filter((e) => !r.evenements.includes(e));
  if (absents.length <= 3) return `${absents.map((e) => SANS[e]).join(", ").replace(/^./, (c) => c.toUpperCase())} · ${f}`;
  return `${r.evenements.map((e) => LIBELLES_EVENEMENTS[e].nom).join(", ")} · ${f}`;
}
