import { tagsForPlat, type Proteine } from "./quiz-tags";
import { type PoolPlat, type Mode } from "./quiz-plats";

/**
 * Moteur de choix multi-critères du quiz « Aide-moi à choisir ».
 *
 * Chaque question affiche TOUJOURS toutes ses options (pas d'élagage). On classe
 * les plats du jour par nombre de critères satisfaits ; les mieux classés sont les
 * candidats. Si un seul candidat → résultat direct ; si plusieurs → départage par nom.
 * Aucun critère ne matche → repli sur le mieux noté (au plus proche). Les plats du jour
 * restent donc toujours atteignables.
 */

export type Envie = "poulet" | "boeuf" | "porc" | "veau" | "poisson" | "vege";
export type Cuisine = "mijote" | "asiatique" | "mediterraneen" | "streetfood" | "froid";
export type LourdeurPlat = "leger" | "copieux";
export type Budget = "eco" | "standard";

export interface Criteres {
  envie?: Envie;
  cuisine?: Cuisine;
  lourdeur?: LourdeurPlat;
  budget?: Budget;
}

export interface PlatTagsComplet {
  envie: Envie | "autre";
  cuisine: Cuisine | "autre";
  lourdeur: LourdeurPlat;
  budget: Budget;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function texteDuPlat(p: PoolPlat): string {
  const ing = (p.ingredients_detail ?? []).map((i) => i.matched_nom ?? "").join(" ");
  return normalize(`${ing} ${p.plat}`);
}

// Veau et agneau sont regroupés ("Veau / agneau").
function proteineGroupe(pr: Proteine): Proteine {
  return pr === "agneau" ? "veau" : pr;
}

const ENVIES: Envie[] = ["poulet", "boeuf", "porc", "veau", "poisson", "vege"];
const CUISINES: Cuisine[] = ["mijote", "asiatique", "mediterraneen", "streetfood", "froid"];

/** Normalise une valeur de tag LLM vers l'enum attendu (agneau→veau), sinon null. */
function envieFromTag(v?: string): Envie | "autre" | null {
  if (!v) return null;
  const t = v.toLowerCase().trim();
  if (t === "agneau") return "veau";
  if ((ENVIES as string[]).includes(t)) return t as Envie;
  if (t === "autre") return "autre";
  return null;
}

/** Famille/protéine → valeur d'« envie » (axe combiné de la 1re question). */
export function envieForPlat(p: PoolPlat): Envie | "autre" {
  const fromLlm = envieFromTag(p.quiz_tags?.envie);
  if (fromLlm) return fromLlm;
  const { famille, proteine } = tagsForPlat(p);
  if (famille === "vege") return "vege";
  if (proteine === "poisson") return "poisson";
  const g = proteineGroupe(proteine);
  if (g === "poulet" || g === "boeuf" || g === "porc" || g === "veau") return g;
  return "autre"; // viande générique sans protéine identifiée
}

const CUISINE_KEYWORDS: { cuisine: Cuisine; mots: string[] }[] = [
  { cuisine: "asiatique", mots: ["wok", "nouilles", "curry", "thai", "asiat", "soja", "teriyaki", "ramen", "nem", "cantonais", "bo bun", "yakitori", "sushi", "pad", "coco", "gingembre", "saute"] },
  { cuisine: "streetfood", mots: ["burger", "kebab", "tacos", "wrap", "sandwich", "hot-dog", "hot dog", "frites", "panini", "bagel", "nuggets", "tenders", "fish and chips"] },
  { cuisine: "mediterraneen", mots: ["tajine", "couscous", "paella", "risotto", "pasta", "pates", "ratatouille", "moussaka", "falafel", "houmous", "mediterran", "provencal", "mozzarella", "pesto", "parmesan", "polenta", "gnocchi"] },
  { cuisine: "froid", mots: ["salade", "buddha", "poke", "carpaccio", "tartare", "ceviche", "gaspacho", "taboule", "crudites", "bowl froid"] },
  { cuisine: "mijote", mots: ["mijote", "bourguignon", "blanquette", "pot-au-feu", "pot au feu", "daube", "navarin", "cassoulet", "confit", "braise", "ragout", "carottes", "parmentier", "chili", "estouffade"] },
];

export function cuisineForPlat(p: PoolPlat): Cuisine | "autre" {
  const tag = p.quiz_tags?.cuisine?.toLowerCase().trim();
  if (tag && (CUISINES as string[]).includes(tag)) return tag as Cuisine;
  if (tag === "autre") return "autre";
  const t = texteDuPlat(p);
  for (const { cuisine, mots } of CUISINE_KEYWORDS) {
    if (mots.some((m) => t.includes(normalize(m)))) return cuisine;
  }
  return "autre";
}

const LEGER_MOTS = ["salade", "grille", "vapeur", "poke", "bowl", "papillote", "crudites", "wok de legumes", "legumes", "dorade", "cabillaud", "ceviche", "tartare", "carpaccio", "buddha"];
const COPIEUX_MOTS = ["frites", "gratin", "burger", "raclette", "cassoulet", "parmentier", "lasagne", "pane", "friture", "fromage", "creme", "tartiflette", "nuggets", "pizza", "risotto", "pates", "nouilles", "tenders", "panini"];

export function lourdeurForPlat(p: PoolPlat): LourdeurPlat {
  const tag = p.quiz_tags?.lourdeur?.toLowerCase().trim();
  if (tag === "leger" || tag === "copieux") return tag;
  const t = texteDuPlat(p);
  const copieux = COPIEUX_MOTS.some((m) => t.includes(normalize(m)));
  const leger = LEGER_MOTS.some((m) => t.includes(normalize(m)));
  if (copieux && !leger) return "copieux";
  if (leger && !copieux) return "leger";
  // Ambigu ou inconnu : on tranche sur la note sportif (plus saine = plus légère).
  return (p.note ?? 5) >= 7 ? "leger" : "copieux";
}

/** Extrait le prix en euros depuis une chaîne comme "11.9€" / "11,9 €" / "10€". */
export function prixEuros(prix: string): number | null {
  const m = normalize(prix).replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export function budgetForPlat(p: PoolPlat): Budget {
  const prix = prixEuros(p.prix);
  return prix !== null && prix <= 10 ? "eco" : "standard";
}

export function classerPlat(p: PoolPlat): PlatTagsComplet {
  return {
    envie: envieForPlat(p),
    cuisine: cuisineForPlat(p),
    lourdeur: lourdeurForPlat(p),
    budget: budgetForPlat(p),
  };
}

function noteFor(p: PoolPlat, mode: Mode): number {
  const n = mode === "sportif" ? p.note : p.note_goulaf;
  return typeof n === "number" ? n : -1;
}

/** Tri déterministe : note du mode, puis départage stable (restaurant, plat). */
function trierParNote(plats: PoolPlat[], mode: Mode): PoolPlat[] {
  return [...plats].sort(
    (a, b) =>
      noteFor(b, mode) - noteFor(a, mode) ||
      a.restaurant.localeCompare(b.restaurant) ||
      a.plat.localeCompare(b.plat)
  );
}

function nbCriteres(c: Criteres): number {
  return [c.envie, c.cuisine, c.lourdeur, c.budget].filter((v) => v !== undefined).length;
}

function scorePlat(tags: PlatTagsComplet, c: Criteres): number {
  let s = 0;
  if (c.envie !== undefined && tags.envie === c.envie) s++;
  if (c.cuisine !== undefined && tags.cuisine === c.cuisine) s++;
  if (c.lourdeur !== undefined && tags.lourdeur === c.lourdeur) s++;
  if (c.budget !== undefined && tags.budget === c.budget) s++;
  return s;
}

export interface CandidatsResultat {
  /** Plats les mieux classés (score max), triés par note du mode. */
  candidats: PoolPlat[];
  /** true si au moins un plat satisfait TOUS les critères précisés. */
  exact: boolean;
  /** Nombre de critères précisés (hors « peu importe »). */
  nbCriteres: number;
  /** Nombre de critères satisfaits par les candidats (0 = aucun plat ne colle). */
  scoreMax: number;
}

/** Classe le pool par nombre de critères satisfaits ; renvoie les mieux classés. */
export function meilleursCandidats(pool: PoolPlat[], criteres: Criteres, mode: Mode): CandidatsResultat {
  const n = nbCriteres(criteres);
  if (pool.length === 0) return { candidats: [], exact: false, nbCriteres: n, scoreMax: 0 };

  const scored = pool.map((p) => ({ p, score: scorePlat(classerPlat(p), criteres) }));
  const max = Math.max(...scored.map((s) => s.score));
  const top = trierParNote(
    scored.filter((s) => s.score === max).map((s) => s.p),
    mode
  );
  return { candidats: top, exact: n > 0 && max === n, nbCriteres: n, scoreMax: max };
}
