export type SaveurDessert = "fruite" | "chocolate" | "creme_lacte" | "patissier";
export type Lourdeur = "leger" | "gourmand";

export interface DessertConnu {
  nom: string;
  restaurant: string;
  type_saveur: SaveurDessert;
  leger_gourmand: Lourdeur;
  /** 0-100 : chance d'être disponible aujourd'hui. */
  proba: number;
  note?: number;
}

export interface DessertCriteres {
  saveur?: SaveurDessert;
  lourdeur?: Lourdeur;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Déduit saveur + lourdeur d'un nom de dessert (utilisé pour les desserts de carte). */
export function classerDessertNom(nom: string): {
  type_saveur: SaveurDessert;
  leger_gourmand: Lourdeur;
} {
  const t = normalize(nom);
  const has = (...mots: string[]) => mots.some((m) => t.includes(normalize(m)));

  if (has("chocolat", "nutella", "brownie", "fondant", "mi-cuit", "mi cuit")) {
    return { type_saveur: "chocolate", leger_gourmand: "gourmand" };
  }
  if (has("salade de fruits", "fraises", "abricot", "peche", "pomme", "fruits rouges", "ananas", "fruit")) {
    const leger = has("salade de fruits", "fruits rouges") ? "leger" : "gourmand";
    // Une tarte/crumble de fruits reste pâtissier.
    if (has("tarte", "crumble", "clafoutis", "amandine")) {
      return { type_saveur: "patissier", leger_gourmand: "gourmand" };
    }
    return { type_saveur: "fruite", leger_gourmand: leger };
  }
  if (has("tarte", "crumble", "clafoutis", "brioche", "amandine", "banoffee", "perdue")) {
    return { type_saveur: "patissier", leger_gourmand: "gourmand" };
  }
  if (has("fromage blanc", "yaourt", "muesli")) {
    return { type_saveur: "creme_lacte", leger_gourmand: "leger" };
  }
  // tiramisu, mousse, crème, flan, panna cotta…
  return { type_saveur: "creme_lacte", leger_gourmand: "gourmand" };
}

/** Base curée des desserts connus (Truck Muche — non scrapables). À éditer librement. */
export const DESSERTS_CONNUS: DessertConnu[] = [
  // — Truck Muche : quasi-permanents (souvent là) —
  { nom: "Fromage blanc muesli coulis framboise", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "leger", proba: 85 },
  { nom: "Salade de fruits", restaurant: "Le Truck Muche", type_saveur: "fruite", leger_gourmand: "leger", proba: 85 },
  { nom: "Mi-cuit chocolat", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 85 },
  { nom: "Mousse spéculoos", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 85 },
  { nom: "Tiramisu Oreo", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 85 },
  { nom: "Banoffee", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 85 },
  // — Truck Muche : tournants (vus récemment) —
  { nom: "Flan aux œufs", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Fraises chantilly", restaurant: "Le Truck Muche", type_saveur: "fruite", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Tarte abricots amandine", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Clafoutis pêches", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Crème brûlée chocolat", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Crumble pommes spéculoos", restaurant: "Le Truck Muche", type_saveur: "patissier", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Tiramisu framboise spéculoos", restaurant: "Le Truck Muche", type_saveur: "creme_lacte", leger_gourmand: "gourmand", proba: 30 },
  { nom: "Brioche perdue Nutella", restaurant: "Le Truck Muche", type_saveur: "chocolate", leger_gourmand: "gourmand", proba: 30 },
];

/** Filtre par critères (axes non précisés = pas de filtre), trie par proba puis note, retourne le meilleur. */
export function choisirDessert(
  desserts: DessertConnu[],
  criteres: DessertCriteres
): DessertConnu | null {
  const matches = desserts.filter(
    (d) =>
      (!criteres.saveur || d.type_saveur === criteres.saveur) &&
      (!criteres.lourdeur || d.leger_gourmand === criteres.lourdeur)
  );
  if (matches.length === 0) return null;
  return [...matches].sort(
    (a, b) => b.proba - a.proba || (b.note ?? 0) - (a.note ?? 0)
  )[0];
}
