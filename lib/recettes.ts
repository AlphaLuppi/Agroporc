/**
 * Recettes maison inspirées des plats du jour (POC) — logique pure, client ET serveur
 * (ni `node:crypto` ni `pg` ici).
 *
 * Une recette par variante de plat, rattachée par la même clé que les images
 * (`clePlatImage`, calculée côté serveur). Le pipeline Python (`agent/recette_agent.py`)
 * fait rédiger la recette par le LLM et la valide avec les MÊMES règles ; le serveur la
 * revalide ici (`validerRecette`) mais, contrairement au Python, refuse les synonymes
 * d'unités (« cs », « gr »…). Contrat : `docs/poc-recettes-spec.md`.
 *
 * La recette n'est PAS celle du restaurant : les libellés d'honnêteté ci-dessous sont
 * imposés par la spec, mot pour mot.
 */
import { normPlatImage, type ImagePlat } from "./plat-image";
import { RESTAURANTS } from "./restaurants";
import { fmtNote } from "./format";
// Types seulement : `recette-notes.ts` importe ce module ET quiz-engine / carte-tri (pas de cycle).
import type { Envie } from "./quiz-engine";
import { MODE_LABEL, type Mode } from "./carte-tri";

/** Liste fermée et ordonnée, identique à `UNITES` de `agent/recette_agent.py`. */
export const UNITES: readonly string[] = [
  "g", "kg", "ml", "cl", "l", "c. à café", "c. à soupe", "pincée", "pièce",
  "gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet",
];
export const DIFFICULTES = ["facile", "moyenne", "difficile"] as const;
export type Difficulte = (typeof DIFFICULTES)[number];

export const PERSONNES_MIN = 1;
export const PERSONNES_MAX = 12;
export const PAR_PAGE = 24;
export const TAILLE_MAX_RECETTE = 30000;

export const BANDEAU_HONNETETE_DEBUT = "Recette maison inspirée du plat";
export const BANDEAU_HONNETETE_SUITE =
  ", ce n'est pas la recette du restaurant. Elle a été rédigée automatiquement à partir du nom du plat et de sa composition estimée : goûtez et ajustez les cuissons et l'assaisonnement.";
export const MENTION_PANNEAU = "Recette maison inspirée du plat, pas celle du restaurant.";

// --- Notes du plat d'origine et protéine (banque) ---

/** Tris de la banque ; `recentes` = dernier service d'abord (ordre historique). */
export const TRIS = ["recentes", "sportif", "goulaf", "rapide"] as const;
export type TriBanque = (typeof TRIS)[number];
export const LIBELLES_TRI: Record<TriBanque, string> = { recentes: "Récentes", sportif: "Sportif", goulaf: "Goulaf", rapide: "Rapides" };

/** Protéines filtrables (axe « envie » du quiz) ; « autre » est stocké mais pas proposé en filtre. */
export const PROTEINES: readonly Envie[] = ["poulet", "boeuf", "porc", "veau", "poisson", "vege"];
export type ProteineRecette = Envie | "autre";
export const LIBELLES_PROTEINE: Record<Envie, string> = {
  poulet: "Poulet / volaille", boeuf: "Bœuf", porc: "Porc", veau: "Veau / agneau", poisson: "Poisson", vege: "Végé",
};

/** Honnêteté : les notes viennent du plat du jour évalué, pas de la recette maison. */
/**
 * Recette sans note : plat d'origine pas encore rattrapé, ou introuvable parmi les plats notés
 * (il ne le sera peut-être jamais) — d'où « indisponible » et non « pas encore notée ».
 */
export const NOTE_INDISPONIBLE = "note indisponible";
export const LEGENDE_SANS_NOTE = "Notes indisponibles pour le plat du jour dont la recette s'inspire.";

export const MENTION_NOTES = "Les notes Sportif et Goulaf sont celles du plat du jour dont la recette s'inspire, pas de la recette maison.";

/** Notes recopiées depuis `pdj_entries` (null tant que la recette n'a pas été rattrapée). */
export interface NotesRecetteChamps {
  note_sportif: number | null;
  note_goulaf: number | null;
  /** Date du plat du jour dont viennent les notes (la plus récente). */
  note_date: string | null;
  /** null = recette jamais traitée par le rattrapage. */
  proteine: ProteineRecette | null;
}

export interface IngredientRecette {
  nom: string;
  quantite: number | null;
  unite: string | null;
  note?: string;
  groupe?: string;
}

