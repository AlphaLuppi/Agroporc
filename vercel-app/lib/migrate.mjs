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

  console.log("[migrate] Terminé.");
  await pool.end();
}

migrate().catch(console.error);
