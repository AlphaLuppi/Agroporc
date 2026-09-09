import type { Carte, CartePlat, CarteSection } from "./db";

export type Mode = "sportif" | "goulaf";

/** Note d'un plat de carte pour un mode ; en Goulaf, retombe sur la note sportive si absente. */
export function noteMode(plat: CartePlat, mode: Mode): number | undefined {
  return mode === "goulaf" ? plat.note_goulaf ?? plat.note : plat.note;
}

/** Note moyenne d'une section (plats sans note ignorés), -1 si aucune note. */
function sectionAvg(sec: CarteSection, mode: Mode): number {
  const notes = sec.plats.map((p) => noteMode(p, mode)).filter((n): n is number => typeof n === "number");
  if (notes.length === 0) return -1;
  return notes.reduce((a, b) => a + b, 0) / notes.length;
}

/**
 * Sections d'une carte triées par note moyenne décroissante, plats de chaque section par
 * note décroissante (non notés en dernier). Ne modifie pas la carte d'origine.
 */
export function trierCarte(carte: Carte, mode: Mode = "sportif"): CarteSection[] {
  return carte.sections
    .map((sec) => ({
      ...sec,
      plats: [...sec.plats].sort((a, b) => (noteMode(b, mode) ?? -1) - (noteMode(a, mode) ?? -1)),
    }))
    .sort((a, b) => sectionAvg(b, mode) - sectionAvg(a, mode));
}