/** Contenu rédigé par le LLM ; après validation, tous les champs sont présents. */
export interface RecetteContenu {
  titre: string;
  description: string;
  personnes: number;
  temps_preparation_min: number;
  temps_cuisson_min: number;
  temps_repos_min: number;
  difficulte: Difficulte;
  ingredients: IngredientRecette[];
  etapes: string[];
  astuces: string[];
  ustensiles: string[];
}

export interface RecetteComplete extends RecetteContenu, NotesRecetteChamps {
  cle: string;
  restaurant: string;
  plat: string;
  modele: string | null;
  fournisseur: string | null;
  version_prompt: number | null;
  date_premier_service: string | null;
  dates_service: string[];
  cree_le: string;
  maj_le: string;
  image: ImagePlat | null;
}

export interface ResumeRecette extends NotesRecetteChamps {
  cle: string;
  restaurant: string;
  plat: string;
  titre: string;
  difficulte: Difficulte;
  personnes: number;
  /** Préparation + cuisson + repos. */
  temps_total_min: number;
  derniere_date: string | null;
  nb_services: number;
  image: ImagePlat | null;
}

// --- Validation (§1.2 / §1.5) ---

type Erreurs = string[];

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nettoyer = (s: string) => s.replace(/\s+/g, " ").trim();

/** Chaîne obligatoire (ou optionnelle avec `defaut`), trim + espaces multiples, bornée en longueur. */
function texte(v: unknown, chemin: string, min: number, max: number, erreurs: Erreurs, defaut?: string): string | null {
  if (v === undefined || v === null) {
    if (defaut !== undefined) return defaut;
    erreurs.push(`${chemin} : texte requis`);
    return null;
  }
  if (typeof v !== "string") {
    erreurs.push(`${chemin} : texte attendu`);
    return null;
  }
  const s = nettoyer(v);
  if (s.length < min || s.length > max) {
    erreurs.push(`${chemin} : entre ${min} et ${max} caractères attendus`);
    return null;
  }
  return s;
}

/** Entier borné ; accepte `25.0` et `"25"`. */
function entier(v: unknown, chemin: string, min: number, max: number, erreurs: Erreurs, defaut?: number): number | null {
  if ((v === undefined || v === null) && defaut !== undefined) return defaut;
  let n: number | null = null;
  if (typeof v === "number" && Number.isInteger(v)) n = v;
  else if (typeof v === "string" && /^\d+$/.test(v.trim())) n = parseInt(v.trim(), 10);
  if (n === null || n < min || n > max) {
    erreurs.push(`${chemin} : entier entre ${min} et ${max} attendu`);
    return null;
  }
  return n;
}

/** Liste de chaînes : éléments vides retirés avant de compter. */
function liste(
  v: unknown, chemin: string, nbMin: number, nbMax: number, lgMin: number, lgMax: number, erreurs: Erreurs, optionnel: boolean,
): string[] | null {
  if ((v === undefined || v === null) && optionnel) return [];
  if (!Array.isArray(v)) {
    erreurs.push(`${chemin} : liste attendue`);
    return null;
  }
  const out: string[] = [];
  let ok = true;
  v.forEach((el, i) => {
    if (typeof el !== "string") {
      erreurs.push(`${chemin}[${i}] : texte attendu`);
      ok = false;
      return;
    }
    const s = nettoyer(el);
    if (!s) return;
    if (s.length < lgMin || s.length > lgMax) {
      erreurs.push(`${chemin}[${i}] : entre ${lgMin} et ${lgMax} caractères attendus`);
      ok = false;
      return;
    }
    out.push(s);
  });
  if (out.length < nbMin) {
    erreurs.push(nbMin === 1 && chemin === "etapes" ? "etapes : au moins 1 étape" : `${chemin} : au moins ${nbMin} élément(s)`);
    ok = false;
  } else if (out.length > nbMax) {
    erreurs.push(`${chemin} : au plus ${nbMax} éléments`);
    ok = false;
  }
  return ok ? out : null;
}

/** Quantité : nombre ou chaîne numérique (virgule acceptée) ; null = « selon goût ». */
function quantite(v: unknown, chemin: string, erreurs: Erreurs): number | null | undefined {
  if (v === undefined || v === null) return null;
  let n = NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)) n = parseFloat(v.trim().replace(",", "."));
  const arrondi = Math.round(n * 100) / 100;
  if (!Number.isFinite(n) || n <= 0 || n > 10000 || arrondi <= 0) {
    erreurs.push(`${chemin} : nombre entre 0 (exclu) et 10000 attendu, ou null`);
    return undefined;
  }
  return arrondi;
}

