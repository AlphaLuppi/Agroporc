import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { SLUG_TO_RESTAURANT } from "@/lib/restaurants";
import { creditFournisseur, normPlatImage, srcPlatImage, type ImagePlat } from "@/lib/plat-image";
import { clePlatImage } from "@/lib/plat-image-cle";
import type { Envie } from "@/lib/quiz-engine";
import { fusionnerNotes, noteValide, notesDuJour, proteineDepuisRecette, type NotesVariante } from "@/lib/recette-notes";
import {
  aujourdhuiParis, motifsRecherche, tempsTotal, type Difficulte, type NotesRecetteChamps, type ProteineRecette, type RecetteComplete,
  type RecetteContenu, type ResumeRecette, type TriBanque,
} from "@/lib/recettes";

// Postgres auto-hébergé (VPS) au lieu de Vercel Postgres/Neon.
// Le driver `pg` parle le protocole wire standard sur TCP+TLS.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  // Cert self-signed du VPS : on chiffre sans vérifier la chaîne.
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * Tagged-template `sql` compatible avec l'API @vercel/postgres :
 * `sql\`select ... ${valeur}\`` → requête paramétrée, renvoie { rows, rowCount }.
 */
function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<T>> {
  let text = "";
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) text += `$${i + 1}`;
  });
  return pool.query<T>(text, values as unknown[]);
}

export interface PdjEntry {
  date: string;
  plats: Plat[];
  recommandation?: Recommandation;
  recommandation_goulaf?: Recommandation;
  erreur?: string;
  ferie?: string;
}

export interface Plat {
  restaurant: string;
  /** Nom du plat ; tableau quand le resto propose plusieurs plats au choix (voir `options`). */
  plat: string | string[];
  prix: string;
  /**
   * Plats multi-options (Basilic n'Go, Dubble) : l'agent diététicien note chaque option ici
   * et laisse la racine sans note. Toujours passer par `lib/plat-options.ts` pour les lire.
   */
  options?: PlatOption[];
  nutrition_estimee?: {
    calories: number;
    proteines_g: number;
    glucides_g: number;
    lipides_g: number;
  };
  /** "ciqual" : agrégé depuis la table Ciqual ; "llm" : estimation directe Claude (fallback) */
  nutrition_source?: "ciqual" | "llm";
  ingredients_detail?: IngredientDetail[];
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  commentaires?: Commentaire[];
  coming_soon?: boolean;
  /** Tags de classification générés par le LLM à l'évaluation (pour le quiz). */
  quiz_tags?: QuizTags;
}

/** Une option d'un plat multi-options : mêmes champs de notation que `Plat`, sans resto ni prix. */
export interface PlatOption {
  plat?: string;
  nutrition_estimee?: Plat["nutrition_estimee"];
  nutrition_source?: "ciqual" | "llm";
  ingredients_detail?: IngredientDetail[];
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  quiz_tags?: QuizTags;
}

/** Classification d'un plat sur les axes du quiz « Aide-moi à choisir ». */
export interface QuizTags {
  envie?: string; // poulet | boeuf | porc | veau | agneau | poisson | vege
  cuisine?: string; // mijote | asiatique | mediterraneen | streetfood | froid | autre
  lourdeur?: string; // leger | copieux
}

export interface IngredientDetail {
  nom_query: string;
  grammes: number;
  matched_nom: string | null;
  matched_code: string | null;
  kcal: number;
  prot: number;
  gluc: number;
  lip: number;
}

export interface Commentaire {
  auteur: string;
  texte: string;
  image_url?: string;
  reponse_a?: string;
  reponse_a_index?: number;
  /** true = écrit par un humain via le formulaire, sinon généré par l'IA */
  is_human?: boolean;
}

export interface Recommandation {
  restaurant: string;
  plat: string;
  raison: string;
}

// --- Carte permanente (notée une fois, ré-évaluée par hash) ---

export interface CartePlat {
  plat: string;
  prix: string;
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  nutrition_estimee?: {
    calories: number;
    proteines_g: number;
    glucides_g: number;
    lipides_g: number;
  };
  nutrition_source?: "ciqual" | "llm";
  ingredients_detail?: IngredientDetail[];
}

export interface CarteSection {
  nom: string;
  plats: CartePlat[];
}

export interface Carte {
  restaurant_slug: string;
  hash: string;
  restaurant?: string;
  sections: CarteSection[];
  evaluated_at?: string | null;
}

/** Crée la table si elle n'existe pas */
export async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_entries (
      id SERIAL PRIMARY KEY,
      date DATE UNIQUE NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/** Insère ou met à jour un PDJ pour une date donnée */
export async function upsertPdj(entry: PdjEntry) {
  await sql`
    INSERT INTO pdj_entries (date, data, updated_at)
    VALUES (${entry.date}, ${JSON.stringify(entry)}, NOW())
    ON CONFLICT (date)
    DO UPDATE SET data = ${JSON.stringify(entry)}, updated_at = NOW()
  `;
}

/** Récupère le PDJ le plus récent */
export async function getLatestPdj(): Promise<PdjEntry | null> {
  const result = await sql`
    SELECT data FROM pdj_entries
    ORDER BY date DESC
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return result.rows[0].data as PdjEntry;
}

/** Récupère tous les PDJ, du plus récent au plus ancien */
export async function getAllPdj(): Promise<PdjEntry[]> {
  const result = await sql`
    SELECT data FROM pdj_entries
    ORDER BY date DESC
  `;
  return result.rows.map((row) => row.data as PdjEntry);
}

/** Récupère les PDJ de la semaine en cours (lun-ven), ou d'une semaine précise si `mondayStr` fourni (YYYY-MM-DD) */
export async function getWeekPdj(mondayStr?: string): Promise<PdjEntry[]> {
  let monday: Date;
  if (mondayStr) {
    monday = new Date(mondayStr + "T12:00:00");
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
  }
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const mondayIso = monday.toLocaleDateString('en-CA');
  const fridayStr = friday.toLocaleDateString('en-CA');

  const result = await sql`
    SELECT data FROM pdj_entries
    WHERE date >= ${mondayIso} AND date <= ${fridayStr}
    ORDER BY date ASC
  `;
  return result.rows.map((row) => row.data as PdjEntry);
}

/** Récupère un PDJ par date */
export async function getPdjByDate(date: string): Promise<PdjEntry | null> {
  const result = await sql`
    SELECT data FROM pdj_entries
    WHERE date = ${date}
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return result.rows[0].data as PdjEntry;
}

// --- Idées d'améliorations ---

export interface Idee {
  id: number;
  auteur: string;
  texte: string;
  votes: string[]; // noms des votants
  statut: "nouveau" | "fait" | "refusé";
  created_at: string;
  faisabilite?: "faisable" | "complexe" | "impossible" | "troll" | null;
  evaluation?: string | null;
  evaluated_at?: string | null;
  /** Réponse de l'équipe (ex. « c'est sorti »), affichée sous l'idée. */
  reponse?: string | null;
  reponse_at?: string | null;
  /** Idée archivée : sortie de la liste des votes, listée dans « Idées sorties ». */
  archived_at?: string | null;
}

/** Crée la table des idées si elle n'existe pas */
export async function ensureIdeesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_idees (
      id SERIAL PRIMARY KEY,
      auteur VARCHAR(50) NOT NULL,
      texte VARCHAR(500) NOT NULL,
      votes JSONB DEFAULT '[]'::jsonb,
      statut VARCHAR(20) DEFAULT 'nouveau',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      faisabilite VARCHAR(20),
      evaluation TEXT,
      evaluated_at TIMESTAMPTZ
    )
  `;
  // Migration en place pour bases existantes
  await sql`ALTER TABLE pdj_idees ADD COLUMN IF NOT EXISTS faisabilite VARCHAR(20)`;
  await sql`ALTER TABLE pdj_idees ADD COLUMN IF NOT EXISTS evaluation TEXT`;
  await sql`ALTER TABLE pdj_idees ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ`;
  await sql`ALTER TABLE pdj_idees ADD COLUMN IF NOT EXISTS reponse TEXT`;
  await sql`ALTER TABLE pdj_idees ADD COLUMN IF NOT EXISTS reponse_at TIMESTAMPTZ`;
  await sql`ALTER TABLE pdj_idees ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
}

