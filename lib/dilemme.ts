/**
 * Dilemme du jour — logique PURE (client et serveur) : catalogue des plats servis, tirage
 * déterministe du duel, décomptes, classement, validation d'un vote.
 * Aucun `node:crypto`, aucun accès base (types seulement), aucun React, aucun `Math.random`.
 * La clé d'un plat (`clePlatImage`, qui hache) est INJECTÉE dans `construireCatalogue`.
 */
import type { DuelAvecVoix, LigneHistorique, Plat } from "./db";
import { baseClePlatImage, normPlatImage } from "./plat-image";
import { variantesPlat } from "./plat-options";
import { casseLisible } from "./menus-vue";
import { canoniserVotant } from "./votant";

export type Cote = "a" | "b";

// --- Catalogue des plats servis ---------------------------------------------------------

export interface PlatCatalogue {
  cle: string;
  base: string;
  restaurant: string;
  /** `casseLisible` du dernier libellé vu. */
  nom: string;
  /** Dates de service uniques, ordre croissant. */
  dates: string[];
  premiere: string;
  derniere: string;
  nbServices: number;
  /** Dernier prix non vide. */
  prix: string | null;
  /** Dernière occurrence notée. */
  noteSportif: number | null;
  noteGoulaf: number | null;
}

/**
 * Libellés qui ne sont QUE des messages (restaurant fermé, pas de plat…), testés sur le nom
 * normalisé (sans accents : « Fermé » et le nom commun « ferme » s'écrivent pareil, d'où l'ancrage
 * au début du libellé). « Poulet de ferme » ou « Œufs de la ferme » sont de vrais plats.
 */
const NOMS_EXCLUS: RegExp[] = [
  // « Fermé », « Restaurant fermé », « Fermé pour congés », « Fermé (jour férié) », « Fermé exceptionnellement »…
  /^(?:(?:le )?restaurant |resto )?ferm(?:e|ee)(?: (?:exceptionnellement|temporairement|definitivement|pour|jour|aujourd hui|ce jour|cette semaine|toute|jusqu|le|du|les|en)\b.*)?$/,
  /^(?:en )?conges\b/,
  /^pas de plat\b/,
  /^(?:plat |menu )?indisponible$/,
  /^bientot\b/,
  /^(?:plat |menu )?a venir$/,
];

/** Vrai pour un libellé qui n'est pas un plat (`norm` = `normPlatImage` du libellé). */
export function estFauxPlat(norm: string): boolean {
  return NOMS_EXCLUS.some((re) => re.test(norm));
}

const nombre = (n: unknown): number | undefined => (typeof n === "number" && Number.isFinite(n) ? n : undefined);

/** Reconstruit un `Plat` depuis une ligne légère de l'historique (nulls SQL → champs absents). */
function platDepuisLigne(l: LigneHistorique): Plat {
  const options = Array.isArray(l.options) && l.options.length > 0
    ? l.options.map((o) => ({
        ...(o.plat ? { plat: o.plat } : {}),
        ...(nombre(o.note) !== undefined ? { note: nombre(o.note) } : {}),
        ...(nombre(o.note_goulaf) !== undefined ? { note_goulaf: nombre(o.note_goulaf) } : {}),
      }))
    : undefined;
  return {
    restaurant: l.restaurant,
    plat: l.plat ?? "",
    prix: l.prix ?? "",
    ...(nombre(l.note) !== undefined ? { note: nombre(l.note) } : {}),
    ...(nombre(l.note_goulaf) !== undefined ? { note_goulaf: nombre(l.note_goulaf) } : {}),
    ...(options ? { options } : {}),
  };
}

/**
 * Un plat par variante servie (`variantesPlat` : options de Basilic n'Go / Dubble éclatées),
 * regroupé par base de clé. Les jours publiés d'avance (> aujourd'hui) et les faux plats
 * (« fermé », « congés »…) sont écartés. Tri : dernier service décroissant, puis nom.
 */