function ingredient(v: unknown, chemin: string, erreurs: Erreurs): IngredientRecette | null {
  if (!estObjet(v)) {
    erreurs.push(`${chemin} : objet attendu`);
    return null;
  }
  const n = erreurs.length;
  const nom = texte(v.nom, `${chemin}.nom`, 1, 120, erreurs);
  const q = quantite(v.quantite, `${chemin}.quantite`, erreurs);
  let unite: string | null = null;
  if (v.unite !== undefined && v.unite !== null) {
    if (typeof v.unite !== "string") erreurs.push(`${chemin}.unite : texte attendu`);
    else {
      unite = nettoyer(v.unite);
      if (!UNITES.includes(unite)) erreurs.push(`${chemin}.unite : unité inconnue « ${unite} »`);
    }
  } else if (q !== null && q !== undefined) {
    erreurs.push(`${chemin}.unite : unité requise quand la quantité est renseignée`);
  }
  const note = texte(v.note, `${chemin}.note`, 0, 120, erreurs, "");
  const groupe = texte(v.groupe, `${chemin}.groupe`, 0, 60, erreurs, "");
  if (erreurs.length > n || nom === null || q === undefined) return null;
  const out: IngredientRecette = { nom, quantite: q, unite };
  if (note) out.note = note;
  if (groupe) out.groupe = groupe;
  return out;
}

/**
 * Normalise puis valide une recette (§1.2). Collecte toutes les erreurs, en français, avec
 * leur chemin. Les champs inconnus sont retirés. La taille (≤ 30 000 car.) est contrôlée par
 * la route avant l'appel (413).
 */
export function validerRecette(entree: unknown): { ok: true; recette: RecetteContenu } | { ok: false; erreurs: string[] } {
  if (!estObjet(entree)) return { ok: false, erreurs: ["recette : objet attendu"] };
  const e: Erreurs = [];
  const titre = texte(entree.titre, "titre", 3, 200, e);
  const description = texte(entree.description, "description", 0, 600, e, "");
  const personnes = entier(entree.personnes, "personnes", PERSONNES_MIN, PERSONNES_MAX, e);
  const prep = entier(entree.temps_preparation_min, "temps_preparation_min", 0, 600, e);
  const cuisson = entier(entree.temps_cuisson_min, "temps_cuisson_min", 0, 1440, e);
  const repos = entier(entree.temps_repos_min, "temps_repos_min", 0, 2880, e, 0);
  const difficulte = typeof entree.difficulte === "string" ? nettoyer(entree.difficulte) : null;
  if (!difficulte || !(DIFFICULTES as readonly string[]).includes(difficulte)) {
    e.push(`difficulte : ${DIFFICULTES.join(", ")} attendu`);
  }
  let ingredients: IngredientRecette[] | null = null;
  if (!Array.isArray(entree.ingredients)) e.push("ingredients : liste attendue");
  else if (entree.ingredients.length < 1) e.push("ingredients : au moins 1 ingrédient");
  else if (entree.ingredients.length > 40) e.push("ingredients : au plus 40 ingrédients");
  else {
    const ings = entree.ingredients.map((v, i) => ingredient(v, `ingredients[${i}]`, e));
    if (ings.every((x) => x !== null)) ingredients = ings as IngredientRecette[];
  }
  const etapes = liste(entree.etapes, "etapes", 1, 30, 3, 800, e, false);
  const astuces = liste(entree.astuces, "astuces", 0, 10, 1, 400, e, true);
  const ustensiles = liste(entree.ustensiles, "ustensiles", 0, 20, 1, 80, e, true);

  if (e.length) return { ok: false, erreurs: e };
  return {
    ok: true,
    recette: {
      titre: titre!,
      description: description!,
      personnes: personnes!,
      temps_preparation_min: prep!,
      temps_cuisson_min: cuisson!,
      temps_repos_min: repos!,
      difficulte: difficulte as Difficulte,
      ingredients: ingredients!,
      etapes: etapes!,
      astuces: astuces!,
      ustensiles: ustensiles!,
    },
  };
}

/** `YYYY-MM-DD` d'une date réelle (pas de 2026-02-30). */
export function dateValide(d: unknown): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export const MAX_SERVICES = 200;