/** Récupère toutes les idées (hors trolls), triées par nombre de votes desc ; archivées en dernier, plus récentes d'abord */
export async function getAllIdees(): Promise<Idee[]> {
  await ensureIdeesTable();
  const result = await sql`
    SELECT id, auteur, texte, votes, statut, created_at, faisabilite, evaluation, evaluated_at,
           reponse, reponse_at, archived_at
    FROM pdj_idees
    WHERE faisabilite IS DISTINCT FROM 'troll'
    ORDER BY archived_at IS NOT NULL, archived_at DESC, jsonb_array_length(votes) DESC, created_at DESC
  `;
  return result.rows.map((row) => ({
    id: row.id,
    auteur: row.auteur,
    texte: row.texte,
    votes: row.votes as string[],
    statut: row.statut,
    created_at: row.created_at,
    faisabilite: row.faisabilite,
    evaluation: row.evaluation,
    evaluated_at: row.evaluated_at,
    reponse: row.reponse,
    reponse_at: row.reponse_at,
    archived_at: row.archived_at,
  }));
}

/** Récupère les idées non encore évaluées (pour le pipeline IA) */
export async function getIdeesNonEvaluees(): Promise<Idee[]> {
  await ensureIdeesTable();
  const result = await sql`
    SELECT id, auteur, texte, votes, statut, created_at, faisabilite, evaluation, evaluated_at
    FROM pdj_idees
    WHERE evaluated_at IS NULL
    ORDER BY created_at ASC
  `;
  return result.rows.map((row) => ({
    id: row.id,
    auteur: row.auteur,
    texte: row.texte,
    votes: row.votes as string[],
    statut: row.statut,
    created_at: row.created_at,
    faisabilite: row.faisabilite,
    evaluation: row.evaluation,
    evaluated_at: row.evaluated_at,
  }));
}

/** Enregistre l'évaluation IA d'une idée */
export async function setIdeeEvaluation(
  id: number,
  faisabilite: "faisable" | "complexe" | "impossible" | "troll",
  evaluation: string
): Promise<boolean> {
  await ensureIdeesTable();
  const result = await sql`
    UPDATE pdj_idees
    SET faisabilite = ${faisabilite}, evaluation = ${evaluation}, evaluated_at = NOW()
    WHERE id = ${id}
  `;
  return (result.rowCount ?? 0) > 0;
}

/**
 * Suivi d'une idée par l'équipe : statut, réponse (chaîne vide = retirée), archivage.
 * Les champs absents sont laissés tels quels.
 */
export async function setIdeeSuivi(
  id: number,
  suivi: { statut?: Idee["statut"]; reponse?: string; archiver?: boolean }
): Promise<boolean> {
  await ensureIdeesTable();
  const majReponse = suivi.reponse !== undefined;
  const reponse = suivi.reponse?.trim() || null;
  const majArchive = suivi.archiver !== undefined;
  const result = await sql`
    UPDATE pdj_idees SET
      statut = COALESCE(${suivi.statut ?? null}, statut),
      reponse = CASE WHEN ${majReponse} THEN ${reponse} ELSE reponse END,
      reponse_at = CASE WHEN ${majReponse} THEN (CASE WHEN ${reponse}::text IS NULL THEN NULL ELSE NOW() END) ELSE reponse_at END,
      archived_at = CASE WHEN ${majArchive} THEN (CASE WHEN ${suivi.archiver === true} THEN COALESCE(archived_at, NOW()) ELSE NULL END) ELSE archived_at END
    WHERE id = ${id}
  `;
  return (result.rowCount ?? 0) > 0;
}

/** Ajoute une nouvelle idée */
export async function addIdee(auteur: string, texte: string): Promise<Idee> {
  await ensureIdeesTable();
  const result = await sql`
    INSERT INTO pdj_idees (auteur, texte)
    VALUES (${auteur}, ${texte})
    RETURNING id, auteur, texte, votes, statut, created_at
  `;
  const row = result.rows[0];
  return {
    id: row.id,
    auteur: row.auteur,
    texte: row.texte,
    votes: row.votes as string[],
    statut: row.statut,
    created_at: row.created_at,
  };
}

/** Toggle le vote d'un utilisateur sur une idée */
export async function toggleVoteIdee(ideeId: number, votant: string): Promise<boolean> {
  await ensureIdeesTable();
  const result = await sql`
    SELECT votes FROM pdj_idees WHERE id = ${ideeId}
  `;
  if (result.rows.length === 0) return false;

  const votes = result.rows[0].votes as string[];
  const index = votes.indexOf(votant);
  if (index >= 0) {
    votes.splice(index, 1);
  } else {
    votes.push(votant);
  }

  await sql`
    UPDATE pdj_idees SET votes = ${JSON.stringify(votes)} WHERE id = ${ideeId}
  `;
  return true;
}

// --- Profils IA (éditables depuis /ia) ---

export interface IaProfile {
  nom: string; // clé unique (filename sans .json)
  prenom: string;
  emoji: string;
  couleur: string;
  role: string;
  personnalite: string;
  traits: string[];
  style_de_parole: string;
  sujets_fetiches: string[];
  blagues_recurrentes: string[];
  gifs_fetiches: string[]; // URLs de gifs
  avatar_url?: string; // URL custom pour la photo de profil (override de CHARACTERS_BY_NAME)
  actif: boolean;
  updated_at?: string;
  updated_by?: string;
}

