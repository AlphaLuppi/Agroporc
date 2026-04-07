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
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  commentaires?: Commentaire[];
  coming_soon?: boolean;
}

export interface Commentaire {
  auteur: string;
  texte: string;
  image_url?: string;
  reponse_a?: string;
  reponse_a_index?: number;
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

/** Récupère les PDJ de la semaine en cours (lun-ven) */
export async function getWeekPdj(): Promise<PdjEntry[]> {
  // Calculer le lundi et vendredi de la semaine courante
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=dim, 1=lun, ..., 6=sam
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const mondayStr = monday.toISOString().slice(0, 10);
  const fridayStr = friday.toISOString().slice(0, 10);

  const result = await sql`
    SELECT data FROM pdj_entries
    WHERE date >= ${mondayStr} AND date <= ${fridayStr}
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
