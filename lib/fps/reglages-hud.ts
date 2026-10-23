/**
 * Réglages du HUD et de la mini-map (PUR) : lecture, validation et écriture de `localStorage` `pdj-fps-minimap` et `pdj-fps-hud`
 * (JSON versionné, toujours dans try/catch, valeur hors liste / version inconnue / JSON illisible → défauts sûrs, sans erreur).
 * `orientation` absent = « décidé par prefers-reduced-motion » (alors « nord »). Stockage injecté.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§4.5)
 *
 */

/** Coin de la mini-map : haut-gauche (défaut), haut-droite, bas-gauche, bas-droite, ou masquée. */
export type CoinMinimap = "hg" | "hd" | "bg" | "bd" | "off";
export const COINS_MINIMAP: readonly CoinMinimap[] = ["hg", "hd", "bg", "bd", "off"];
export type TailleMinimap = "s" | "m" | "l";
export const TAILLES_MINIMAP: readonly TailleMinimap[] = ["s", "m", "l"];
/** « regard » : la carte tourne avec la vue ; « nord » : nord en haut. */
export type OrientationMinimap = "regard" | "nord";
/** Demi-largeur de la carte, en mètres. */
export type RayonMinimap = 60 | 100 | 160;
export const RAYONS_MINIMAP: readonly RayonMinimap[] = [60, 100, 160];

/** Clé `pdj-fps-minimap` : `{ "v": 1, "coin": "hg", "taille": "m", "orientation": "regard", "rayon": 100 }`. */
export interface ReglagesMinimap {
  v: 1;
  coin: CoinMinimap;
  taille: TailleMinimap;
  /** absent = décidé par prefers-reduced-motion */
  orientation?: OrientationMinimap;
  rayon: RayonMinimap;
}
/** Clé `pdj-fps-hud` : `{ "v": 1, "echelle": 1, "effets": "auto" }`. */
export type EchelleHud = 0.9 | 1 | 1.15;
export const ECHELLES_HUD: readonly EchelleHud[] = [0.9, 1, 1.15];
export type EffetsHud = "auto" | "reduits";
export interface ReglagesInterface { v: 1; echelle: EchelleHud; effets: EffetsHud }

/** Réglages du HUD tels que les passe l'hôte (`PropsHudArene.reglagesHud`). */
export interface ReglagesHud { minimap: ReglagesMinimap; interface: ReglagesInterface }

export const CLE_MINIMAP = "pdj-fps-minimap";
export const CLE_HUD = "pdj-fps-hud";
export const REGLAGES_MINIMAP_DEFAUT: ReglagesMinimap = { v: 1, coin: "hg", taille: "m", rayon: 100 };
export const REGLAGES_INTERFACE_DEFAUT: ReglagesInterface = { v: 1, echelle: 1, effets: "auto" };
export const REGLAGES_HUD_DEFAUT: ReglagesHud = { minimap: REGLAGES_MINIMAP_DEFAUT, interface: REGLAGES_INTERFACE_DEFAUT };

/** Stockage minimal injectable (lecture). */
export interface LecteurStockage { getItem(k: string): string | null }
/** Stockage minimal injectable (écriture). */
export interface EcrivainStockage { setItem(k: string, v: string): void }

/** Libellés des coins (sélecteur, toast de l'action « coin suivant », `aria-label`). */
export const LIBELLES_COINS: Record<CoinMinimap, string> = {
  hg: "Haut-gauche", hd: "Haut-droite", bg: "Bas-gauche", bd: "Bas-droite", off: "Masquée",
};
/** Côté de la mini-map (en u) par taille (HUD §4.1). */
export const TAILLE_MINIMAP_U: Record<TailleMinimap, number> = { s: 208, m: 264, l: 320 };