export async function ensureIaProfilesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS ia_profiles (
      nom VARCHAR(50) PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by VARCHAR(50)
    )
  `;
}

export async function getAllIaProfiles(): Promise<IaProfile[]> {
  await ensureIaProfilesTable();
  const result = await sql`
    SELECT nom, data, updated_at, updated_by FROM ia_profiles ORDER BY nom ASC
  `;
  return result.rows.map((r) => ({
    ...(r.data as Omit<IaProfile, "nom" | "updated_at" | "updated_by">),
    nom: r.nom,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  }));
}

export async function getIaProfile(nom: string): Promise<IaProfile | null> {
  await ensureIaProfilesTable();
  const result = await sql`
    SELECT nom, data, updated_at, updated_by FROM ia_profiles WHERE nom = ${nom} LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    ...(r.data as Omit<IaProfile, "nom" | "updated_at" | "updated_by">),
    nom: r.nom,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  };
}

export async function upsertIaProfile(profile: IaProfile, updatedBy?: string): Promise<void> {
  await ensureIaProfilesTable();
  const { nom, ...data } = profile;
  await sql`
    INSERT INTO ia_profiles (nom, data, updated_at, updated_by)
    VALUES (${nom}, ${JSON.stringify(data)}, NOW(), ${updatedBy ?? null})
    ON CONFLICT (nom)
    DO UPDATE SET data = ${JSON.stringify(data)}, updated_at = NOW(), updated_by = ${updatedBy ?? null}
  `;
}

// --- Photos de référence des portions ---

export interface Photo {
  id: number;
  restaurant_slug: string;
  filename: string;
  content_type: string;
  plat_nom?: string;
  plat_date?: string;
  created_at: string;
}

export interface RecentDish {
  plat_nom: string;
  plat_date: string;
}

export async function ensurePhotosTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_photos (
      id SERIAL PRIMARY KEY,
      restaurant_slug VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      content_type VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
      image_data TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_pdj_photos_slug ON pdj_photos(restaurant_slug)`;
  await sql`ALTER TABLE pdj_photos ADD COLUMN IF NOT EXISTS plat_nom TEXT`;
  await sql`ALTER TABLE pdj_photos ADD COLUMN IF NOT EXISTS plat_date DATE`;
}

export async function getAllPhotos(): Promise<Photo[]> {
  await ensurePhotosTable();
  const result = await sql`
    SELECT id, restaurant_slug, filename, content_type, plat_nom, plat_date, created_at
    FROM pdj_photos
    ORDER BY restaurant_slug ASC, created_at ASC
  `;
  return result.rows as Photo[];
}

export async function getPhotosBySlug(slug: string): Promise<Photo[]> {
  await ensurePhotosTable();
  const result = await sql`
    SELECT id, restaurant_slug, filename, content_type, plat_nom, plat_date, created_at
    FROM pdj_photos
    WHERE restaurant_slug = ${slug}
    ORDER BY created_at ASC
  `;
  return result.rows as Photo[];
}

export async function addPhoto(
  slug: string,
  filename: string,
  contentType: string,
  imageDataBase64: string,
  platNom?: string,
  platDate?: string
): Promise<Photo> {
  await ensurePhotosTable();
  const result = await sql`
    INSERT INTO pdj_photos (restaurant_slug, filename, content_type, image_data, plat_nom, plat_date)
    VALUES (${slug}, ${filename}, ${contentType}, ${imageDataBase64}, ${platNom ?? null}, ${platDate ?? null})
    RETURNING id, restaurant_slug, filename, content_type, plat_nom, plat_date, created_at
  `;
  return result.rows[0] as Photo;
}

export async function getRecentDishesBySlug(slug: string, limit = 30): Promise<RecentDish[]> {
  const restaurantName = SLUG_TO_RESTAURANT[slug];
  if (!restaurantName) return [];
  const result = await sql`
    SELECT DISTINCT
      plat->>'plat' AS plat_nom,
      e.date AS plat_date
    FROM pdj_entries e,
      jsonb_array_elements(e.data->'plats') AS plat
    WHERE plat->>'restaurant' = ${restaurantName}
      AND plat->>'coming_soon' IS DISTINCT FROM 'true'
    ORDER BY e.date DESC
    LIMIT ${limit}
  `;
  return result.rows as RecentDish[];
}

export async function getPhotoData(
  id: number
): Promise<{ content_type: string; image_data: string } | null> {
  await ensurePhotosTable();
  const result = await sql`
    SELECT content_type, image_data FROM pdj_photos WHERE id = ${id}
  `;
  if (result.rows.length === 0) return null;
  return result.rows[0] as { content_type: string; image_data: string };
}

export async function deletePhoto(id: number): Promise<boolean> {
  await ensurePhotosTable();
  const result = await sql`DELETE FROM pdj_photos WHERE id = ${id}`;
  return (result.rowCount ?? 0) > 0;
}

// --- Images importées (photo de profil IA, gifs fétiches) servies par /api/images/<id>.<ext> ---

export async function ensureImagesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_images (
      id SERIAL PRIMARY KEY,
      content_type VARCHAR(50) NOT NULL,
      image_data TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function addImage(contentType: string, imageDataBase64: string): Promise<number> {
  await ensureImagesTable();
  const result = await sql`
    INSERT INTO pdj_images (content_type, image_data)
    VALUES (${contentType}, ${imageDataBase64})
    RETURNING id
  `;
  return result.rows[0].id as number;
}

export async function getImage(
  id: number
): Promise<{ content_type: string; image_data: string } | null> {
  await ensureImagesTable();
  const result = await sql`SELECT content_type, image_data FROM pdj_images WHERE id = ${id}`;
  if (result.rows.length === 0) return null;
  return result.rows[0] as { content_type: string; image_data: string };
}

/** Ajoute un commentaire à un plat pour une date donnée */
export async function addCommentaire(
  date: string,
  platIndex: number,
  commentaire: Commentaire
): Promise<boolean> {
  const entry = await getPdjByDate(date);
  if (!entry) return false;
  if (platIndex < 0 || platIndex >= entry.plats.length) return false;

  if (!entry.plats[platIndex].commentaires) {
    entry.plats[platIndex].commentaires = [];
  }
  entry.plats[platIndex].commentaires!.push(commentaire);
  await upsertPdj(entry);
  return true;
}

/** Crée la table de la carte si elle n'existe pas */
export async function ensureCarteTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_carte (
      restaurant_slug VARCHAR(50) PRIMARY KEY,
      hash TEXT NOT NULL,
      data JSONB NOT NULL,
      evaluated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/** Récupère la carte stockée pour un restaurant (ou null) */
export async function getCarte(slug: string): Promise<Carte | null> {
  await ensureCarteTable();
  const result = await sql`
    SELECT data, hash, evaluated_at FROM pdj_carte WHERE restaurant_slug = ${slug} LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    ...(r.data as Carte),
    hash: r.hash,
    evaluated_at: r.evaluated_at,
  };
}

/** Insère ou met à jour la carte d'un restaurant */
export async function upsertCarte(carte: Carte): Promise<void> {
  await ensureCarteTable();
  await sql`
    INSERT INTO pdj_carte (restaurant_slug, hash, data, evaluated_at)
    VALUES (${carte.restaurant_slug}, ${carte.hash}, ${JSON.stringify(carte)}, NOW())
    ON CONFLICT (restaurant_slug)
    DO UPDATE SET hash = ${carte.hash}, data = ${JSON.stringify(carte)}, evaluated_at = NOW()
  `;
}

