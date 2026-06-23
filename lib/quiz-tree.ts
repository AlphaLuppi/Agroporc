import { tagsForPlat, type Famille, type Proteine } from "./quiz-tags";
import { choisirPlat, type PoolPlat, type Mode } from "./quiz-plats";

/**
 * Arbre de décision adaptatif construit chaque jour à partir des plats du jour.
 *
 * Garanties :
 *  - chaque plat est atteignable (il existe un chemin de réponses qui l'isole) ;
 *  - un chemin donné mène toujours au même résultat (déterminisme).
 *
 * On partitionne récursivement par famille → protéine → nom. Le nom sépare toujours
 * deux plats distincts, donc le départage final est garanti.
 */

export type AxisKey = "famille" | "proteine" | "nom";

export interface QuizOption {
  label: string;
  emoji: string;
  /** true = « Peu importe » : la feuille résout le meilleur du groupe selon le mode. */
  peuImporte: boolean;
  node: QuizNode;
}

export interface QuizQuestion {
  kind: "question";
  axis: AxisKey;
  titre: string;
  options: QuizOption[];
}

export interface QuizLeaf {
  kind: "leaf";
  /**
   * Groupe de plats à départager par le mode au moment du clic.
   * 1 plat = feuille exacte ; ≥2 plats = repli « Peu importe ».
   */
  plats: PoolPlat[];
}

export type QuizNode = QuizQuestion | QuizLeaf;

// Veau et agneau sont regroupés dans l'UI ("Veau / agneau") → même seau de partition.
function proteineGroupe(p: Proteine): Proteine {
  return p === "agneau" ? "veau" : p;
}

const FAMILLE_ORDER: Famille[] = ["viande", "poisson", "vege"];
const FAMILLE_META: Record<Famille, { label: string; emoji: string }> = {
  viande: { label: "De la viande", emoji: "🥩" },
  poisson: { label: "Du poisson", emoji: "🐟" },
  vege: { label: "Sans viande ni poisson", emoji: "🥦" },
};

const PROTEINE_ORDER: Proteine[] = ["poulet", "boeuf", "porc", "veau", "poisson", "autre"];
const PROTEINE_META: Record<Proteine, { label: string; emoji: string }> = {
  poulet: { label: "Poulet", emoji: "🍗" },
  boeuf: { label: "Bœuf", emoji: "🐄" },
  porc: { label: "Porc", emoji: "🐖" },
  veau: { label: "Veau / agneau", emoji: "🐑" },
  agneau: { label: "Veau / agneau", emoji: "🐑" },
  poisson: { label: "Poisson", emoji: "🐟" },
  autre: { label: "Autre", emoji: "🍽️" },
};

const PEU_IMPORTE = { label: "Peu importe", emoji: "🤷" };

/** Regroupe les plats par valeur d'axe, en préservant un ordre déterministe des valeurs. */
function grouper<T extends string>(
  plats: PoolPlat[],
  keyOf: (p: PoolPlat) => T,
  order: T[]
): { value: T; plats: PoolPlat[] }[] {
  const map = new Map<T, PoolPlat[]>();
  for (const p of plats) {
    const k = keyOf(p);
    (map.get(k) ?? map.set(k, []).get(k)!).push(p);
  }
  const known = order.filter((v) => map.has(v)).map((v) => ({ value: v, plats: map.get(v)! }));
  // Valeurs hors de l'ordre connu (par sécurité), triées alphabétiquement.
  const extra = [...map.keys()]
    .filter((v) => !order.includes(v))
    .sort()
    .map((v) => ({ value: v, plats: map.get(v)! }));
  return [...known, ...extra];
}

function leaf(plats: PoolPlat[]): QuizLeaf {
  return { kind: "leaf", plats };
}

function noeudFamille(plats: PoolPlat[]): QuizNode {
  if (plats.length <= 1) return leaf(plats);
  const groupes = grouper(plats, (p) => tagsForPlat(p).famille, FAMILLE_ORDER);
  if (groupes.length <= 1) return noeudProteine(plats);

  const options: QuizOption[] = groupes.map((g) => ({
    label: FAMILLE_META[g.value].label,
    emoji: FAMILLE_META[g.value].emoji,
    peuImporte: false,
    node: noeudProteine(g.plats),
  }));
  options.push({ ...PEU_IMPORTE, peuImporte: true, node: leaf(plats) });

  return { kind: "question", axis: "famille", titre: "Plutôt viande, poisson, ou sans viande ?", options };
}

function noeudProteine(plats: PoolPlat[]): QuizNode {
  if (plats.length <= 1) return leaf(plats);
  const groupes = grouper(plats, (p) => proteineGroupe(tagsForPlat(p).proteine), PROTEINE_ORDER);
  if (groupes.length <= 1) return noeudNom(plats);

  const options: QuizOption[] = groupes.map((g) => ({
    label: PROTEINE_META[g.value].label,
    emoji: PROTEINE_META[g.value].emoji,
    peuImporte: false,
    node: noeudNom(g.plats),
  }));
  options.push({ ...PEU_IMPORTE, peuImporte: true, node: leaf(plats) });

  return { kind: "question", axis: "proteine", titre: "Quelle protéine te fait envie ?", options };
}

function noeudNom(plats: PoolPlat[]): QuizNode {
  if (plats.length <= 1) return leaf(plats);
  // Départage final explicite par nom de plat : un choix = un plat.
  const options: QuizOption[] = plats
    .slice()
    .sort((a, b) => a.plat.localeCompare(b.plat))
    .map((p) => ({ label: p.plat, emoji: "🍽️", peuImporte: false, node: leaf([p]) }));

  return { kind: "question", axis: "nom", titre: "Lequel te tente ?", options };
}

/** Construit l'arbre de décision à partir des plats fournis (plats du jour, ou repli carte). */
export function buildQuizTree(plats: PoolPlat[]): QuizNode {
  return noeudFamille(plats);
}

/** Résout une feuille en un plat unique, de façon déterministe, selon le mode. */
export function resoudreFeuille(feuille: QuizLeaf, mode: Mode): PoolPlat | null {
  return choisirPlat(feuille.plats, {}, mode).resultat;
}
