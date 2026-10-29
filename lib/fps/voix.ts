/**
 * Chat vocal de proximité de l'arène (PUR, v3 §5) : on entend les joueurs proches, de moins en moins fort jusqu'à `VOIX.distanceMax`,
 * placés à gauche ou à droite selon leur position. Ce module décide QUI se connecte à qui et À QUEL VOLUME ; la mécanique WebRTC et
 * WebAudio est dans `voix-rtc.ts`. Réglages (activée, mode) gardés dans le navigateur (`pdj-fps-voix`, stockage injecté).
 * Battle Royale : proximité entre joueurs en vie (les plus proches seulement, `ciblesVoixBr`), canal à part entre spectateurs (éliminés et
 * spectateurs venus regarder) que les joueurs en vie n'entendent jamais (`relaiVoixBr`, appliqué par le serveur).
 * Spec : docs/superpowers/specs/2026-10-23-arene-v3-design.md (§5), 2026-10-29-br-voix-parties-design.md
 */
import type { JoueurPublic, SignalVoix, Vec3 } from "./protocole";
import type { Stockage } from "./touches";

export const VOIX = {
  /** volume plein jusqu'à cette distance (m) */
  distancePleine: 8,
  /** muet au-delà (m) : on s'entend d'un bâtiment à l'autre, pas d'un bout à l'autre de la carte (45 m avant le 2026-10-29 : trop court) */
  distanceMax: 75,
  /** courbe de la décroissance (> 1 : on entend surtout les voisins ; 1,6 avant le 2026-10-29, on n'entendait plus rien passé 25 m) */
  courbe: 1.3,
  /** un joueur mort s'entend moins (il commente sa mort sans couvrir les vivants) */
  facteurMort: 0.5,
  /** niveau RMS (0..1) au-delà duquel un joueur « parle » (indicateur du HUD) */
  seuilParole: 0.02,
  /** (BR) on appelle les joueurs en vie à moins de cette distance (m) : la connexion est prête avant qu'on commence à s'entendre */
  connexionBrM: 85,
  /** (BR) une connexion établie tient jusqu'à cette distance (m) : pas de connexion qui clignote à la limite */
  deconnexionBrM: 110,
  /** (BR) voisins en vie appelés au plus, les plus proches (50 joueurs en maillage feraient 1 225 connexions) */
  voisinsMaxBr: 8,
  /** (BR) spectateurs appelés au plus (ordre des identifiants) ; un appel d'un autre spectateur est toujours accepté */
  spectateursMaxBr: 12,
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
 * (la killcam, puis le temps d'échanger un « bien joué »). En Battle Royale, c'est la seule exception au canal séparé des spectateurs.
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

/**
 * Ce qu'il faut ouvrir (en appelant si c'est à moi) et fermer pour passer des connexions `actuelles` aux `voulues`. `admises` (défaut : les
 * voulues) : connexions gardées même si je ne les aurais pas appelées (Battle Royale : un correspondant un peu plus loin que mes plus proches).
 */
export function planConnexions(
  moi: string, actuelles: Iterable<string>, voulues: readonly string[], admises: readonly string[] = voulues,
): { appeler: string[]; fermer: string[] } {
  const a = new Set(actuelles), g = new Set([...voulues, ...admises]);
  return {
    appeler: voulues.filter((id) => !a.has(id) && doitAppeler(moi, id)),
    fermer: [...a].filter((id) => !g.has(id)),
  };
}

/** Connexions voulues (j'appelle celles où c'est à moi) et admises (gardées si l'autre m'appelle), triées. */
export interface CiblesVoix { voulus: string[]; admis: string[] }

/** Un participant du Battle Royale vu par le chat vocal. */
export interface ParticipantVoixBr {
  id: string;
  /** voix activée (présence) */
  voix: boolean;
  /** en jeu sans être en vie : éliminé, ou spectateur venu regarder la partie */
  spectateur: boolean;
  /** position de la tête (snap interpolé) ; null si inconnue (à bord de l'avion, sorti du snap) */
  p: Vec3 | null;
}

/**
 * (BR) Avec qui ouvrir le chat vocal. Spectateur : les autres spectateurs (les `spectateursMaxBr` premiers par identifiant appelés, tous
 * admis), à plein volume, jamais un joueur en vie. En vie : les joueurs en vie les plus proches (`voisinsMaxBr` au plus, à moins de
 * `connexionBrM`, ou `deconnexionBrM` pour une connexion déjà établie : `connectes`), jamais un spectateur. Les liens de killcam (`liens`)
 * passent outre les deux règles. Rien si ma voix est coupée ; seuls les participants qui ont activé la voix comptent.
 */
export function ciblesVoixBr(
  moi: ParticipantVoixBr, autres: readonly ParticipantVoixBr[], liens: readonly string[], connectes: ReadonlySet<string> = new Set(),
): CiblesVoix {
  if (!moi.voix) return { voulus: [], admis: [] };
  const avecVoix = autres.filter((o) => o.id !== moi.id && o.voix);
  const ids = new Set(avecVoix.map((o) => o.id));
  const lies = liens.filter((id) => ids.has(id));
  const trier = (l: Iterable<string>) => [...new Set(l)].sort();
  if (moi.spectateur) {
    const specs = avecVoix.filter((o) => o.spectateur).map((o) => o.id).sort();
    return { voulus: trier([...lies, ...specs.slice(0, VOIX.spectateursMaxBr)]), admis: trier([...lies, ...specs]) };
  }
  const p = moi.p;
  if (!p) return { voulus: trier(lies), admis: trier(lies) };
  const proches = avecVoix
    .filter((o): o is ParticipantVoixBr & { p: Vec3 } => !o.spectateur && o.p !== null)
    .map((o) => ({ id: o.id, d: Math.hypot(o.p[0] - p[0], o.p[1] - p[1], o.p[2] - p[2]) }))
    .filter((o) => o.d <= VOIX.deconnexionBrM);
  const appeles = proches
    .filter((o) => o.d <= (connectes.has(o.id) ? VOIX.deconnexionBrM : VOIX.connexionBrM))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
    .slice(0, VOIX.voisinsMaxBr)
    .map((o) => o.id);
  return { voulus: trier([...lies, ...appeles]), admis: trier([...lies, ...proches.map((o) => o.id)]) };
}

/**
 * (BR, serveur) Un signal du chat vocal passe-t-il entre ces deux joueurs ? Seulement entre deux joueurs en jeu de la même catégorie : deux
 * joueurs en vie, ou deux spectateurs (éliminés, venus regarder). Un joueur en vie n'entend donc jamais un spectateur, sauf le lien de
 * killcam (`lien` : une victime et son tueur, `LIEN_VOIX_KILLCAM_MS`).
 */
export function relaiVoixBr(a: { enJeu: boolean; vivant: boolean }, b: { enJeu: boolean; vivant: boolean }, lien: boolean): boolean {
  if (!a.enJeu || !b.enJeu) return false;
  return lien || a.vivant === b.vivant;
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
