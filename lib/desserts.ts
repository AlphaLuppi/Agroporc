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

/** Une observation quotidienne d'un dessert (issue du scrape). */
export interface DessertObservation {
  date: string; // YYYY-MM-DD
  nom: string;
}

/** Clé de regroupement : minuscule, sans accents/ligatures, sans ponctuation, espaces normalisés. */
export function normalizeDessertKey(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Soustrait `n` jours à une date ISO (YYYY-MM-DD) et renvoie une date ISO. */
export function isoMinusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrège des observations en base de desserts data-driven.
 * proba = (jours distincts où le dessert a été vu) / (jours distincts où DES desserts
 * ont été postés), sur la fenêtre [today - windowDays, today]. Les jours sans post
 * n'entrent pas dans le dénominateur.
 */
export function aggregateObservations(
  observations: DessertObservation[],
  opts: { today: string; windowDays?: number }
): DessertConnu[] {
  const windowDays = opts.windowDays ?? 60;
  const cutoff = isoMinusDays(opts.today, windowDays);
  const inWindow = observations.filter(
    (o) => o.date >= cutoff && o.date <= opts.today
  );
  const postDays = new Set(inWindow.map((o) => o.date));
  const totalDays = postDays.size;
  if (totalDays === 0) return [];

  const groups = new Map<
    string,
    { dates: Set<string>; noms: Map<string, number> }
  >();
  for (const o of inWindow) {
    const key = normalizeDessertKey(o.nom);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { dates: new Set(), noms: new Map() };
      groups.set(key, g);
    }
    g.dates.add(o.date);
    g.noms.set(o.nom, (g.noms.get(o.nom) ?? 0) + 1);
  }

  const out: DessertConnu[] = [];
  for (const g of groups.values()) {
    const nom = [...g.noms.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const proba = Math.round((g.dates.size / totalDays) * 100);
    const { type_saveur, leger_gourmand } = classerDessertNom(nom);
    out.push({ nom, restaurant: "Le Truck Muche", type_saveur, leger_gourmand, proba });
  }
  return out;
}

/**
 * Fusionne les desserts observés (prioritaires) et le seed curé (fallback cold-start),
 * dédupliqués par clé normalisée. Un dessert observé écrase l'entrée seed de même clé.
 */
export function mergeDesserts(
  observed: DessertConnu[],
  seed: DessertConnu[]
): DessertConnu[] {
  const byKey = new Map<string, DessertConnu>();
  for (const d of seed) byKey.set(normalizeDessertKey(d.nom), d);
  for (const d of observed) byKey.set(normalizeDessertKey(d.nom), d);
  return [...byKey.values()];
}

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
