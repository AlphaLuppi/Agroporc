/**
 * Notes Sportif / Goulaf et protéine des recettes (POC) — logique pure, sans `node:crypto` ni `pg`.
 *
 * Une recette est rattachée à une variante de plat par la clé `clePlatImage(resto, plat)` ; ses
 * notes sont recopiées depuis `pdj_entries` (colonnes `note_sportif`, `note_goulaf`, `note_date`,
 * `proteine` de `pdj_recettes`) pour que la banque puisse trier en SQL. Règles :
 * docs/poc-recettes-spec.md §2.
 *  - on ignore les jours fériés, les plats « coming soon », les noms vides après normalisation
 *    et les variantes sans aucune note ;
 *  - seuls comptent les jours déjà servis (`dateServie`) : un jour publié d'avance peut encore
 *    changer de menu, sa note fantôme bloquerait celles des vrais services ;
 *  - un plat servi plusieurs fois garde la note de sa date la plus récente ; à date égale, la
 *    dernière écriture gagne ;
 *  - la protéine (axe « envie » du quiz) est celle de la même variante, le même jour.
 */
import type { PdjEntry } from "./db";
import { noteMode } from "./carte-tri";
import { variantesPlat } from "./plat-options";
import { baseClePlatImage } from "./plat-image";
import { envieForPlat } from "./quiz-engine";
import { dateServie, recetteAttendue, type ProteineRecette, type RecetteContenu } from "./recettes";

export interface NotesVariante {
  base: string;
  restaurant: string;
  plat: string;
  date: string;
  sportif: number | null;
  goulaf: number | null;
  proteine: ProteineRecette;
}

/** Nombre fini entre 0 et 10, arrondi au dixième (corrige aussi l'imprécision des REAL) ; sinon null. */
export function noteValide(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Notes de chaque variante notée d'un jour déjà servi (`aujourdhui` par défaut : date de Paris) ;
 * un jour à venir ne donne rien. En cas de doublon de base, la première l'emporte.
 */
export function notesDuJour(pdj: PdjEntry, aujourdhui?: string): NotesVariante[] {
  if (!pdj || pdj.ferie) return [];
  const date = String(pdj.date).slice(0, 10);
  if (!dateServie(date, aujourdhui)) return [];
  const out = new Map<string, NotesVariante>();
  for (const plat of pdj.plats ?? []) {
    if (plat.coming_soon) continue;
    for (const v of variantesPlat(plat)) {
      if (!v.plat || !recetteAttendue(plat.restaurant, v.plat)) continue;
      const sportif = noteValide(noteMode(v, "sportif"));
      // En Goulaf, retombe sur la note Sportif (convention du site).
      const goulaf = noteValide(noteMode(v, "goulaf"));
      if (sportif == null && goulaf == null) continue;
      const base = baseClePlatImage(plat.restaurant, v.plat);
      if (out.has(base)) continue;
      const proteine = envieForPlat({
        plat: v.plat,
        restaurant: plat.restaurant,
        prix: plat.prix ?? "",
        quiz_tags: v.quiz_tags,
        ingredients_detail: v.ingredients_detail,
      });
      out.set(base, { base, restaurant: plat.restaurant, plat: v.plat, date, sportif, goulaf, proteine });
    }
  }
  return [...out.values()];
}

/** Une entrée par base : la date la plus récente, à égalité la dernière rencontrée. */
export function fusionnerNotes(listes: NotesVariante[]): NotesVariante[] {
  const out = new Map<string, NotesVariante>();
  for (const n of listes) {
    const deja = out.get(n.base);
    if (!deja || n.date >= deja.date) out.set(n.base, n);
  }
  return [...out.values()];
}

/** Base de cuisson (bouillon de volaille, fumet…) : ne dit rien de la protéine principale. */
const BASE_CUISSON = /^(bouillon|fond|fumet|jus|court-bouillon)\b/i;

/**
 * Repli quand aucun plat noté ne correspond : protéine déduite par mots-clés du plat et du titre ;
 * les ingrédients (hors bouillons et fonds) ne servent que si ces deux-là n'en nomment aucune
 * (« Bowl du jour »), sinon un « bouillon de volaille » ferait d'un paleron un plat de poulet.
 */
export function proteineDepuisRecette(
  restaurant: string,
  plat: string,
  r: Pick<RecetteContenu, "titre" | "ingredients">,
): ProteineRecette {
  const nommee = envieForPlat({ plat: `${plat} ${r.titre}`, restaurant, prix: "" });
  if (nommee !== "vege") return nommee;
  const ingredients = (r.ingredients ?? []).map((i) => i.nom).filter((nom) => !BASE_CUISSON.test(nom.trim()));
  return envieForPlat({ plat: [plat, r.titre, ...ingredients].join(" "), restaurant, prix: "" });
}
