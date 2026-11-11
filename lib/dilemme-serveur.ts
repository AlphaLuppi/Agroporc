/**
 * Dilemme du jour — orchestration SERVEUR : catalogue mis en cache, images, création du duel
 * du jour (figé en base à la première demande), état d'un duel, traitement d'un vote.
 * La logique pure vit dans `lib/dilemme.ts` ; les routes `app/api/dilemme*` n'en sont qu'une enveloppe.
 */
import {
  creerDilemmeSiAbsent, getDilemme, getDuelsPasses, getLignesHistorique, getVotesDilemme, platImagesExistantes,
  voterDilemme, type DilemmeLigne, type VoteDilemme,
} from "./db";
import {
  candidatsDuJour, choisirDuel, construireCatalogue, dateIsoValide, resumerVotes, validerVote,
  type Cote, type PlatCatalogue, type Resume,
} from "./dilemme";
import { creerLimiteur, type Limiteur } from "./limiteur-debit";
import { creditFournisseur, srcPlatImage } from "./plat-image";
import { clePlatImage } from "./plat-image-cle";
import { aujourdhuiParis } from "./recettes";
import { canoniserVotant } from "./votant";

export interface ImageDuel {
  src: string;
  credit?: string;
}

export interface PlatDuel {
  cle: string;
  restaurant: string;
  nom: string;
  image: ImageDuel | null;
  /** 0 / null quand le catalogue ne connaît plus le plat. */
  nbServices: number;
  derniere: string | null;
}

export interface EtatDuel {
  jour: string;
  /** Vrai pour le duel d'aujourd'hui (Paris) : on peut encore voter. */
  ouvert: boolean;
  dilemme: { a: PlatDuel; b: PlatDuel };
  voix: { a: number; b: number };
  resume: Resume;
  /** Pour les avatars, et pour dériver « mon vote » côté client quand le personnage change. */
  votes: VoteDilemme[];
  monVote: Cote | null;
}

export type ResultatEtat =
  | { ok: true; etat: EtatDuel }
  | { ok: false; status: 400 | 404 | 409 | 429 | 503; erreur: string; code?: "vivier" | "clos" | "limite" };

/** Honeypot rempli : faux succès, rien n'est écrit. */
export type ResultatVote = ResultatEtat | { ok: true; factice: true };

const MSG_INDISPONIBLE = "Le dilemme est indisponible pour le moment.";
const MSG_VIVIER = "Pas encore assez de plats pour lancer un duel. Reviens demain !";
const MSG_ABSENT = "Pas de dilemme ce jour-là.";
const MSG_LIMITE = "Trop de votes d'un coup, reprends ton souffle.";

// --- Catalogue (cache mémoire 60 s) -----------------------------------------------------

const CATALOGUE_TTL_MS = 60_000;
interface CacheCatalogue {
  jour: string;
  expire: number;
  promesse: Promise<PlatCatalogue[]>;
}
const g = globalThis as { __pdjDilemmeCatalogue?: CacheCatalogue };

/** Pour les tests. */
export function viderCacheCatalogue(): void {
  g.__pdjDilemmeCatalogue = undefined;
}

/** Tous les plats servis jusqu'à aujourd'hui (Paris), regroupés par clé d'image. */
export async function chargerCatalogue(): Promise<PlatCatalogue[]> {
  const jour = aujourdhuiParis();
  const c = g.__pdjDilemmeCatalogue;
  if (c && c.jour === jour && c.expire > Date.now()) return c.promesse;
  const promesse = getLignesHistorique(jour).then((lignes) => construireCatalogue(lignes, clePlatImage, jour));
  const entree: CacheCatalogue = { jour, expire: Date.now() + CATALOGUE_TTL_MS, promesse };
  g.__pdjDilemmeCatalogue = entree;
  promesse.catch(() => {
    if (g.__pdjDilemmeCatalogue === entree) g.__pdjDilemmeCatalogue = undefined;
  });
  return promesse;
}

// --- Images -----------------------------------------------------------------------------

