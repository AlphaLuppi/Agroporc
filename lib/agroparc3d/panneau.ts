import type { PdjEntry, Plat } from "../db";
import { RESTAURANTS, statutSansPlat, type RestaurantDef } from "../restaurants";
import type { Poi } from "./types";

/** Contenu du panneau d'un POI cliqué dans la vue 3D. */
export type EtatResto =
  | { kind: "plat"; plat: Plat }
  | {
      kind: "sans_plat";
      resto: RestaurantDef | null;
      /** Ligne de statut (même vocabulaire que les cards « sans plat » de la home). */
      statut: string;
      /** Slug de la carte permanente à afficher à la place du plat, ou null. */
      carteSlug: string | null;
    };

/**
 * Détermine ce que montre le panneau pour un POI : le plat du jour s'il existe, sinon le
 * statut du resto et, quand il en a une, sa carte permanente.
 */
export function etatRestaurant(poi: Poi, pdj: PdjEntry | null, today: string): EtatResto {
  const resto = RESTAURANTS.find((r) => r.nom === poi.name) ?? null;
  const plat = pdj?.plats.find((p) => p.restaurant === poi.name);
  if (plat && !plat.coming_soon) return { kind: "plat", plat };

  const carteSlug = resto?.carte ? resto.slug : null;
  let statut: string;
  if (!resto) statut = "Pas de restaurant suivi ici";
  else if (!pdj) statut = "Menu du jour indisponible";
  else if (plat?.coming_soon) statut = "Plat du jour dévoilé le matin même";
  else statut = statutSansPlat(resto, pdj.date > today);

  return { kind: "sans_plat", resto, statut, carteSlug };
}
