/**
 * Images IA des plats (POC) — logique pure, utilisable côté client.
 *
 * Une image par variante de plat (`variantesPlat`), identifiée par une clé calculée À
 * L'IDENTIQUE par le pipeline Python (`plats-du-jour/plat_image.py`) ; vecteurs partagés
 * dans `lib/plat-image-vecteurs.json` :
 *   base = norm(restaurant) + "|" + norm(plat)
 *   norm = NFKD → sans diacritiques → minuscules → œ/æ/ß/ø → [^a-z0-9]+ → " " → trim
 *   cle  = sha256(base).hex[:24]   (calcul serveur : `lib/plat-image-cle.ts`)
 * Le client ne hache rien : la page lui passe `ImagesPlats` (base → URL + crédit) pour les
 * seules images existantes.
 */

export const CLE_IMAGE_RE = /^[0-9a-f]{24}$/;

/** Image d'une variante : URL versionnée et crédit à afficher (fournisseur gratuit). */
export interface ImagePlat {
  src: string;
  credit?: string;
}

/** base → image (`/api/plat-image/<cle>?v=…`), pour les images en base uniquement. */
export type ImagesPlats = Record<string, ImagePlat>;

/** Crédit exigé par le fournisseur (Pollinations anonyme : logo + attribution). */
export function creditFournisseur(fournisseur?: string | null): string | undefined {
  return fournisseur === "pollinations" ? "pollinations.ai" : undefined;
}

/** `?v=` → version (ms) ; null si absent ou invalide. Inverse de `srcPlatImage`. */
export function versionDepuisParam(v: string | null): number | null {
  if (v === null || !/^[0-9a-z]{1,12}$/.test(v)) return null;
  const n = parseInt(v, 36);
  return Number.isSafeInteger(n) ? n : null;
}

export function paramVersion(ms: number): string {
  return ms.toString(36);
}

/** Lettres que NFKD ne décompose pas (même table en Python). */
const LIGATURES: Record<string, string> = { "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o" };

export function normPlatImage(s: string): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[œæßø]/g, (c) => LIGATURES[c])
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function baseClePlatImage(restaurant: string, plat: string): string {
  return `${normPlatImage(restaurant)}|${normPlatImage(plat)}`;
}

/** URL servie ; `v` (date de création) change si l'image est régénérée → cache immuable sûr. */
export function srcPlatImage(cle: string, creeLe?: Date | string | null): string {
  const t = creeLe ? new Date(creeLe).getTime() : NaN;
  return Number.isFinite(t) ? `/api/plat-image/${cle}?v=${paramVersion(t)}` : `/api/plat-image/${cle}`;
}

export function imageDuPlat(images: ImagesPlats | undefined, restaurant: string, plat: string): ImagePlat | undefined {
  return images?.[baseClePlatImage(restaurant, plat)];
}

const SIGNATURES: [string, number[], number][] = [
  ["image/jpeg", [0xff, 0xd8, 0xff], 0],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0],
];

/** Type d'image d'après les magic bytes (jpeg/png/webp), sinon null. */
export function typeImage(octets: Uint8Array): string | null {
  for (const [type, sig, debut] of SIGNATURES) {
    if (octets.length >= debut + sig.length && sig.every((b, i) => octets[debut + i] === b)) return type;
  }
  const ascii = (a: number, b: number) => String.fromCharCode(...octets.slice(a, b));
  if (octets.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