export interface CarteDisponible {
  slug: string;
  evaluated_at: string | null;
}

/** Cartes présentes en base (slug + date d'évaluation), sans le contenu : sert au SSR
 *  pour savoir quelles cards ont un dépliant « Voir la carte ». */
export async function getCartesDisponibles(): Promise<CarteDisponible[]> {
  await ensureCarteTable();
  const result = await sql`SELECT restaurant_slug, evaluated_at FROM pdj_carte`;
  return result.rows.map((r) => ({
    slug: r.restaurant_slug as string,
    evaluated_at: r.evaluated_at ? new Date(r.evaluated_at as string | Date).toISOString() : null,
  }));
}

// --- Observations quotidiennes des desserts (Truck Muche) ---

/** Crée la table d'observations de desserts si elle n'existe pas. */
export async function ensureDessertsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_desserts_observations (
      date DATE NOT NULL,
      nom TEXT NOT NULL,
      observed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (date, nom)
    )
  `;
}

/** Insère les desserts observés pour une date (idempotent). Retourne le nb d'inserts tentés. */
export async function insertDessertsObservations(
  date: string,
  noms: string[]
): Promise<number> {
  await ensureDessertsTable();
  let n = 0;
  for (const raw of noms) {
    const nom = raw.trim();
    if (!nom) continue;
    await sql`
      INSERT INTO pdj_desserts_observations (date, nom)
      VALUES (${date}, ${nom})
      ON CONFLICT (date, nom) DO NOTHING
    `;
    n++;
  }
  return n;
}

/** Récupère les observations depuis `sinceDate` (incluse), date renvoyée en YYYY-MM-DD. */
export async function getDessertsObservations(
  sinceDate: string
): Promise<{ date: string; nom: string }[]> {
  await ensureDessertsTable();
  const result = await sql`
    SELECT to_char(date, 'YYYY-MM-DD') AS date, nom
    FROM pdj_desserts_observations
    WHERE date >= ${sinceDate}
    ORDER BY date DESC
  `;
  return result.rows.map((r) => ({ date: r.date as string, nom: r.nom as string }));
}

// --- Runs du pipeline (logs & relance) ---

export type PipelineMode = "jour" | "semaine";
export type PipelineStatus = "requested" | "running" | "success" | "error" | "partial";

export interface PipelineRun {
  id: number;
  mode: PipelineMode;
  status: PipelineStatus;
  triggered_by: string; // "admin" | "cron"
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  log: string | null;
}

const RUNS_KEEP = 50;
const LOG_MAX_CHARS = 200_000;
const STALE_RUNNING_MINUTES = 120; // un run 'running' sans report au-delà = échec

export async function ensurePipelineRunsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id SERIAL PRIMARY KEY,
      mode VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'requested',
      triggered_by VARCHAR(20) NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      log TEXT
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pipeline_runs_single_active
    ON pipeline_runs ((1)) WHERE status IN ('requested', 'running')
  `;
}

/** Y a-t-il déjà un run en attente ou en cours ? */
export async function hasActiveRun(): Promise<boolean> {
  await ensurePipelineRunsTable();
  const r = await sql`
    SELECT 1 FROM pipeline_runs
    WHERE status IN ('requested', 'running') LIMIT 1
  `;
  return r.rows.length > 0;
}

/** Marque en échec les runs 'running' trop vieux (poller mort / report perdu). */
export async function reapStaleRuns(): Promise<void> {
  await sql`
    UPDATE pipeline_runs
    SET status = 'error',
        finished_at = NOW(),
        log = COALESCE(log, '') || '\n[reaper] run marqué en échec (aucun report après ' || ${STALE_RUNNING_MINUTES} || ' min)'
    WHERE status = 'running'
      AND started_at < NOW() - (${STALE_RUNNING_MINUTES} || ' minutes')::interval
  `;
}

/** Crée une demande de run. Renvoie l'id, ou null si un run est déjà actif. */
export async function requestRun(
  mode: PipelineMode,
  triggeredBy = "admin"
): Promise<number | null> {
  await ensurePipelineRunsTable();
  await reapStaleRuns();
  try {
    const r = await sql`
      INSERT INTO pipeline_runs (mode, status, triggered_by)
      VALUES (${mode}, 'requested', ${triggeredBy})
      RETURNING id
    `;
    return r.rows[0].id as number;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return null; // index unique = run déjà actif
    throw e;
  }
}

/** Renvoie les N runs les plus récents. */
export async function getRecentRuns(): Promise<PipelineRun[]> {
  await ensurePipelineRunsTable();
  await reapStaleRuns();
  const r = await sql`
    SELECT id, mode, status, triggered_by, created_at, started_at, finished_at, log
    FROM pipeline_runs
    ORDER BY id DESC
    LIMIT ${RUNS_KEEP}
  `;
  return r.rows as PipelineRun[];
}

/** Claim atomique du plus vieux run 'requested' → 'running'. Renvoie {id, mode} ou null. */
export async function claimNextRun(): Promise<{ id: number; mode: PipelineMode } | null> {
  await ensurePipelineRunsTable();
  const r = await sql`
    UPDATE pipeline_runs SET status = 'running', started_at = NOW()
    WHERE id = (
      SELECT id FROM pipeline_runs
      WHERE status = 'requested'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, mode
  `;
  if (r.rows.length === 0) return null;
  return { id: r.rows[0].id as number, mode: r.rows[0].mode as PipelineMode };
}

function truncateLog(log: string): string {
  if (log.length <= LOG_MAX_CHARS) return log;
  return log.slice(-LOG_MAX_CHARS);
}

async function purgeOldRuns() {
  await sql`
    DELETE FROM pipeline_runs
    WHERE id NOT IN (SELECT id FROM pipeline_runs ORDER BY id DESC LIMIT ${RUNS_KEEP})
  `;
}

/** Clôt un run existant (par id). */
export async function finishRun(
  id: number,
  status: PipelineStatus,
  log: string
): Promise<void> {
  await ensurePipelineRunsTable();
  await sql`
    UPDATE pipeline_runs
    SET status = ${status}, log = ${truncateLog(log)}, finished_at = NOW()
    WHERE id = ${id}
  `;
  await purgeOldRuns();
}

/** Insère directement un run déjà terminé (cron 7h30, ne passe pas par claim). */
export async function recordFinishedRun(
  mode: PipelineMode,
  status: PipelineStatus,
  log: string,
  triggeredBy = "cron"
): Promise<void> {
  await ensurePipelineRunsTable();
  await sql`
    INSERT INTO pipeline_runs (mode, status, triggered_by, started_at, finished_at, log)
    VALUES (${mode}, ${status}, ${triggeredBy}, NOW(), NOW(), ${truncateLog(log)})
  `;
  await purgeOldRuns();
}

// --- Images IA des plats (POC) ---
// Une ligne par variante de plat, clé = `clePlatImage` (lib/plat-image-cle.ts, identique
// au pipeline Python). Rien dans `pdj_entries` : la clé se recalcule depuis le nom.

