import { sql } from "@vercel/postgres";

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
  plat: string;
  prix: string;
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
}

/** Récupère toutes les idées (hors trolls), triées par nombre de votes desc */
export async function getAllIdees(): Promise<Idee[]> {
  await ensureIdeesTable();
  const result = await sql`
    SELECT id, auteur, texte, votes, statut, created_at, faisabilite, evaluation, evaluated_at
    FROM pdj_idees
    WHERE faisabilite IS DISTINCT FROM 'troll'
    ORDER BY jsonb_array_length(votes) DESC, created_at DESC
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
  created_at: string;
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
}

export async function getAllPhotos(): Promise<Photo[]> {
  await ensurePhotosTable();
  const result = await sql`
    SELECT id, restaurant_slug, filename, content_type, created_at
    FROM pdj_photos
    ORDER BY restaurant_slug ASC, created_at ASC
  `;
  return result.rows as Photo[];
}

export async function getPhotosBySlug(slug: string): Promise<Photo[]> {
  await ensurePhotosTable();
  const result = await sql`
    SELECT id, restaurant_slug, filename, content_type, created_at
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
  imageDataBase64: string
): Promise<Photo> {
  await ensurePhotosTable();
  const result = await sql`
    INSERT INTO pdj_photos (restaurant_slug, filename, content_type, image_data)
    VALUES (${slug}, ${filename}, ${contentType}, ${imageDataBase64})
    RETURNING id, restaurant_slug, filename, content_type, created_at
  `;
  return result.rows[0] as Photo;
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