/** Corps de `POST /api/recette/services` → couples dédoublonnés, ou null si invalide (1 à 200). */
export function validerServices(corps: unknown, cleRe: RegExp): { cle: string; date: string }[] | null {
  const services = estObjet(corps) ? corps.services : undefined;
  if (!Array.isArray(services) || services.length < 1 || services.length > MAX_SERVICES) return null;
  const vus = new Map<string, { cle: string; date: string }>();
  for (const s of services) {
    if (!estObjet(s) || typeof s.cle !== "string" || !cleRe.test(s.cle) || !dateValide(s.date)) return null;
    vus.set(`${s.cle}|${s.date}`, { cle: s.cle, date: s.date });
  }
  return [...vus.values()];
}

// --- Affichage ---

export function tempsTotal(r: Pick<RecetteContenu, "temps_preparation_min" | "temps_cuisson_min" | "temps_repos_min">): number {
  return (r.temps_preparation_min || 0) + (r.temps_cuisson_min || 0) + (r.temps_repos_min || 0);
}

/** 45 → « 45 min », 60 → « 1 h », 75 → « 1 h 15 », 65 → « 1 h 05 ». */
export function formaterDuree(min: number): string {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} min`;
  const reste = m % 60;
  return reste ? `${Math.floor(m / 60)} h ${String(reste).padStart(2, "0")}` : `${m / 60} h`;
}

const LIBELLES_DIFFICULTE: Record<Difficulte, string> = { facile: "Facile", moyenne: "Moyenne", difficile: "Difficile" };

export function libelleDifficulte(d: Difficulte): string {
  return LIBELLES_DIFFICULTE[d] ?? d;
}

/** Unités qui s'arrondissent et s'affichent à la demi (½). */
const A_LA_DEMI = new Set(["c. à café", "c. à soupe", "pièce", "gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet"]);
const PLURIEL = new Set(["pincée", "gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet"]);

const deuxDecimales = (v: number) => Math.round(v * 100) / 100;
const multiple = (v: number, pas: number, min: number) => Math.max(min, deuxDecimales(Math.round(v / pas) * pas));

/** Quantité pour `cible` personnes au lieu de `base`, arrondie selon l'unité (§5.1). */
export function ajusterQuantite(q: number | null, unite: string | null, base: number, cible: number): number | null {
  if (q === null) return null;
  if (cible === base || !(base > 0)) return q;
  const v = (q * cible) / base;
  if (unite === "g" || unite === "ml") {
    if (v < 20) return Math.max(1, Math.round(v));
    return v < 100 ? multiple(v, 5, 5) : multiple(v, 10, 10);
  }
  if (unite === "cl") return multiple(v, 0.5, 0.5);
  if (unite === "kg" || unite === "l") return multiple(v, 0.05, 0.05);
  if (unite === "pincée") return Math.max(1, Math.round(v));
  if (unite && A_LA_DEMI.has(unite)) return multiple(v, 0.5, 0.5);
  return deuxDecimales(v);
}

const nombreFr = (v: number) => String(deuxDecimales(v)).replace(".", ",");

/** « 200 g », « 1 ½ c. à soupe », « 2 gousses », « ½ » (pièce masquée), « selon goût ». */
export function formaterQuantite(q: number | null, unite: string | null): string {
  if (q === null) return "selon goût";
  const v = deuxDecimales(q);
  let nombre = nombreFr(v);
  if (unite && (A_LA_DEMI.has(unite) || unite === "pincée")) {
    const entiere = Math.floor(v);
    if (v - entiere === 0.5) nombre = entiere ? `${entiere} ½` : "½";
  }
  if (!unite || unite === "pièce") return nombre;
  return `${nombre} ${unite}${PLURIEL.has(unite) && v > 1 ? "s" : ""}`;
}

export function ajusterIngredients(
  ings: IngredientRecette[], base: number, cible: number,
): (IngredientRecette & { libelleQuantite: string })[] {
  return ings.map((i) => {
    const quantite = ajusterQuantite(i.quantite, i.unite, base, cible);
    return { ...i, quantite, libelleQuantite: formaterQuantite(quantite, i.unite) };
  });
}

export function bornerPersonnes(n: number): number {
  if (!Number.isFinite(n)) return PERSONNES_MIN;
  return Math.min(PERSONNES_MAX, Math.max(PERSONNES_MIN, Math.round(n)));
}

/** Groupes dans l'ordre de première apparition ; `groupe: null` pour les ingrédients sans groupe. */
export function grouperIngredients<T extends IngredientRecette>(ings: T[]): { groupe: string | null; ingredients: T[] }[] {
  const groupes = new Map<string | null, T[]>();
  for (const i of ings) {
    const g = i.groupe?.trim() || null;
    const l = groupes.get(g);
    if (l) l.push(i);
    else groupes.set(g, [i]);
  }
  return [...groupes].map(([groupe, ingredients]) => ({ groupe, ingredients }));
}

/** Colonne `recherche` : texte normalisé comme les clés (sans accents ni ponctuation). */
export function texteRecherche(restaurant: string, plat: string, r: Pick<RecetteContenu, "titre" | "ingredients">): string {
  return normPlatImage([restaurant, plat, r.titre, ...r.ingredients.map((i) => i.nom)].join(" "));
}

/**
 * Motifs LIKE de la recherche : un par mot (normalisé comme `recherche`, dédoublonné, 8 au plus),
 * tous requis, dans n'importe quel ordre (« curry poulet » trouve « Poulet au curry »).
 * Recherche en DÉBUT de mot : le motif `% mot%` est confronté à `' ' || recherche` en SQL, donc
 * « riz » ne trouve plus « chorizo », mais « pate » trouve encore « pates » et « lait » « laitue ».
 * Après normalisation il ne reste que [a-z0-9] : rien à échapper.
 */
export function motifsRecherche(q: string): string[] {
  const mots = [...new Set(normPlatImage(q).split(" ").filter(Boolean))].slice(0, 8);
  return mots.map((m) => `% ${m}%`);
}

/** Date du jour à Paris (`YYYY-MM-DD`). */
export function aujourdhuiParis(maintenant: Date = new Date()): string {
  return maintenant.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

/** Une date de service n'est enregistrée qu'une fois le plat servi (pas les jours publiés d'avance). */
export function dateServie(date: string, aujourdhui: string = aujourdhuiParis()): boolean {
  return date <= aujourdhui;
}

/** Date de Paris (`YYYY-MM-DD`) d'un horodatage ISO, pour `formatDateShort`. */
export function jourParis(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

// --- Banque : paramètres communs à la page /recettes et à GET /api/recettes ---

export type ParametresBanque =
  | {
      ok: true; q: string; qNorm: string; slug: string | null; restaurant: string | null; page: number;
      tri: TriBanque; proteine: Envie | null;
    }
  | { ok: false; erreur: string };

/** Restaurants filtrables (hors liens seuls comme Vival), dans l'ordre d'affichage. */
export const RESTAURANTS_RECETTES = RESTAURANTS.filter((r) => r.type !== "lien");

export function parametresBanque(sp: URLSearchParams | Record<string, string | string[] | undefined>): ParametresBanque {
  // Valeur répétée : la première, sauf pour `tri` et `proteine`, où c'est la dernière. Les
  // boutons de tri et de protéine soumettent le formulaire de recherche (q et restaurant saisis
  // compris), dont les champs cachés reprennent le tri et la protéine courants : le bouton
  // pressé arrive après eux dans l'ordre du formulaire et doit l'emporter.
  const lire = (k: string): string => {
    const derniere = k === "tri" || k === "proteine";
    if (sp instanceof URLSearchParams) {
      const toutes = sp.getAll(k);
      return (derniere ? toutes[toutes.length - 1] : toutes[0]) ?? "";
    }
    const v = sp[k];
    return (Array.isArray(v) ? (derniere ? v[v.length - 1] : v[0]) : v) ?? "";
  };
  const q = lire("q").trim().slice(0, 100);
  const slugBrut = lire("restaurant").trim();
  let slug: string | null = null;
  let restaurant: string | null = null;
  if (slugBrut) {
    const r = RESTAURANTS_RECETTES.find((x) => x.slug === slugBrut);
    if (!r) return { ok: false, erreur: "Restaurant inconnu" };
    slug = r.slug;
    restaurant = r.nom;
  }
  const pageBrute = lire("page").trim();
  let page = 1;
  if (pageBrute) {
    page = /^\d{1,6}$/.test(pageBrute) ? parseInt(pageBrute, 10) : 0;
    if (page < 1) return { ok: false, erreur: "Paramètre 'page' invalide" };
  }
  const triBrut = lire("tri").trim();
  let tri: TriBanque = "recentes";
  if (triBrut) {
    if (!(TRIS as readonly string[]).includes(triBrut)) return { ok: false, erreur: "Paramètre 'tri' invalide" };
    tri = triBrut as TriBanque;
  }
  const proteineBrute = lire("proteine").trim();
  let proteine: Envie | null = null;
  if (proteineBrute) {
    if (!(PROTEINES as readonly string[]).includes(proteineBrute)) return { ok: false, erreur: "Protéine inconnue" };
    proteine = proteineBrute as Envie;
  }
  return { ok: true, q, qNorm: normPlatImage(q), slug, restaurant, page, tri, proteine };
}

/**
 * Vrai si l'URL de la banque est à nettoyer : paramètre répété (bouton de tri ou de protéine
 * soumis avec les champs cachés) ou vide (`q=`, `restaurant=`, « Toutes » les protéines).
 */
export function parametresANettoyer(sp: Record<string, string | string[] | undefined>): boolean {
  return ["q", "restaurant", "tri", "proteine", "page"].some((k) => Array.isArray(sp[k]) || sp[k] === "");
}

type EtatBanque = { q: string; slug: string | null; tri: TriBanque; proteine: Envie | null; page: number };

/**
 * Lien de la banque qui conserve recherche, restaurant, tri et protéine. Changer de restaurant,
 * de tri ou de protéine ramène à la page 1 (sauf page explicite). Paramètres dans l'ordre
 * q, restaurant, tri, proteine, page ; les valeurs par défaut sont omises.
 */
export function hrefBanque(
  p: EtatBanque,
  changements: Partial<Pick<EtatBanque, "slug" | "tri" | "proteine" | "page">> = {},
): string {
  const filtreChange = "slug" in changements || "tri" in changements || "proteine" in changements;
  const e: EtatBanque = { ...p, ...changements };
  if (filtreChange && changements.page === undefined) e.page = 1;
  const sp = new URLSearchParams();
  if (e.q) sp.set("q", e.q);
  if (e.slug) sp.set("restaurant", e.slug);
  if (e.tri !== "recentes") sp.set("tri", e.tri);
  if (e.proteine) sp.set("proteine", e.proteine);
  if (e.page > 1) sp.set("page", String(e.page));
  const s = sp.toString();
  return s ? `/recettes?${s}` : "/recettes";
}

/** « Note Sportif : 7,5 sur 10 » / « Note Goulaf : note indisponible » (lecteurs d'écran, title). */
export function libelleNote(mode: Mode, note: number | null): string {
  return `Note ${MODE_LABEL[mode]} : ${note == null ? NOTE_INDISPONIBLE : `${fmtNote(note)} sur 10`}`;
}

/** « 12 recettes · triées par note Sportif · Poulet / volaille ». */
export function libelleResultats(total: number, tri: TriBanque, proteine: Envie | null): string {
  const parts = [`${total} recette${total > 1 ? "s" : ""}`];
  if (tri === "sportif" || tri === "goulaf") parts.push(`triées par note ${MODE_LABEL[tri]}`);
  else if (tri === "rapide") parts.push("les plus rapides d'abord");
  if (proteine) parts.push(LIBELLES_PROTEINE[proteine]);
  return parts.join(" · ");
}

/** Réponse de `GET /api/recette/<cle>` → état du panneau. */
/**
 * Le pipeline (`plat_recette.a_cuisiner`) écarte les noms dont la normalisation est vide
 * (« — », « ? », emojis seuls) : pas de section recette pour eux, elle ne viendrait jamais.
 */
export function recetteAttendue(restaurant: string, plat: string): boolean {
  return normPlatImage(restaurant) !== "" && normPlatImage(plat) !== "";
}

/** Heure (Paris) après laquelle les recettes du jour sont censées être rédigées (cron 11h15). */
export const HEURE_RECETTES_DU_JOUR = 12;

/**
 * Texte de l'état « absente » selon la date du plat : les recettes ne sont rédigées que le
 * jour même (run 7h30 puis cron 11h15) ; rien ne rattrape un jour passé.
 */
export function messageRecetteAbsente(date: string, today: string, heureParis: number): string {
  if (date > today) return "La recette sera rédigée le jour où le plat est servi.";
  if (date === today && heureParis < HEURE_RECETTES_DU_JOUR) {
    return "Pas encore de recette pour ce plat : elles sont rédigées en fin de matinée.";
  }
  return "Pas de recette pour ce plat.";
}

/** Heure courante à Paris (0-23). */
export function heureParis(maintenant: Date = new Date()): number {
  return Number(maintenant.toLocaleString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false })) % 24;
}

export function etatRecetteDepuisStatut(status: number): "ok" | "absente" | "erreur" {
  if (status === 200) return "ok";
  if (status === 404) return "absente";
  return "erreur";
}
