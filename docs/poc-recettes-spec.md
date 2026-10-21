# POC « Recettes » — spécification d'implémentation (contrat)

> Worktree : `/Users/toam/Documents/PDJ-recettes`, branche `feat/poc-recettes` (base `origin/main`, après #40).
> Deux implémenteurs travaillent **en parallèle sur des fichiers disjoints** (§6). Ce document est le contrat :
> en cas de doute, il fait foi ; ne pas « améliorer » un nom, un champ, un code HTTP ou un message sans le
> répercuter ici.

## 0. Objectif et principes

Pour chaque **variante** de plat du jour publiée (unité identique aux images : `variantesPlat` côté TS,
`plat_image.variantes` côté Python), le pipeline fait rédiger par le LLM une **recette maison inspirée du
plat** (ingrédients avec quantités pour N personnes, étapes, temps, difficulté, astuces), l'envoie à l'API
Next, qui la stocke **une seule fois par plat** (clé du plat) et enregistre **chaque date de service**.
Le site expose une **banque de recettes** consultable (`/recettes`) et une fiche par recette
(`/recettes/[cle]`), plus une section « Recette » dans le panneau de détail d'un plat.

Règles absolues (rappel) :
- Tout en français (UI, messages d'erreur API, noms de domaine, logs).
- **Honnêteté** : la recette n'est **pas** celle du restaurant. Libellés imposés (§5.6) : « Recette maison
  inspirée du plat », jamais « la recette du chef / du restaurant ».
- Pas de recette pour un plat `coming_soon`, ni pour un jour férié / sans plat (`plats` vide, `ferie`, `erreur`).
- Tests : jamais d'appel LLM réel, jamais d'appel à `VERCEL_API_URL`, jamais d'écriture dans une base réelle
  (tout est mocké). Pas de commit, pas de push.
- Le modèle à copier est la fonctionnalité images (#37-#40) : `plat_image.py`, `agent/image_agent.py`,
  `main.py run_images/_step_images`, `entrypoint.sh`, `Dockerfile`, `lib/plat-image*.ts`,
  `app/api/plat-image/*`, `lib/db.ts`, `app/menus/PlatImage.tsx`, `DetailPanneau.tsx`.

## 1. Clé du plat et schéma JSON d'une recette

### 1.1 Clé (réutilisée telle quelle, aucun nouvel algorithme)

- TS (serveur) : `clePlatImage(restaurant, plat)` de `lib/plat-image-cle.ts` ; base :
  `baseClePlatImage` de `lib/plat-image.ts`.
- Python : `plat_image.cle_image(restaurant, plat)` / `plat_image.base_cle` (importés, **non modifiés**).
- Format : `^[0-9a-f]{24}$` (`CLE_IMAGE_RE` / `plat_image.CLE_RE`).
- `plat` = **nom de la variante tel qu'il figure dans le PDJ** (pas le titre de recette). Recette et image du
  même plat ont donc la même clé → l'image se retrouve par `platImagesExistantes([cle])`.

### 1.2 Contenu de recette (`RecetteContenu`) — produit par le LLM, validé des deux côtés

```jsonc
{
  "titre": "Tataki de bœuf, pesto asiatique et purée de carottes",  // string, 3..200 car. après trim
  "description": "Un bœuf saisi minute…",                           // string, 0..600 car. ; optionnel (défaut "")
  "personnes": 4,                                                    // int, 1..12 (le prompt demande 4)
  "temps_preparation_min": 25,                                       // int, 0..600
  "temps_cuisson_min": 15,                                           // int, 0..1440
  "temps_repos_min": 0,                                              // int, 0..2880 ; optionnel (défaut 0)
  "difficulte": "moyenne",                                           // "facile" | "moyenne" | "difficile"
  "ingredients": [                                                   // 1..40 éléments
    { "nom": "rumsteck de bœuf", "quantite": 600, "unite": "g",
      "note": "en un seul morceau", "groupe": "Pour le bœuf" },
    { "nom": "œufs", "quantite": 2, "unite": "pièce" },
    { "nom": "sel, poivre", "quantite": null, "unite": null }        // « selon goût »
  ],
  "etapes": ["Sortir la viande…", "…"],                              // 1..30 chaînes, chacune 3..800 car.
  "astuces": ["Saisir la viande très chaude…"],                      // 0..10 chaînes, chacune 1..400 car. ; optionnel (défaut [])
  "ustensiles": ["poêle", "mixeur"]                                  // 0..20 chaînes, chacune 1..80 car. ; optionnel (défaut [])
}
```

Ingrédient (`IngredientRecette`) :

| champ | type | contrainte |
|---|---|---|
| `nom` | string | 1..120 car. après trim |
| `quantite` | number \| null | `null` = « selon goût » ; sinon `0 < q ≤ 10000`, arrondi à 2 décimales à la normalisation |
| `unite` | string \| null | une valeur de `UNITES` ; `null` **autorisé seulement si** `quantite === null` |
| `note` | string | optionnel, 0..120 car. (ex. « émincé », « bien froid ») |
| `groupe` | string | optionnel, 0..60 car. (ex. « Pour la sauce ») ; les ingrédients d'un même groupe sont contigus (non vérifié, l'UI regroupe par ordre d'apparition) |

`UNITES` (liste **exacte et ordonnée**, identique en TS `lib/recettes.ts` et Python `agent/recette_agent.py`) :

```
"g", "kg", "ml", "cl", "l", "c. à café", "c. à soupe", "pincée", "pièce",
"gousse", "tranche", "feuille", "brin", "botte", "boîte", "sachet"
```

`DIFFICULTES` = `["facile", "moyenne", "difficile"]`.

Règles communes de **normalisation** (appliquées avant validation, Python ET serveur) :
- chaînes : trim + espaces multiples → un espace ; champs optionnels absents → valeur par défaut ci-dessus ;
- nombres de temps / `personnes` : un nombre flottant entier (`25.0`) ou une chaîne de chiffres (`"25"`) est
  accepté et converti en int ; sinon invalide ;
- `quantite` : nombre ou chaîne numérique (virgule française acceptée : `"1,5"`) ; `0` → invalide ;
- `astuces`, `ustensiles`, `etapes` : on retire les éléments vides après trim avant de compter ;
- les champs inconnus sont **ignorés et retirés** (jamais stockés).

Normalisation **Python seulement** (le LLM est imprécis ; le serveur, lui, refuse une unité hors liste) —
table de synonymes, comparaison sur `unite.lower().strip().rstrip(".")` :
`gr, gramme(s) → g` ; `kilo(s), kilogramme(s) → kg` ; `millilitre(s) → ml` ; `centilitre(s) → cl` ;
`litre(s) → l` ; `cuillère à café, cuillères à café, càc, cc, c.à.c, c. à c, cuil. à café → c. à café` ;
`cuillère à soupe, cuillères à soupe, càs, cs, c.à.s, c. à s, cuil. à soupe → c. à soupe` ;
`pincées → pincée` ; `pièces, unité(s), u, "" (avec quantité non nulle) → pièce` ; pluriels `gousses, tranches,
feuilles, brins, bottes, boîtes, sachets` → singulier. Unité inconnue après synonymes : l'ingrédient devient
`quantite: null, unite: null` et la valeur brute est **préfixée** dans `note` (`"200 verres"` → note
`"200 verres"`, tronquée à 120).

### 1.3 Métadonnées (ajoutées par le pipeline / le serveur, jamais par le LLM)

| champ | source | type |
|---|---|---|
| `cle` | pipeline | 24 hex, = `clePlatImage(restaurant, plat)` |
| `restaurant` | pipeline | string 1..200 (nom exact du PDJ, ex. `Le Bistrot Trèfle`) |
| `plat` | pipeline | string 1..500 (nom de la variante dans le PDJ) |
| `date` | pipeline (POST seulement) | `YYYY-MM-DD`, date du PDJ d'où vient la variante |
| `modele` | pipeline | string ≤ 80 (`claude-sonnet-4-6` en API, `claude-cli` en CLI) |
| `fournisseur` | pipeline | `"anthropic-api"` \| `"claude-cli"` (string ≤ 50, non contraint côté serveur) |
| `version_prompt` | pipeline | int ≥ 1 (constante `VERSION_PROMPT = 1` dans `recette_agent.py`) |
| `date_premier_service` | serveur | `YYYY-MM-DD`, = min des dates de service connues |
| `dates_service` | serveur | `string[]` `YYYY-MM-DD`, tri **décroissant**, au plus 60 |
| `cree_le` / `maj_le` | serveur | ISO 8601 (`created_at` / `updated_at`) |

### 1.4 Types TS de sortie (dans `lib/recettes.ts`, réexportés pour les pages)

```ts
export interface RecetteComplete extends RecetteContenu {
  cle: string; restaurant: string; plat: string;
  modele: string | null; fournisseur: string | null; version_prompt: number | null;
  date_premier_service: string | null; dates_service: string[];
  cree_le: string; maj_le: string;
  image: { src: string; credit?: string } | null;   // via platImagesExistantes + srcPlatImage + creditFournisseur
}
export interface ResumeRecette {
  cle: string; restaurant: string; plat: string; titre: string;
  difficulte: Difficulte; personnes: number; temps_total_min: number;  // prépa + cuisson + repos
  derniere_date: string | null; nb_services: number;
  image: { src: string; credit?: string } | null;
}
```

### 1.5 Validation serveur

`validerRecette(entree: unknown): { ok: true; recette: RecetteContenu } | { ok: false; erreurs: string[] }`
dans `lib/recettes.ts` (pur, testé). Applique la normalisation §1.2 (sans la table de synonymes Python) puis
toutes les contraintes ; collecte **toutes** les erreurs, en français, avec chemin
(ex. `"ingredients[3].unite : unité inconnue « verres »"`, `"etapes : au moins 1 étape"`,
`"personnes : entier entre 1 et 12 attendu"`). En plus : `JSON.stringify(recette).length ≤ 30000` sinon 413.

Côté Python, `recette_agent.valider_recette(data: dict) -> dict` applique synonymes + normalisation +
mêmes contraintes et **lève `ValueError`** (message = erreurs jointes par ` ; `) ; une recette invalide n'est
jamais POSTée.

### 1.6 Recette d'exemple (fixture commune, à recopier — chaque implémenteur possède sa copie)

Front : `lib/recette-exemple.json` ; backend : `plats-du-jour/tests/fixtures/recette_valide.json`.
Contenu identique :

```json
{
  "titre": "Rôti de dinde froid, sauce gribiche et légumes à l'aïoli",
  "description": "Un rôti de dinde moelleux servi froid, une gribiche relevée et des légumes croquants.",
  "personnes": 4,
  "temps_preparation_min": 30,
  "temps_cuisson_min": 60,
  "temps_repos_min": 120,
  "difficulte": "facile",
  "ingredients": [
    { "nom": "rôti de dinde", "quantite": 800, "unite": "g", "groupe": "Pour le rôti" },
    { "nom": "huile d'olive", "quantite": 2, "unite": "c. à soupe", "groupe": "Pour le rôti" },
    { "nom": "œufs", "quantite": 2, "unite": "pièce", "note": "durs", "groupe": "Pour la gribiche" },
    { "nom": "cornichons", "quantite": 40, "unite": "g", "note": "hachés", "groupe": "Pour la gribiche" },
    { "nom": "moutarde de Dijon", "quantite": 1, "unite": "c. à café", "groupe": "Pour la gribiche" },
    { "nom": "huile de colza", "quantite": 15, "unite": "cl", "groupe": "Pour la gribiche" },
    { "nom": "ail", "quantite": 1, "unite": "gousse", "groupe": "Pour les légumes" },
    { "nom": "carottes", "quantite": 4, "unite": "pièce", "groupe": "Pour les légumes" },
    { "nom": "sel, poivre", "quantite": null, "unite": null }
  ],
  "etapes": [
    "Préchauffer le four à 180 °C.",
    "Badigeonner le rôti d'huile, saler, poivrer et enfourner 1 h.",
    "Laisser refroidir puis réserver 2 h au frais avant de trancher.",
    "Écraser les jaunes d'œufs avec la moutarde, monter à l'huile, ajouter blancs et cornichons hachés.",
    "Cuire les carottes 10 min à l'eau, servir avec l'aïoli et la gribiche."
  ],
  "astuces": ["Le rôti se tranche plus finement bien froid."],
  "ustensiles": ["plat à four", "fouet"]
}
```

## 2. Base de données

Deux tables, créées **à l'identique** par `ensureRecettesTable()` dans `lib/db.ts` et par `lib/migrate.mjs`
(nouveau bloc après `pdj_plat_images`, log `[migrate] Création des tables pdj_recettes / pdj_recette_services...`).

```sql
CREATE TABLE IF NOT EXISTS pdj_recettes (
  cle VARCHAR(24) PRIMARY KEY,
  restaurant TEXT NOT NULL,
  plat TEXT NOT NULL,
  titre TEXT NOT NULL,
  recette JSONB NOT NULL,              -- RecetteContenu normalisé (sans métadonnées)
  recherche TEXT NOT NULL DEFAULT '',  -- texteRecherche(...) normalisé, cf. ci-dessous
  modele VARCHAR(80),
  fournisseur VARCHAR(50),
  version_prompt SMALLINT,
  date_premier_service DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pdj_recettes_restaurant_idx ON pdj_recettes (restaurant);

-- Historique des services (une ligne par plat et par date). Pas de FK : une date peut être
-- enregistrée avant que la recette existe (génération ratée puis rattrapée).
CREATE TABLE IF NOT EXISTS pdj_recette_services (
  cle VARCHAR(24) NOT NULL,
  date DATE NOT NULL,
  PRIMARY KEY (cle, date)
);
CREATE INDEX IF NOT EXISTS pdj_recette_services_date_idx ON pdj_recette_services (date);
```

`recherche` = `texteRecherche(restaurant, plat, contenu)` (`lib/recettes.ts`) =
`normPlatImage([restaurant, plat, titre, ...ingredients.map(i => i.nom)].join(" "))`.
Recherche texte : `recherche LIKE '%' || normPlatImage(q) || '%'` (pas d'extension `unaccent` requise ;
échapper `%`, `_` et `\` dans `q` normalisé — `normPlatImage` ne garde que `[a-z0-9 ]`, donc inutile en
pratique, mais faire `LIKE … ESCAPE '\'` quand même).

Fonctions à ajouter dans `lib/db.ts` (section `// --- Recettes (POC) ---`, à la fin du fichier) :

```ts
export async function ensureRecettesTable(): Promise<void>;          // les 2 tables + index
export async function upsertRecette(r: {
  cle: string; restaurant: string; plat: string; titre: string; recette: RecetteContenu;
  recherche: string; modele: string | null; fournisseur: string | null; version_prompt: number | null;
  date: string; force: boolean;
}): Promise<boolean>;
// INSERT … ON CONFLICT (cle) DO NOTHING ; avec force : DO UPDATE de tous les champs sauf created_at et
// date_premier_service (= LEAST(ancienne, EXCLUDED)), updated_at = NOW(). Renvoie rowCount > 0.
// Dans tous les cas, insère aussi (cle, date) dans pdj_recette_services ON CONFLICT DO NOTHING
// et met date_premier_service = LEAST(date_premier_service, date) si la recette existe.
export async function ajouterServicesRecettes(services: { cle: string; date: string }[]): Promise<number>;
// INSERT … SELECT * FROM unnest($1::text[], $2::date[]) ON CONFLICT DO NOTHING ; renvoie le nb ajouté ;
// puis UPDATE pdj_recettes SET date_premier_service = LEAST(...) pour les clés concernées.
export async function recettesExistantes(cles: string[]): Promise<Set<string>>;  // 42P01 → Set vide
export async function getRecette(cle: string): Promise<RecetteComplete | null>;  // 42P01 → null ; image incluse
export async function listerRecettes(p: {
  q: string; restaurant: string | null; proteine: Envie | null; tri: TriBanque; page: number; parPage: number;
}): Promise<BanqueRecettes>;  // { recettes, total, proteines, notesDisponibles } ; 42P01 → { [], 0, {}, false } (cf. §2.1)
```

- Lecture seule sans DDL (`getRecette`, `listerRecettes`, `recettesExistantes`) : réutiliser `tableAbsente(e)`
  (déjà dans `lib/db.ts`) pour traiter « table absente » comme « vide ». Écritures : `await ensureRecettesTable()` d'abord.
- `listerRecettes` : `derniere_date` = `MAX(s.date)`, `nb_services` = `COUNT(s.date)` via `LEFT JOIN
  pdj_recette_services s USING (cle)` + `GROUP BY r.cle` ; `temps_total_min` calculé en TS depuis `recette`
  (`tempsTotal`). Tri (`recentes`, et repli avant migration) : `derniere_date DESC NULLS LAST, r.titre ASC` ;
  tris par note et durée : §2.1. `total` = `COUNT(*)` avec les mêmes
  filtres (requête séparée). Images : un appel `platImagesExistantes(cles de la page)` puis
  `srcPlatImage(cle, creeLe)` + `creditFournisseur`.
- `getRecette` : `dates_service` = 60 dernières dates DESC ; `date_premier_service` = `LEAST(colonne, MIN(dates))`
  formaté `YYYY-MM-DD` (attention : `pg` renvoie `DATE` en objet `Date` local → formater via
  `to_char(date, 'YYYY-MM-DD')` côté SQL, pas en JS).

### 2.1 Notes du plat d'origine et protéine (tri et filtres de la banque)

Colonnes ajoutées à `pdj_recettes` (même DDL dans `ensureRecettesTable()` et `lib/migrate.mjs`) :

```sql
ALTER TABLE pdj_recettes ADD COLUMN IF NOT EXISTS note_sportif REAL, ADD COLUMN IF NOT EXISTS note_goulaf REAL,
  ADD COLUMN IF NOT EXISTS note_date DATE, ADD COLUMN IF NOT EXISTS proteine VARCHAR(10);
```

`ensureRecettesTable()` ne lance cet `ALTER` que si `information_schema.columns` ne connaît pas encore
`pdj_recettes.proteine` : même avec `IF NOT EXISTS`, l'ALTER prendrait un verrou ACCESS EXCLUSIVE à chaque
ingestion. Pas d'index (quelques centaines de lignes, tri par `CASE`).

Règles (`lib/recette-notes.ts`, pur, testé) :
- **Variante d'une recette** = la variante `v` (`variantesPlat`) d'un plat de `pdj_entries` telle que
  `clePlatImage(plat.restaurant, v.plat) = cle`. On ignore `pdj.ferie`, `plat.coming_soon`,
  `!recetteAttendue(resto, v.plat)` et les variantes dont les deux notes sont nulles.
- `note_sportif = noteValide(noteMode(v, "sportif"))`, `note_goulaf = noteValide(noteMode(v, "goulaf"))`
  (en Goulaf, repli sur la note Sportif, convention du site) ; `noteValide` = nombre fini dans [0, 10],
  arrondi au dixième, sinon null (corrige aussi l'imprécision des REAL à la lecture).
- **Jours servis seulement** (`dateServie`, date de Paris) : un jour publié d'avance (pipeline semaine) n'est
  pas pris en compte tant qu'il n'est pas arrivé — son menu peut encore changer, et sa note « la plus
  récente » bloquerait celles des vrais services.
- **Date** : on garde la note du dernier service (`note_date`) ; à date égale la dernière écriture gagne
  (réévaluation du même jour) ; une date plus ancienne n'écrase jamais en mise à jour incrémentale ;
  une variante sans note n'écrit rien ; dans un même jour, à base égale, la première variante notée l'emporte.
- **Republication** d'un jour (`/api/update`) qui ne contient plus le plat (menu corrigé, erreur de scrape,
  férié) : les recettes dont `note_date` est ce jour (ou à venir, données antérieures à la règle ci-dessus)
  sont recalculées depuis tout l'historique servi (`recalculerNotesDuJour`).
- **Protéine** = `envieForPlat` (axe « envie » du quiz : tag LLM `quiz_tags.envie` d'abord, agneau → veau,
  puis mots-clés) de la même variante, le même jour : `poulet | boeuf | porc | veau | poisson | vege | autre`.
  Repli sans variante notée retrouvée : `proteineDepuisRecette` (mots-clés du plat, du titre et des
  ingrédients de la recette). Estimation, d'où le libellé « Protéine principale (estimée) ».
- `proteine IS NULL` = recette jamais traitée (marqueur du rattrapage) ; une recette traitée a toujours une
  protéine, ne serait-ce que « autre ».
- Recette sans aucune note : une seule pastille visible « Non notée » (title / légende de la fiche :
  « Notes indisponibles pour le plat du jour dont la recette s'inspire. ») — pas « pas encore notée » :
  un plat introuvable parmi les plats notés ne le sera peut-être jamais. Une seule note absente : « ? »
  (`aria-hidden`), « note indisponible » pour les lecteurs d'écran. En dernier au tri par note (`NULLS LAST`).

Recherche texte : **en début de mot**, `(' ' || recherche) LIKE ALL ('% mot%', …)` (un motif par mot,
`motifsRecherche`) : « riz » ne trouve plus « chorizo », « pate » trouve encore « pates ».

Fonctions `lib/db.ts` : `getPdjDepuis(date)`, `enregistrerNotesRecettes(notes, cles?)` (après
`fusionnerNotes` — un doublon dans `UPDATE … FROM unnest` serait appliqué arbitrairement ; condition
`note_date IS NULL OR t.d >= note_date` ; 42P01 / 42703 → 0, sans DDL), `rafraichirNotesRecettes(pdjs, cles?)`,
`rattraperNotesRecettes(toutes = false)` (recettes `proteine IS NULL`, ou toutes ; relit `pdj_entries` (jours
servis) seulement s'il y a des recettes à traiter ; renvoie `{ notees, sans_note }`) et
`recalculerNotesDuJour(pdj)` (cf. Republication). Les deux derniers passent par un recalcul complet **en une
seule écriture** (`UPDATE … FROM unnest`, atomique, sans règle de date) : notes du dernier service retrouvé,
sinon notes NULL et protéine de repli — jamais de remise à NULL préalable qui laisserait la banque vide
si l'écriture suivante échouait.

`listerRecettes({ q, restaurant, proteine, tri, page, parPage })` →
`{ recettes, total, proteines, notesDisponibles }` : 2 requêtes en parallèle (liste + **facettes**
`SELECT proteine, COUNT(*) … GROUP BY proteine` avec recherche et restaurant, sans le filtre protéine, qui
remplacent le `COUNT`), puis les images. `total` = compte de la protéine filtrée, sinon somme de toutes les
lignes (protéine NULL comprise). Tri : `CASE tri` sur la note du mode puis l'autre note (`DESC NULLS LAST`),
durée totale pour `rapide`, puis dernier service et titre (ordre historique, seul actif en `recentes`).
**Repli 42703** (code déployé avant la migration) : requête historique (liste + `COUNT`), sans tri par note
ni filtre protéine, notes nulles, `notesDisponibles: false`, `console.warn` une fois par instance.
`getRecette` lit les notes par une petite requête séparée (`notesRecette`, 42703 → nulls) : le panneau de
l'accueil (`/api/recette/[cle]`) ne casse pas avant la migration.

## 3. API (Next, `runtime = "nodejs"`)

Messages d'erreur exacts ; toutes les erreurs ont la forme `{ "error": string }` (+ `details` pour 422).
Auth Bearer = même code que `app/api/plat-image/route.ts` (`!token || auth !== \`Bearer ${token}\`` → 401
`{ "error": "Non autorisé" }`).

### 3.1 `app/api/recette/route.ts`

**`GET /api/recette?cles=a,b,c`** (public) — pour que le pipeline saute les recettes existantes.
- Dédoublonne ; au plus **200** clés, chacune `CLE_IMAGE_RE`. Sinon 400
  `{ "error": "Paramètre 'cles' invalide (au plus 200 clés hexadécimales de 24 caractères)" }`.
- `cles` vide ou absent → 200 `{ "existantes": [] }`.
- 200 `{ "existantes": ["…", …] }` (ordre libre). Erreur DB → 500 `{ "error": "Erreur serveur" }`.
- `Cache-Control: no-store`.

**`POST /api/recette`** (Bearer `API_SECRET_TOKEN`) — ingestion.
Corps :
```jsonc
{ "cle": "…24 hex…", "restaurant": "Le Bistrot Trèfle", "plat": "Tataki de bœuf…", "date": "2026-10-20",
  "recette": { /* RecetteContenu */ }, "modele": "claude-sonnet-4-6", "fournisseur": "anthropic-api",
  "version_prompt": 1, "force": false }
```
Ordre des contrôles et réponses :
1. auth → 401 `Non autorisé`
2. JSON illisible → 400 `JSON invalide`
3. `cle`, `restaurant`, `plat`, `date` chaînes non vides et `recette` objet → sinon 400
   `Champs requis : cle, restaurant, plat, date, recette`
4. `!CLE_IMAGE_RE.test(cle) || cle !== clePlatImage(restaurant, plat)` → 400 `Clé incohérente avec restaurant + plat`
5. `date` ne matche pas `^\d{4}-\d{2}-\d{2}$` ou date impossible → 400 `Date invalide (YYYY-MM-DD attendu)`
6. `JSON.stringify(recette).length > 30000` → 413 `Recette trop volumineuse`
7. `validerRecette(recette)` KO → 422 `{ "error": "Recette invalide", "details": [ …erreurs… ] }`
8. upsert (`restaurant.slice(0,200)`, `plat.slice(0,500)`, `modele?.slice(0,80)`, `fournisseur?.slice(0,50)`,
   `version_prompt` int ≥ 1 sinon null, `force === true`) → 200 `{ "ok": true, "cle": "…", "ecrit": true|false }`
   (`ecrit: false` = recette déjà présente sans `force` ; la date de service est **quand même** enregistrée).
9. Erreur DB → 500 `Erreur serveur`.

### 3.2 `app/api/recette/services/route.ts`

**`POST /api/recette/services`** (Bearer) — enregistre les dates de service des plats **déjà** pourvus
d'une recette (le pipeline les saute, il faut quand même alimenter l'historique de la banque).
Corps : `{ "services": [ { "cle": "…", "date": "YYYY-MM-DD" }, … ] }`, 1..200 éléments.
- 401 `Non autorisé` ; 400 `JSON invalide` ;
- tableau absent/vide/> 200, clé non hex-24 ou date invalide → 400
  `Paramètre 'services' invalide (1 à 200 couples { cle, date })` ;
- 200 `{ "ok": true, "ajoutes": n }` ; 500 `Erreur serveur`.
(Le segment statique `services` a priorité sur `[cle]` dans le routeur Next ; pas de collision avec une clé hex.)

### 3.2 bis Notes des recettes (hooks best-effort et rattrapage)

- `POST /api/update` : après `upsertPdj`, `rafraichirNotesRecettes([body])` puis `recalculerNotesDuJour(body)`
  dans un try/catch séparé, sans DDL ; la réponse `{ ok, date }` ne change jamais (chemin critique du pipeline).
- `POST /api/recette` : après l'upsert (même si `ecrit: false`), `rafraichirNotesRecettes(getPdjDepuis(date),
  [cle])` puis `rattraperNotesRecettes()`, best-effort ; réponse inchangée.
- `POST /api/recette/services` : après l'ajout des dates servies, `rafraichirNotesRecettes(getPdjDepuis(min des
  dates), cles servies)` (un jour publié d'avance n'est noté qu'une fois servi, et `/api/update` ne repasse pas
  forcément ce jour-là) puis `rattraperNotesRecettes()`, best-effort.
- **`POST /api/recette/notes`** (Bearer) : corps facultatif `{ "toutes"?: boolean }` (vide ou illisible →
  `toutes = false`) ; `ensureRecettesTable()` puis `rattraperNotesRecettes(toutes)` → 200
  `{ "ok": true, "notees": n, "sans_note": m }` ; 401 `Non autorisé` ; 500 `Erreur serveur`.

### 3.3 `app/api/recette/[cle]/route.ts`

**`GET /api/recette/<cle>`** (public).
- `cle` hors `CLE_IMAGE_RE` → 400 `{ "error": "Clé invalide" }`.
- absente → 404 `{ "error": "Recette introuvable" }`, `Cache-Control: public, max-age=60, s-maxage=60`.
- 200 `{ "recette": RecetteComplete }`, `Cache-Control: public, max-age=300, s-maxage=300`.
- 500 `Erreur serveur`.

### 3.4 `app/api/recettes/route.ts`

**`GET /api/recettes?q=&restaurant=&tri=&proteine=&page=`** (public) — liste paginée de la banque (utilisée par des
clients externes ; la page `/recettes` appelle directement `listerRecettes`, pas l'API).
- Parsing via `parametresBanque(searchParams)` de `lib/recettes.ts` (même fonction que la page) :
  - `q` : trim, tronqué à 100 car. ; normalisé par `normPlatImage` ; vide → pas de filtre ;
  - `restaurant` : **slug** de `lib/restaurants.ts` (`RESTAURANTS[].slug`, hors type `"lien"`) ; absent/vide →
    tous ; slug inconnu → 400 `{ "error": "Restaurant inconnu" }` ; converti en nom via `SLUG_TO_RESTAURANT` ;
  - `page` : entier ≥ 1, défaut 1 ; sinon 400 `{ "error": "Paramètre 'page' invalide" }` ;
  - `PAR_PAGE = 24` (constante exportée de `lib/recettes.ts`).
  - `tri` : `recentes` (défaut) | `sportif` | `goulaf` | `rapide` ; sinon 400 `{ "error": "Paramètre 'tri' invalide" }` ;
  - `proteine` : `poulet | boeuf | porc | veau | poisson | vege` (pas `autre`) ; sinon 400
    `{ "error": "Protéine inconnue" }` ;
  - valeur répétée : la première, sauf `tri` et `proteine` (la dernière : bouton pressé du formulaire de la
    page, après les champs cachés ; la page redirige ensuite vers l'URL nettoyée, `parametresANettoyer`) ;
- 200 `{ "recettes": ResumeRecette[], "total": n, "page": p, "parPage": 24, "pages": max(1, ceil(n/24)),
  "tri": t, "proteine": p|null, "proteines": { poulet: n, … }, "notesDisponibles": bool }` ; `tri` et
  `proteine` reprennent ce qui a été **appliqué** : avant la migration (`notesDisponibles: false`), `"recentes"`
  et `null` quels que soient les paramètres ; chaque recette
  porte `note_sportif`, `note_goulaf`, `note_date`, `proteine` (null avant rattrapage / migration) ;
  une page au-delà de la dernière renvoie `recettes: []` (pas d'erreur).
- `Cache-Control: public, max-age=60, s-maxage=60`. 500 `Erreur serveur`.

## 4. Pipeline Python

### 4.1 `plats-du-jour/plat_recette.py` (pur, sans réseau)

```python
VARIANTE: {"cle": str, "restaurant": str, "plat": str, "date": str, "ingredients": list[dict]}

def variantes_avec_source(plat: dict) -> list[tuple[str, dict]]
    # Miroir de plat_image.variantes MAIS garde l'objet source des ingrédients :
    # options non vides → [(nom_option_resolu, option_dict)] ; sinon plat["plat"] liste → [(nom, {})]
    # (pas d'ingrédients par nom) ; sinon [(nom, plat)]. Noms vides retirés.
    # Résolution du nom identique à plat_image.variantes (option.plat, sinon noms[i], sinon noms[0]).
    # Test : [n for n, _ in variantes_avec_source(p)] == plat_image.variantes(p) pour tous les cas.

def ingredients_estimes(source: dict) -> list[dict]
    # [{"nom": str, "grammes": int}] depuis source["ingredients"] ([{nom, grammes}], diet_agent),
    # à défaut source["ingredients_detail"] ([{nom_query, grammes}]) ; entrées sans nom ou grammes ≤ 0
    # ignorées ; au plus 25.

def a_cuisiner(pdj: dict) -> list[dict]
    # VARIANTEs d'un PDJ publié : [] si pdj vide, pdj.get("ferie"), ou pas de "plats" ;
    # plats non dict / coming_soon ignorés ; norm(resto) ou norm(nom) vide → ignoré ;
    # cle = plat_image.cle_image(resto, nom) ; dédoublonné par cle ; date = pdj["date"].

def services(pdjs: list[dict]) -> list[dict]
    # [{"cle", "date"}] de toutes les variantes de a_cuisiner(pdj) pour chaque pdj, dédoublonné.
```

Réutilise `plat_image.norm`, `plat_image.cle_image`, `plat_image.libelle_lisible` (import, pas de copie,
**pas de modification** de `plat_image.py`).

### 4.2 `plats-du-jour/agent/recette_agent.py`

Constantes : `UNITES` (§1.2, même ordre), `DIFFICULTES`, `SYNONYMES_UNITES`, `VERSION_PROMPT = 1`,
`MODELE_API = "claude-sonnet-4-6"`, `TIMEOUT_MAX_S = 180`, `ESSAIS = 2`.

```python
def construire_prompt(variante: dict) -> str
def appeler_llm(prompt: str, timeout: float) -> tuple[str, str, str]
    # (texte, modele, fournisseur). Copie du mécanisme de image_agent._appel_llm : ANTHROPIC_API_KEY →
    # anthropic.Anthropic(timeout=timeout, max_retries=0).messages.create(model=MODELE_API,
    # max_tokens=4096, …) → (texte, MODELE_API, "anthropic-api") ; sinon CLI
    # [diet_agent.CLAUDE_BIN, "-p", prompt, "--output-format", "text"] (subprocess.run, timeout)
    # → (stdout, "claude-cli", "claude-cli") ; sinon RuntimeError("ni ANTHROPIC_API_KEY ni CLI claude").
    # Réponse vide → RuntimeError.
def extraire_json(brut: str) -> dict | None
    # retire ```json … ```, prend du premier "{" au dernier "}", json.loads ; jamais d'exception.
def normaliser_unite(unite, quantite) -> tuple[float | None, str | None, str | None]  # (quantite, unite, note_prefixe)
def valider_recette(data: dict) -> dict          # normalise + valide, lève ValueError (§1.5)
def rediger(variante: dict, deadline: float) -> dict
    # jusqu'à ESSAIS appels tant que deadline - now ≥ 20 s ; timeout = min(TIMEOUT_MAX_S, restant) ;
    # renvoie {"recette": dict_valide, "modele": str, "fournisseur": str} ; lève si tous échouent.
def cuisiner(pdjs: list[dict], budget_s: float, force: bool = False, max_recettes: int | None = None) -> dict
    # NE LÈVE JAMAIS. Bilan {"a_faire", "deja", "ok", "echecs", "restantes", "services"}.
```

Algorithme de `cuisiner` (calqué sur `image_agent.illustrer`) :
1. `items` = union dédoublonnée par clé de `plat_recette.a_cuisiner(pdj)` (un PDJ mal formé est loggé et ignoré).
2. `publish_recette_services(plat_recette.services(pdjs))` (best-effort, résultat dans `bilan["services"]`
   = nb renvoyé ou 0 ; une erreur n'arrête rien).
3. Sans `force` : `fetch_recettes_existantes(cles)` ; `None` (API injoignable) → log
   `[recettes] liste des recettes existantes indisponible → on ne génère rien`, `restantes = len(items)`, retour.
   Sinon `deja` = nb existantes, on les retire.
4. Pour chaque item, dans l'ordre, tant que budget et `max_recettes` le permettent : `rediger` ; échec →
   `echecs += 1`, log `[recettes] {resto} — {plat} : {erreur}` ; succès → `publish_recette({...})` (§3.1, avec
   `date` de l'item, `version_prompt`, `force`) ; `ok += 1` si True sinon `echecs += 1`.
5. Log final `[recettes] bilan {json}`.

Prompt (français ; `libelle_lisible(plat)`), contenu imposé :
- rôle : « Tu es un cuisinier qui écrit des recettes maison accessibles. » ;
- contexte : plat servi par `{restaurant}` le `{date}` sous le libellé `{libellé}` ; si ingrédients estimés :
  liste `- {nom} : {grammes} g` précédée de « Ingrédients et grammages estimés pour UNE portion (noms issus
  d'une table nutritionnelle, à traduire en ingrédients du commerce) : » ;
- consigne d'honnêteté : « Tu ne connais pas la recette du restaurant : propose une recette maison
  plausible et classique qui permet d'obtenir un plat proche. N'affirme jamais que c'est la recette du
  restaurant et ne cite pas le restaurant dans le titre ni dans les étapes. » ;
- pour **4 personnes**, matériel de cuisine domestique, ingrédients trouvables en supermarché, pas de marque,
  temps réalistes, étapes numérotables (sans numéro dans le texte), quantités en unités de la liste
  `UNITES` uniquement (citées dans le prompt), `quantite: null, unite: null` pour « selon goût » ;
- schéma : l'exemple JSON de §1.2 (sans commentaires) ; « Réponds UNIQUEMENT avec l'objet JSON, sans
  markdown ni texte autour. ».

### 4.3 `plats-du-jour/publish.py` (ajouts, sur le modèle des fonctions images)

```python
def fetch_recettes_existantes(cles: list[str]) -> set[str] | None   # GET /api/recette?cles=, lots de 100 ; None si API_URL vide ou erreur
def publish_recette(data: dict) -> bool                              # POST /api/recette, Bearer, timeout 30
def publish_recette_services(services: list[dict]) -> int            # POST /api/recette/services par lots de 200 ; somme des "ajoutes" ; 0 si non configuré/erreur
```

### 4.4 `plats-du-jour/main.py`

- Docstring : ajouter `python main.py recettes [YYYY-MM-DD|semaine] [--force]  → (POC) Recettes maison des plats publiés…`.
- Import : `recette_agent` dans la ligne `from agent import …`.
- Constantes : `RECETTES_BUDGET_RUN_S = 180`, `RECETTES_BUDGET_COMMANDE_S = 1500`.
- `_recettes_actives() -> bool` : `os.getenv("PDJ_RECETTES", "on").lower() not in ("off", "0", "false", "non")`.
- `async def _step_recettes(loop, output: dict) -> None` : copie de `_step_images` (budget
  `PDJ_RECETTES_BUDGET_RUN`, défaut 180), appelle `recette_agent.cuisiner([output], budget)` dans l'executor ;
  `try/except Exception` → `[pipeline:recettes] Erreur (ignorée) : …`. N'entre pas dans `est_complet`.
  Appelé dans `run_jour` **et** `run_semaine` juste après `await _step_images(loop, output)`.
- `def run_recettes(arg=None, force=False) -> int` : copie de `run_images` (réutilise `_dates_images` ;
  désactivé → `[pipeline:recettes] Désactivé (PDJ_RECETTES=off)`, 0 ; date invalide → 1 ; budget
  `PDJ_RECETTES_BUDGET`, défaut 1500 ; lecture `fetch_pdj` puis repli `OUTPUT_FILE`) ; toujours 0 sinon.
- `main()` : `elif mode == "recettes":` comme `images` ; usage complété par `|recettes [YYYY-MM-DD|semaine] [--force]`.

### 4.5 `plats-du-jour/entrypoint.sh`

Ajouter, sur le modèle exact du bloc `images` :
```bash
elif [ "$MODE" = "recettes" ]; then
  exec 200>/app/output/pdj_recettes.lock
  flock -n 200 || { echo "$(date '+%Y-%m-%d %H:%M') [cron] recettes déjà en cours, sauté"; exit 0; }
  LIMITE="timeout -k 30 1800"
```
(transformer le `if images … else …` en `if images … elif recettes … else …`). Le report `/admin` reste limité
à jour/semaine (inchangé).

### 4.6 `plats-du-jour/Dockerfile`

Ligne cron ajoutée **après** celle des images, et commentaire d'en-tête complété :
```
echo '15 11 * * 1-5 root /entrypoint.sh recettes >> /app/logs/cron.log 2>&1' >> /etc/cron.d/pdj && \
```
Choix 11h15 Paris lun-ven : après le dernier retry (10h00), après le créneau images 10h35 (plafonné à 30 min
→ 11h05 au plus tard), avant les desserts 13h. Le cron traite **aujourd'hui seulement** (pas `semaine`) :
les dates de service enregistrées sont celles de plats réellement servis (le menu futur du Trèfle/Truck peut
changer). La commande manuelle accepte `semaine`.

Variables d'environnement (aucune nouvelle obligatoire) : `PDJ_RECETTES` (on/off), `PDJ_RECETTES_BUDGET_RUN`,
`PDJ_RECETTES_BUDGET`.

## 5. Front

### 5.1 `lib/recettes.ts` (pur, importable client ET serveur — **pas** de `node:crypto`, pas de `pg`)

Exports :
```ts
export const UNITES: readonly string[];                 // §1.2, même ordre
export const DIFFICULTES: readonly ["facile", "moyenne", "difficile"];
export type Difficulte = (typeof DIFFICULTES)[number];
export const PERSONNES_MIN = 1, PERSONNES_MAX = 12, PAR_PAGE = 24, TAILLE_MAX_RECETTE = 30000;
export interface IngredientRecette { nom: string; quantite: number | null; unite: string | null; note?: string; groupe?: string }
export interface RecetteContenu { titre; description; personnes; temps_preparation_min; temps_cuisson_min;
  temps_repos_min; difficulte; ingredients; etapes; astuces; ustensiles }   // tous présents après validation
export interface RecetteComplete …; export interface ResumeRecette …;        // §1.4
export function validerRecette(entree: unknown): { ok: true; recette: RecetteContenu } | { ok: false; erreurs: string[] };
export function tempsTotal(r: Pick<RecetteContenu, "temps_preparation_min" | "temps_cuisson_min" | "temps_repos_min">): number;
export function formaterDuree(min: number): string;      // 0 → "0 min", 45 → "45 min", 60 → "1 h", 75 → "1 h 15", 1500 → "25 h"
export function libelleDifficulte(d: Difficulte): string; // "Facile" | "Moyenne" | "Difficile"
export function ajusterQuantite(q: number | null, unite: string | null, base: number, cible: number): number | null;
export function formaterQuantite(q: number | null, unite: string | null): string;
export function ajusterIngredients(ings: IngredientRecette[], base: number, cible: number): (IngredientRecette & { libelleQuantite: string })[];
export function bornerPersonnes(n: number): number;      // NaN → PERSONNES_MIN ; arrondi ; borné [1, 12]
export function grouperIngredients<T extends IngredientRecette>(ings: T[]): { groupe: string | null; ingredients: T[] }[]; // ordre d'apparition
export function texteRecherche(restaurant: string, plat: string, r: Pick<RecetteContenu, "titre" | "ingredients">): string;
export function parametresBanque(sp: URLSearchParams | Record<string, string | string[] | undefined>):
  { ok: true; q: string; qNorm: string; slug: string | null; restaurant: string | null; page: number } | { ok: false; erreur: string };
export function etatRecetteDepuisStatut(status: number): "ok" | "absente" | "erreur";   // 200 → ok, 404 → absente, autre → erreur
```

Règles d'**ajustement** (`ajusterQuantite`) : `q === null` → `null` ; sinon `v = q * cible / base`, puis arrondi :

| unité | arrondi |
|---|---|
| `g`, `ml` | `v < 20` → entier, min 1 ; `v < 100` → multiple de 5 ; sinon multiple de 10 |
| `cl` | multiple de 0,5 ; min 0,5 |
| `kg`, `l` | multiple de 0,05 ; min 0,05 |
| `pincée` | entier, min 1 |
| `c. à café`, `c. à soupe`, `pièce`, `gousse`, `tranche`, `feuille`, `brin`, `botte`, `boîte`, `sachet` | multiple de 0,5 ; min 0,5 |
| autre / `null` | 2 décimales |

(`cible === base` → quantité d'origine **inchangée**, sans arrondi.)

Règles de **formatage** (`formaterQuantite`) : `null` → `"selon goût"` ; nombre à la française (virgule,
2 décimales max, zéros finaux retirés : `1.5 → "1,5"`, `0.25 → "0,25"`) ; pour les unités « à la demi »
(ligne 5 du tableau + `pincée`), `x,5` s'affiche avec `½` : `0.5 → "½"`, `1.5 → "1 ½"` ; `pièce` n'est pas
affichée (`2, "pièce" → "2"`) ; pluriel (`+ "s"`) pour `pincée, gousse, tranche, feuille, brin, botte,
boîte, sachet` quand `q > 1` ; les autres unités sont invariables. Ex. : `(200,"g") → "200 g"`,
`(1.5,"c. à soupe") → "1 ½ c. à soupe"`, `(2,"gousse") → "2 gousses"`, `(0.5,"pièce") → "½"`.

### 5.2 `lib/db.ts` et `lib/migrate.mjs`

Cf. §2. Importer les types depuis `lib/recettes.ts` (`import type`) ; `getRecette`/`listerRecettes` utilisent
`platImagesExistantes`, `srcPlatImage`, `creditFournisseur` existants.

### 5.3 Routes API

Cf. §3 : `app/api/recette/route.ts`, `app/api/recette/services/route.ts`, `app/api/recette/[cle]/route.ts`,
`app/api/recettes/route.ts`.

### 5.4 Panneau de détail (accueil V2 uniquement ; V1 non modifiée)

Le client ne hache rien (comme les images). Plomberie :
- `app/page.tsx` : calculer `const cles = clesSemaine(semaine)` **une fois** (V2), le passer à `chargerImages`
  (adapter sa signature) et passer `clesPlats={Object.fromEntries(cles)}` (`Record<base, cle>`) à `MenusClient`.
- `app/menus/MenusClient.tsx` : prop optionnelle `clesPlats?: Record<string, string>` transmise à `DetailPanneau`.
- `app/menus/DetailPanneau.tsx` : prop `clesPlats?` ; `const cle = clesPlats?.[baseClePlatImage(plat.restaurant, v.plat)]` ;
  si `cle`, `!plat.coming_soon` et `recetteAttendue(restaurant, plat)` (nom non vide une fois normalisé, comme
  `a_cuisiner`) : `<RecettePanneau key={cle} cle={cle} date={pdj.date} today={today} />` placé **après** le bloc
  `.actions` et **avant** `PhotoPlat`.
- **Nouveau** `app/menus/RecettePanneau.tsx` (client) : au montage `fetch(\`/api/recette/${cle}\`)` avec
  `AbortController` (annulé au démontage) ; état via `etatRecetteDepuisStatut` :
  - `charge` : titre de section « Le refaire chez soi » + ligne « Chargement de la recette… » (`aria-busy`) ;
  - `absente` (404) : texte de `messageRecetteAbsente(date, today, heure)` — jour à venir : « La recette sera
    rédigée le jour où le plat est servi. » ; jour même avant 12h (Paris) : « Pas encore de recette pour ce plat :
    elles sont rédigées en fin de matinée. » ; sinon : « Pas de recette pour ce plat. » — + lien
    discret « Parcourir les recettes » → `/recettes` ;
  - `erreur` (autre statut ou réseau) : « Recette indisponible pour le moment. » + bouton « Réessayer » ;
  - `ok` : titre de recette, puces (`personnes` pers. · Préparation `formaterDuree` · Cuisson · `libelleDifficulte`),
    les **6 premiers** ingrédients (`formaterQuantite` + nom) puis « … et N autres » s'il y en a plus, mention
    d'honnêteté courte (§5.6), lien bouton « Voir la recette complète » → `/recettes/{cle}` (`<a>`, pas de JS).
- Styles : nouvelles classes dans `app/menus/menus.module.css` (`.recette`, `.recetteTete`, `.recettePuces`,
  `.recetteIngredients`, `.recetteMention`) avec les tokens existants (`--surface`, `--border`, `--radius`,
  `--text-secondary`, `--text-muted`, `--accent`, `--font-heading`…). Aucun nouveau token.

### 5.5 Pages

`app/recettes/page.tsx` (serveur, `export const dynamic = "force-dynamic"`,
`metadata.title = "Recettes — Plats du Jour"`) :
- lit `searchParams` (Promise, Next 15) → `parametresBanque` ; invalide → affiche le message d'erreur et la
  liste non filtrée page 1 (pas de 500) ;
- `listerRecettes(...)` dans un `try/catch` (erreur → état « Banque indisponible pour le moment. ») ;
- en-tête : h1 « Recettes » (`var(--font-heading)`, même gabarit que `/idees`), sous-titre
  « Recettes maison inspirées des plats du jour, pour les refaire chez soi. » ;
- formulaire **GET** sans JS (`<form action="/recettes">`) : `<input type="search" name="q">` (label « Rechercher
  un plat ou un ingrédient »), `<select name="restaurant">` (« Tous les restaurants » + restos non `lien` de
  `RESTAURANTS`, valeur = slug), bouton « Rechercher » ; valeurs courantes pré-remplies ;
- grille de cartes (`app/recettes/recettes.module.css`) : 1 colonne mobile, 2 dès 640 px, 3 dès 960 px ;
  chaque carte = lien `/recettes/{cle}` : image (`PlatImage` de `app/menus/PlatImage.tsx`, `format="tuile"`)
  si `image`, sinon fond neutre avec l'icône de couverts ; titre ; restaurant ; « `formaterDuree(temps_total)` ·
  `libelleDifficulte` » ; « Servi le `formatDateShort(derniere_date)` » (+ « · N fois » si `nb_services > 1`) ;
- vide : « Aucune recette pour l'instant : elles apparaissent au fil des plats du jour. » ; recherche sans
  résultat : « Aucune recette ne correspond à cette recherche. » ;
- pagination : liens « Précédent » / « Suivant » conservant `q` et `restaurant`, « Page p sur n ».

`app/recettes/[cle]/page.tsx` (serveur, dynamic) : `cle` invalide ou `getRecette` null → `notFound()` ;
`generateMetadata` → `"{titre} — Recettes — Plats du Jour"`. Contenu :
- fil « ← Toutes les recettes » (`/recettes`) ;
- image du plat (`PlatImage format="panneau"`) si présente, avec crédit éventuel ;
- h1 = `titre` ; ligne « Inspirée de « {casseLisible(plat)} » · {restaurant} » ; `description` ;
- **bandeau d'honnêteté** (§5.6) bien visible, sous le titre ;
- puces : préparation, cuisson, repos (si > 0), total, difficulté ;
- composant client `app/recettes/[cle]/AjusteurRecette.tsx` : boutons « − » / « + » (`aria-label`
  « Une personne de moins » / « Une personne de plus », désactivés aux bornes), valeur « N personnes » en
  `aria-live="polite"`, liste des ingrédients groupés (`grouperIngredients` + `ajusterIngredients`) ;
  valeur initiale = `recette.personnes` ;
- étapes en `<ol>`, astuces (si non vides), ustensiles (si non vides) ;
- pied : « Servi le … » (jusqu'à 10 dates, `formatDateShort`), « Recette rédigée le `formatDateShort(cree_le)` ».
- styles dans `app/recettes/recettes.module.css`, mobile d'abord, mêmes tokens que `menus.module.css`.

**Notes et filtres de la banque** (cf. §2.1) :
- sous le sous-titre, `MENTION_NOTES` : « Les notes Sportif et Goulaf sont celles du plat du jour dont la
  recette s'inspire, pas de la recette maison. » (honnêteté : notes du plat, pas de la recette) ;
- chaque carte affiche les **deux** notes (`app/recettes/NotesRecette.tsx`, serveur, sans état) : pastilles
  « SPORTIF 7,5 /10 » et « GOULAF 8 /10 » colorées vert / ambre / rouge (`noteClass`), « ? » neutre sans note ;
  la note du mode trié passe en premier et est soulignée (`data-actif`) ; la carte elle-même n'est pas colorée ;
- barre « Trier par » (Récentes, Sportif, Goulaf, Rapides) et puces « Protéine principale (estimée) »
  (Toutes + protéines présentes avec leur compte ; une puce active se désactive au clic) : liens GET
  (`hrefBanque`, page remise à 1), affichés seulement si `notesDisponibles` ; sinon, si `tri`/`proteine`
  sont demandés : « Tri et filtres par note bientôt disponibles : recettes affichées par date. » ;
- champs cachés `tri` / `proteine` dans le formulaire : une nouvelle recherche les conserve ;
- ligne de résultats `libelleResultats` (« 12 recettes · triées par note Sportif · Poulet / volaille ») ;
- fiche : pastilles au format `fiche` avant les puces de durée, légende « Notes du plat du jour évalué le … —
  pas de la recette maison. », lien « Autres recettes {protéine} → ».

Navigation (`app/layout.tsx`) : lien « Recettes » → `/recettes`, **après** « Aide-moi à choisir », dans la liste
desktop (`nav-links`) ET la liste mobile, mêmes classes que les liens voisins.

### 5.6 Libellés d'honnêteté (exacts)

- Bandeau fiche : « **Recette maison inspirée du plat**, ce n'est pas la recette du restaurant. Elle a été
  rédigée automatiquement à partir du nom du plat et de sa composition estimée : goûtez et ajustez les cuissons et l'assaisonnement. »
- Mention panneau : « Recette maison inspirée du plat, pas celle du restaurant. »
- Interdits partout : « recette du chef », « recette du restaurant » (hors négation ci-dessus),
  « recette originale », « secret du chef ».

### 5.7 Documentation

`CLAUDE.md` (front) : ajouter la commande `python main.py recettes [YYYY-MM-DD|semaine] [--force]`, une puce
« Recettes (POC) » dans la structure front (`lib/recettes.ts`, `app/recettes/`, `app/api/recette*`,
`RecettePanneau`) et pipeline (`plat_recette.py`, `agent/recette_agent.py`, cron 11h15, lock
`pdj_recettes.lock`, `PDJ_RECETTES=off`), et `pdj_recettes` / `pdj_recette_services` dans les conventions DB.

## 6. Répartition des fichiers (aucun fichier partagé)

### Implémenteur BACKEND (uniquement sous `plats-du-jour/`)

| fichier | action |
|---|---|
| `plats-du-jour/plat_recette.py` | créer |
| `plats-du-jour/agent/recette_agent.py` | créer |
| `plats-du-jour/publish.py` | modifier (3 fonctions §4.3) |
| `plats-du-jour/main.py` | modifier (§4.4) |
| `plats-du-jour/entrypoint.sh` | modifier (§4.5) |
| `plats-du-jour/Dockerfile` | modifier (§4.6) |
| `plats-du-jour/tests/test_plat_recette.py` | créer |
| `plats-du-jour/tests/test_recette_agent.py` | créer |
| `plats-du-jour/tests/test_main_recettes.py` | créer |
| `plats-du-jour/tests/fixtures/recette_valide.json` | créer (contenu §1.6) |

Lecture seule pour lui : `plat_image.py`, `agent/image_agent.py`, `agent/diet_agent.py`, tout `lib/`.

### Implémenteur FRONT (tout le reste)

| fichier | action |
|---|---|
| `lib/recettes.ts` | créer |
| `lib/recettes.test.ts` | créer |
| `lib/recette-exemple.json` | créer (contenu §1.6) |
| `lib/db.ts` | modifier (§2) |
| `lib/migrate.mjs` | modifier (§2) |
| `app/api/recette/route.ts` | créer |
| `app/api/recette/services/route.ts` | créer |
| `app/api/recette/[cle]/route.ts` | créer |
| `app/api/recettes/route.ts` | créer |
| `app/page.tsx` | modifier (§5.4) |
| `app/menus/MenusClient.tsx` | modifier (§5.4) |
| `app/menus/DetailPanneau.tsx` | modifier (§5.4) |
| `app/menus/RecettePanneau.tsx` | créer |
| `app/menus/menus.module.css` | modifier (classes `.recette*`) |
| `app/recettes/page.tsx` | créer |
| `app/recettes/recettes.module.css` | créer |
| `app/recettes/[cle]/page.tsx` | créer |
| `app/recettes/[cle]/AjusteurRecette.tsx` | créer |
| `app/layout.tsx` | modifier (lien nav) |
| `CLAUDE.md` | modifier (§5.7) |

Lecture seule pour lui : `lib/plat-image*.ts`, `lib/plat-image-vecteurs.json`, `app/api/plat-image/*`,
tout `plats-du-jour/`. Personne ne touche `lib/plat-image-vecteurs.json` ni `plat_image.py`.

## 7. Plans de tests

Aucun test ne fait de réseau, d'appel LLM ou d'accès base réels.

### Backend (pytest, `cd plats-du-jour && python -m pytest tests/test_plat_recette.py tests/test_recette_agent.py tests/test_main_recettes.py`)

`test_plat_recette.py`
- `variantes_avec_source` : noms identiques à `plat_image.variantes` sur les cas de `test_plat_image.py`
  (plat simple, liste, options avec/sans nom, vide) ; la source d'une option est l'option.
- `ingredients_estimes` : depuis `ingredients`, repli `ingredients_detail` (`nom_query`), filtrage grammes ≤ 0,
  plafond 25.
- `a_cuisiner` : ignore `coming_soon`, PDJ `ferie`, `plats` vide/absent, resto ou nom vide ; dédoublonne la même
  variante présente deux fois ; clé = `plat_image.cle_image` ; un vecteur de `lib/plat-image-vecteurs.json`
  donne la clé attendue ; `date` reprise du PDJ ; multi-options → une entrée par option avec ses ingrédients.
- `services` : couples dédoublonnés sur plusieurs PDJ.

`test_recette_agent.py`
- `extraire_json` : JSON nu, entouré de ```json, texte autour, JSON cassé → None, non-dict → None.
- `valider_recette` : la fixture passe et ressort identique ; synonymes (`"cuillère à soupe"`, `"gr"`,
  `"gousses"`, `""` avec quantité → `pièce`) ; unité inconnue → `quantite/unite` null + note préfixée ;
  `"1,5"` → 1.5 ; `"25"` → 25 ; champs inconnus retirés ; défauts (`astuces`, `ustensiles`, `temps_repos_min`,
  `description`) ; erreurs : `personnes` 0/13, difficulté hors liste, 0 étape, 41 ingrédients, unité null avec
  quantité, titre trop court → `ValueError` mentionnant le champ.
- `construire_prompt` : contient libellé lisible, restaurant, « 4 personnes », la liste `UNITES`, la consigne
  « N'affirme jamais que c'est la recette du restaurant », les grammages quand fournis et pas la section
  grammages sinon.
- `appeler_llm` : `ANTHROPIC_API_KEY` présent → client anthropic mocké (`monkeypatch` sur `anthropic.Anthropic`),
  renvoie `(texte, "claude-sonnet-4-6", "anthropic-api")` ; sans clé → `subprocess.run` mocké, renvoie
  `"claude-cli"` ; ni l'un ni l'autre → RuntimeError ; sortie vide → RuntimeError.
- `rediger` : 1er appel JSON invalide, 2e valide → succès ; deux invalides → lève ; budget < 20 s → lève sans
  appel.
- `cuisiner` (espion façon `test_image_agent.Espion` : `fetch_recettes_existantes`, `rediger`,
  `publish_recette`, `publish_recette_services` mockés dans le module) : saute existantes et `coming_soon` ;
  `force` n'interroge pas l'API d'existence et passe `force: True` au POST ; API injoignable (None) → rien
  généré, `restantes` renseigné ; échec de `rediger` compté et n'interrompt pas ; `publish_recette` False →
  `echecs` ; budget épuisé → `restantes` ; `max_recettes` ; services envoyés pour **toutes** les variantes (y
  compris existantes) ; exception inattendue dans un mock → pas d'exception propagée, bilan renvoyé.

`test_main_recettes.py`
- `_step_recettes` : `PDJ_RECETTES=off` → `cuisiner` non appelé ; output vide → non appelé ; `cuisiner` qui lève →
  pas d'exception.
- `run_recettes` : date invalide → 1 ; désactivé → 0 sans appel ; `semaine` → dates du jour au vendredi
  (`fetch_pdj` mocké) ; aucun PDJ → 0 sans appel ; `--force` propagé ; repli `OUTPUT_FILE` (tmp_path).
- `main()` : `sys.argv = ["main.py", "recettes", "2026-10-20", "--force"]` → `run_recettes("2026-10-20", force=True)`
  (mocké), `SystemExit(0)`.
- (statique) `Dockerfile` contient la ligne cron `15 11 * * 1-5 root /entrypoint.sh recettes` ; `entrypoint.sh`
  contient `pdj_recettes.lock` et `flock -n`.

### Front (vitest, `npx vitest run lib/recettes.test.ts` puis `npm run build` et `npx tsc --noEmit`)

`lib/recettes.test.ts`
- `validerRecette` : la fixture `lib/recette-exemple.json` passe ; normalisation (trim, `"25"` → 25, `"1,5"`
  → 1.5, défauts, champs inconnus retirés) ; une erreur par contrainte de §1.2 avec chemin ; plusieurs erreurs
  cumulées ; unité synonyme (`"cs"`) **refusée** côté serveur ; entrée non objet → KO.
- `ajusterQuantite` : chaque ligne du tableau §5.1 (ex. 600 g × 2/4 → 300 ; 15 g × 1/4 → 4 ; 60 g × 5/4 → 75 ;
  120 g × 5/4 → 150 ; 2 pièces × 1/4 → 0,5 ; pincée ×1/4 → 1) ; `cible === base` inchangé ; `null` → `null`.
- `formaterQuantite` : exemples §5.1, `null` → « selon goût », virgule, ½, pluriels, `pièce` masquée.
- `ajusterIngredients`, `grouperIngredients` (ordre conservé, `null` pour non groupé), `bornerPersonnes`
  (0, 13, NaN, 2.6), `tempsTotal`, `formaterDuree` (0, 45, 60, 75, 1500), `libelleDifficulte`.
- `texteRecherche` : accents/ligatures supprimés (`"Œufs"` → `oeufs`), concordant avec `normPlatImage`.
- `parametresBanque` : défauts, `page=0`/`abc` → erreur `Paramètre 'page' invalide`, slug inconnu →
  `Restaurant inconnu`, slug `vival` (lien) → `Restaurant inconnu`, `q` tronqué à 100, tableau de valeurs → 1re.
- `etatRecetteDepuisStatut` : 200/404/500/0.
- Les routes API restent minces (contrôles listés en §3, dans l'ordre) et ne sont pas couvertes par vitest
  (`include: lib/**`) : toute logique non triviale qu'elles utilisent vit dans `lib/recettes.ts` et y est testée.

Vérification manuelle (locale uniquement, **jamais** sur la base de prod ni l'API de prod) : `npm run build` ;
optionnel `npm run dev` avec une base Postgres locale jetable (`docker run postgres:16`, `PGSSL=disable`,
`DATABASE_URL` locale), `node lib/migrate.mjs`, `curl` POST d'une recette fixture avec un
`API_SECRET_TOKEN` local, puis `/recettes`, `/recettes/<cle>`, panneau d'un plat (états 404 / ok), largeur
375 px et ≥ 1024 px, thème sombre.
