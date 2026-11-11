/** Historique de tous les plats servis (/dilemme/plats) : paramètres d'URL, filtre, tri, pagination. Pur. */
import type { PlatCatalogue } from "./dilemme";
import { normPlatImage } from "./plat-image";
import { SLUG_TO_RESTAURANT } from "./restaurants";

export const PAR_PAGE = 24;
export type TriHistorique = "recents" | "victoires" | "servis" | "alpha";
const TRIS: TriHistorique[] = ["recents", "victoires", "servis", "alpha"];

export interface ParametresHistorique {
  q: string;
  /** Slug de `RESTAURANTS`, sinon null. */
  restaurant: string | null;
  tri: TriHistorique;
  photo: boolean;
  page: number;
}

type ParamsBruts = Record<string, string | string[] | undefined>;

const dernier = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[v.length - 1] : v);

export function parametresHistorique(sp: ParamsBruts): ParametresHistorique {
  const q = (dernier(sp.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  const slug = dernier(sp.restaurant);
  const restaurant = slug && Object.prototype.hasOwnProperty.call(SLUG_TO_RESTAURANT, slug) ? slug : null;
  const triBrut = dernier(sp.tri);
  const tri = TRIS.find((t) => t === triBrut) ?? "recents";
  const photo = ["1", "on", "true"].includes((dernier(sp.photo) ?? "").toLowerCase());
  const pageBrute = dernier(sp.page);
  const n = pageBrute && /^\d+$/.test(pageBrute.trim()) ? Number(pageBrute.trim()) : 1;
  const page = Number.isSafeInteger(n) && n >= 1 ? n : 1;
  return { q, restaurant, tri, photo, page };
}

/** URL de l'historique : seules les valeurs différentes du défaut sont écrites. */
export function hrefHistorique(p: ParametresHistorique, surcharge: Partial<ParametresHistorique> = {}): string {
  const m = { ...p, ...surcharge };
  const params = new URLSearchParams();
  if (m.q) params.set("q", m.q);
  if (m.restaurant) params.set("restaurant", m.restaurant);
  if (m.tri !== "recents") params.set("tri", m.tri);
  if (m.photo) params.set("photo", "1");
  if (m.page > 1) params.set("page", String(m.page));
  const qs = params.toString();
  return qs ? `/dilemme/plats?${qs}` : "/dilemme/plats";
}

export interface PlatHistorique extends PlatCatalogue {
  victoires: number;
  aImage: boolean;
}

const parCle = (x: PlatHistorique, y: PlatHistorique) => (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0);

const COMPARATEURS: Record<TriHistorique, (x: PlatHistorique, y: PlatHistorique) => number> = {
  recents: (x, y) => (x.derniere < y.derniere ? 1 : x.derniere > y.derniere ? -1 : 0),
  victoires: (x, y) => y.victoires - x.victoires || (x.derniere < y.derniere ? 1 : x.derniere > y.derniere ? -1 : 0),
  servis: (x, y) => y.nbServices - x.nbServices || (x.derniere < y.derniere ? 1 : x.derniere > y.derniere ? -1 : 0),
  alpha: (x, y) => x.nom.localeCompare(y.nom, "fr"),
};

export function filtrerHistorique(
  plats: PlatHistorique[],
  p: ParametresHistorique,
): { plats: PlatHistorique[]; total: number; page: number; pages: number } {
  const mots = normPlatImage(p.q).split(" ").filter(Boolean);
  const resto = p.restaurant ? SLUG_TO_RESTAURANT[p.restaurant] : null;
  const gardes = plats.filter((x) => {
    if (resto && x.restaurant !== resto) return false;
    if (p.photo && !x.aImage) return false;
    if (mots.length > 0) {
      const motsNom = normPlatImage(x.nom).split(" ");
      if (!mots.every((m) => motsNom.some((n) => n.startsWith(m)))) return false;
    }
    return true;
  });
  const cmp = COMPARATEURS[p.tri];
  gardes.sort((x, y) => cmp(x, y) || parCle(x, y));
  const total = gardes.length;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const page = Math.min(Math.max(1, p.page), pages);
  return { plats: gardes.slice((page - 1) * PAR_PAGE, page * PAR_PAGE), total, page, pages };
}
