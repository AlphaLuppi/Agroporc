# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Plats du Jour" (PDJ) — a daily lunch menu aggregator for office restaurants. Two main components:

1. **Python backend** (`plats-du-jour/`): Scrapes menus from 6 restaurants — 3 core (Le Bistrot Trèfle, La Pause Gourmande, Le Truck Muche) + 3 optional (Basilic n'Go, Dubble, La Mijote : card « pas de plat du jour » + carte permanente notée les jours sans plat) — evaluates them with AI agents, generates comments from fictional characters, and publishes to the Vercel API. A 7th restaurant, Vival (épicerie avec bar à salades Picadeli en libre-service), is never scraped: link-only card on the frontend, clickable restaurant POI in the 3D view.
2. **Next.js frontend** (root): Displays the weekly menus with nutritional ratings, recommendations (two modes: "Sportif" and "Goulaf"), and a comment system. Deployed on Vercel.

## Commands

### Frontend (Next.js 15 + React 19)
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run db:migrate   # Run database migrations (node lib/migrate.mjs)
```

### Python pipeline (`plats-du-jour/`)
```bash
cd plats-du-jour
source .venv/bin/activate
python main.py semaine              # Full weekly pipeline (Monday): scrape all menus + generate comments
python main.py jour                 # Daily pipeline: scrape today's dishes only
python main.py cartes [slug] [--force]  # Cartes permanentes (Trèfle, Basilic n'Go, Dubble, La Mijote) : scrape, hash, notation LLM si changement ; --force ré-évalue
python main.py images [YYYY-MM-DD|semaine] [--force]  # (POC) Images IA des plats publiés manquantes ; --force régénère
python main.py commentaires <name>  # Generate comments for one character
python main.py sync-feedback        # Sync human feedback into character profiles
```

Cron automation: `cron_pdj.sh [jour|semaine]`

## Architecture

### Data flow
Python scrapers → AI diet agent evaluation (LLM décompose en ingrédients + grammages, macros agrégées via table Ciqual) → AI comment generation → `publish.py` POSTs to `/api/update` → Vercel Postgres (`pdj_entries` table, JSONB column) → Next.js SSR reads from DB

Cartes permanentes : `main.py CARTE_SOURCES` → hash → `/api/carte` (`pdj_carte`, une ligne par slug), traitées le lundi ou via `main.py cartes`

Images IA des plats (POC) : `agent/image_agent.py` génère une photo par variante (`plat_image.a_illustrer`) : le LLM du pipeline rédige d'abord en un appel par lot une description visuelle anglaise de chaque plat (`plat_image.prompt_descriptions`, un essai borné, repli sur le libellé brut ; `PDJ_IMAGES_DESCRIPTION=off`), puis un fournisseur gratuit génère l'image, recadrée en WebP 768×512 par Pillow, (Cloudflare Workers AI si `CF_ACCOUNT_ID`/`CF_API_TOKEN`, AI Horde si `AIHORDE_API_KEY`, sinon Pollinations anonyme : 1 image / 45 s, logo laissé visible + crédit « Image : pollinations.ai » dans le panneau ; chaque fournisseur a une sous-deadline `PLAFOND_S`, Horde sauté si budget < 240 s) → POST `/api/plat-image` (Bearer) → table `pdj_plat_images` (bytea, clé = `sha256(norm(resto)|norm(plat))[:24]`, calculée à l'identique en Python `plat_image.py` et TS `lib/plat-image*.ts`, vecteurs partagés `lib/plat-image-vecteurs.json`). Best-effort : budget de 150 s après `publish_pdj` dans `jour`/`semaine` (hors `est_complet`), rattrapage par le cron `images semaine` de 10h35 (lock dédié `pdj_images.lock`, `timeout 1800`, ne bloque pas les runs jour/semaine) ; route `/api/plat-image/[cle]?v=` en cache CDN immuable (`s-maxage`), `v` faux → redirection ; `PDJ_IMAGES=off` coupe tout. Rien n'est écrit dans `pdj_entries`

### Frontend structure
- `app/page.tsx` — Main page (SSR) : charge la semaine (`getWeekPdj`) et la liste des cartes, puis rend `app/menus/MenusClient.tsx` (client) avec trois vues commutables (mémorisées en `localStorage` `pdj-vue`) : **Jour** (`JourVue` : reco du mode en grand puis tuiles triées par note avec prix, kcal et protéines/glucides/lipides en chiffres monochromes (`macrosTuile`), noms toujours complets — une tuile au nom > 46 caractères passe en pleine largeur sur mobile ; jours + mode collés en bas de l'écran sur mobile), **Semaine** (`SemaineVue` : grille restos × jours sur desktop, débordant du conteneur 860 px ; carte de chaleur + swipe par jour sur mobile) et **La carte** (`CarteVue` : carte permanente d'un resto via `/api/carte?slug=`, triée par note du mode). Un clic sur un plat ouvre `DetailPanneau` (portal : feuille du bas sur mobile, panneau à droite sur desktop) avec l'image IA du plat si elle existe (+ mention « Image générée par IA »), macros, liens, « Ajouter » et commentaires. Les tuiles et la reco de `JourVue` ont un bandeau image (pastille « IA ») ; `page.tsx` passe `images` (base de clé → URL `?v=` versionnée) pour les seules images en base, composant `app/menus/PlatImage.tsx`. V1 inchangée. Mode Sportif/Goulaf en état React (`useModeSite`, synchronisé via `pdj-mode` + `pdj:mode-refresh`). Logique pure testée dans `lib/menus-vue.ts`
- **Switch V1 / V2** (`app/components/VersionSwitch.tsx`, dans la barre de navigation) : cookie `pdj-ui` (`lib/version-ui.ts`, V2 par défaut) lu au rendu serveur par l'accueil et « Aide-moi à choisir ». V1 = affichage d'avant la refonte (PR #32) : `app/v1/AccueilV1.tsx` (+ `app/v1/CarteLazy.tsx`, `CarteRestaurant.tsx`, piloté par les onglets/tri de `ClientScripts`) et `app/aide-moi-a-choisir/QuizClientV1.tsx`. Changer de version recharge la page
- `app/CommentSection.tsx` / `app/CommentForm.tsx` — Client components for the comment system
- `app/historique/` — History page
- Import d'images : `lib/image-upload.ts` (compression navigateur, testée) + `app/components/ImportImage.tsx` (bouton, coller, glisser-déposer) → `POST /api/images` (table `pdj_images`, servie par `/api/images/<id>.<ext>`), utilisé pour la photo de profil et les gifs fétiches des IA (`app/ia/`). Photo d'un plat ajoutée depuis `DetailPanneau` (`app/menus/PhotoPlat.tsx` → `POST /api/photos` avec `plat_nom`/`plat_date`)
- `app/api/` — API routes: `update` (auth-protected ingestion), `commentaire` (rate-limited user comments), `pdj` (read), `historique`, `feedback-ia`, `plat-image` (POC : GET `?cles=` liste publique des images existantes ; POST Bearer d'ingestion qui recalcule la clé et vérifie les magic bytes ; `[cle]` sert l'image avec ETag, `Cache-Control` immuable quand `?v=`)
- `lib/db.ts` — Vercel Postgres queries, types (`PdjEntry`, `Plat`, `Commentaire`, `Recommandation`)
- `lib/characters.ts` — Character definitions (avatars, colors, emojis) used in both comments and UI
- `lib/format.ts` — French date formatting
- `lib/icons.ts` — Restaurant icon SVGs
- `lib/plat-options.ts` — Plats multi-options (Basilic n'Go, Dubble : `plat` est un tableau et les notes sont dans `options[]`, la racine reste sans note) : `variantesPlat` éclate un `Plat` en variantes notées, `meilleureNote` (tri/reco), `libellePlat`. Toujours passer par là plutôt que lire `plat.note` directement (home, quiz, vue 3D, feedback-ia)
- `lib/restaurants.ts` — Liste de référence des restos (nom exact, slug, type core/optionnel/lien, carte scrapée ou non), ordre d'affichage, `statutSansPlat`, `titreCarte`
- `app/aide-moi-a-choisir/` — Quiz « Aide-moi à choisir » : une question à la fois sur mobile, l'arbre entier en colonnes sur desktop avec le nombre de plats compatibles par branche (`lib/quiz-arbre.ts`) ; le classement reste celui de `meilleursCandidats` (`lib/quiz-engine.ts`), les candidats à égalité sont listés par note (plus de question de départage)
- `components/ui/` — shadcn/ui components (Tailwind CSS v4)
- `app/components/MyrtilleEasterEgg.tsx` — Code secret : taper `myrtille` au clavier (hors champ de saisie) ouvre la vue 3D d'Agroparc en overlay ; le retaper referme. Écouteur pur dans `lib/agroparc3d/myrtille.ts` (testé).
- `app/components/Agroparc3D.tsx` — Vue 3D « rayons X » (three.js chargé à la demande) : bâtiments fil de fer, restaurants cliquables (plat du jour via `/api/pdj?date=` avec jauge rouge→vert du mode courant + carte permanente dépliable via `/api/carte?slug=`), toggle Sportif/Goulaf synchronisé avec le site (`localStorage` `pdj-mode` + événement `pdj:mode-refresh`), avion, Truck Muche (roule le long de sa voie d'arrivée puis se gare à l'est du bâtiment voisin de CBA), circulation. Scène pure three.js dans `lib/agroparc3d/scene.ts` ; helpers purs testés : `jauge.ts` (couleur/remplissage), `marqueurs.ts` (écartement des POI d'un même bâtiment), `truck.ts` (trajet), `panneau.ts` (contenu du panneau). Données dans `public/agroparc/scene.json`, générées par `scripts/agroparc/build_scene.py` (IGN BD TOPO + OSM, coordonnées locales en mètres ; voir `lib/agroparc3d/types.ts`).

### Python pipeline structure (`plats-du-jour/`)
- `scrapers/` — One module per restaurant (`bistrot_trefle.py` uses the ObyPay REST API, `pause_gourmande.py` uses Playwright, `truck_muche.py` is async FB/IG). Optionnels, synchrones (`requests`/urllib, sans Playwright) : `basilic_ngo.py` (API ObyPay comme le Trèfle, + `scrape_carte()` ObyPay), `dubble.py` (HTML Wix SSR, + `scrape_carte()` PDF saisonnier via pypdf), `la_mijote.py` (HTML statique + garde-fou fraîcheur `Last-Modified`, + `scrape_carte()` texte HTML sans plats du jour)
- `run_state.py` — État reprenable du run ; distingue `CORE_LABELS` (les 3 historiques, requis pour un run complet) et `OPTIONAL_LABELS` (`None` = « pas de plat du jour », pas un échec)
- `ciqual/` — Intégration de la table Ciqual ANSES pour le calcul déterministe des macros (cf. `ciqual/README.md`)
- `agent/diet_agent.py` — Claude-based nutritional evaluation (scores dishes 1-10 in both modes). Demande au LLM des ingrédients + grammages, agrège les macros via Ciqual, fallback LLM si >30% non matché.
- `agent/carte_agent.py` — Structuration LLM d'une carte à partir de texte brut (PDF Dubble, HTML La Mijote) + `_texte_hash` ; appelé seulement quand le hash change
- `agent/comment_agent.py` — Generates in-character comments from persona JSON files
- `agent/repair_team.py` — Auto-fixes scraper failures
- `agent/feedback_agent.py` — Syncs human comment feedback into character profiles
- `personnages/` — JSON files defining each character's personality, tone, food preferences (used by comment_agent)
- `messages.py` — Generates formatted message files for the week
- `jours_feries.py` — French public holidays detection
- `publish.py` — POSTs evaluation JSON to the Vercel API (+ `publish_plat_image`, `fetch_plat_images_existantes`, `fetch_pdj`)
- `plat_image.py` / `agent/image_agent.py` — Images IA des plats (POC) : clé, variantes, prompt, validation magic bytes (pur, testé) / fournisseurs + budget (cf. Data flow)

### Two evaluation modes
Every dish gets two scores: "Sportif" (health-focused) and "Goulaf" (taste/indulgence-focused). The frontend toggles between them client-side via `mode-sportif`/`mode-goulaf` CSS classes and `display: none`.

## Key conventions

- The app is entirely in French (UI text, comments, API error messages, variable names in domain code)
- Dates use `YYYY-MM-DD` format (ISO via `toLocaleDateString('en-CA')`)
- `@/*` path alias maps to project root
- Database: single `pdj_entries` table with `date` (unique) and `data` (JSONB containing full `PdjEntry`) ; `pdj_plat_images` (POC images IA) créée par `ensurePlatImagesTable()` et `lib/migrate.mjs`
- The `/api/update` endpoint is protected by `API_SECRET_TOKEN` (Bearer auth)
- Python deps: `playwright`, `anthropic`, `python-dotenv`, `requests`
- Environment: `.env.local` for Next.js (Vercel Postgres vars + API_SECRET_TOKEN), `plats-du-jour/.env` for Python (same token + VERCEL_API_URL + ANTHROPIC_API_KEY ; optionnels images IA : CF_ACCOUNT_ID/CF_API_TOKEN, AIHORDE_API_KEY, PDJ_IMAGES*, cf. `.env.example`)
