import { CHARACTERS } from "./characters";

/** Même clé que /idees, /ia, les commentaires et l'arène : un seul « qui es-tu ? » pour tout le site. */
export const CLE_PERSONNAGE = "pdj-selected-character";
/** Émis sur `window` à chaque écriture (le `storage` natif ne part pas dans l'onglet qui écrit). */
export const EVENEMENT_VOTANT = "pdj:votant-refresh";

/** Anciens noms encore présents dans la base ou les avatars (cf. AVATAR_* de lib/characters.ts). */
const ALIAS = new Map<string, string>([
  ["philippe", "Philippe Hetschebest"],
  ["ophelie", "Ophélie"],
  ["toam", "Thomas"],
]);

/**
 * Nom canonique d'un personnage (casse et alias hérités acceptés), null s'il est inconnu.
 * Le nom stocké en base est TOUJOURS celui-ci.
 */
export function canoniserVotant(nom: unknown): string | null {
  if (typeof nom !== "string") return null;
  const t = nom.trim();
  if (!t) return null;
  // Recherche dans la liste (jamais d'accès par clé à un objet : « constructor » ou « __proto__ » passeraient).
  const minuscule = t.toLowerCase();
  const nomCherche = ALIAS.get(minuscule) ?? t;
  const exact = CHARACTERS.find((c) => c.name === nomCherche);
  if (exact) return exact.name;
  const cherche = nomCherche.toLowerCase();
  return CHARACTERS.find((c) => c.name.toLowerCase() === cherche)?.name ?? null;
}

type LectureStockage = Pick<Storage, "getItem">;
type EcritureStockage = Pick<Storage, "setItem">;

function stockageParDefaut(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Personnage mémorisé, validé contre la liste ; null si absent, inconnu ou stockage inaccessible. Ne lève jamais. */
export function lireVotant(storage?: LectureStockage | null): string | null {
  try {
    const s = storage === undefined ? stockageParDefaut() : storage;
    if (!s) return null;
    return canoniserVotant(s.getItem(CLE_PERSONNAGE));
  } catch {
    return null;
  }
}

/**
 * Mémorise le personnage et prévient les autres composants. Refuse un nom inconnu ; renvoie
 * false si le stockage échoue (le vote peut quand même partir pour cette session).
 */
export function ecrireVotant(
  nom: string,
  storage?: EcritureStockage | null,
  cible?: EventTarget | null,
): boolean {
  const canonique = canoniserVotant(nom);
  if (!canonique) return false;
  let ecrit = false;
  try {
    const s = storage === undefined ? stockageParDefaut() : storage;
    if (s) {
      s.setItem(CLE_PERSONNAGE, canonique);
      ecrit = true;
    }
  } catch {
    ecrit = false;
  }
  try {
    const c = cible === undefined ? (typeof window !== "undefined" ? window : null) : cible;
    c?.dispatchEvent(new Event(EVENEMENT_VOTANT));
  } catch {
    /* sans importance */
  }
  return ecrit;
}
