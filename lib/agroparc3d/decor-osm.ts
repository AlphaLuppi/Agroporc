/**
 * Lecture tolérante de `public/agroparc/decor.json` (PUR) : un fichier absent, d'une autre version ou mal formé donne `undefined`, et le décor
 * se dessine avec les seules règles dérivées de `scene.json` (cf. decor-donnees.ts).
 */
import type { DecorOsm, Vec2 } from "./types";

const estPoint = (p: unknown): p is Vec2 => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const estListe = (l: unknown, min: number, point = true): boolean => Array.isArray(l) && l.length >= min && (!point || l.every(estPoint));

const POINTS = ["lampadaires", "passages", "stops", "cedez", "signaux", "bancs", "corbeilles", "velos", "portails"] as const;
const GENRES = new Set(["grass", "garden", "park", "meadow"]);

/** Valide le JSON de `decor.json` ; `undefined` s'il ne convient pas. */
export function lireDecor(json: unknown): DecorOsm | undefined {
  const d = json as Partial<DecorOsm> | null;
  if (!d || typeof d !== "object" || d.v !== 1) return undefined;
  for (const k of POINTS) if (!Array.isArray(d[k]) || !(d[k] as unknown[]).every(estPoint)) return undefined;
  if (!Array.isArray(d.pelouses) || !d.pelouses.every((p) => p && GENRES.has(p.k) && estListe(p.r, 3))) return undefined;
  for (const [k, min] of [["bois", 3], ["haies", 2], ["alignements", 2]] as const) {
    const l = d[k];
    if (!Array.isArray(l) || !l.every((x) => estListe(x, min))) return undefined;
  }
  return d as DecorOsm;
}