async function imagesExistantes(cles: string[]): Promise<Map<string, ImageDuel>> {
  const out = new Map<string, ImageDuel>();
  if (cles.length === 0) return out;
  for (const [cle, meta] of await platImagesExistantes(cles)) {
    const credit = creditFournisseur(meta.fournisseur);
    out.set(cle, credit ? { src: srcPlatImage(cle, meta.creeLe), credit } : { src: srcPlatImage(cle, meta.creeLe) });
  }
  return out;
}

/** Images qui existent parmi `cles` (URL versionnée + crédit) ; vide en cas d'erreur : une photo manquante ne casse rien. */
export async function imagesPourCles(cles: string[]): Promise<Map<string, ImageDuel>> {
  try {
    return await imagesExistantes(cles);
  } catch (e) {
    console.error("[dilemme] Images :", e);
    return new Map();
  }
}

// --- Création du duel du jour -----------------------------------------------------------

/**
 * Duel d'un jour (à n'appeler que pour AUJOURD'HUI) : celui de la base s'il existe, sinon tirage
 * puis écriture « premier arrivé, premier servi » (`ON CONFLICT DO NOTHING`) et relecture, de sorte
 * que deux demandes simultanées voient le même duel. null = vivier insuffisant, rien d'écrit.
 * Les erreurs de base remontent (un duel ne doit jamais être figé sur des images mal lues).
 */
export async function assurerDilemme(jour: string): Promise<DilemmeLigne | null> {
  const existant = await getDilemme(jour);
  if (existant) return existant;

  const catalogue = await chargerCatalogue();
  const eligibles = catalogue.filter((p) => p.premiere < jour);
  const avecImage = new Set((await imagesExistantes(eligibles.map((p) => p.cle))).keys());
  const passes = await getDuelsPasses(jour);
  const duel = choisirDuel(jour, candidatsDuJour(catalogue, jour, new Set(avecImage)), passes);
  if (!duel) return null;

  const ligne: DilemmeLigne = {
    jour,
    a_cle: duel.a.cle, a_restaurant: duel.a.restaurant.slice(0, 100), a_plat: duel.a.nom.slice(0, 300),
    b_cle: duel.b.cle, b_restaurant: duel.b.restaurant.slice(0, 100), b_plat: duel.b.nom.slice(0, 300),
  };
  await creerDilemmeSiAbsent(ligne);
  return (await getDilemme(jour)) ?? ligne;
}

// --- État d'un duel ---------------------------------------------------------------------

function platDuel(
  cle: string, restaurant: string, nom: string,
  catalogue: Map<string, PlatCatalogue>, images: Map<string, ImageDuel>,
): PlatDuel {
  const c = catalogue.get(cle);
  return {
    cle, restaurant, nom,
    image: images.get(cle) ?? null,
    nbServices: c?.nbServices ?? 0,
    derniere: c?.derniere ?? null,
  };
}

async function construireEtat(ligne: DilemmeLigne, ouvert: boolean, votant: string | null): Promise<EtatDuel> {
  // Le catalogue (en cache) ne sert qu'aux « servi N fois » : son absence n'empêche pas d'afficher le duel.
  const catalogue = await chargerCatalogue().catch((e) => {
    console.error("[dilemme] Catalogue :", e);
    return [] as PlatCatalogue[];
  });
  const [votes, images] = await Promise.all([
    getVotesDilemme(ligne.jour),
    imagesPourCles([ligne.a_cle, ligne.b_cle]),
  ]);
  const parCle = new Map(catalogue.map((p) => [p.cle, p]));
  const voixA = votes.filter((v) => v.choix === "a").length;
  const voixB = votes.length - voixA;
  const canonique = votant ? canoniserVotant(votant) : null;
  return {
    jour: ligne.jour,
    ouvert,
    dilemme: {
      a: platDuel(ligne.a_cle, ligne.a_restaurant, ligne.a_plat, parCle, images),
      b: platDuel(ligne.b_cle, ligne.b_restaurant, ligne.b_plat, parCle, images),
    },
    voix: { a: voixA, b: voixB },
    resume: resumerVotes(voixA, voixB),
    votes,
    monVote: canonique ? (votes.find((v) => v.votant === canonique)?.choix ?? null) : null,
  };
}