export function construireCatalogue(
  lignes: LigneHistorique[],
  cle: (restaurant: string, plat: string) => string,
  aujourdhui: string,
): PlatCatalogue[] {
  const triees = lignes
    .map((l, i) => ({ l, i }))
    .sort((x, y) => (x.l.date < y.l.date ? -1 : x.l.date > y.l.date ? 1 : x.i - y.i))
    .map((x) => x.l);

  const groupes = new Map<string, PlatCatalogue>();
  for (const ligne of triees) {
    if (ligne.date > aujourdhui) continue;
    for (const v of variantesPlat(platDepuisLigne(ligne))) {
      const brut = (v.plat ?? "").trim();
      const norm = normPlatImage(brut);
      if (!brut || norm.length < 3 || estFauxPlat(norm)) continue;
      const base = baseClePlatImage(ligne.restaurant, brut);
      let p = groupes.get(base);
      if (!p) {
        p = {
          cle: cle(ligne.restaurant, brut), base, restaurant: ligne.restaurant, nom: "",
          dates: [], premiere: ligne.date, derniere: ligne.date, nbServices: 0,
          prix: null, noteSportif: null, noteGoulaf: null,
        };
        groupes.set(base, p);
      }
      p.nom = casseLisible(brut);
      if (!p.dates.includes(ligne.date)) p.dates.push(ligne.date);
      const prix = (ligne.prix ?? "").trim();
      if (prix) p.prix = prix;
      const ns = nombre(v.note);
      if (ns !== undefined) p.noteSportif = ns;
      const ng = nombre(v.note_goulaf);
      if (ng !== undefined) p.noteGoulaf = ng;
    }
  }
  const out = [...groupes.values()];
  for (const p of out) {
    p.dates.sort();
    p.premiere = p.dates[0];
    p.derniere = p.dates[p.dates.length - 1];
    p.nbServices = p.dates.length;
  }
  return out.sort(
    (x, y) =>
      (x.derniere < y.derniere ? 1 : x.derniere > y.derniere ? -1 : 0) ||
      x.nom.localeCompare(y.nom, "fr") ||
      (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0),
  );
}

// --- « Même plat » ----------------------------------------------------------------------

const MOTS_VIDES = new Set(
  "de du des d la le les l au aux un une et en a avec sans sur sous sauce maison façon facon du chef et ses sa son".split(" "),
);

/** Mots du nom normalisé, mots vides retirés. */
export function motsSignificatifs(nom: string): string[] {
  return normPlatImage(nom).split(" ").filter((m) => m && !MOTS_VIDES.has(m));
}

/**
 * Deux plats trop proches pour faire un dilemme : même base, ou l'un des deux jeux de mots
 * contient l'autre (« Croziflette » / « Croziflette savoyarde »), ou Jaccard ≥ 0,6.
 */
export function memePlat(a: { base: string; nom: string }, b: { base: string; nom: string }): boolean {
  if (a.base === b.base) return true;
  const A = new Set(motsSignificatifs(a.nom));
  const B = new Set(motsSignificatifs(b.nom));
  if (A.size === 0 || B.size === 0) return false;
  const commun = [...A].filter((m) => B.has(m)).length;
  if (commun === A.size || commun === B.size) return true;
  return commun / (A.size + B.size - commun) >= 0.6;
}

// --- Hasard déterministe ----------------------------------------------------------------

