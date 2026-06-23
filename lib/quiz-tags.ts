export type Famille = "viande" | "poisson" | "vege";
export type Proteine =
  | "poulet"
  | "boeuf"
  | "porc"
  | "veau"
  | "agneau"
  | "poisson"
  | "autre";

export interface PlatTags {
  famille: Famille;
  proteine: Proteine;
}

/** Entrée minimale acceptée : un `Plat` ou un `CartePlat`. */
export interface PlatTagInput {
  plat: string;
  ingredients_detail?: { matched_nom: string | null }[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Ordre = priorité de détection. Le poisson est testé en premier.
const PROTEINE_KEYWORDS: { proteine: Exclude<Proteine, "autre">; mots: string[] }[] = [
  {
    proteine: "poisson",
    mots: ["saumon", "cabillaud", "thon", "colin", "lieu", "dorade", "truite", "merlu", "poisson", "crevette", "accra de poisson", "fruits de mer", "calamar", "moule"],
  },
  { proteine: "poulet", mots: ["poulet", "volaille", "dinde"] },
  { proteine: "boeuf", mots: ["boeuf", "steak", "bavette", "bourguignon", "haché"] },
  { proteine: "porc", mots: ["porc", "jambon", "lardon", "saucisse", "chipolata", "andouillette"] },
  { proteine: "veau", mots: ["veau"] },
  { proteine: "agneau", mots: ["agneau", "gigot"] },
];

// Termes de viande génériques (pas de protéine précise mais clairement carné).
const VIANDE_GENERIQUE = ["viande", "boulette", "kebab", "merguez", "magret", "confit"];

export function tagsForPlat(input: PlatTagInput): PlatTags {
  const fromIngredients = (input.ingredients_detail ?? [])
    .map((i) => i.matched_nom ?? "")
    .join(" ");
  const text = normalize(`${fromIngredients} ${input.plat}`);

  let proteine: Proteine = "autre";
  for (const { proteine: p, mots } of PROTEINE_KEYWORDS) {
    if (mots.some((m) => text.includes(normalize(m)))) {
      proteine = p;
      break;
    }
  }

  let famille: Famille;
  if (proteine === "poisson") {
    famille = "poisson";
  } else if (proteine !== "autre") {
    famille = "viande";
  } else if (VIANDE_GENERIQUE.some((m) => text.includes(normalize(m)))) {
    famille = "viande";
  } else {
    famille = "vege";
  }

  return { famille, proteine };
}