export async function ensurePlatImagesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_plat_images (
      cle VARCHAR(64) PRIMARY KEY,
      restaurant TEXT NOT NULL,
      plat TEXT NOT NULL,
      prompt TEXT,
      fournisseur VARCHAR(50),
      content_type VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
      image_data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/** Insère l'image ; si la clé existe : ne fait rien, sauf `force` (régénération). Renvoie true si écrit. */
export async function upsertPlatImage(img: {
  cle: string;
  restaurant: string;
  plat: string;
  prompt?: string | null;
  fournisseur?: string | null;
  content_type: string;
  data: Buffer;
  force?: boolean;
}): Promise<boolean> {
  await ensurePlatImagesTable();
  const r = img.force
    ? await sql`
        INSERT INTO pdj_plat_images (cle, restaurant, plat, prompt, fournisseur, content_type, image_data)
        VALUES (${img.cle}, ${img.restaurant}, ${img.plat}, ${img.prompt ?? null}, ${img.fournisseur ?? null}, ${img.content_type}, ${img.data})
        ON CONFLICT (cle) DO UPDATE SET restaurant = EXCLUDED.restaurant, plat = EXCLUDED.plat, prompt = EXCLUDED.prompt,
          fournisseur = EXCLUDED.fournisseur, content_type = EXCLUDED.content_type, image_data = EXCLUDED.image_data, created_at = NOW()
      `
    : await sql`
        INSERT INTO pdj_plat_images (cle, restaurant, plat, prompt, fournisseur, content_type, image_data)
        VALUES (${img.cle}, ${img.restaurant}, ${img.plat}, ${img.prompt ?? null}, ${img.fournisseur ?? null}, ${img.content_type}, ${img.data})
        ON CONFLICT (cle) DO NOTHING
      `;
  return (r.rowCount ?? 0) > 0;
}

// Version d'une image = created_at en ms, calculée côté SQL partout (URL `?v=` et contrôle de
// la route) pour qu'elles concordent exactement.

/** Table absente (déploiement sans `db:migrate` ni ingestion) : lu comme « aucune image ». */
function tableAbsente(e: unknown): boolean {
  return (e as { code?: string })?.code === "42P01";
}

/** Colonne absente (code déployé avant la migration des colonnes de notes des recettes). */
function colonneAbsente(e: unknown): boolean {
  return (e as { code?: string })?.code === "42703";
}

/**
 * Image d'un plat. Lecture seule, sans DDL (la table est créée par `lib/migrate.mjs` et par
 * l'ingestion). Avec `versionMs`, les octets ne sont lus que si la version demandée est la
 * version en base (sinon `image_data` vaut null : la route redirige sans lire le bytea).
 */
export async function getPlatImage(
  cle: string,
  versionMs?: number | null,
): Promise<{ content_type: string; image_data: Buffer | null; version_ms: number } | null> {
  try {
    const r = versionMs == null
      ? await sql`SELECT content_type, image_data, floor(extract(epoch FROM created_at) * 1000)::bigint AS version_ms FROM pdj_plat_images WHERE cle = ${cle}`
      : await sql`
          SELECT content_type, floor(extract(epoch FROM created_at) * 1000)::bigint AS version_ms,
            CASE WHEN floor(extract(epoch FROM created_at) * 1000)::bigint = ${versionMs}::bigint THEN image_data END AS image_data
          FROM pdj_plat_images WHERE cle = ${cle}`;
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return { content_type: row.content_type as string, image_data: (row.image_data as Buffer | null) ?? null, version_ms: Number(row.version_ms) };
  } catch (e) {
    if (tableAbsente(e)) return null;
    throw e;
  }
}

export interface PlatImageMeta {
  creeLe: string;
  fournisseur: string | null;
}

/** Clés présentes parmi `cles`, avec date de création (version de l'URL) et fournisseur (crédit). */
export async function platImagesExistantes(cles: string[]): Promise<Map<string, PlatImageMeta>> {
  if (cles.length === 0) return new Map();
  try {
    const r = await sql`SELECT cle, floor(extract(epoch FROM created_at) * 1000)::bigint AS version_ms, fournisseur FROM pdj_plat_images WHERE cle = ANY(${cles})`;
    return new Map(
      r.rows.map((row) => [
        row.cle as string,
        { creeLe: new Date(Number(row.version_ms)).toISOString(), fournisseur: (row.fournisseur as string | null) ?? null },
      ]),
    );
  } catch (e) {
    if (tableAbsente(e)) return new Map();
    throw e;
  }
}

// --- Recettes (POC) ---
// Une recette par variante de plat, clé = `clePlatImage` (la même que l'image du plat).
// `pdj_recette_services` garde chaque date de service, sans FK : une date peut arriver avant
// la recette (génération ratée puis rattrapée). Contrat : docs/poc-recettes-spec.md §2.

export async function ensureRecettesTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_recettes (
      cle VARCHAR(24) PRIMARY KEY,
      restaurant TEXT NOT NULL,
      plat TEXT NOT NULL,
      titre TEXT NOT NULL,
      recette JSONB NOT NULL,
      recherche TEXT NOT NULL DEFAULT '',
      modele VARCHAR(80),
      fournisseur VARCHAR(50),
      version_prompt SMALLINT,
      date_premier_service DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS pdj_recettes_restaurant_idx ON pdj_recettes (restaurant)`;
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_recette_services (
      cle VARCHAR(24) NOT NULL,
      date DATE NOT NULL,
      PRIMARY KEY (cle, date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS pdj_recette_services_date_idx ON pdj_recette_services (date)`;
  // Notes du plat d'origine + protéine (tri et filtres de la banque). ALTER seulement si la colonne
  // manque : même avec IF NOT EXISTS, il prendrait un verrou ACCESS EXCLUSIVE à chaque ingestion.
  const colonnes = await sql`
    SELECT 1 FROM information_schema.columns WHERE table_name = 'pdj_recettes' AND column_name = 'proteine'
  `;
  if (!colonnes.rows.length) {
    await sql`
      ALTER TABLE pdj_recettes ADD COLUMN IF NOT EXISTS note_sportif REAL, ADD COLUMN IF NOT EXISTS note_goulaf REAL,
        ADD COLUMN IF NOT EXISTS note_date DATE, ADD COLUMN IF NOT EXISTS proteine VARCHAR(10)
    `;
  }
}

/**
 * Insère la recette ; si la clé existe : ne fait rien, sauf `force` (régénération, sans toucher
 * à `created_at`). La date de service est enregistrée dans tous les cas. Renvoie true si écrit.
 */
export async function upsertRecette(r: {
  cle: string;
  restaurant: string;
  plat: string;
  titre: string;
  recette: RecetteContenu;
  recherche: string;
  modele: string | null;
  fournisseur: string | null;
  version_prompt: number | null;
  /** Date du plat ; enregistrée comme date de service seulement si `servi`. */
  date: string;
  servi: boolean;
  force: boolean;
}): Promise<boolean> {
  await ensureRecettesTable();
  // Jour à venir (PDJ publié d'avance) : pas de « Servi le … » tant que le plat n'est pas servi.
  const premier = r.servi ? r.date : null;
  const json = JSON.stringify(r.recette);
  const res = r.force
    ? await sql`
        INSERT INTO pdj_recettes (cle, restaurant, plat, titre, recette, recherche, modele, fournisseur, version_prompt, date_premier_service)
        VALUES (${r.cle}, ${r.restaurant}, ${r.plat}, ${r.titre}, ${json}::jsonb, ${r.recherche}, ${r.modele}, ${r.fournisseur}, ${r.version_prompt}, ${premier}::date)
        ON CONFLICT (cle) DO UPDATE SET restaurant = EXCLUDED.restaurant, plat = EXCLUDED.plat, titre = EXCLUDED.titre,
          recette = EXCLUDED.recette, recherche = EXCLUDED.recherche, modele = EXCLUDED.modele, fournisseur = EXCLUDED.fournisseur,
          version_prompt = EXCLUDED.version_prompt,
          date_premier_service = LEAST(pdj_recettes.date_premier_service, EXCLUDED.date_premier_service), updated_at = NOW()
      `
    : await sql`
        INSERT INTO pdj_recettes (cle, restaurant, plat, titre, recette, recherche, modele, fournisseur, version_prompt, date_premier_service)
        VALUES (${r.cle}, ${r.restaurant}, ${r.plat}, ${r.titre}, ${json}::jsonb, ${r.recherche}, ${r.modele}, ${r.fournisseur}, ${r.version_prompt}, ${premier}::date)
        ON CONFLICT (cle) DO NOTHING
      `;
  if (r.servi) {
    await sql`INSERT INTO pdj_recette_services (cle, date) VALUES (${r.cle}, ${r.date}::date) ON CONFLICT DO NOTHING`;
    await sql`UPDATE pdj_recettes SET date_premier_service = LEAST(date_premier_service, ${r.date}::date) WHERE cle = ${r.cle}`;
  }
  return (res.rowCount ?? 0) > 0;
}

/** Dates de service des plats déjà pourvus d'une recette (le pipeline les saute). Renvoie le nb ajouté. */
export async function ajouterServicesRecettes(services: { cle: string; date: string }[]): Promise<number> {
  if (services.length === 0) return 0;
  await ensureRecettesTable();
  const cles = services.map((s) => s.cle);
  const dates = services.map((s) => s.date);
  const r = await sql`
    INSERT INTO pdj_recette_services (cle, date)
    SELECT * FROM unnest(${cles}::text[], ${dates}::date[])
    ON CONFLICT DO NOTHING
  `;
  await sql`
    UPDATE pdj_recettes r SET date_premier_service = LEAST(r.date_premier_service, s.d)
    FROM (SELECT cle, MIN(date) AS d FROM unnest(${cles}::text[], ${dates}::date[]) AS t(cle, date) GROUP BY cle) s
    WHERE r.cle = s.cle
  `;
  return r.rowCount ?? 0;
}

/** Clés présentes parmi `cles` (lecture seule, table absente = aucune). */
export async function recettesExistantes(cles: string[]): Promise<Set<string>> {
  if (cles.length === 0) return new Set();
  try {
    const r = await sql`SELECT cle FROM pdj_recettes WHERE cle = ANY(${cles})`;
    return new Set(r.rows.map((row) => row.cle as string));
  } catch (e) {
    if (tableAbsente(e)) return new Set();
    throw e;
  }
}

/** Image du plat (même clé) pour chaque recette, via les images existantes. */
async function imagesRecettes(cles: string[]): Promise<Map<string, ImagePlat>> {
  const out = new Map<string, ImagePlat>();
  for (const [cle, meta] of await platImagesExistantes(cles)) {
    const credit = creditFournisseur(meta.fournisseur);
    out.set(cle, credit ? { src: srcPlatImage(cle, meta.creeLe), credit } : { src: srcPlatImage(cle, meta.creeLe) });
  }
  return out;
}

const isoOuVide = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? new Date(d as string).toISOString() : "");

