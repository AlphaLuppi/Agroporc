/**
 * Script de migration : crée la table pdj_entries.
 * Usage : node lib/migrate.mjs
 *
 * Nécessite POSTGRES_URL dans l'environnement.
 * Tu peux aussi l'utiliser pour importer l'historique existant.
 */
import { createPool } from "@vercel/postgres";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const pool = createPool({ connectionString: process.env.POSTGRES_URL });

  console.log("[migrate] Création de la table pdj_entries...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdj_entries (
      id SERIAL PRIMARY KEY,
      date DATE UNIQUE NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("[migrate] Table créée.");

  // Import de l'historique existant si disponible
  const outputDir = join(__dirname, "..", "..", "output");
  const histDir = join(outputDir, "historique");
  const pdjFile = join(outputDir, "pdj.json");

  const files = [];

  if (existsSync(histDir)) {
    for (const f of readdirSync(histDir)) {
      if (f.startsWith("pdj_") && f.endsWith(".json")) {
        files.push(join(histDir, f));
      }
    }
  }
  if (existsSync(pdjFile)) {
    files.push(pdjFile);
  }

  if (files.length === 0) {
    console.log("[migrate] Pas de fichiers historiques à importer.");
  } else {
    console.log(`[migrate] Import de ${files.length} fichier(s)...`);
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(f, "utf-8"));
        const date = data.date;
        if (!date) continue;
        await pool.query(
          `INSERT INTO pdj_entries (date, data) VALUES ($1, $2)
           ON CONFLICT (date) DO UPDATE SET data = $2, updated_at = NOW()`,
          [date, JSON.stringify(data)]
        );
        console.log(`  [import] ${date}`);
      } catch (e) {
        console.error(`  [erreur] ${f}: ${e.message}`);
      }
    }
  }

  // --- Table profils IA ---
  console.log("[migrate] Création de la table ia_profiles...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ia_profiles (
      nom VARCHAR(50) PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by VARCHAR(50)
    )
  `);

  const countRes = await pool.query(`SELECT COUNT(*) FROM ia_profiles`);
  const count = parseInt(countRes.rows[0].count, 10);
  if (count === 0) {
    const persoDir = join(__dirname, "..", "plats-du-jour", "personnages");
    if (existsSync(persoDir)) {
      console.log("[migrate] Seed des profils IA depuis les fichiers JSON...");
      for (const f of readdirSync(persoDir)) {
        if (!f.endsWith(".json")) continue;
        const nom = f.replace(/\.json$/, "");
        try {
          const data = JSON.parse(readFileSync(join(persoDir, f), "utf-8"));
          const profile = {
            prenom: data.prenom || nom,
            emoji: data.emoji || "🙂",
            couleur: data.couleur || "#888888",
            role: data.role || "",
            personnalite: data.personnalite || "",
            traits: data.traits || [],
            style_de_parole: data.style_de_parole || "",
            sujets_fetiches: data.sujets_fetiches || [],
            blagues_recurrentes: data.blagues_recurrentes || [],
            gifs_fetiches: data.gifs_fetiches || [],
            actif: data.actif !== false,
          };
          await pool.query(
            `INSERT INTO ia_profiles (nom, data) VALUES ($1, $2)
             ON CONFLICT (nom) DO NOTHING`,
            [nom, JSON.stringify(profile)]
          );
          console.log(`  [seed] ${nom}`);
        } catch (e) {
          console.error(`  [erreur seed] ${f}: ${e.message}`);
        }
      }
    }
  } else {
    console.log(`[migrate] ia_profiles déjà peuplée (${count} profils).`);
  }

  // --- Table photos de référence ---
  console.log("[migrate] Création de la table pdj_photos...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdj_photos (
      id SERIAL PRIMARY KEY,
      restaurant_slug VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      content_type VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
      image_data TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pdj_photos_slug ON pdj_photos(restaurant_slug)`);

  console.log("[migrate] Terminé.");
  await pool.end();
}

migrate().catch(console.error);