/** État du duel de `jourParam` (aujourd'hui si null) ; `votant` sert à renseigner `monVote`. */
export async function lireEtatDuel(
  jourParam: string | null,
  votant: string | null,
  maintenant: Date = new Date(),
): Promise<ResultatEtat> {
  const aujourdhui = aujourdhuiParis(maintenant);
  if (jourParam !== null && !dateIsoValide(jourParam)) return { ok: false, status: 400, erreur: "Date invalide." };
  const jour = jourParam ?? aujourdhui;
  if (jour > aujourdhui) return { ok: false, status: 404, erreur: MSG_ABSENT };
  try {
    let ligne: DilemmeLigne | null;
    if (jour === aujourdhui) {
      ligne = await assurerDilemme(jour);
      if (!ligne) return { ok: false, status: 404, erreur: MSG_VIVIER, code: "vivier" };
    } else {
      ligne = await getDilemme(jour);
      if (!ligne) return { ok: false, status: 404, erreur: MSG_ABSENT };
    }
    return { ok: true, etat: await construireEtat(ligne, jour === aujourdhui, votant) };
  } catch (e) {
    console.error("[dilemme] Lecture :", e);
    return { ok: false, status: 503, erreur: MSG_INDISPONIBLE };
  }
}

// --- Vote -------------------------------------------------------------------------------

export interface LimiteursVote {
  ip: Limiteur;
  votant: Limiteur;
}

/** 30 votes par minute et par IP (le bureau partage probablement une adresse), 6 par votant. */
export const limiteursVote: LimiteursVote = {
  ip: creerLimiteur(30, 60_000),
  votant: creerLimiteur(6, 60_000),
};

/**
 * Traite un POST de vote. Ordre des contrôles (fixé par les tests) : corps objet, honeypot,
 * limite IP, validation, duel clos, limite votant, duel du jour, écriture, relecture.
 */
export async function traiterVote(
  corps: unknown,
  ip: string,
  maintenant: Date = new Date(),
  limiteurs: LimiteursVote = limiteursVote,
): Promise<ResultatVote> {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) {
    return { ok: false, status: 400, erreur: "Requête invalide." };
  }
  if ((corps as Record<string, unknown>).website) return { ok: true, factice: true };

  if (!limiteurs.ip.essayer(ip)) return { ok: false, status: 429, erreur: MSG_LIMITE, code: "limite" };

  const v = validerVote(corps);
  if (!v.ok) return { ok: false, status: 400, erreur: v.erreur };

  const aujourdhui = aujourdhuiParis(maintenant);
  if (v.jour !== null && v.jour !== aujourdhui) {
    return { ok: false, status: 409, erreur: "Ce duel est terminé, rendez-vous demain.", code: "clos" };
  }
  if (!limiteurs.votant.essayer(v.votant)) return { ok: false, status: 429, erreur: MSG_LIMITE, code: "limite" };

  try {
    const ligne = await assurerDilemme(aujourdhui);
    if (!ligne) return { ok: false, status: 404, erreur: MSG_VIVIER, code: "vivier" };
    await voterDilemme(aujourdhui, v.votant, v.choix);
    const r = await lireEtatDuel(aujourdhui, v.votant, maintenant);
    if (!r.ok) {
      return r.status === 503 ? { ok: false, status: 503, erreur: "Vote indisponible pour le moment." } : r;
    }
    // Le vote qui vient d'être posé fait foi, même si la relecture venait d'un réplica en retard.
    return { ok: true, etat: { ...r.etat, monVote: v.choix } };
  } catch (e) {
    console.error("[dilemme] Vote :", e);
    return { ok: false, status: 503, erreur: "Vote indisponible pour le moment." };
  }
}