/** Recette complète avec ses dates de service (60 dernières) et l'image du plat ; null si absente. */
export async function getRecette(cle: string): Promise<RecetteComplete | null> {
  try {
    // Dates formatées côté SQL : `pg` renvoie un DATE en objet Date local.
    const r = await sql`
      SELECT r.cle, r.restaurant, r.plat, r.recette, r.modele, r.fournisseur, r.version_prompt, r.created_at, r.updated_at,
        to_char(LEAST(r.date_premier_service, (SELECT MIN(s.date) FROM pdj_recette_services s WHERE s.cle = r.cle)), 'YYYY-MM-DD') AS date_premier_service,
        ARRAY(SELECT to_char(s.date, 'YYYY-MM-DD') FROM pdj_recette_services s WHERE s.cle = r.cle ORDER BY s.date DESC LIMIT 60) AS dates_service
      FROM pdj_recettes r WHERE r.cle = ${cle}
    `;
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const [images, notes] = await Promise.all([imagesRecettes([cle]), notesRecette(cle)]);
    const image = images.get(cle) ?? null;
    return {
      ...(row.recette as RecetteContenu),
      ...notes,
      cle: row.cle as string,
      restaurant: row.restaurant as string,
      plat: row.plat as string,
      modele: (row.modele as string | null) ?? null,
      fournisseur: (row.fournisseur as string | null) ?? null,
      version_prompt: row.version_prompt == null ? null : Number(row.version_prompt),
      date_premier_service: (row.date_premier_service as string | null) ?? null,
      dates_service: (row.dates_service as string[] | null) ?? [],
      cree_le: isoOuVide(row.created_at),
      maj_le: isoOuVide(row.updated_at),
      image,
    };
  } catch (e) {
    if (tableAbsente(e)) return null;
    throw e;
  }
}

// --- Notes des recettes (recopiées depuis pdj_entries, cf. lib/recette-notes.ts) ---

const NOTES_VIDES: NotesRecetteChamps = { note_sportif: null, note_goulaf: null, note_date: null, proteine: null };

/** REAL (float4) → nombre arrondi au dixième, ou null. */
const noteLue = (v: unknown) => noteValide(v == null ? null : Number(v));

function notesDepuisLigne(row: Record<string, unknown>): NotesRecetteChamps {
  return {
    note_sportif: noteLue(row.note_sportif),
    note_goulaf: noteLue(row.note_goulaf),
    note_date: (row.note_date as string | null) ?? null,
    proteine: (row.proteine as ProteineRecette | null) ?? null,
  };
}

/** Notes d'une recette ; colonnes absentes (avant migration) = pas de notes, sans erreur. */
async function notesRecette(cle: string): Promise<NotesRecetteChamps> {
  try {
    const r = await sql`
      SELECT note_sportif, note_goulaf, to_char(note_date, 'YYYY-MM-DD') AS note_date, proteine
      FROM pdj_recettes WHERE cle = ${cle}
    `;
    return r.rows.length ? notesDepuisLigne(r.rows[0]) : NOTES_VIDES;
  } catch (e) {
    if (colonneAbsente(e)) return NOTES_VIDES;
    throw e;
  }
}

