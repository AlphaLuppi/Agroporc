import type { Plat, PlatOption } from "./db";
import { noteMode, type Mode } from "./carte-tri";

/**
 * Variante affichable d'un plat du jour : le plat lui-même quand il est unique, ou chacune
 * de ses options quand le resto en propose plusieurs (Basilic n'Go, Dubble). Le resto et le
 * prix restent portés par le `Plat` parent.
 */
export interface VariantePlat extends Omit<PlatOption, "plat"> {
  plat: string;
}

function nomsPlat(plat: Plat): string[] {
  return Array.isArray(plat.plat) ? plat.plat : [plat.plat];
}

/**
 * Éclate un plat en variantes notées. Un plat multi-options porte ses notes dans `options`
 * (une par option, la racine restant vide) : sans ce passage, la carte affiche « ? ».
 */
export function variantesPlat(plat: Plat): VariantePlat[] {
  const noms = nomsPlat(plat);
  const options = plat.options;
  if (Array.isArray(options) && options.length > 0) {
    return options.map((o, i) => ({ ...o, plat: o.plat || noms[i] || noms[0] || "" }));
  }
  if (noms.length > 1) {
    return noms.map((nom) => ({ plat: nom }));
  }
  const { restaurant: _r, prix: _p, commentaires: _c, coming_soon: _cs, options: _o, ...reste } = plat;
  return [{ ...reste, plat: noms[0] ?? "" }];
}

/** Nom lisible d'un plat : les options jointes par « ou ». */
export function libellePlat(plat: Plat): string {
  return nomsPlat(plat).join(" ou ");
}

export function estMultiOptions(plat: Plat): boolean {
  return variantesPlat(plat).length > 1;
}

/** Meilleure note d'un plat pour un mode (max sur ses options), undefined si rien n'est noté. */
export function meilleureNote(plat: Plat, mode: Mode): number | undefined {
  const notes = variantesPlat(plat)
    .map((v) => noteMode(v, mode))
    .filter((n): n is number => typeof n === "number");
  return notes.length > 0 ? Math.max(...notes) : undefined;
}
