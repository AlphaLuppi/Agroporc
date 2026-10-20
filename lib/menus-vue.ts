import type { PdjEntry, Plat, Recommandation } from "./db";
import { variantesPlat, type VariantePlat } from "./plat-options";
import { noteMode, type Mode } from "./carte-tri";
import { RESTAURANTS, type RestaurantDef } from "./restaurants";

/**
 * Données des vues Jour et Semaine de l'accueil. Un plat multi-options (Basilic n'Go, Dubble)
 * donne une entrée par option : chaque option a sa note et sa place dans le classement.
 */
export interface PlatAffiche {
  /** Position dans `pdj.plats` : clé des commentaires (`platIndex`). */
  platIndex: number;
  plat: Plat;
  variante: VariantePlat;
  note?: number;
  reco: boolean;
}

/** Recommandation du mode ; en Goulaf, retombe sur la reco sportive si absente. */
export function recoDuMode(pdj: PdjEntry | undefined, mode: Mode): Recommandation | undefined {
  if (!pdj) return undefined;
  return mode === "goulaf" ? pdj.recommandation_goulaf ?? pdj.recommandation : pdj.recommandation;
}

/** Plats notés du jour (hors « coming soon ») : la reco du mode en tête, puis par note décroissante. */
export function platsAffiches(pdj: PdjEntry | undefined, mode: Mode): PlatAffiche[] {
  if (!pdj) return [];
  const reco = recoDuMode(pdj, mode);
  const liste: PlatAffiche[] = [];
  pdj.plats.forEach((plat, platIndex) => {
    if (plat.coming_soon) return;
    for (const variante of variantesPlat(plat)) {
      liste.push({
        platIndex,
        plat,
        variante,
        note: noteMode(variante, mode),
        reco: !!reco && reco.restaurant === plat.restaurant && reco.plat === variante.plat,
      });
    }
  });
  // sort est stable : à égalité, l'ordre du pipeline est conservé.
  return liste.sort((a, b) => Number(b.reco) - Number(a.reco) || (b.note ?? -1) - (a.note ?? -1));
}

/** Plats annoncés mais pas encore dévoilés. */
export function platsAVenir(pdj: PdjEntry | undefined): Plat[] {
  return pdj?.plats.filter((p) => p.coming_soon) ?? [];
}

/** Restaurants suivis qui n'ont aucune entrée ce jour-là (dans l'ordre de `RESTAURANTS`). */
export function restosSansPlat(pdj: PdjEntry | undefined): RestaurantDef[] {
  return RESTAURANTS.filter((r) => !pdj?.plats.some((p) => p.restaurant === r.nom));
}

/** Meilleure note du jour pour un mode, undefined si rien n'est noté. */
export function meilleureNoteDuJour(pdj: PdjEntry | undefined, mode: Mode): number | undefined {
  const notes = platsAffiches(pdj, mode)
    .map((p) => p.note)
    .filter((n): n is number => typeof n === "number");
  return notes.length > 0 ? Math.max(...notes) : undefined;
}

export interface LigneSemaine {
  resto: RestaurantDef;
  /** Une case par jour : les plats du resto ce jour-là, par note décroissante. */
  cases: PlatAffiche[][];
}

/**
 * Grille restaurants × jours de la vue Semaine. Les restos sans scraping (Vival) et ceux
 * qui n'ont publié aucun plat de la semaine sont écartés (voir `restosAbsentsSemaine`).
 */
export function grilleSemaine(semaine: PdjEntry[], mode: Mode): LigneSemaine[] {
  const parJour = semaine.map((pdj) => platsAffiches(pdj, mode));
  return RESTAURANTS.filter((r) => r.type !== "lien")
    .map((resto) => ({
      resto,
      cases: parJour.map((plats) =>
        plats.filter((p) => p.plat.restaurant === resto.nom).sort((a, b) => (b.note ?? -1) - (a.note ?? -1)),
      ),
    }))
    .filter((ligne) => ligne.cases.some((c) => c.length > 0));
}

/** Restos scrapés qui n'ont publié aucun plat de la semaine. */
export function restosAbsentsSemaine(semaine: PdjEntry[]): RestaurantDef[] {
  return RESTAURANTS.filter(
    (r) => r.type !== "lien" && !semaine.some((pdj) => pdj.plats.some((p) => p.restaurant === r.nom && !p.coming_soon)),
  );
}

/**
 * Nom de plat lisible : espaces normalisés, point final retiré, et casse de phrase quand le
 * resto écrit tout en majuscules (« CORDON BLEU COMTÉ » → « Cordon bleu comté »).
 */
export function casseLisible(nom: string): string {
  let t = nom.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim().replace(/\s*\.$/, "");
  const lettres = t.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  if (lettres.length > 3 && lettres === lettres.toUpperCase()) {
    t = t.toLowerCase();
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export interface MacroTuile {
  cle: "proteines" | "glucides" | "lipides";
  grammes: number;
  /** Libellé court affiché sous la valeur (« prot. »). */
  court: string;
  /** Libellé complet (infobulle). */
  long: string;
}

/** Protéines / glucides / lipides arrondis au gramme pour une tuile ; `null` si une valeur manque. */
export function macrosTuile(n: Plat["nutrition_estimee"] | undefined): MacroTuile[] | null {
  if (!n) return null;
  const valeurs = [n.proteines_g, n.glucides_g, n.lipides_g];
  if (valeurs.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  return [
    { cle: "proteines", grammes: Math.round(n.proteines_g), court: "prot.", long: "Protéines" },
    { cle: "glucides", grammes: Math.round(n.glucides_g), court: "gluc.", long: "Glucides" },
    { cle: "lipides", grammes: Math.round(n.lipides_g), court: "lip.", long: "Lipides" },
  ];
}

/** Au-delà, un nom est trop long pour une demi-tuile sur mobile : la tuile passe en pleine largeur. */
export const NOM_LONG = 46;

/**
 * Index de la tuile qui resterait seule sur sa ligne dans la grille mobile à 2 colonnes (nombre impair de
 * demi-tuiles) : elle passe en pleine largeur au lieu de laisser une demi-ligne vide. La grille est en `dense`,
 * donc l'orpheline est la dernière demi-tuile dans l'ordre. -1 s'il n'y en a pas. Sans effet à 3 colonnes.
 */
export function indexOrpheline(tuiles: { variante: { plat: string } }[]): number {
  const demi = tuiles.flatMap((p, i) => (casseLisible(p.variante.plat).length > NOM_LONG ? [] : [i]));
  return demi.length % 2 === 1 ? demi[demi.length - 1] : -1;
}
