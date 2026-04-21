# Plats du Jour (PDJ)

Agrégateur de menus du midi pour les restaurants d'entreprise. Scrape les menus, les évalue avec des agents IA, génère des commentaires de personnages fictifs, et affiche le tout sur un site web.

**Site live** : [agroporc.vercel.app](https://agroporc.vercel.app)

## Comment ça marche

```
Scrapers Python → Agent diététicien (Claude) → Agent commentateur → POST /api/update → Vercel Postgres → Next.js SSR
```

1. **Scraping** : Trois scrapers récupèrent les menus quotidiens (Playwright pour Le Bistrot Trèfle, HTTP pour La Pause Gourmande et Le Truck Muche)
2. **Évaluation** : Un agent Claude note chaque plat de 1 à 10 dans deux modes — *Sportif* (santé) et *Goulaf* (gourmandise)
3. **Commentaires** : Des personnages fictifs (définis en JSON dans `personnages/`) réagissent aux menus selon leur personnalité
4. **Publication** : Les résultats sont envoyés à l'API Vercel et stockés en JSONB
5. **Affichage** : Le frontend Next.js affiche les menus de la semaine avec onglets par jour, bascule sportif/goulaf, et section commentaires

## Stack technique

| Composant | Technos |
|-----------|---------|
| Frontend | Next.js 15, React 19, Tailwind CSS v4, shadcn/ui |
| Backend API | Next.js API Routes (Vercel) |
| Base de données | Vercel Postgres (table unique `pdj_entries`, colonne JSONB) |
| Pipeline Python | Playwright, Anthropic SDK (Claude), requests |
| Déploiement | Vercel (frontend), Docker (pipeline cron) |

## Structure du projet

```
├── app/                    # Pages et API Next.js
│   ├── page.tsx            # Page principale (menus de la semaine)
│   ├── api/                # Routes API (update, commentaire, pdj, etc.)
│   ├── ia/                 # Page profils IA
│   └── idees/              # Page boîte à idées
├── lib/                    # Utilitaires (DB, personnages, formatage)
├── components/ui/          # Composants shadcn/ui
├── public/                 # Assets statiques (avatars, favicon)
└── plats-du-jour/          # Pipeline Python
    ├── scrapers/           # Un module par restaurant
    ├── agent/              # Agents IA (diététicien, commentateur, repair)
    ├── personnages/        # Profils JSON des personnages fictifs
    ├── main.py             # Point d'entrée CLI
    ├── publish.py          # Publication vers l'API Vercel
    └── Dockerfile          # Image Docker pour le cron
```

## Installation

### Frontend (Next.js)

```bash
npm install
cp .env.example .env.local
# Remplir les variables Vercel Postgres + API_SECRET_TOKEN
npm run db:migrate
npm run dev
```

### Pipeline Python

```bash
cd plats-du-jour
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
# Remplir les variables (token Anthropic, Giphy, credentials Facebook, etc.)
```

## Utilisation

### Pipeline

```bash
cd plats-du-jour
source .venv/bin/activate

python main.py semaine              # Pipeline complet du lundi : scrape toute la semaine + commentaires
python main.py jour                 # Pipeline quotidien : scrape le menu du jour
python main.py commentaires <nom>   # Générer les commentaires d'un personnage
python main.py sync-feedback        # Synchroniser le feedback humain dans les profils
```

### Docker (cron automatique)

```bash
cd plats-du-jour
docker compose up -d
# Lundi 9h30 : pipeline semaine
# Mardi-vendredi 9h30 : pipeline jour
```

## Variables d'environnement

### Frontend (`.env.local`)

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | URL de connexion Vercel Postgres |
| `API_SECRET_TOKEN` | Token Bearer pour protéger `/api/update` |

### Pipeline Python (`plats-du-jour/.env`)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Clé API Claude (ou OAuth via Keychain) |
| `VERCEL_API_URL` | URL du site Vercel |
| `API_SECRET_TOKEN` | Même token que le frontend |
| `GIPHY_API_KEY` | Clé API Giphy pour les GIFs dans les commentaires |
| `FACEBOOK_EMAIL` / `FACEBOOK_PASSWORD` | Credentials pour scraper Le Truck Muche |

## Licence

MIT
