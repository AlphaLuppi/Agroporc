/**
 * Chat vocal de proximité de l'arène (PUR, v3 §5) : on entend les joueurs proches, de moins en moins fort jusqu'à `VOIX.distanceMax`,
 * placés à gauche ou à droite selon leur position. Ce module décide QUI se connecte à qui et À QUEL VOLUME ; la mécanique WebRTC et
 * WebAudio est dans `voix-rtc.ts`. Réglages (activée, mode) gardés dans le navigateur (`pdj-fps-voix`, stockage injecté).
 * Spec : docs/superpowers/specs/2026-10-23-arene-v3-design.md (§5)
 */
import type { JoueurPublic, SignalVoix } from "./protocole";
import type { Stockage } from "./touches";

export const VOIX = {
  /** volume plein jusqu'à cette distance (m) */
  distancePleine: 4,
  /** muet au-delà (m) : un peu moins que la portée d'un pistolet, on ne s'entend pas d'un bout à l'autre de l'arène */
  distanceMax: 45,
  /** courbe de la décroissance (> 1 : on entend surtout les voisins) */
  courbe: 1.6,
  /** un joueur mort s'entend moins (il commente sa mort sans couvrir les vivants) */
  facteurMort: 0.5,
  /** niveau RMS (0..1) au-delà duquel un joueur « parle » (indicateur du HUD) */
  seuilParole: 0.02,
} as const;

export type ModeVoix = "appuyer" | "ouvert";
export interface ReglagesVoix { actif: boolean; mode: ModeVoix }
export const CLE_VOIX = "pdj-fps-voix";
export const REGLAGES_VOIX_DEFAUT: ReglagesVoix = { actif: false, mode: "appuyer" };

/** Volume (0..1) d'un joueur à `distance` m. */
export function gainVoix(distance: number, vivant = true): number {
  const { distancePleine, distanceMax, courbe, facteurMort } = VOIX;
  if (!(distance >= 0)) return 0;
  let g = 1;
  if (distance >= distanceMax) g = 0;
  else if (distance > distancePleine) g = Math.pow(1 - (distance - distancePleine) / (distanceMax - distancePleine), courbe);
  return vivant ? g : g * facteurMort;
}

/**
 * Lien vocal de killcam : une victime et son tueur s'entendent à plein volume, quelle que soit la distance, pendant ce délai après la mort
 * (la killcam, puis le temps d'échanger un « bien joué »). En Battle Royale, c'est le seul chat vocal (le serveur ne relaie que ces paires).
 */
export const LIEN_VOIX_KILLCAM_MS = 12_000;

/** Clé d'un lien vocal, la même dans les deux sens. */
export function cleLienVoix(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Liens vocaux de killcam en cours, côté client : `id` → fin (horloge locale, ms). Un `mort` dont je suis la victime ou le tueur en ouvre
 * un ; `actifs(t)` donne les correspondants dont le lien court encore.
 */
export class LiensVoixKillcam {
  private readonly liens = new Map<string, number>();

  /** Un `mort` reçu : lien ouvert si je suis la victime (avec le tueur) ou le tueur (avec la victime). Vrai si un lien s'ouvre. */
  surMort(moi: string | null, cible: string, par: string, t: number): boolean {
    if (!moi || !par || par === cible) return false;
    const autre = cible === moi ? par : par === moi ? cible : null;
    if (!autre) return false;
    this.liens.set(autre, t + LIEN_VOIX_KILLCAM_MS);
    return true;
  }

  /** Correspondants liés à l'instant `t` (triés), liens échus oubliés. */
  actifs(t: number): string[] {
    for (const [id, fin] of this.liens) if (fin <= t) this.liens.delete(id);
    return [...this.liens.keys()].sort();
  }

  vider(): void {
    this.liens.clear();
  }
}

/** Des deux joueurs, celui à l'identifiant le plus petit fait l'offre : jamais deux offres croisées. */
export function doitAppeler(moi: string, autre: string): boolean {
  return moi < autre;
}

/**
 * Joueurs avec qui ouvrir une connexion : en arène, voix activée, autres que moi ; aucun si je ne suis pas moi-même en arène avec la voix.
 * `seulement` (Battle Royale) : restreint aux correspondants d'un lien de killcam.
 */
export function correspondants(moi: string | null, joueurs: readonly JoueurPublic[], seulement?: ReadonlySet<string> | null): string[] {
  if (!moi) return [];
  const m = joueurs.find((j) => j.id === moi);
  if (!m || !m.enJeu || !m.voix) return [];
  return joueurs.filter((j) => j.id !== moi && j.enJeu && j.voix && (!seulement || seulement.has(j.id))).map((j) => j.id).sort();
}

/** Ce qu'il faut ouvrir (en appelant si c'est à moi) et fermer pour passer des connexions `actuelles` aux `voulues`. */
export function planConnexions(moi: string, actuelles: Iterable<string>, voulues: readonly string[]): { appeler: string[]; fermer: string[] } {
  const a = new Set(actuelles), v = new Set(voulues);
  return {
    appeler: voulues.filter((id) => !a.has(id) && doitAppeler(moi, id)),
    fermer: [...a].filter((id) => !v.has(id)),
  };
}

/** Le micro émet-il ? Mode « ouvert » : toujours ; « appuyer » : seulement touche tenue. */
export function microOuvert(mode: ModeVoix, toucheTenue: boolean): boolean {
  return mode === "ouvert" || toucheTenue;
}

/** Forme d'un signal reçu (même règle que le serveur). */
export function signalValide(s: unknown): s is SignalVoix {
  if (!s || typeof s !== "object") return false;
  const x = s as { type?: unknown; sdp?: unknown };
  if (x.type === "fin") return true;
  return (x.type === "offre" || x.type === "reponse") && typeof x.sdp === "string" && x.sdp.length > 0;
}

export function lireReglagesVoix(stockage?: Stockage | null): ReglagesVoix {
  try {
    const brut = stockage?.getItem(CLE_VOIX);
    if (!brut) return { ...REGLAGES_VOIX_DEFAUT };
    const o = JSON.parse(brut) as Partial<ReglagesVoix>;
    return { actif: o.actif === true, mode: o.mode === "ouvert" ? "ouvert" : "appuyer" };
  } catch {
    return { ...REGLAGES_VOIX_DEFAUT };
  }
}

export function ecrireReglagesVoix(r: ReglagesVoix, stockage?: Stockage | null): void {
  try {
    stockage?.setItem(CLE_VOIX, JSON.stringify({ actif: r.actif, mode: r.mode }));
  } catch { /* stockage indisponible : réglage pour la session seulement */ }
}
