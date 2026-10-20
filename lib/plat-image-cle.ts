import { createHash } from "node:crypto";
import type { PdjEntry } from "./db";
import { variantesPlat } from "./plat-options";
import { baseClePlatImage, creditFournisseur, srcPlatImage, type ImagesPlats } from "./plat-image";

/** Clé d'image d'une variante de plat (serveur uniquement : `node:crypto`). */
export function clePlatImage(restaurant: string, plat: string): string {
  return createHash("sha256").update(baseClePlatImage(restaurant, plat), "utf8").digest("hex").slice(0, 24);
}

/** base → clé pour toutes les variantes affichables de la semaine (hors « coming soon »). */
export function clesSemaine(semaine: PdjEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const pdj of semaine) {
    for (const plat of pdj.plats ?? []) {
      if (plat.coming_soon) continue;
      for (const v of variantesPlat(plat)) {
        if (!v.plat) continue;
        const base = baseClePlatImage(plat.restaurant, v.plat);
        if (!out.has(base)) out.set(base, clePlatImage(plat.restaurant, v.plat));
      }
    }
  }
  return out;
}

/** Ne garde que les images existantes : base → URL versionnée par la date de création + crédit. */
export function imagesDeSemaine(
  cles: Map<string, string>,
  existantes: Map<string, { creeLe: string; fournisseur?: string | null }>,
): ImagesPlats {
  const out: ImagesPlats = {};
  for (const [base, cle] of cles) {
    const meta = existantes.get(cle);
    if (!meta) continue;
    const credit = creditFournisseur(meta.fournisseur);
    out[base] = credit ? { src: srcPlatImage(cle, meta.creeLe), credit } : { src: srcPlatImage(cle, meta.creeLe) };
  }
  return out;
}
