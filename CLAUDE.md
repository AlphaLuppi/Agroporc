# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Plats du Jour" (PDJ) — a daily lunch menu aggregator for office restaurants. Two main components:

1. **Python backend** (`plats-du-jour/`): Scrapes menus from 3 restaurants (Le Bistrot Trèfle, La Pause Gourmande, Le Truck Muche), evaluates them with AI agents, generates comments from fictional characters, and publishes to the Vercel API.
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
python main.py commentaires <name>  # Generate comments for one character
python main.py sync-feedback        # Sync human feedback into character profiles
```

Cron automation: `cron_pdj.sh [jour|semaine]`

## Architecture

### Data flow
Python scrapers → AI diet agent evaluation → AI comment generation → `publish.py` POSTs to `/api/update` → Vercel Postgres (`pdj_entries` table, JSONB column) → Next.js SSR reads from DB

### Frontend structure
- `app/page.tsx` — Main page (SSR), builds the full week view with day tabs, mode selector, plat cards
- `app/CommentSection.tsx` / `app/CommentForm.tsx` — Client components for the comment system
- `app/historique/` — History page
- `app/api/` — API routes: `update` (auth-protected ingestion), `commentaire` (rate-limited user comments), `pdj` (read), `historique`, `feedback-ia`
- `lib/db.ts` — Vercel Postgres queries, types (`PdjEntry`, `Plat`, `Commentaire`, `Recommandation`)
- `lib/characters.ts` — Character definitions (avatars, colors, emojis) used in both comments and UI
- `lib/format.ts` — French date formatting
- `lib/icons.ts` — Restaurant icon SVGs
- `components/ui/` — shadcn/ui components (Tailwind CSS v4)

### Python pipeline structure (`plats-du-jour/`)
- `scrapers/` — One module per restaurant (`bistrot_trefle.py` uses Playwright, `pause_gourmande.py` and `truck_muche.py` are async)
- `agent/diet_agent.py` — Claude-based nutritional evaluation (scores dishes 1-10 in both modes)
- `agent/comment_agent.py` — Generates in-character comments from persona JSON files
- `agent/repair_team.py` — Auto-fixes scraper failures
- `agent/feedback_agent.py` — Syncs human comment feedback into character profiles
- `personnages/` — JSON files defining each character's personality, tone, food preferences (used by comment_agent)
- `messages.py` — Generates formatted message files for the week
- `jours_feries.py` — French public holidays detection
- `publish.py` — POSTs evaluation JSON to the Vercel API

### Two evaluation modes
Every dish gets two scores: "Sportif" (health-focused) and "Goulaf" (taste/indulgence-focused). The frontend toggles between them client-side via `mode-sportif`/`mode-goulaf` CSS classes and `display: none`.

## Key conventions

- The app is entirely in French (UI text, comments, API error messages, variable names in domain code)
- Dates use `YYYY-MM-DD` format (ISO via `toLocaleDateString('en-CA')`)
- `@/*` path alias maps to project root
- Database: single `pdj_entries` table with `date` (unique) and `data` (JSONB containing full `PdjEntry`)
- The `/api/update` endpoint is protected by `API_SECRET_TOKEN` (Bearer auth)
- Python deps: `playwright`, `anthropic`, `python-dotenv`, `requests`
- Environment: `.env.local` for Next.js (Vercel Postgres vars + API_SECRET_TOKEN), `plats-du-jour/.env` for Python (same token + VERCEL_API_URL + ANTHROPIC_API_KEY)