/** Coin suivant de l'action rebindable `minimapCoin` : haut-gauche → haut-droite → bas-droite → bas-gauche → masquée → haut-gauche. */
const ORDRE_ROTATION: readonly CoinMinimap[] = ["hg", "hd", "bd", "bg", "off"];
export function coinSuivant(c: CoinMinimap): CoinMinimap {
  const i = ORDRE_ROTATION.indexOf(c);
  return ORDRE_ROTATION[(i + 1) % ORDRE_ROTATION.length];
}

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const dans = <T>(liste: readonly T[], v: unknown): v is T => (liste as readonly unknown[]).includes(v);

/** Valide un objet lu du stockage : version inconnue ou forme illisible → défauts ; champ hors liste → défaut de ce champ seulement. */
export function validerReglagesMinimap(brut: unknown): ReglagesMinimap {
  const d = REGLAGES_MINIMAP_DEFAUT;
  if (!estObjet(brut) || brut.v !== 1) return { ...d };
  const r: ReglagesMinimap = {
    v: 1,
    coin: dans(COINS_MINIMAP, brut.coin) ? brut.coin : d.coin,
    taille: dans(TAILLES_MINIMAP, brut.taille) ? brut.taille : d.taille,
    rayon: dans(RAYONS_MINIMAP, brut.rayon) ? brut.rayon : d.rayon,
  };
  // `orientation` absent (ou hors liste) = « décidé par prefers-reduced-motion » : la clé reste absente
  if (brut.orientation === "regard" || brut.orientation === "nord") r.orientation = brut.orientation;
  return r;
}

export function validerReglagesInterface(brut: unknown): ReglagesInterface {
  const d = REGLAGES_INTERFACE_DEFAUT;
  if (!estObjet(brut) || brut.v !== 1) return { ...d };
  return {
    v: 1,
    echelle: dans(ECHELLES_HUD, brut.echelle) ? brut.echelle : d.echelle,
    effets: brut.effets === "auto" || brut.effets === "reduits" ? brut.effets : d.effets,
  };
}

/** `localStorage` du navigateur s'il est utilisable (rendu serveur, navigation privée stricte : null). */
function stockageNavigateur(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function lireJson(stockage: LecteurStockage | null, cle: string): unknown {
  if (!stockage) return null;
  try {
    const brut = stockage.getItem(cle);
    return brut === null ? null : JSON.parse(brut);
  } catch {
    return null;
  }
}

/** Lit les deux clés (défauts sûrs si absentes, illisibles ou si le stockage lève). `stockage` omis = `localStorage` ; `null` = aucun. */
export function lireReglagesHud(stockage?: LecteurStockage | null): ReglagesHud {
  const s = stockage === undefined ? stockageNavigateur() : stockage;
  return {
    minimap: validerReglagesMinimap(lireJson(s, CLE_MINIMAP)),
    interface: validerReglagesInterface(lireJson(s, CLE_HUD)),
  };
}

/** Écrit les deux clés (normalisées) ; faux si le stockage est indisponible ou lève. */
export function ecrireReglagesHud(r: ReglagesHud, stockage?: EcrivainStockage | null): boolean {
  const s = stockage === undefined ? stockageNavigateur() : stockage;
  if (!s) return false;
  try {
    s.setItem(CLE_MINIMAP, JSON.stringify(validerReglagesMinimap(r.minimap)));
    s.setItem(CLE_HUD, JSON.stringify(validerReglagesInterface(r.interface)));
    return true;
  } catch {
    return false;
  }
}

/** Orientation effective : celle du joueur, sinon « nord » si prefers-reduced-motion, sinon « regard ». */
export function orientationEffective(r: ReglagesMinimap, mouvementReduit: boolean): OrientationMinimap {
  return r.orientation ?? (mouvementReduit ? "nord" : "regard");
}

/**
 * Attributs à poser sur la racine du HUD (`.hud`) : `data-effets` (les règles « effets réduits » du CSS) et `--echelle-hud`
 * (multiplicateur de `--u`, HUD §1.2).
 */
export function attributsHud(r: ReglagesHud): { "data-effets": EffetsHud; style: { "--echelle-hud": number } } {
  return { "data-effets": r.interface.effets, style: { "--echelle-hud": r.interface.echelle } };
}