/** FNV-1a 32 bits. */
export function graineJour(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 : suite dans [0, 1) entièrement fixée par la graine. */
export function creerRng(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Tirage du duel ---------------------------------------------------------------------

export interface CandidatDuel {
  cle: string;
  base: string;
  restaurant: string;
  nom: string;
  aImage: boolean;
}
export interface DuelPasse {
  jour: string;
  a_cle: string;
  b_cle: string;
}

/** Fenêtres (en duels) de clés récentes exclues, relâchées dans l'ordre si le vivier manque. */
export const FENETRES_RECENTES = [14, 7, 0] as const;
/** Sous ce nombre de candidats photographiés, la préférence pour les photos s'efface. */
export const MIN_CANDIDATS_PHOTO = 6;

const cleDePaire = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function tirerPondere<T>(items: T[], poids: (t: T) => number, rng: () => number): T {
  let total = 0;
  const ps = items.map((t) => {
    const p = poids(t);
    total += p;
    return p;
  });
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ps[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Duel d'un jour : fonction pure de (jour, candidats, duels passés). Même entrée, même sortie,
 * quel que soit l'ordre des candidats. Voir la spec 2026-11-11-dilemme-du-jour-design.md §5.1.
 */
export function choisirDuel(
  jour: string,
  candidats: CandidatDuel[],
  passes: DuelPasse[],
): { a: CandidatDuel; b: CandidatDuel } | null {
  const rng = creerRng(graineJour("dilemme|v1|" + jour));

  const parCle = new Map<string, CandidatDuel>();
  for (const c of candidats) if (!parCle.has(c.cle)) parCle.set(c.cle, c);
  const tous = [...parCle.values()].sort((x, y) => (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0));

  // Seuls les duels strictement antérieurs comptent, du plus récent au plus ancien.
  const anciens = passes.filter((d) => d.jour < jour).sort((x, y) => (x.jour < y.jour ? 1 : x.jour > y.jour ? -1 : 0));
  const joues = new Map<string, number>();
  const paires = new Set<string>();
  for (const d of anciens) {
    joues.set(d.a_cle, (joues.get(d.a_cle) ?? 0) + 1);
    joues.set(d.b_cle, (joues.get(d.b_cle) ?? 0) + 1);
    paires.add(cleDePaire(d.a_cle, d.b_cle));
  }
  const nbJoues = (c: CandidatDuel) => joues.get(c.cle) ?? 0;

  for (const fenetre of FENETRES_RECENTES) {
    const exclues = new Set<string>();
    for (const d of anciens.slice(0, fenetre)) {
      exclues.add(d.a_cle);
      exclues.add(d.b_cle);
    }
    const pool = tous.filter((c) => !exclues.has(c.cle));
    if (pool.length < 2) continue;

    const preferePhotos = pool.filter((c) => c.aImage).length >= MIN_CANDIDATS_PHOTO;
    // Chaque tour retire A de l'urne s'il n'a aucun adversaire possible : la boucle se termine.
    const urne = [...pool];
    while (urne.length > 0) {
      const photographies = preferePhotos ? urne.filter((c) => c.aImage) : [];
      const sourceA = photographies.length > 0 ? photographies : urne;
      const A = tirerPondere(sourceA, (c) => (c.aImage ? 4 : 1) / (1 + nbJoues(c)), rng);

      let compatibles = pool.filter(
        (c) => c.cle !== A.cle && !memePlat(A, c) && !paires.has(cleDePaire(A.cle, c.cle)),
      );
      if (compatibles.length === 0) {
        urne.splice(urne.indexOf(A), 1);
        continue;
      }
      if (A.aImage) {
        const avecPhoto = compatibles.filter((c) => c.aImage);
        if (avecPhoto.length > 0) compatibles = avecPhoto;
      }
      const B = tirerPondere(
        compatibles,
        (c) => (c.aImage ? 4 : 1) * (c.restaurant !== A.restaurant ? 3 : 1) / (1 + nbJoues(c)),
        rng,
      );
      return rng() < 0.5 ? { a: B, b: A } : { a: A, b: B };
    }
  }
  return null;
}

/** Candidats du jour J : les plats dont la première date de service est strictement antérieure. */
export function candidatsDuJour(catalogue: PlatCatalogue[], jour: string, cleAvecImage: Set<string>): CandidatDuel[] {
  return catalogue
    .filter((p) => p.premiere < jour)
    .map((p) => ({ cle: p.cle, base: p.base, restaurant: p.restaurant, nom: p.nom, aImage: cleAvecImage.has(p.cle) }));
}

// --- Décomptes et classement ------------------------------------------------------------

export interface Resume {
  a: number;
  b: number;
  total: number;
  pctA: number;
  pctB: number;
  gagnant: Cote | "egalite" | null;
}

/** Pourcentages entiers dont la somme fait 100 (plus fort reste) ; 0 / 0 si personne n'a voté. */
export function resumerVotes(a: number, b: number): Resume {
  const total = a + b;
  if (total <= 0) return { a, b, total: 0, pctA: 0, pctB: 0, gagnant: null };
  const ea = (100 * a) / total;
  const eb = (100 * b) / total;
  let pctA = Math.floor(ea);
  let pctB = Math.floor(eb);
  if (pctA + pctB < 100) {
    if (ea - pctA >= eb - pctB) pctA++;
    else pctB++;
  }
  return { a, b, total, pctA, pctB, gagnant: a > b ? "a" : b > a ? "b" : "egalite" };
}

export interface StatPlat {
  cle: string;
  restaurant: string;
  nom: string;
  duels: number;
  victoires: number;
  defaites: number;
  nuls: number;
  pour: number;
  contre: number;
  /** Part de voix lissée (Laplace) : (pour + 1) / (pour + contre + 2). */
  score: number;
}

const scoreLisse = (pour: number, contre: number) => (pour + 1) / (pour + contre + 2);

/** Statistiques par plat sur des duels clos ; un duel sans aucun vote est ignoré. */
export function agregerStats(duels: DuelAvecVoix[]): Map<string, StatPlat> {
  const out = new Map<string, StatPlat>();
  const stat = (cle: string, restaurant: string, nom: string): StatPlat => {
    let s = out.get(cle);
    if (!s) {
      s = { cle, restaurant, nom, duels: 0, victoires: 0, defaites: 0, nuls: 0, pour: 0, contre: 0, score: 0.5 };
      out.set(cle, s);
    }
    return s;
  };
  for (const d of duels) {
    if (d.voix_a + d.voix_b <= 0) continue;
    const cotes: [StatPlat, number, number][] = [
      [stat(d.a_cle, d.a_restaurant, d.a_plat), d.voix_a, d.voix_b],
      [stat(d.b_cle, d.b_restaurant, d.b_plat), d.voix_b, d.voix_a],
    ];
    for (const [s, pour, contre] of cotes) {
      s.duels++;
      s.pour += pour;
      s.contre += contre;
      if (pour > contre) s.victoires++;
      else if (pour < contre) s.defaites++;
      else s.nuls++;
    }
  }
  for (const s of out.values()) s.score = scoreLisse(s.pour, s.contre);
  return out;
}

/** Classement : au moins 2 voix reçues ou données ; score, victoires, duels décroissants, puis clé. */
export function classerStats(stats: Iterable<StatPlat>): StatPlat[] {
  return [...stats]
    .filter((s) => s.pour + s.contre >= 2)
    .sort(
      (x, y) =>
        y.score - x.score ||
        y.victoires - x.victoires ||
        y.duels - x.duels ||
        (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0),
    );
}

// --- Validation -------------------------------------------------------------------------

/** `YYYY-MM-DD` qui existe vraiment (2026-02-30 refusé). */
export function dateIsoValide(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type ValidationVote =
  | { ok: true; votant: string; choix: Cote; jour: string | null }
  | { ok: false; erreur: string };

/** Corps d'un POST de vote → votant canonique, côté et jour (null = aujourd'hui). */
export function validerVote(corps: unknown): ValidationVote {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) return { ok: false, erreur: "Requête invalide." };
  const c = corps as Record<string, unknown>;

  const brut = c.votant;
  const inconnu = { ok: false, erreur: "Personnage inconnu : choisis-en un dans la liste." } as const;
  if (typeof brut !== "string" || !brut.trim() || brut.length > 50) return inconnu;
  const votant = canoniserVotant(brut);
  if (!votant) return inconnu;

  const choix = typeof c.choix === "string" ? c.choix.trim().toLowerCase() : "";
  if (choix !== "a" && choix !== "b") return { ok: false, erreur: "Choix invalide." };

  let jour: string | null = null;
  if (c.jour !== undefined && c.jour !== null) {
    if (!dateIsoValide(c.jour)) return { ok: false, erreur: "Date invalide." };
    jour = c.jour;
  }
  return { ok: true, votant, choix, jour };
}

// --- Navigation et libellés -------------------------------------------------------------

/** Jours de duel immédiatement avant et après `jour` (liste en désordre, doublons possibles). */
export function voisinsDuel(jours: string[], jour: string): { precedent: string | null; suivant: string | null } {
  const tries = [...new Set(jours)].sort();
  const i = tries.indexOf(jour);
  if (i < 0) return { precedent: null, suivant: null };
  return { precedent: i > 0 ? tries[i - 1] : null, suivant: i < tries.length - 1 ? tries[i + 1] : null };
}

/**
 * Jours entre lesquels on navigue : les duels clos (`passes`, strictement avant aujourd'hui) et le
 * duel du jour, toujours « suivant » du plus récent duel clos (créé à la demande sur /dilemme).
 * `affiche` : jour consulté, ajouté s'il manquait (historique indisponible).
 */
export function joursNavigation(passes: string[], aujourdhui: string, affiche?: string | null): string[] {
  const jours = passes.filter((j) => j < aujourdhui);
  jours.push(aujourdhui);
  if (affiche && !jours.includes(affiche)) jours.push(affiche);
  return jours;
}

/** « Thomas, Gab et 2 autres » : au plus `max` éléments, « N autres » compris. */
export function listeVotants(noms: string[], max = 3): string {
  if (noms.length === 0) return "";
  if (noms.length <= max) {
    return noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
  }
  const montres = Math.max(1, max - 1);
  const reste = noms.length - montres;
  return `${noms.slice(0, montres).join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}`;
}
