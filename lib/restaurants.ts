/**
 * Liste de référence des restaurants d'Agroparc suivis par PDJ.
 * - `nom` : valeur exacte du champ `restaurant` des plats, clé des icônes et des liens.
 * - `slug` : `restaurant_slug` des cartes (`pdj_carte`) et des photos.
 * - `type` : core = historique (card « Fermé aujourd'hui » sans plat), optionnel = présent
 *   seulement les jours où il publie un plat, lien = aucun scraping (Vival : bar à salades
 *   Picadeli en libre-service dans l'épicerie, card et POI 3D avec statut + liens).
 * - `carte` : une carte permanente est scrapée et notée par le pipeline.
 * - `court` / `picto` / `couleur` : repère visuel du resto (`RestoBadge`) — nom court, contenu SVG
 *   (`lib/resto-pictos.ts`) et token CSS d'accent (`--resto-*` dans `app/globals.css`, hors des
 *   teintes vert/ambre/rouge réservées aux notes).
 * L'ordre du tableau est l'ordre d'affichage des cards sans plat et des cartes.
 */
import {
  PICTO_AVOCAT,
  PICTO_BASILIC,
  PICTO_CAMION,
  PICTO_COCOTTE,
  PICTO_CROISSANT,
  PICTO_DEFAUT,
  PICTO_PANIER,
  PICTO_TREFLE,
} from "./resto-pictos";

export type RestaurantType = "core" | "optionnel" | "lien";

export interface RestaurantDef {
  nom: string;
  slug: string;
  type: RestaurantType;
  carte: boolean;
  court: string;
  picto: string;
  couleur: string;
}

export const RESTAURANTS: RestaurantDef[] = [
  { nom: "Le Bistrot Trèfle", slug: "bistrot_trefle", type: "core", carte: true, court: "Trèfle", picto: PICTO_TREFLE, couleur: "var(--resto-trefle)" },
  { nom: "La Pause Gourmande", slug: "pause_gourmande", type: "core", carte: false, court: "La Pause", picto: PICTO_CROISSANT, couleur: "var(--resto-pause)" },
  { nom: "Le Truck Muche", slug: "truck_muche", type: "core", carte: false, court: "Truck", picto: PICTO_CAMION, couleur: "var(--resto-truck)" },
  { nom: "Basilic n'Go", slug: "basilic_ngo", type: "optionnel", carte: true, court: "Basilic", picto: PICTO_BASILIC, couleur: "var(--resto-basilic)" },
  { nom: "Dubble", slug: "dubble", type: "optionnel", carte: true, court: "Dubble", picto: PICTO_AVOCAT, couleur: "var(--resto-dubble)" },
  { nom: "La Mijote", slug: "la_mijote", type: "optionnel", carte: true, court: "Mijote", picto: PICTO_COCOTTE, couleur: "var(--resto-mijote)" },
  { nom: "Vival", slug: "vival", type: "lien", carte: false, court: "Vival", picto: PICTO_PANIER, couleur: "var(--resto-vival)" },
];

export const SLUG_TO_RESTAURANT: Record<string, string> = Object.fromEntries(
  RESTAURANTS.map((r) => [r.slug, r.nom]),
);

const PAR_NOM = new Map(RESTAURANTS.map((r) => [r.nom, r]));

/** Définition d'un resto par son nom exact (champ `restaurant` des plats), `undefined` si inconnu. */
export function restoParNom(nom: string): RestaurantDef | undefined {
  return PAR_NOM.get(nom);
}

export interface RepereResto {
  court: string;
  picto: string;
  couleur: string;
}

/** Repère visuel d'un resto ; un resto inconnu garde son nom, des couverts et la couleur atténuée. */
export function repereResto(nom: string): RepereResto {
  const def = restoParNom(nom);
  if (def) return { court: def.court, picto: def.picto, couleur: def.couleur };
  return { court: nom, picto: PICTO_DEFAUT, couleur: "var(--text-muted)" };
}

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