/** Plats du jour à partir d'une date (incluse), dans l'ordre chronologique. */
export async function getPdjDepuis(date: string): Promise<PdjEntry[]> {
  const r = await sql`SELECT data FROM pdj_entries WHERE date >= ${date} ORDER BY date`;
  return r.rows.map((row) => row.data as PdjEntry);
}

/**
 * Écrit les notes (une par clé après `fusionnerNotes` : un doublon dans `unnest` serait appliqué
 * de façon arbitraire). Une date plus ancienne que `note_date` n'écrase jamais ; à date égale,
 * la dernière écriture gagne (réévaluation du même jour). Restreint à `cles` si fourni.
 * Sans DDL : table ou colonnes absentes → 0. Renvoie le nombre de recettes mises à jour.
 */
export async function enregistrerNotesRecettes(notes: NotesVariante[], cles?: string[]): Promise<number> {
  const filtre = cles ? new Set(cles) : null;
  const lignes = fusionnerNotes(notes)
    .map((n) => ({ ...n, cle: clePlatImage(n.restaurant, n.plat) }))
    .filter((n) => !filtre || filtre.has(n.cle));
  if (lignes.length === 0) return 0;
  try {
    const r = await sql`
      UPDATE pdj_recettes r SET note_sportif = t.s, note_goulaf = t.g, note_date = t.d, proteine = t.p
      FROM unnest(${lignes.map((n) => n.cle)}::text[], ${lignes.map((n) => n.date)}::date[],
        ${lignes.map((n) => n.sportif)}::real[], ${lignes.map((n) => n.goulaf)}::real[],
        ${lignes.map((n) => n.proteine)}::text[]) AS t(cle, d, s, g, p)
      WHERE r.cle = t.cle AND (r.note_date IS NULL OR t.d >= r.note_date)
    `;
    return r.rowCount ?? 0;
  } catch (e) {
    if (tableAbsente(e) || colonneAbsente(e)) return 0;
    throw e;
  }
}

/** Recopie les notes des plats du jour `pdjs` (jours déjà servis seulement) dans les recettes correspondantes. */
export async function rafraichirNotesRecettes(pdjs: PdjEntry[], cles?: string[]): Promise<number> {
  // Pas `flatMap(notesDuJour)` : l'index passé en 2e argument remplacerait la date du jour.
  return enregistrerNotesRecettes(pdjs.flatMap((pdj) => notesDuJour(pdj)), cles);
}

/** Recette telle que relue pour un recalcul de ses notes. */
type RecetteARecalculer = { cle: string; restaurant: string; plat: string; recette: RecetteContenu };

/**
 * Recalcul complet des notes de `recettes` depuis tout l'historique des jours déjà servis, en une
 * seule écriture (atomique : jamais de banque remise à zéro à moitié). Sans règle de date : la note
 * retenue est celle du dernier service réel, quelle que soit la note en base ; une recette dont le
 * plat n'est retrouvé dans aucun jour servi perd ses notes et reçoit une protéine déduite de la
 * recette (elle n'est plus rescannée). Table ou colonnes absentes : l'appelant les absorbe.
 */
async function recalculerNotes(recettes: RecetteARecalculer[]): Promise<{ notees: number; sans_note: number }> {
  if (!recettes.length) return { notees: 0, sans_note: 0 };
  const aujourdhui = aujourdhuiParis();
  const historique = await sql`SELECT data FROM pdj_entries WHERE date <= ${aujourdhui} ORDER BY date`;
  const parCle = new Map(
    fusionnerNotes(historique.rows.flatMap((row) => notesDuJour(row.data as PdjEntry, aujourdhui)))
      .map((n) => [clePlatImage(n.restaurant, n.plat), n] as const),
  );
  const lignes = recettes.map((r) => {
    const n = parCle.get(r.cle);
    return n
      ? { cle: r.cle, d: n.date, s: n.sportif, g: n.goulaf, p: n.proteine }
      : { cle: r.cle, d: null, s: null, g: null, p: proteineDepuisRecette(r.restaurant, r.plat, r.recette) };
  });
  await sql`
    UPDATE pdj_recettes r SET note_sportif = t.s, note_goulaf = t.g, note_date = t.d, proteine = t.p
    FROM unnest(${lignes.map((l) => l.cle)}::text[], ${lignes.map((l) => l.d)}::date[],
      ${lignes.map((l) => l.s)}::real[], ${lignes.map((l) => l.g)}::real[],
      ${lignes.map((l) => l.p)}::text[]) AS t(cle, d, s, g, p)
    WHERE r.cle = t.cle
  `;
  const notees = lignes.filter((l) => l.d != null).length;
  return { notees, sans_note: lignes.length - notees };
}

const versRecalcul = (row: Record<string, unknown>): RecetteARecalculer => ({
  cle: row.cle as string,
  restaurant: row.restaurant as string,
  plat: row.plat as string,
  recette: row.recette as RecetteContenu,
});

/**
 * Rattrapage des recettes jamais traitées (`proteine IS NULL`), ou de toutes avec `toutes`
 * (après un changement de règle) : recalcul complet (`recalculerNotes`), qui ne relit
 * l'historique que s'il y a des recettes à traiter. Table ou colonnes absentes → { 0, 0 }.
 */
export async function rattraperNotesRecettes(toutes = false): Promise<{ notees: number; sans_note: number }> {
  try {
    const a = await sql`SELECT cle, restaurant, plat, recette FROM pdj_recettes WHERE ${toutes}::boolean OR proteine IS NULL`;
    return await recalculerNotes(a.rows.map(versRecalcul));
  } catch (e) {
    if (tableAbsente(e) || colonneAbsente(e)) return { notees: 0, sans_note: 0 };
    throw e;
  }
}

/**
 * Republication du jour `date` (/api/update) : les recettes dont la note venait de ce jour mais
 * dont le plat n'y figure plus (menu corrigé, erreur de scrape, férié) sont recalculées, sinon
 * elles garderaient une note fantôme que la règle de date protégerait. Une `note_date` à venir
 * (écrite avant que les jours non servis soient ignorés) est recalculée aussi.
 * Table ou colonnes absentes → 0. Renvoie le nombre de recettes recalculées.
 */
export async function recalculerNotesDuJour(pdj: PdjEntry): Promise<number> {
  const date = String(pdj.date).slice(0, 10);
  const encore = notesDuJour(pdj).map((n) => clePlatImage(n.restaurant, n.plat));
  try {
    const a = await sql`
      SELECT cle, restaurant, plat, recette FROM pdj_recettes
      WHERE (note_date = ${date}::date AND NOT (cle = ANY(${encore}::text[]))) OR note_date > ${aujourdhuiParis()}::date
    `;
    await recalculerNotes(a.rows.map(versRecalcul));
    return a.rows.length;
  } catch (e) {
    if (tableAbsente(e) || colonneAbsente(e)) return 0;
    throw e;
  }
}

