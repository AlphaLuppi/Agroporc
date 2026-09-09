/**
 * Liste de référence des restaurants d'Agroparc suivis par PDJ.
 * - `nom` : valeur exacte du champ `restaurant` des plats, clé des icônes et des liens.
 * - `slug` : `restaurant_slug` des cartes (`pdj_carte`) et des photos.
 * - `type` : core = historique (card « Fermé aujourd'hui » sans plat), optionnel = présent
 *   seulement les jours où il publie un plat, lien = aucun scraping (Vival : bar à salades
 *   Picadeli en libre-service dans l'épicerie, card et POI 3D avec statut + liens).
 * - `carte` : une carte permanente est scrapée et notée par le pipeline.
 * L'ordre du tableau est l'ordre d'affichage des cards sans plat et des cartes.
 */
export type RestaurantType = "core" | "optionnel" | "lien";

export interface RestaurantDef {
  nom: string;
  slug: string;
  type: RestaurantType;
  carte: boolean;
}

export const RESTAURANTS: RestaurantDef[] = [
  { nom: "Le Bistrot Trèfle", slug: "bistrot_trefle", type: "core", carte: true },
  { nom: "La Pause Gourmande", slug: "pause_gourmande", type: "core", carte: false },
  { nom: "Le Truck Muche", slug: "truck_muche", type: "core", carte: false },
  { nom: "Basilic n'Go", slug: "basilic_ngo", type: "optionnel", carte: true },
  { nom: "Dubble", slug: "dubble", type: "optionnel", carte: true },
  { nom: "La Mijote", slug: "la_mijote", type: "optionnel", carte: true },
  { nom: "Vival", slug: "vival", type: "lien", carte: false },
];

export const SLUG_TO_RESTAURANT: Record<string, string> = Object.fromEntries(
  RESTAURANTS.map((r) => [r.slug, r.nom]),
);

/** Ligne de statut d'une card sans plat du jour. */
export function statutSansPlat(resto: RestaurantDef, isFuture: boolean): string {
  switch (resto.type) {
    case "core":
      return "Fermé aujourd'hui";
    case "optionnel":
      return isFuture ? "Plat du jour dévoilé le matin même" : "Pas de plat du jour aujourd'hui";
    case "lien":
      return "Bar à salades Picadeli en libre-service, prix au poids";
  }
}

/** « La carte du Bistrot Trèfle », « La carte de la Mijote », « La carte de Dubble ». */
export function titreCarte(resto: RestaurantDef): string {
  if (resto.nom.startsWith("Le ")) return `La carte du ${resto.nom.slice(3)}`;
  if (resto.nom.startsWith("La ")) return `La carte de la ${resto.nom.slice(3)}`;
  return `La carte de ${resto.nom}`;
}