function ligneVersResume(row: Record<string, unknown>, images: Map<string, ImagePlat>, notes: boolean): ResumeRecette {
  return {
    cle: row.cle as string,
    restaurant: row.restaurant as string,
    plat: row.plat as string,
    titre: row.titre as string,
    difficulte: row.difficulte as Difficulte,
    personnes: Number(row.personnes) || 0,
    temps_total_min: tempsTotal({
      temps_preparation_min: Number(row.prep) || 0,
      temps_cuisson_min: Number(row.cuisson) || 0,
      temps_repos_min: Number(row.repos) || 0,
    }),
    derniere_date: (row.derniere_date as string | null) ?? null,
    nb_services: Number(row.nb_services) || 0,
    image: images.get(row.cle as string) ?? null,
    ...(notes ? notesDepuisLigne(row) : NOTES_VIDES),
  };
}

export interface BanqueRecettes {
  recettes: ResumeRecette[];
  total: number;
  /** Nombre de recettes par protéine (recherche + restaurant appliqués, hors filtre protéine). */
  proteines: Partial<Record<ProteineRecette, number>>;
  /** false avant la migration des colonnes de notes : ni tri par note, ni filtre protéine. */
  notesDisponibles: boolean;
}

let repliSignale = false;

/**
 * Banque de recettes paginée : filtre texte sur `recherche` (normalisé comme les clés, donc
 * sans `unaccent`, en début de mot), par restaurant et par protéine ; tri par note Sportif /
 * Goulaf (non notées en dernier), par durée, ou par dernier service puis titre (`recentes`).
 */
export async function listerRecettes(p: {
  q: string;
  restaurant: string | null;
  proteine: Envie | null;
  tri: TriBanque;
  page: number;
  parPage: number;
}): Promise<BanqueRecettes> {
  // Un motif par mot, tous requis (LIKE ALL d'un tableau vide = vrai : pas de filtre).
  const motifs = motifsRecherche(p.q);
  const offset = (Math.max(1, p.page) - 1) * p.parPage;
  try {
    // 2 requêtes en parallèle puis les images : le pool est à 3 connexions.
    const [liste, facettes] = await Promise.all([
      sql`
        SELECT r.cle, r.restaurant, r.plat, r.titre,
          r.recette->>'difficulte' AS difficulte, r.recette->'personnes' AS personnes,
          r.recette->'temps_preparation_min' AS prep, r.recette->'temps_cuisson_min' AS cuisson, r.recette->'temps_repos_min' AS repos,
          r.note_sportif, r.note_goulaf, to_char(r.note_date, 'YYYY-MM-DD') AS note_date, r.proteine,
          to_char(COALESCE(MAX(s.date), r.date_premier_service), 'YYYY-MM-DD') AS derniere_date,
          COUNT(s.date)::int AS nb_services
        FROM pdj_recettes r LEFT JOIN pdj_recette_services s USING (cle)
        WHERE (' ' || r.recherche) LIKE ALL (${motifs}::text[])
          AND (${p.restaurant}::text IS NULL OR r.restaurant = ${p.restaurant}::text)
          AND (${p.proteine}::text IS NULL OR r.proteine = ${p.proteine}::text)
        GROUP BY r.cle
        ORDER BY
          CASE ${p.tri}::text WHEN 'sportif' THEN r.note_sportif WHEN 'goulaf' THEN r.note_goulaf END DESC NULLS LAST,
          CASE ${p.tri}::text WHEN 'sportif' THEN r.note_goulaf WHEN 'goulaf' THEN r.note_sportif END DESC NULLS LAST,
          CASE WHEN ${p.tri}::text = 'rapide' THEN COALESCE((r.recette->>'temps_preparation_min')::int, 0)
            + COALESCE((r.recette->>'temps_cuisson_min')::int, 0) + COALESCE((r.recette->>'temps_repos_min')::int, 0) END ASC NULLS LAST,
          COALESCE(MAX(s.date), r.date_premier_service) DESC NULLS LAST, r.titre ASC
        LIMIT ${p.parPage} OFFSET ${offset}
      `,
      sql`
        SELECT r.proteine, COUNT(*)::int AS n FROM pdj_recettes r
        WHERE (' ' || r.recherche) LIKE ALL (${motifs}::text[])
          AND (${p.restaurant}::text IS NULL OR r.restaurant = ${p.restaurant}::text)
        GROUP BY r.proteine
      `,
    ]);
    const proteines: Partial<Record<ProteineRecette, number>> = {};
    let tous = 0;
    for (const row of facettes.rows) {
      const n = Number(row.n) || 0;
      tous += n;
      if (row.proteine) proteines[row.proteine as ProteineRecette] = n;
    }
    // Total déduit des facettes : les recettes pas encore rattrapées (proteine NULL) comptent.
    const total = p.proteine ? (proteines[p.proteine] ?? 0) : tous;
    const images = await imagesRecettes(liste.rows.map((row) => row.cle as string));
    return {
      recettes: liste.rows.map((row) => ligneVersResume(row, images, true)),
      total,
      proteines,
      notesDisponibles: true,
    };
  } catch (e) {
    if (tableAbsente(e)) return { recettes: [], total: 0, proteines: {}, notesDisponibles: false };
    if (!colonneAbsente(e)) throw e;
  }
  // Repli avant migration : ordre historique, sans notes ni filtre protéine.
  if (!repliSignale) {
    repliSignale = true;
    console.warn("[recettes] colonnes de notes absentes : banque sans tri par note ni filtre protéine (migration à lancer)");
  }
  try {
    const [liste, compte] = await Promise.all([
      sql`
        SELECT r.cle, r.restaurant, r.plat, r.titre,
          r.recette->>'difficulte' AS difficulte, r.recette->'personnes' AS personnes,
          r.recette->'temps_preparation_min' AS prep, r.recette->'temps_cuisson_min' AS cuisson, r.recette->'temps_repos_min' AS repos,
          to_char(COALESCE(MAX(s.date), r.date_premier_service), 'YYYY-MM-DD') AS derniere_date,
          COUNT(s.date)::int AS nb_services
        FROM pdj_recettes r LEFT JOIN pdj_recette_services s USING (cle)
        WHERE (' ' || r.recherche) LIKE ALL (${motifs}::text[])
          AND (${p.restaurant}::text IS NULL OR r.restaurant = ${p.restaurant}::text)
        GROUP BY r.cle
        ORDER BY COALESCE(MAX(s.date), r.date_premier_service) DESC NULLS LAST, r.titre ASC
        LIMIT ${p.parPage} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS total FROM pdj_recettes r
        WHERE (' ' || r.recherche) LIKE ALL (${motifs}::text[])
          AND (${p.restaurant}::text IS NULL OR r.restaurant = ${p.restaurant}::text)
      `,
    ]);
    const images = await imagesRecettes(liste.rows.map((row) => row.cle as string));
    return {
      recettes: liste.rows.map((row) => ligneVersResume(row, images, false)),
      total: Number(compte.rows[0]?.total) || 0,
      proteines: {},
      notesDisponibles: false,
    };
  } catch (e) {
    if (tableAbsente(e)) return { recettes: [], total: 0, proteines: {}, notesDisponibles: false };
    throw e;
  }
}
